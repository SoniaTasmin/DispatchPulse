import { InvalidEventError } from './event-envelope';
import {
  decideOnFailure,
  failureReason,
  SimulatedFailureError,
} from './failure-policy';

describe('decideOnFailure', () => {
  const transient = new Error('database unavailable');
  const invalid = new InvalidEventError('Message body is not valid JSON');

  it.each([
    ['transient, attempt 1 of 3', transient, 1, 'retry'],
    ['transient, attempt 2 of 3', transient, 2, 'retry'],
    ['transient, attempt 3 of 3', transient, 3, 'dead-letter'],
    ['invalid message, first attempt', invalid, 1, 'dead-letter'],
  ] as const)('%s → %s', (_case, error, attempt, expected) => {
    expect(decideOnFailure(error, attempt, 3)).toBe(expected);
  });
});

describe('failureReason', () => {
  // The event-processing SLO excludes "simulated", so demo failures must be told apart.
  it.each([
    [new InvalidEventError('bad envelope'), 'invalid'],
    [new SimulatedFailureError('demo'), 'simulated'],
    [new Error('database unavailable'), 'error'],
  ] as const)('%s → %s', (error, expected) => {
    expect(failureReason(error)).toBe(expected);
  });
});
