import { InvalidEventError } from './event-envelope';

export type FailureAction = 'retry' | 'dead-letter';

/** Thrown only by the demo switch SIMULATE_FAILURE_EVENT_TYPES. */
export class SimulatedFailureError extends Error {}

export const FAILURE_REASONS = ['invalid', 'simulated', 'error'] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Decides what happens to a message whose processing failed on the given attempt (1-based).
 * Invalid messages go straight to the dead-letter queue; anything else is retried until
 * maxAttempts is used up, so a permanently failing message cannot loop forever.
 */
export function decideOnFailure(
  error: unknown,
  attempt: number,
  maxAttempts: number,
): FailureAction {
  if (error instanceof InvalidEventError) return 'dead-letter';
  return attempt < maxAttempts ? 'retry' : 'dead-letter';
}

/** Bounded metric label. "simulated" lets the event-processing SLO ignore demo failures. */
export function failureReason(error: unknown): FailureReason {
  if (error instanceof InvalidEventError) return 'invalid';
  if (error instanceof SimulatedFailureError) return 'simulated';
  return 'error';
}
