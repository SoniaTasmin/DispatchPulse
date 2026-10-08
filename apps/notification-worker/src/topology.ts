import { Channel } from 'amqplib';

// Owned by the API (it publishes here). Declared again below because the worker binds to it;
// declaring an exchange with identical arguments is a no-op.
export const WORK_ORDER_EVENTS_EXCHANGE = 'workorder.events';

// Owned by the worker.
export const EVENTS_QUEUE = 'notification-worker.events';
export const RETRY_QUEUE = 'notification-worker.retry';
export const DEAD_LETTER_EXCHANGE = 'notification-worker.dlx';
export const DEAD_LETTER_QUEUE = 'notification-worker.dlq';

/**
 *   workorder.events (topic) --workorder.*--> notification-worker.events --nack--> .dlx --> .dlq
 *                                                  ^                 |
 *                                                  |   republish     v
 *                                     TTL expires  +--- notification-worker.retry
 */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(WORK_ORDER_EVENTS_EXCHANGE, 'topic', {
    durable: true,
  });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'fanout', {
    durable: true,
  });

  // A rejected (nacked, not requeued) message is dead-lettered to the DLX.
  await channel.assertQueue(EVENTS_QUEUE, {
    durable: true,
    deadLetterExchange: DEAD_LETTER_EXCHANGE,
  });
  await channel.bindQueue(
    EVENTS_QUEUE,
    WORK_ORDER_EVENTS_EXCHANGE,
    'workorder.*',
  );

  // Holds a message until its per-message TTL expires, then dead-letters it through the
  // default exchange straight back to this worker's queue, not to every subscriber of
  // workorder.events. The TTL is per message so tests can use a short delay.
  await channel.assertQueue(RETRY_QUEUE, {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: EVENTS_QUEUE,
  });

  await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
  await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '');
}
