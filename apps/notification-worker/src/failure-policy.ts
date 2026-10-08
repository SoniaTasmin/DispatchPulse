import { InvalidEventError } from './event-envelope';

export type FailureAction = 'retry' | 'dead-letter';

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
