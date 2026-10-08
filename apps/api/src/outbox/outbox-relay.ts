import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelModel, ConfirmChannel, connect } from 'amqplib';
import { Env } from '../config/env';
import { OutboxEvent } from '../generated/prisma/client';
import {
  outboxPendingEvents,
  outboxPublishFailuresTotal,
  type PublishFailureReason,
} from '../metrics/metrics';
import { PrismaService } from '../prisma/prisma.service';

// The API owns this exchange; each consumer declares and binds its own queues.
export const WORK_ORDER_EVENTS_EXCHANGE = 'workorder.events';
const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 50;

class UnroutableEventError extends Error {}

/**
 * Publishes committed outbox rows to RabbitMQ. A row is marked published only after the
 * broker confirms it, so a crash between publish and marking re-publishes the event:
 * delivery is at-least-once and consumers must be idempotent.
 */
@Injectable()
export class OutboxRelay implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly rabbitMqUrl: string;
  private timer?: NodeJS.Timeout;
  private currentRun?: Promise<number>;
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private readonly returnedMessageIds = new Set<string>();
  private brokerUnavailable = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.rabbitMqUrl = config.get('RABBITMQ_URL', { infer: true });
  }

  start(): void {
    this.timer = setInterval(() => {
      this.publishPending().catch((error: unknown) =>
        this.logger.error(`Outbox relay run failed: ${String(error)}`),
      );
    }, POLL_INTERVAL_MS);
  }

  /** Publishes pending events, oldest first. A call made while a run is active joins that run. */
  publishPending(): Promise<number> {
    this.currentRun ??= this.publishBatch().finally(() => {
      this.currentRun = undefined;
    });
    return this.currentRun;
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.currentRun?.catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  private async publishBatch(): Promise<number> {
    // Counted every poll, so the backlog stays visible even while RabbitMQ is down.
    const pendingCount = await this.prisma.outboxEvent.count({
      where: { publishedAt: null },
    });
    outboxPendingEvents.set(pendingCount);
    if (pendingCount === 0) return 0;

    let channel: ConfirmChannel;
    try {
      channel = await this.getChannel();
    } catch (error) {
      outboxPublishFailuresTotal.inc({ reason: 'broker_unavailable' });
      this.reportBrokerUnavailable(error, pendingCount);
      return 0;
    }

    const pending = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    let published = 0;
    for (const event of pending) {
      try {
        await this.publishAndConfirm(channel, event);
      } catch (error) {
        await this.recordFailure(event, error);
        // Stop so later events are not published ahead of this one; the next poll retries.
        return published;
      }
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date() },
      });
      outboxPendingEvents.dec();
      published++;
    }
    this.logger.log(`Published ${published} outbox event(s)`);
    return published;
  }

  private async publishAndConfirm(
    channel: ConfirmChannel,
    event: OutboxEvent,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        WORK_ORDER_EVENTS_EXCHANGE,
        event.eventType,
        Buffer.from(JSON.stringify(event.payload)),
        {
          messageId: event.id,
          type: event.eventType,
          contentType: 'application/json',
          persistent: true,
          mandatory: true,
        },
        (error: unknown) =>
          error
            ? reject(new Error('RabbitMQ did not confirm the message'))
            : resolve(),
      );
    });
    // With mandatory=true, RabbitMQ returns a message that no queue is bound for (before
    // confirming it). Without this check the event would be confirmed and silently dropped.
    if (this.returnedMessageIds.delete(event.id)) {
      throw new UnroutableEventError(
        `No queue is bound for routing key ${event.eventType}`,
      );
    }
  }

  private async recordFailure(event: OutboxEvent, error: unknown) {
    const reason: PublishFailureReason =
      error instanceof UnroutableEventError ? 'unroutable' : 'not_confirmed';
    outboxPublishFailuresTotal.inc({ reason });
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Publishing event ${event.id} (${event.eventType}) failed: ${message}`,
    );
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        publishAttempts: { increment: 1 },
        lastError: message.slice(0, 500),
      },
    });
  }

  private async getChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;

    const connection = await connect(this.rabbitMqUrl);
    try {
      // Without 'error' listeners, a broker disconnect would crash the whole API.
      connection.on('error', (error: Error) =>
        this.logger.warn(`RabbitMQ connection error: ${error.message}`),
      );
      connection.on('close', () => {
        this.connection = undefined;
        this.channel = undefined;
      });
      const channel = await connection.createConfirmChannel();
      channel.on('error', (error: Error) =>
        this.logger.warn(`RabbitMQ channel error: ${error.message}`),
      );
      channel.on('close', () => {
        this.channel = undefined;
        void connection.close().catch(() => undefined);
      });
      channel.on('return', ({ properties }) =>
        this.returnedMessageIds.add(String(properties.messageId)),
      );
      await channel.assertExchange(WORK_ORDER_EVENTS_EXCHANGE, 'topic', {
        durable: true,
      });

      this.connection = connection;
      this.channel = channel;
      if (this.brokerUnavailable) {
        this.logger.log(
          'RabbitMQ is reachable again; publishing pending events',
        );
        this.brokerUnavailable = false;
      }
      return channel;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  // Logs once per outage instead of once per poll.
  private reportBrokerUnavailable(error: unknown, pendingCount: number) {
    if (this.brokerUnavailable) return;
    this.brokerUnavailable = true;
    this.logger.warn(
      `RabbitMQ unavailable (${String(error)}); ${pendingCount}+ event(s) stay pending in the outbox`,
    );
  }
}
