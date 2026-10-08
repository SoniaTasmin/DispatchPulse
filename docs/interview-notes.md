# Interview notes

Personal notes for explaining DispatchPulse. Every answer points at something in this repo.

## Node.js and the event loop

- **Built:** two Node 24 processes. The API's outbox relay is a 1 s `setInterval`; the worker
  handles up to 10 RabbitMQ messages concurrently.
- **Why:** all of this work is I/O (MySQL, RabbitMQ, HTTP), which Node handles well on one
  thread with async/await.
- **Trade-off:** concurrency is per process; CPU-heavy work would block every request, so
  nothing CPU-heavy runs in these services.
- **Q:** What happens if the relay's timer fires while the previous run is still going?
- **A:** Nothing extra. `publishPending()` keeps the current run's promise; a second call
  joins it instead of starting another (`outbox-relay.ts`). Errors in the timer callback are
  caught and logged, because an unhandled rejection would otherwise go unnoticed — and in the
  worker, a rejection inside the consume callback would leave the message unacked forever.

## NestJS

- **Built:** modules per feature (work orders, technicians, outbox, metrics), providers
  injected by constructor, a global `ValidationPipe`, config validated at start-up.
- **Why:** clear boundaries and DI without writing a container; familiar from ASP.NET Core.
- **Trade-off:** no repository layer over Prisma — Prisma already is the data-access layer.
- **Q:** How does shutdown work?
- **A:** `enableShutdownHooks()`. The relay and consumer stop in `onModuleDestroy`; Prisma
  disconnects in `onApplicationShutdown`, the last phase, so in-flight work can still write.
  The containers stop in about 1.5 s with exit code 0.

## REST

- **Built:** `POST /work-orders`, list and detail, `GET …/technician-matches`, and action
  endpoints `POST …/assign`, `…/start`, `…/complete`.
- **Why action endpoints:** each transition has its own preconditions and side effects; a
  generic `PATCH {status}` would hide them.
- **Trade-off:** `POST /work-orders` is not idempotent; a retried request creates a duplicate.
  The fix would be an `Idempotency-Key` header.
- **Q:** 409 or 422?
- **A:** 409 when the request conflicts with current state and could succeed later
  (technician busy, work order already assigned). 422 when it can never succeed as sent
  (technician lacks the skill or works in another city, unknown skill).

## MySQL

- **Built:** five tables in the API database, one in the worker's. FKs, composite PK on
  `technician_skills`, a CHECK that a work order has a technician exactly when it is not OPEN,
  `INDEX(status, created_at)` for the filtered list.
- **Why:** the database protects invariants even if application code has a bug.
- **Trade-off:** Prisma cannot express CHECK constraints, so that line is hand-written in the
  migration.
- **Q:** How do you know the index is used?
- **A:** `EXPLAIN` on 20,011 rows: `ref` on the index with a backward index scan and no
  filesort, 50 rows read in 3.5 ms; with `IGNORE INDEX` a full scan plus filesort took
  94.7 ms. The `id DESC` tie-break is free because InnoDB secondary indexes end with the PK.

## Concurrency

- **Built:** assignment claims the technician with `UPDATE … WHERE id = ? AND status =
  'AVAILABLE'` and moves the work order with `UPDATE … WHERE id = ? AND status = <read
  status>`. Zero rows changed means someone else won: 409.
- **Why:** the eligibility check runs before the transaction and can be stale; the
  conditional update is the real guard. No version column, no `SELECT … FOR UPDATE`.
- **Trade-off:** the loser gets an error to retry rather than a queue.
- **Q:** Tell me about a bug you found.
- **A:** The concurrent-assignment test returned 500, not 409: MySQL deadlock 1213. Setting
  `work_orders.technician_id` takes a shared lock on the technician row (FK check); both
  requests held that and then both wanted an exclusive lock. Claiming the technician first
  fixed it — the second request now waits, sees BUSY and gets 409.

## Transactions

- **Built:** each command runs in one Prisma interactive transaction: state change, technician
  update and outbox insert.
- **Why:** all or nothing — never an event for a rolled-back change.
- **Trade-off:** a transaction per request; fine at this scale.
- **Q:** How do you prove a rejected request changed nothing?
- **A:** The illegal-transition test checks the status is unchanged *and* that no outbox row
  exists for that work order.

## React

- **Built:** two routes (list with create form; details with timeline, the one valid action and
  technician matches), semantic HTML, keyboard-operable, plain CSS.
- **Why:** small enough to understand fully; the matches table with reasons is the product
  feature.
- **Trade-off:** no frontend tests; behaviour is covered by backend tests and a scripted
  browser walkthrough.
- **Q:** Why does the UI hide invalid actions if the server enforces them?
- **A:** Convenience only. The page shows a snapshot that may be stale; the server is the
  authority and answers 409.

## Redux / RTK Query

- **Built:** one RTK Query API slice (typed endpoints, tags) and one tiny toast slice. Form
  fields are `useState`; the status filter lives in the URL.
- **Why:** RTK Query provides caching, loading and error state and refetching after mutations
  without hand-written thunks.
- **Trade-off:** no optimistic updates; the page refetches after each action.
- **Q:** How does the page refresh after assign? What about a 409?
- **A:** `assignWorkOrder` invalidates `WorkOrder/<id>`, `WorkOrder/LIST` and
  `Technician/LIST` (the technician is now busy everywhere). Lifecycle mutations invalidate
  even on failure, so a 409 refetches the real state. I also hit a stale-data bug: `data` shows
  the previous filter's rows while a new filter loads; `currentData` fixed it.

