import { Injectable } from '@nestjs/common';
import { Prisma } from './generated/prisma/client';
import { EventEnvelope, InvalidEventError } from './event-envelope';
import { PrismaService } from './prisma.service';

export type RecordOutcome = 'created' | 'duplicate';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores one notification per event. Deduplication is the UNIQUE(event_id) constraint,
   * not a "does it exist?" query first: two deliveries of the same event racing each other
   * would both pass such a check, but only one insert can succeed.
   */
  async record(event: EventEnvelope): Promise<RecordOutcome> {
    const { recipient, message } = describe(event);
    try {
      await this.prisma.notification.create({
        data: {
          eventId: event.eventId,
          eventType: event.eventType,
          workOrderId: event.workOrderId,
          recipient,
          message,
        },
      });
      return 'created';
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 'duplicate';
      }
      throw error;
    }
  }
}

function describe(event: EventEnvelope): {
  recipient: string;
  message: string;
} {
  const { workOrderId, data } = event;
  switch (event.eventType) {
    case 'workorder.created':
      return {
        recipient: 'dispatch',
        message: `New work order #${workOrderId}: ${text(data, 'title')} (${text(data, 'requiredSkill')}, ${text(data, 'city')})`,
      };
    case 'workorder.assigned':
      return {
        recipient: `technician:${id(data, 'technicianId')}`,
        message: `${text(data, 'technicianName')}, you have been assigned work order #${workOrderId}`,
      };
    case 'workorder.started':
      return {
        recipient: 'dispatch',
        message: `Work order #${workOrderId} started by technician ${id(data, 'technicianId')}`,
      };
    case 'workorder.completed':
      return {
        recipient: 'dispatch',
        message: `Work order #${workOrderId} completed by technician ${id(data, 'technicianId')}`,
      };
  }
}

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value === '') {
    throw new InvalidEventError(`data.${key} must be a non-empty string`);
  }
  return value;
}

function id(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new InvalidEventError(`data.${key} must be a positive integer`);
  }
  return value as number;
}
