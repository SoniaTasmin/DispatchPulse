# Work-order lifecycle

Status: implemented · Owner: Work Order API · Code: `apps/api/src/work-orders/`

## Problem

Dispatchers assign field technicians to work orders. Without server-side rules, a work order
can jump to an impossible state (OPEN straight to COMPLETED), and two dispatchers acting at the
same moment can give one technician two jobs. Downstream services also need to learn about every
state change, and must never hear about a change that was rolled back.

## Requirements

1. Only these transitions are legal: OPEN → ASSIGNED → IN_PROGRESS → COMPLETED.
2. A technician can be assigned only if they have the required skill, are AVAILABLE and work in
   the work order's city. Dispatchers can see why a technician is not eligible.
3. A technician holds at most one active work order, even under concurrent requests.
4. Every successful change records exactly one integration event, atomically with the change.
5. Rejected requests change nothing.

## Proposed behaviour

```
OPEN ──assign──► ASSIGNED ──start──► IN_PROGRESS ──complete──► COMPLETED
                 technician → BUSY                              technician → AVAILABLE
```

| Command | Preconditions | Writes, in one transaction |
|---|---|---|
| create | skill exists | work order (OPEN), `workorder.created` |
| assign | status OPEN, technician eligible | technician BUSY, work order ASSIGNED + `technician_id` + `assigned_at`, `workorder.assigned` |
| start | status ASSIGNED | work order IN_PROGRESS + `started_at`, `workorder.started` |
| complete | status IN_PROGRESS | work order COMPLETED + `completed_at`, technician AVAILABLE, `workorder.completed` |

Eligibility reasons: `MISSING_SKILL`, `NOT_AVAILABLE` (BUSY or OFF_DUTY), `DIFFERENT_CITY`
(case-insensitive). One function (`checkEligibility`) serves both the matches endpoint and the
assign command.

## Contract

| Endpoint | Success | Errors |
|---|---|---|
| `POST /work-orders` `{title, description?, city, requiredSkill}` | 201 | 400 validation, 422 unknown skill |
| `GET /work-orders?status=&limit=` (limit 1–100, default 50) | 200 newest first | 400 |
| `GET /work-orders/:id` | 200 | 404 |
| `GET /work-orders/:id/technician-matches` | 200 `[{technician, eligible, reasons}]` | 404 |
| `POST /work-orders/:id/assign` `{technicianId}` | 200 | 404; 409 wrong status, technician not available, concurrent change; 422 technician missing, lacks skill or in another city |
| `POST /work-orders/:id/start` · `/complete` | 200 | 404, 409 |
| `GET /technicians`, `GET /skills` | 200 | none |

**409 vs 422:** 409 means the request conflicts with current state and could succeed later (the
technician may become available). 422 means it can never succeed as sent (wrong skill or city).

Outbox event envelope (`outbox_events.payload`, published to RabbitMQ by the outbox relay):
`{ eventId, eventType, schemaVersion: 1, occurredAt, workOrderId, data }`, where `data` is
`{title, city, requiredSkill}` for created, `{technicianId, technicianName}` for assigned and
`{technicianId}` for started and completed.

## Failure cases

| Case | Behaviour |
|---|---|
| Illegal transition (e.g. OPEN → complete) | 409 before any write |
| Two requests assign one technician to different work orders | One 200, the other 409: its `UPDATE technicians … WHERE status='AVAILABLE'` matches no row after the winner commits |
| Two requests change the same work order | Compare-and-set `UPDATE work_orders … WHERE id=? AND status=<status read>`; the loser gets 409 |
| Any error inside the transaction | Full rollback: no status change, no technician change, no outbox row |
| Database bypassing the API | CHECK constraint: a work order has a technician exactly when it is not OPEN |

## Decisions

- **Action endpoints** (`/assign`, `/start`, `/complete`) instead of `PATCH {status}`: each
  transition has its own preconditions and side effects.
- **Conditional updates, not `SELECT … FOR UPDATE`:** the eligibility check before the
  transaction gives a clear error; the `WHERE status = …` clause inside it guarantees
  correctness. No version column needed.
- **Lock order: technician first.** Setting `work_orders.technician_id` takes a shared lock on the
  technician row (the foreign-key check). Updating the work order first let two concurrent
  assigns each hold that shared lock and then both wait for an exclusive one, a deadlock
  (MySQL 1213) that the concurrency test caught. Claiming the technician first makes the second
  request wait, then see BUSY and return 409.
- **Transactional outbox:** the event row commits with the state change, so there is never an
  event for a rolled-back change and never a change without an event.

## Index check

`GET /work-orders?status=OPEN` runs
`SELECT … WHERE status='OPEN' ORDER BY created_at DESC, id DESC LIMIT 50`, served by
`INDEX(status, created_at)`. Measured on 20,011 rows (2,009 OPEN):

| | Plan | Rows read | Time |
|---|---|---|---|
| With index | `ref` lookup, `Backward index scan`, no filesort | 50 | 3.5 ms |
| `IGNORE INDEX` | full table scan + filesort | 20,011 | 94.7 ms |

The `id DESC` tie-breaker needs no extra index column: InnoDB secondary indexes already end with
the primary key.

## Trade-offs and open questions

- No cancel, unassign or reassign yet; an assigned technician stays BUSY until completion.
- No authentication: start and complete are trusted to come from the assigned technician.
- Matching evaluates every technician in memory, fine for hundreds; at larger scale, pre-filter
  by skill and city in SQL and keep `checkEligibility` for the reasons.
- `POST /work-orders` is not idempotent; a retried request creates a second order
  (an `Idempotency-Key` header would fix this).
