import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { TechnicianStatus, WorkOrderStatus } from '../generated/prisma/enums';
import { workOrderTransitionsTotal } from '../metrics/metrics';
import { addOutboxEvent } from '../outbox/outbox';
import { PrismaService } from '../prisma/prisma.service';
import { checkEligibility, IneligibilityReason } from './eligibility';
import { canTransition } from './work-order-transitions';
import { CreateWorkOrderDto, ListWorkOrdersQuery } from './work-order.dto';

const { ASSIGNED, IN_PROGRESS, COMPLETED } = WorkOrderStatus;

const withTechnician = {
  technician: { select: { id: true, name: true } },
} satisfies Prisma.WorkOrderInclude;

type WorkOrder = Prisma.WorkOrderGetPayload<{ include: typeof withTechnician }>;

@Injectable()
export class WorkOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWorkOrderDto) {
    const { title, description, city, requiredSkill } = dto;
    const skill = await this.prisma.skill.findUnique({
      where: { code: requiredSkill },
    });
    if (!skill) {
      throw new UnprocessableEntityException(
        `Unknown skill '${requiredSkill}'`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.create({
        data: { title, description, city, requiredSkillCode: requiredSkill },
        include: withTechnician,
      });
      await addOutboxEvent(tx, 'workorder.created', workOrder.id, {
        title,
        city,
        requiredSkill,
      });
      return workOrder;
    });
    workOrderTransitionsTotal.inc({ to_status: WorkOrderStatus.OPEN });
    return created;
  }

  list({ status, limit }: ListWorkOrdersQuery) {
    // Served by the (status, created_at) index; id breaks ties between equal timestamps.
    return this.prisma.workOrder.findMany({
      where: { status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: withTechnician,
    });
  }

  async findOne(id: number): Promise<WorkOrder> {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id },
      include: withTechnician,
    });
    if (!workOrder) {
      throw new NotFoundException(`Work order ${id} not found`);
    }
    return workOrder;
  }

  async technicianMatches(id: number) {
    const workOrder = await this.findOne(id);
    // ponytail: evaluates every technician in memory, fine for hundreds. With thousands,
    // pre-filter in SQL by skill and city and keep checkEligibility for the reasons.
    const technicians = await this.prisma.technician.findMany({
      include: { skills: true },
      orderBy: { name: 'asc' },
    });

    return technicians
      .map(({ id, name, city, status, skills }) => {
        const skillCodes = skills.map((s) => s.skillCode);
        return {
          technician: { id, name, city, status, skills: skillCodes },
          ...checkEligibility({ status, city, skillCodes }, workOrder),
        };
      })
      .sort((a, b) => Number(b.eligible) - Number(a.eligible));
  }

  async assign(id: number, technicianId: number): Promise<WorkOrder> {
    const workOrder = await this.findOne(id);
    this.assertCanTransition(workOrder, ASSIGNED);

    const technician = await this.prisma.technician.findUnique({
      where: { id: technicianId },
      include: { skills: true },
    });
    if (!technician) {
      throw new UnprocessableEntityException(
        `Technician ${technicianId} does not exist`,
      );
    }
    const { eligible, reasons } = checkEligibility(
      { ...technician, skillCodes: technician.skills.map((s) => s.skillCode) },
      workOrder,
    );
    if (!eligible) {
      throw ineligibleTechnician(technicianId, reasons);
    }

    await this.prisma.$transaction(async (tx) => {
      // The check above read the technician before this transaction started. This
      // conditional update is what stops two concurrent requests both claiming them.
      // It must run first: setting work_orders.technician_id takes a shared lock on the
      // technician row (foreign-key check), and two transactions each holding that
      // shared lock and then asking for an exclusive one deadlock.
      const claimed = await tx.technician.updateMany({
        where: { id: technicianId, status: TechnicianStatus.AVAILABLE },
        data: { status: TechnicianStatus.BUSY },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          `Technician ${technicianId} was assigned to another work order at the same time`,
        );
      }
      await this.moveStatus(tx, workOrder, ASSIGNED, {
        technicianId,
        assignedAt: new Date(),
      });
      await addOutboxEvent(tx, 'workorder.assigned', id, {
        technicianId,
        technicianName: technician.name,
      });
    });
    workOrderTransitionsTotal.inc({ to_status: ASSIGNED });
    return this.findOne(id);
  }

  async start(id: number): Promise<WorkOrder> {
    const workOrder = await this.findOne(id);
    this.assertCanTransition(workOrder, IN_PROGRESS);

    await this.prisma.$transaction(async (tx) => {
      await this.moveStatus(tx, workOrder, IN_PROGRESS, {
        startedAt: new Date(),
      });
      await addOutboxEvent(tx, 'workorder.started', id, {
        technicianId: workOrder.technicianId,
      });
    });
    workOrderTransitionsTotal.inc({ to_status: IN_PROGRESS });
    return this.findOne(id);
  }

  async complete(id: number): Promise<WorkOrder> {
    const workOrder = await this.findOne(id);
    this.assertCanTransition(workOrder, COMPLETED);
    // Non-null: the database CHECK guarantees a technician once a work order leaves OPEN.
    const technicianId = workOrder.technicianId!;

    await this.prisma.$transaction(async (tx) => {
      await this.moveStatus(tx, workOrder, COMPLETED, {
        completedAt: new Date(),
      });
      await tx.technician.update({
        where: { id: technicianId },
        data: { status: TechnicianStatus.AVAILABLE },
      });
      await addOutboxEvent(tx, 'workorder.completed', id, { technicianId });
    });
    workOrderTransitionsTotal.inc({ to_status: COMPLETED });
    return this.findOne(id);
  }

  private assertCanTransition(workOrder: WorkOrder, to: WorkOrderStatus) {
    if (!canTransition(workOrder.status, to)) {
      throw new ConflictException(
        `Cannot move work order ${workOrder.id} from ${workOrder.status} to ${to}`,
      );
    }
  }

  // Compare-and-set: the update only applies if the status is still what we read.
  // Zero rows means another request changed the work order first.
  private async moveStatus(
    tx: Prisma.TransactionClient,
    workOrder: WorkOrder,
    to: WorkOrderStatus,
    changes: Prisma.WorkOrderUncheckedUpdateManyInput,
  ) {
    const { count } = await tx.workOrder.updateMany({
      where: { id: workOrder.id, status: workOrder.status },
      data: { ...changes, status: to },
    });
    if (count === 0) {
      throw new ConflictException(
        `Work order ${workOrder.id} was changed by another request; reload and retry`,
      );
    }
  }
}

// Busy or off duty can change later, so that conflicts with current state (409).
// A missing skill or a different city can never succeed (422).
function ineligibleTechnician(
  technicianId: number,
  reasons: IneligibilityReason[],
) {
  const body = {
    message: `Technician ${technicianId} is not eligible for this work order`,
    reasons,
  };
  return reasons.every((reason) => reason === 'NOT_AVAILABLE')
    ? new ConflictException({ statusCode: 409, error: 'Conflict', ...body })
    : new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        ...body,
      });
}
