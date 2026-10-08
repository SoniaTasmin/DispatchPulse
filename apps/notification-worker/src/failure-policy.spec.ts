import { InvalidEventError } from './event-envelope';
import { decideOnFailure } from './failure-policy';

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
