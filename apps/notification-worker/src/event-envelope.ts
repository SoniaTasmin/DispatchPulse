import { plainToInstance } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsUUID,
  Min,
  validateSync,
} from 'class-validator';

// The contract lives in docs/event-delivery-design.md. The worker validates it itself rather
// than importing the API's types, so a bad producer cannot push bad data past this point.
export const WORK_ORDER_EVENT_TYPES = [
  'workorder.created',
  'workorder.assigned',
  'workorder.started',
  'workorder.completed',
] as const;
export type WorkOrderEventType = (typeof WORK_ORDER_EVENT_TYPES)[number];

export class EventEnvelope {
  @IsUUID()
  eventId!: string;

  @IsIn(WORK_ORDER_EVENT_TYPES)
  eventType!: WorkOrderEventType;

  @Equals(1)
  schemaVersion!: 1;

  @IsISO8601({ strict: true })
  occurredAt!: string;

  @IsInt()
  @Min(1)
  workOrderId!: number;

  @IsObject()
  data!: Record<string, unknown>;
}

/** A message that can never be processed. Retrying it is pointless. */
export class InvalidEventError extends Error {}

export function parseEventEnvelope(content: Buffer): EventEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf8'));
  } catch {
    throw new InvalidEventError('Message body is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidEventError('Message body is not a JSON object');
  }

  const envelope = plainToInstance(EventEnvelope, raw);
  const problems = validateSync(envelope).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );
  if (problems.length > 0) {
    throw new InvalidEventError(
      `Invalid event envelope: ${problems.join('; ')}`,
    );
  }
  return envelope;
}
