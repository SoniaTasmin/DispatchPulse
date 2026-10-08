#!/usr/bin/env bash
# Demonstrates the two failure paths of event delivery with ordinary tools.
#
# Prerequisites (separate terminals, from the repo root):
#   docker compose up -d
#   (cd apps/api && npm run start:dev)
#   (cd apps/notification-worker && SIMULATE_FAILURE_EVENT_TYPES=workorder.completed \
#      npm run start:dev 2>&1 | tee /tmp/worker.log)
# Then:
#   WORKER_LOG=/tmp/worker.log scripts/failure-demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

API=${API:-http://localhost:3000}
WORKER_LOG=${WORKER_LOG:-/tmp/worker.log}
JSON='Content-Type: application/json'

sql() { docker compose exec -T mysql mysql -t -uroot -p"$MYSQL_ROOT_PASSWORD" -e "$1" 2>/dev/null; }
value() { docker compose exec -T mysql mysql -N -B -uroot -p"$MYSQL_ROOT_PASSWORD" -e "$1" 2>/dev/null; }
first_id() { grep -o '"id":[0-9]*' | head -1 | cut -d: -f2; }
create_order() {
  curl -sf -X POST "$API/work-orders" -H "$JSON" \
    -d "{\"title\":\"$1\",\"city\":\"Dhaka\",\"requiredSkill\":\"NETWORKING\"}" | first_id
}
wait_until() { for _ in $(seq 1 60); do eval "$1" && return 0; sleep 1; done; echo "Timed out: $1"; exit 1; }

echo "== 1. Consumer failure: retry with delay, then dead-letter queue"
id=$(create_order "Failure demo $(date +%T)")
tech=$(curl -sf "$API/work-orders/$id/technician-matches" | first_id)
curl -sf -o /dev/null -X POST "$API/work-orders/$id/assign" -H "$JSON" -d "{\"technicianId\":$tech}"
curl -sf -o /dev/null -X POST "$API/work-orders/$id/start"
curl -sf -o /dev/null -X POST "$API/work-orders/$id/complete"
echo "Work order $id: created, assigned to technician $tech, started, completed (all HTTP 200/201)"

event=$(value "SELECT id FROM dispatchpulse.outbox_events WHERE work_order_id=$id AND event_type='workorder.completed'")
echo "Waiting for event $event to exhaust its attempts..."
wait_until "grep -q '$event.*Sent to dead-letter queue' '$WORKER_LOG'"
grep "$event" "$WORKER_LOG" | sed 's/.*\[EventConsumer\] //'
docker compose exec -T rabbitmq rabbitmqctl list_queues -q name messages | grep notification-worker
sql "SELECT event_type, recipient, message FROM dispatchpulse_notifications.notifications WHERE work_order_id=$id ORDER BY id"

echo; echo "== 2. Broker outage: the API keeps working, events wait in the outbox"
docker compose stop rabbitmq
id=$(create_order "Outage demo $(date +%T)")
echo "POST /work-orders succeeded with RabbitMQ stopped: work order $id"
sql "SELECT event_type, published_at FROM dispatchpulse.outbox_events WHERE work_order_id=$id"
docker compose start rabbitmq
echo "RabbitMQ restarted; waiting for the relay and worker to reconnect..."
wait_until "[ -n \"\$(value 'SELECT 1 FROM dispatchpulse_notifications.notifications WHERE work_order_id=$id')\" ]"
sql "SELECT event_type, published_at, publish_attempts FROM dispatchpulse.outbox_events WHERE work_order_id=$id"
sql "SELECT event_type, message, created_at FROM dispatchpulse_notifications.notifications WHERE work_order_id=$id"
