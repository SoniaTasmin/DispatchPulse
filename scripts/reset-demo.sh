#!/usr/bin/env bash
# Resets the LOCAL Docker Compose environment to a clean demo state.
#
# WARNING: this permanently deletes all local DispatchPulse data: work orders, outbox rows,
# notifications, RabbitMQ queues (including the dead-letter queue), Prometheus history and
# the test databases. It only acts on this repository's own Docker Compose project
# (`docker compose down -v`), so it cannot reach any database outside this machine.
#
# Afterwards: skills and the 8 demo technicians (re-seeded on API start-up), no work orders,
# no notifications, and empty queues.
#
# Usage: scripts/reset-demo.sh --yes
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" != "--yes" ]; then
  echo "This deletes ALL local DispatchPulse data (Docker volumes of this Compose project)."
  echo "Run again with --yes to continue: scripts/reset-demo.sh --yes"
  exit 1
fi

docker compose down --volumes --remove-orphans
docker compose up -d --build --wait
echo
echo "Clean demo state ready:"
docker compose exec -T rabbitmq rabbitmqctl list_queues -q name messages
# `|| true`: zero matches is a valid count, but grep exits 1 and pipefail would abort the script.
count() { curl -sf "$1" | grep -o "$2" | wc -l || true; }
echo "Technicians: $(count http://localhost:3000/technicians '"name":')"
echo "Work orders: $(count 'http://localhost:3000/work-orders?limit=100' '"id":')"
