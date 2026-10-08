import type { NextFunction, Request, Response } from 'express';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
} from '@prometheus-io/client';
import { WorkOrderStatus } from '../generated/prisma/enums';

// Every label below has a small, fixed set of values. IDs, raw URLs and messages never
// become labels: each distinct label value creates a new time series in Prometheus.

collectDefaultMetrics(); // process CPU, memory, event-loop lag

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests handled, by method, route template and status code',
  labelNames: ['method', 'route', 'status'] as const,
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration, by method and route template',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const workOrderTransitionsTotal = new Counter({
  name: 'workorder_transitions_total',
  help: 'Committed work-order state changes, by the status entered (OPEN = created)',
  labelNames: ['to_status'] as const,
});

export const outboxPendingEvents = new Gauge({
  name: 'outbox_pending_events',
  help: 'Outbox events committed but not yet confirmed by RabbitMQ',
});

export const PUBLISH_FAILURE_REASONS = [
  'broker_unavailable',
  'unroutable',
  'not_confirmed',
] as const;
export type PublishFailureReason = (typeof PUBLISH_FAILURE_REASONS)[number];

export const outboxPublishFailuresTotal = new Counter({
  name: 'outbox_publish_failures_total',
  help: 'Failed outbox publish attempts, by reason',
  labelNames: ['reason'] as const,
});

// Start every known series at 0. Otherwise a series first appears with value 1, and
// increase()/rate() cannot see that first increment.
for (const status of Object.values(WorkOrderStatus)) {
  workOrderTransitionsTotal.inc({ to_status: status }, 0);
}
for (const reason of PUBLISH_FAILURE_REASONS) {
  outboxPublishFailuresTotal.inc({ reason }, 0);
}

const UNMEASURED_ROUTES = new Set(['/metrics', '/health']);

export function httpMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const stopTimer = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // Express sets req.route only when a route matched; its path is the template
    // ("/work-orders/:id"), never the concrete URL ("/work-orders/381").
    const route = (req.route as { path?: string } | undefined)?.path;
    const label = route ?? 'unmatched';
    if (UNMEASURED_ROUTES.has(label)) return;
    stopTimer({ method: req.method, route: label });
    httpRequestsTotal.inc({
      method: req.method,
      route: label,
      status: String(res.statusCode),
    });
  });
  next();
}
