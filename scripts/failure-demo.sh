#!/usr/bin/env bash
# Demonstrates the two failure paths of event delivery with ordinary tools, and how they show
# up in monitoring (Grafana http://localhost:3030, Prometheus alerts http://localhost:9090/alerts).
#
# Prerequisites, from the repo root:
#   docker compose up -d --build
#   SIMULATE_FAILURE_EVENT_TYPES=workorder.completed docker compose up -d notification-worker
# For a predictable result (dead-letter queue depth 0 before, 1 after), start from a clean
# state with `scripts/reset-demo.sh --yes`, or just empty the DLQ (local demo data only):
#   docker compose exec rabbitmq rabbitmqctl purge_queue notification-worker.dlq
# Then:
#   scripts/failure-demo.sh
# Afterwards, turn the simulation off again with: docker compose up -d notification-worker
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

API=${API:-http://localhost:3000}
PROMETHEUS=${PROMETHEUS:-http://localhost:9090}
JSON='Content-Type: application/json'

sql() { docker compose exec -T mysql mysql -t -uroot -p"$MYSQL_ROOT_PASSWORD" -e "$1" 2>/dev/null; }
value() { docker compose exec -T mysql mysql -N -B -uroot -p"$MYSQL_ROOT_PASSWORD" -e "$1" 2>/dev/null; }
first_id() { grep -o '"id":[0-9]*' | head -1 | cut -d: -f2; }
create_order() {
  curl -sf -X POST "$API/work-orders" -H "$JSON" \
    -d "{\"title\":\"$1\",\"city\":\"Dhaka\",\"requiredSkill\":\"NETWORKING\"}" | first_id
}
wait_until() { for _ in $(seq 1 60); do eval "$1" && return 0; sleep 1; done; echo "Timed out: $1"; exit 1; }
worker_log() { docker compose logs --no-color notification-worker; }
dlq_depth() { docker compose exec -T rabbitmq rabbitmqctl list_queues -q name messages | awk '$1=="notification-worker.dlq" {print $2}'; }
pending_metric() { curl -sf "$API/metrics" | awk '$1=="outbox_pending_events" {print $2}'; }

echo "== 1. Consumer failure: retry with delay, then dead-letter queue"
dlq_before=$(dlq_depth)
id=$(create_order "Failure demo $(date +%T)")
tech=$(curl -sf "$API/work-orders/$id/technician-matches" | first_id)
curl -sf -o /dev/null -X POST "$API/work-orders/$id/assign" -H "$JSON" -d "{\"technicianId\":$tech}"
curl -sf -o /dev/null -X POST "$API/work-orders/$id/start"
curl -sf -o /dev/null -X POST "$API/work-orders/$id/complete"
echo "Work order $id: created, assigned to technician $tech, started, completed (all HTTP 200/201)"

event=$(value "SELECT id FROM dispatchpulse.outbox_events WHERE work_order_id=$id AND event_type='workorder.completed'")
echo "Waiting for event $event to exhaust its attempts..."
wait_until "worker_log | grep -q '$event.*Sent to dead-letter queue'"
worker_log | grep "$event" | sed 's/.*\[EventConsumer\] //'
echo "Dead-letter queue depth: $dlq_before before, $(dlq_depth) now"
echo "Waiting for the Prometheus alert EventsDeadLettered to fire..."
wait_until "curl -sf '$PROMETHEUS/api/v1/alerts' | grep -q '\"alertname\":\"EventsDeadLettered\".*\"state\":\"firing\"'"
echo "Alert EventsDeadLettered is FIRING (see $PROMETHEUS/alerts)"
sql "SELECT event_type, recipient, message FROM dispatchpulse_notifications.notifications WHERE work_order_id=$id ORDER BY id"

echo; echo "== 2. Broker outage: the API keeps working, events wait in the outbox"
docker compose stop rabbitmq
for n in 1 2 3; do id=$(create_order "Outage demo $n $(date +%T)"); done
echo "3 x POST /work-orders succeeded with RabbitMQ stopped (last: work order $id)"
sleep 2
echo "outbox_pending_events = $(pending_metric)"
sql "SELECT event_type, published_at FROM dispatchpulse.outbox_events WHERE work_order_id=$id"
docker compose start rabbitmq
echo "RabbitMQ restarted; waiting for the relay and worker to reconnect..."
wait_until "[ -n \"\$(value 'SELECT 1 FROM dispatchpulse_notifications.notifications WHERE work_order_id=$id')\" ]"
echo "outbox_pending_events = $(pending_metric)"
sql "SELECT event_type, published_at, publish_attempts FROM dispatchpulse.outbox_events WHERE work_order_id=$id"
sql "SELECT event_type, message, created_at FROM dispatchpulse_notifications.notifications WHERE work_order_id=$id"
