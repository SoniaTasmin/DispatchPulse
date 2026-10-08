import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';

export type WorkOrderEventType =
  | 'workorder.created'
  | 'workorder.assigned'
  | 'workorder.started'
  | 'workorder.completed';

/**
 * Records an integration event using the caller's transaction, so the event exists
 * if and only if the state change commits. OutboxRelay publishes these rows.
 */
export async function addOutboxEvent(
  tx: Prisma.TransactionClient,
  eventType: WorkOrderEventType,
  workOrderId: number,
  data: Prisma.InputJsonObject,
): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = new Date();
  await tx.outboxEvent.create({
    data: {
      id: eventId,
      eventType,
      workOrderId,
      createdAt: occurredAt,
      payload: {
        eventId,
        eventType,
        schemaVersion: 1,
        occurredAt: occurredAt.toISOString(),
        workOrderId,
        data,
      },
    },
  });
}