## RabbitMQ

- **Built:** topic exchange `workorder.events`; the worker owns its queue (bound to
  `workorder.*`), a retry queue and a dead-letter exchange and queue. Publisher confirms, manual
  acks, prefetch 10.
- **Why:** notifications must not slow down or break the API.
- **Trade-off:** the consumer declares its own queue, so an event published before any queue
  exists would be unroutable.
- **Q:** What if the API publishes before the worker has ever started?
- **A:** The relay publishes with `mandatory`; RabbitMQ returns the unroutable message, the
  relay treats it as a failure and the row stays pending until a queue is bound. Without that,
  RabbitMQ confirms and silently drops it — I verified both.

## Transactional outbox

- **Built:** `outbox_events` written in the business transaction; a relay polls every second,
  publishes oldest first and sets `published_at` only after the broker confirms.
- **Why:** the dual-write problem — MySQL and RabbitMQ cannot commit atomically.
- **Trade-off:** up to ~1 s extra latency, and one relay instance (several would need
  `SELECT … FOR UPDATE SKIP LOCKED`).
- **Q:** What if the API crashes after RabbitMQ confirms but before `published_at` is set?
- **A:** The row is still pending, so it is published again: a duplicate. That is why
  delivery is at-least-once and the consumer must be idempotent.

## Idempotency

- **Built:** `UNIQUE(event_id)` on `notifications`; a duplicate-key error is treated as
  "already processed" and acked.
- **Why:** duplicates are expected (relay crash, worker crash before ack, retry publish then
  crash).
- **Trade-off:** works because the side effect is a database row; an external email would need
  an idempotency key at the provider.
- **Q:** Why not check whether the notification exists first?
- **A:** Two concurrent deliveries would both see "not there" and both insert. The constraint
  lets exactly one win; the integration test delivers the same event twice concurrently and
  gets `created` + `duplicate`.

## Retries and DLQ

- **Built:** on failure the worker republishes to the retry queue with `x-attempt + 1` and a
  5 s TTL, waits for the confirm, then acks. Expired messages return to the worker queue.
  After 3 attempts, or immediately for invalid messages, `nack` without requeue → DLQ.
- **Why:** bounded, delayed retries; no hot requeue loop; poison messages are parked.
- **Trade-off:** fixed delay; the DLQ message carries `x-attempt` but not the error text (it is
  in the logs, searchable by event ID). Replay is manual.
- **Q:** Is ordering guaranteed?
- **A:** No — prefetch 10 means concurrent handling (I saw `started` processed before
  `created`), and retries reorder further. Notifications are independent, so it is fine here.

## Docker

- **Built:** multi-stage Dockerfiles (shared base with OpenSSL, build, runtime), production
  dependencies only, `USER node`, `exec node` as PID 1, Compose with health checks.
- **Why:** reproducible start with one command; graceful SIGTERM.
- **Trade-off:** migrations and seed run on container start — fine for one replica only.
- **Q:** Anything go wrong building the images?
- **A:** The build stage had no OpenSSL, so Prisma downloaded its OpenSSL 1.1 engine while
  the runtime has OpenSSL 3; migrations would have failed on start. A shared base stage fixed
  it. I checked the engine file inside the image.

## Prometheus

- **Built:** HTTP counter and latency histogram (method, route template, status), transition
  counter, outbox pending gauge, publish-failure counter, worker outcome/retry/dead-letter
  counters. Every series starts at 0.
- **Why:** route templates keep cardinality bounded; zero-initialised series let `increase()`
  see the first event, which the alert relies on.
- **Trade-off:** 5 s scrape interval for demos; 15–60 s is typical.
- **Q:** How is p95 computed?
- **A:** `histogram_quantile(0.95, sum by (le)(rate(http_request_duration_seconds_bucket[5m])))`:
  find the bucket where 95% of requests have completed and interpolate inside it — an
  estimate bounded by the bucket edges.

## Grafana

- **Built:** one dashboard and the datasource, provisioned from files, so a fresh volume shows
  it with no clicks.
- **Why:** one screen tells the story: traffic, outbox backlog, retries, dead-letters, SLOs,
  alert state.
- **Trade-off:** anonymous read-only access for local demos.
- **Q:** What does the outage look like?
- **A:** Pending outbox events rise (3 in the demo), `broker_unavailable` publish failures
  climb once per poll, API availability stays at 100%; after restart the backlog drains to 0.

## SLI / SLO

- **Built:** API availability = non-5xx / all requests; event processing = (processed +
  duplicate) / (those + dead-lettered, excluding simulated); both 99%. One alert:
  `increase(notification_events_dead_lettered_total[10m]) > 0`.
- **Why:** SLI is what you measure, SLO the target, the error budget the 1% you may fail.
  4xx counts as good service: the API handled a bad request correctly. Retries are not final
  outcomes.
- **Trade-off:** the alert resolves after 10 minutes even if the message is still in the DLQ;
  a queue-depth alert would be better. No Alertmanager because there is nowhere to route yet.
- **Q:** Why exclude simulated failures?
- **A:** They are a demo switch, not a real fault. In the demo the event SLO stayed at 100%;
  counting the simulated failure would have shown 96.8%.
