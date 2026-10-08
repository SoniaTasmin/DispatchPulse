import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Channel, ChannelModel, connect, GetMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import {
  NotificationsService,
  RecordOutcome,
} from '../src/notifications.service';
import { PrismaService } from '../src/prisma.service';
import {
  assertTopology,
  DEAD_LETTER_QUEUE,
  EVENTS_QUEUE,
  RETRY_QUEUE,
  WORK_ORDER_EVENTS_EXCHANGE,
} from '../src/topology';
import { WorkerModule } from '../src/worker.module';

// The global setup runs the worker with RETRY_DELAY_MS=200, MAX_ATTEMPTS=3 and
// SIMULATE_FAILURE_EVENT_TYPES=workorder.completed against a test vhost and database.
describe('Notification worker (integration, real RabbitMQ + MySQL)', () => {
  let rabbit: ChannelModel;
  let channel: Channel;
  let worker: INestApplicationContext;
  let prisma: PrismaService;

  beforeAll(async () => {
    rabbit = await connect(process.env.RABBITMQ_URL!);
    channel = await rabbit.createChannel();
    await assertTopology(channel);
    for (const queue of [EVENTS_QUEUE, RETRY_QUEUE, DEAD_LETTER_QUEUE]) {
      await channel.purgeQueue(queue);
    }
    worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: ['error'],
    });
    prisma = worker.get(PrismaService);
  });

  afterAll(async () => {
    await worker.close();
    await rabbit.close();
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await channel.purgeQueue(DEAD_LETTER_QUEUE);
  });

  const envelope = (eventType: string, data: object) => ({
    eventId: randomUUID(),
    eventType,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    workOrderId: 42,
    data,
  });

  const publish = (
    event: { eventId: string; eventType: string },
    body?: string,
  ) =>
    channel.publish(
      WORK_ORDER_EVENTS_EXCHANGE,
      event.eventType,
      Buffer.from(body ?? JSON.stringify(event)),
      { messageId: event.eventId, type: event.eventType, persistent: true },
    );

  it('stores exactly one notification when the same event is delivered twice', async () => {
    const record = jest.spyOn(worker.get(NotificationsService), 'record');
    const event = envelope('workorder.assigned', {
      technicianId: 7,
      technicianName: 'Rahim Uddin',
    });

    // Published back to back, so both copies are processed concurrently (prefetch 10).
    publish(event);
    publish(event);

    await waitFor(() => record.mock.results.length === 2);
    const outcomes = await Promise.all(
      record.mock.results.map((r) => r.value as Promise<RecordOutcome>),
    );
    expect(outcomes.sort()).toEqual(['created', 'duplicate']);
    expect(await prisma.notification.findMany()).toEqual([
      expect.objectContaining({
        eventId: event.eventId,
        recipient: 'technician:7',
        message: 'Rahim Uddin, you have been assigned work order #42',
      }),
    ]);
    expect(await dequeueAll(DEAD_LETTER_QUEUE)).toHaveLength(0);
    record.mockRestore();
  });

  it('retries a failing event with a delay, then dead-letters it after the last attempt', async () => {
    const event = envelope('workorder.completed', { technicianId: 7 });
    const startedAt = Date.now();

    publish(event);

    const [deadLettered] = await waitForMessages(DEAD_LETTER_QUEUE, 1);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2 * 200);
    expect(deadLettered.properties.messageId).toBe(event.eventId);
    expect(deadLettered.properties.headers?.['x-attempt']).toBe(3);
    // Each retry is a fresh copy, so x-death records only the last hop; x-attempt is the count.
    expect(xDeath(deadLettered)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: RETRY_QUEUE,
          reason: 'expired',
          count: 1,
        }),
        expect.objectContaining({
          queue: EVENTS_QUEUE,
          reason: 'rejected',
          count: 1,
        }),
      ]),
    );
    expect(await prisma.notification.count()).toBe(0);
  });

  it('sends an invalid event straight to the dead-letter queue without retrying', async () => {
    const event = { ...envelope('workorder.created', {}), schemaVersion: 2 };

    publish(event);

    const [deadLettered] = await waitForMessages(DEAD_LETTER_QUEUE, 1);
    expect(deadLettered.properties.messageId).toBe(event.eventId);
    expect(deadLettered.properties.headers?.['x-attempt']).toBeUndefined();
    expect(xDeath(deadLettered)).toEqual([
      expect.objectContaining({
        queue: EVENTS_QUEUE,
        reason: 'rejected',
        count: 1,
      }),
    ]);
    expect(await prisma.notification.count()).toBe(0);
  });

  async function dequeueAll(queue: string): Promise<GetMessage[]> {
    const messages: GetMessage[] = [];
    for (
      let m = await channel.get(queue, { noAck: true });
      m;
      m = await channel.get(queue, { noAck: true })
    ) {
      messages.push(m);
    }
    return messages;
  }

  async function waitForMessages(
    queue: string,
    count: number,
  ): Promise<GetMessage[]> {
    const messages: GetMessage[] = [];
    await waitFor(async () => {
      messages.push(...(await dequeueAll(queue)));
      return messages.length >= count;
    });
    return messages;
  }
});

type XDeath = { queue: string; reason: string; count: number };

function xDeath(message: GetMessage): XDeath[] {
  const headers = (message.properties.headers ?? {}) as Record<string, unknown>;
  return (headers['x-death'] ?? []) as XDeath[];
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
