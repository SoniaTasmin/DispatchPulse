import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TechnicianStatus } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';

interface WorkOrderBody {
  id: number;
  status: string;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface ErrorBody {
  message: string | string[];
}

describe('Work orders API (integration, real MySQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // Listening on a real port lets concurrent requests share one server.
    await app.listen(0);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.technician.deleteMany();
    for (const code of ['NETWORKING', 'PRINTER']) {
      await prisma.skill.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
    }
  });

  const api = () => request(app.getHttpServer());

  const createTechnician = (name = 'Rahim Uddin') =>
    prisma.technician.create({
      data: {
        name,
        city: 'Dhaka',
        status: TechnicianStatus.AVAILABLE,
        skills: { create: [{ skillCode: 'NETWORKING' }] },
      },
    });

  const createWorkOrder = async (title = 'Repair POS terminal') => {
    const response = await api()
      .post('/work-orders')
      .send({ title, city: 'Dhaka', requiredSkill: 'NETWORKING' })
      .expect(201);
    return response.body as WorkOrderBody;
  };

  const outboxEventTypes = async (workOrderId: number) => {
    const events = await prisma.outboxEvent.findMany({
      where: { workOrderId },
      orderBy: { createdAt: 'asc' },
    });
    return events.map((e) => e.eventType);
  };

  it('creates a work order and its outbox event together', async () => {
    const response = await api()
      .post('/work-orders')
      .send({
        title: '  Repair POS terminal ',
        city: 'Dhaka',
        requiredSkill: 'NETWORKING',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      title: 'Repair POS terminal',
      status: 'OPEN',
      technician: null,
    });
    const [event] = await prisma.outboxEvent.findMany();
    expect(event.eventType).toBe('workorder.created');
    expect(event.publishedAt).toBeNull();
    expect(event.payload).toMatchObject({
      eventId: event.id,
      eventType: 'workorder.created',
      schemaVersion: 1,
      workOrderId: (response.body as WorkOrderBody).id,
      data: {
        title: 'Repair POS terminal',
        city: 'Dhaka',
        requiredSkill: 'NETWORKING',
      },
    });
  });

  it('rejects invalid input with 400 and stores nothing', async () => {
    const response = await api()
      .post('/work-orders')
      .send({ title: '', requiredSkill: 'NETWORKING', priority: 'high' })
      .expect(400);

    expect((response.body as ErrorBody).message).toEqual(
      expect.arrayContaining([
        'property priority should not exist',
        'title should not be empty',
        'city should not be empty',
      ]),
    );
    expect(await prisma.workOrder.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('moves through assign, start and complete', async () => {
    const technician = await createTechnician();
    const { id } = await createWorkOrder();

    const assigned = await api()
      .post(`/work-orders/${id}/assign`)
      .send({ technicianId: technician.id })
      .expect(200);
    expect(assigned.body).toMatchObject({
      status: 'ASSIGNED',
      technician: { id: technician.id, name: 'Rahim Uddin' },
    });
    expect((assigned.body as WorkOrderBody).assignedAt).not.toBeNull();
    expect(await technicianStatus(technician.id)).toBe('BUSY');

    const started = await api().post(`/work-orders/${id}/start`).expect(200);
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS' });
    expect((started.body as WorkOrderBody).startedAt).not.toBeNull();

    const completed = await api()
      .post(`/work-orders/${id}/complete`)
      .expect(200);
    expect(completed.body).toMatchObject({ status: 'COMPLETED' });
    expect((completed.body as WorkOrderBody).completedAt).not.toBeNull();
    expect(await technicianStatus(technician.id)).toBe('AVAILABLE');

    expect(await outboxEventTypes(id)).toEqual([
      'workorder.created',
      'workorder.assigned',
      'workorder.started',
      'workorder.completed',
    ]);
  });

  it('rejects an illegal transition with 409 and changes nothing', async () => {
    const { id } = await createWorkOrder();

    const response = await api()
      .post(`/work-orders/${id}/complete`)
      .expect(409);

    expect((response.body as ErrorBody).message).toBe(
      `Work order ${id} is OPEN and cannot be completed`,
    );
    const workOrder = await prisma.workOrder.findUniqueOrThrow({
      where: { id },
    });
    expect(workOrder.status).toBe('OPEN');
    expect(workOrder.completedAt).toBeNull();
    expect(await outboxEventTypes(id)).toEqual(['workorder.created']);
  });

  it('lets exactly one of two concurrent requests assign the same technician', async () => {
    const technician = await createTechnician();
    const first = await createWorkOrder('Repair POS terminal A');
    const second = await createWorkOrder('Repair POS terminal B');

    const responses = await Promise.all(
      [first, second].map(({ id }) =>
        api()
          .post(`/work-orders/${id}/assign`)
          .send({ technicianId: technician.id }),
      ),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await technicianStatus(technician.id)).toBe('BUSY');
    const assigned = await prisma.workOrder.findMany({
      where: { technicianId: technician.id },
    });
    expect(assigned).toHaveLength(1);
    expect(
      await prisma.outboxEvent.count({
        where: { eventType: 'workorder.assigned' },
      }),
    ).toBe(1);
  });

  async function technicianStatus(id: number) {
    const technician = await prisma.technician.findUniqueOrThrow({
      where: { id },
    });
    return technician.status;
  }
});
