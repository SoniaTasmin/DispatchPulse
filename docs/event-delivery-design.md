# Event delivery

Status: implemented · Producer: Work Order API (`apps/api/src/outbox/`) ·
Consumer: Notification Worker (`apps/notification-worker/`)

## Problem

Work-order changes must reach other services (today: notifications) without slowing down or
breaking the API, without losing events when RabbitMQ or the worker is down, and without
creating duplicate side effects when a message is delivered more than once.

Writing to MySQL and then publishing to RabbitMQ is a dual write: a crash or broker outage
between the two loses the event, and publishing first can announce a change that then rolls back.

## Delivery guarantee

**At-least-once delivery + idempotent consumer.** Every committed change produces its event
at least once; the worker turns repeated deliveries of one event into exactly one notification
row. This is *not* exactly-once delivery, and the system never claims it.

## Event envelope

```json
{
  "eventId": "554c1624-0c13-42e3-92f8-1c887d68e047",
  "eventType": "workorder.completed",
  "schemaVersion": 1,
  "occurredAt": "2026-10-08T10:49:15.263Z",
  "workOrderId": 5,
  "data": { "technicianId": 2 }
}
```

| eventType (= routing key) | data |
|---|---|
| `workorder.created` | `title`, `city`, `requiredSkill` |
| `workorder.assigned` | `technicianId`, `technicianName` |
| `workorder.started`, `workorder.completed` | `technicianId` |

AMQP properties: `messageId` = `eventId`, `type` = `eventType`, persistent, JSON. The worker
validates the envelope itself (it does not import the API's types).

## Topology

```
                            routing key workorder.*
 API ──publish──► workorder.events ──────────────► notification-worker.events ──► worker
     (confirms,   (topic exchange)                  ▲         │ nack (no requeue)
      mandatory)                      TTL expires,  │         ▼
                                      default exch. │   notification-worker.dlx (fanout)
                         notification-worker.retry ─┘         │
                                  ▲                           ▼
                                  └── worker republishes ── notification-worker.dlq
```

| Object | Type | Owner (declares it) | Notes |
|---|---|---|---|
| `workorder.events` | topic exchange, durable | API (worker re-declares to bind) | One exchange for all work-order events |
| `notification-worker.events` | queue, durable | Worker | Bound with `workorder.*`; dead-letters to `.dlx` |
| `notification-worker.retry` | queue, durable | Worker | No consumer. Per-message TTL; expired messages go via the default exchange straight back to `.events`, so a retry never reaches other subscribers |
| `notification-worker.dlx` | fanout exchange | Worker | |
| `notification-worker.dlq` | queue, durable | Worker | Needs a human |

## Transactional outbox

1. Each command writes the state change **and** an `outbox_events` row in one MySQL transaction.
2. The relay (a 1 s timer inside the API process, never overlapping itself) reads up to 50
   unpublished rows, oldest first, and publishes each on a confirm channel with `mandatory`.
3. `published_at` is set only after RabbitMQ confirms the message. A failure (no connection,
   nack, or returned as unroutable) leaves the row pending, records `publish_attempts` and
   `last_error`, and stops the batch so later events do not overtake it.

`mandatory` matters: without it, an event published before any queue is bound is confirmed and
silently dropped. With it, RabbitMQ returns the message and the row stays pending until a
consumer has declared its queue.

## Worker processing and retries

| Situation | Action |
|---|---|
| Valid event, insert succeeds | ack; outcome `created` |
| Insert hits UNIQUE(`event_id`) | ack; outcome `duplicate` (already handled) |
| Invalid message (bad JSON, envelope or data) | nack without requeue → DLQ immediately; retrying cannot help |
| Other failure, attempt < `MAX_ATTEMPTS` (3) | republish to `.retry` with `x-attempt + 1` and a `RETRY_DELAY_MS` (5 s) TTL, wait for the confirm, then ack the original |
| Other failure on the last attempt | nack without requeue → DLQ |

Retries are bounded so a message that keeps failing cannot loop forever, consume worker capacity
or hide a real fault. It ends in the DLQ, where it is visible and can be replayed by hand
after the fix (re-publish it from the management UI, or enable the shovel plugins to move
messages in bulk); replay is safe because processing is idempotent. There is no
immediate-requeue path.

`SIMULATE_FAILURE_EVENT_TYPES=workorder.completed` makes the worker throw for that type, for
the demo only (`scripts/failure-demo.sh`).

## Idempotency

`notifications.event_id` has a UNIQUE index, and the insert itself is the check. A
"select, then insert if absent" check would let two concurrent deliveries both see "absent";
the constraint lets exactly one insert succeed and the other fails with a duplicate-key error,
which the worker treats as success.

## Failure cases

| What happens | Result |
|---|---|
| API crashes after the MySQL commit, before publishing | Row stays pending; the relay publishes it after restart. Nothing lost |
| RabbitMQ confirms, API crashes before setting `published_at` | Row still pending → published again → **duplicate** → absorbed by UNIQUE(`event_id`) |
| RabbitMQ down | API requests still succeed; events wait in the outbox and are published after recovery (demo: stop broker, create order, start broker) |
| Worker inserts, crashes before ack | RabbitMQ redelivers the unacked message → **duplicate** → acked as `duplicate` |
| Worker republishes a retry, crashes before acking the original | Original redelivered and retry copy delivered → **duplicate** → absorbed |
| Poison (invalid) message | DLQ on first attempt |
| Database down in the worker | Retried, then DLQ after 3 attempts; replay once fixed |

## Ordering

Not guaranteed. The relay publishes in `created_at` order, but the worker handles up to 10
messages concurrently (prefetch 10); in testing `workorder.started` was processed before
`workorder.created` of the same work order. Retries reorder further. This application does
not need ordering: each notification is independent. If it did, options are a per-work-order
sequence number checked by the consumer, or a single active consumer with prefetch 1 and no
delayed retries, at a large throughput cost.

## Known limitations and trade-offs

- **One relay instance.** Several API replicas would each publish the same rows (safe, because
  consumers are idempotent, but wasteful). Fix: claim rows with `SELECT … FOR UPDATE SKIP LOCKED`.
- **Pending rows retry forever** and an unroutable event logs a warning every second; no alert yet.
  A connection failure does not count as a per-row `publish_attempt`.
- **Outbox rows are never deleted.** A cleanup job for old published rows is needed in production.
- **Fixed retry delay, no backoff.** Per-message TTL only expires at the head of the retry queue;
  with one fixed delay that is correct.
- **DLQ messages do not carry the error.** `x-attempt` and RabbitMQ's `x-death` show the path;
  the reason is in the worker log, searchable by `eventId`. `x-death` records only the last
  retry hop because each retry is a new message; `x-attempt` is the authoritative count.
- **Reconnect is a fixed 5 s loop** in the worker (the relay simply reconnects on its next poll).
- **Delays are wall-clock.** When the host stalled under memory pressure during testing, a
  5 s retry fired 12 minutes late. Correctness held; only latency suffered.
