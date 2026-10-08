import { collectDefaultMetrics, Counter } from '@prometheus-io/client';
import { WORK_ORDER_EVENT_TYPES } from './event-envelope';
import { FAILURE_REASONS } from './failure-policy';

// Labels have small fixed value sets: event type (4 + "unknown"), outcome, failure reason.
// Event IDs and error messages belong in logs, never in labels.

collectDefaultMetrics(); // process CPU, memory, event-loop lag

export const EVENT_TYPE_LABELS = [
  ...WORK_ORDER_EVENT_TYPES,
  'unknown',
] as const;
export type EventTypeLabel = (typeof EVENT_TYPE_LABELS)[number];

/** Final successful outcomes. A duplicate delivery is a success: the work was already done. */
export const eventsHandledTotal = new Counter({
  name: 'notification_events_total',
  help: 'Events finished successfully, by event type and outcome (processed or duplicate)',
  labelNames: ['event_type', 'outcome'] as const,
});

/** Intermediate failures that were scheduled for another attempt. Not a final outcome. */
export const eventRetriesTotal = new Counter({
  name: 'notification_event_retries_total',
  help: 'Failed processing attempts that were scheduled for retry, by event type and reason',
  labelNames: ['event_type', 'reason'] as const,
});

/** Final failures: the event went to the dead-letter queue. */
export const eventsDeadLetteredTotal = new Counter({
  name: 'notification_events_dead_lettered_total',
  help: 'Events sent to the dead-letter queue, by event type and reason',
  labelNames: ['event_type', 'reason'] as const,
});

// Start every known series at 0 so increase() sees the first event (the alert relies on it).
for (const event_type of EVENT_TYPE_LABELS) {
  for (const outcome of ['processed', 'duplicate']) {
    eventsHandledTotal.inc({ event_type, outcome }, 0);
  }
  for (const reason of FAILURE_REASONS) {
    eventRetriesTotal.inc({ event_type, reason }, 0);
    eventsDeadLetteredTotal.inc({ event_type, reason }, 0);
  }
}

export function eventTypeLabel(type: unknown): EventTypeLabel {
  return EVENT_TYPE_LABELS.find((known) => known === type) ?? 'unknown';
}
