import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelModel, ConfirmChannel, ConsumeMessage, connect } from 'amqplib';
import { Env } from './env';
import { parseEventEnvelope, WorkOrderEventType } from './event-envelope';
import { decideOnFailure } from './failure-policy';
import { NotificationsService } from './notifications.service';
import { assertTopology, EVENTS_QUEUE, RETRY_QUEUE } from './topology';

const PREFETCH = 10;
const RECONNECT_DELAY_MS = 5000;
const ATTEMPT_HEADER = 'x-attempt';

@Injectable()
export class EventConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EventConsumer.name);
  private readonly rabbitMqUrl: string;
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;
  private readonly simulatedFailures: WorkOrderEventType[];
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private consumerTag?: string;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.rabbitMqUrl = config.get('RABBITMQ_URL', { infer: true });
    this.retryDelayMs = config.get('RETRY_DELAY_MS', { infer: true });
    this.maxAttempts = config.get('MAX_ATTEMPTS', { infer: true });
    this.simulatedFailures = config.get('SIMULATE_FAILURE_EVENT_TYPES', {
      infer: true,
    });
  }

  async onApplicationBootstrap() {
    if (this.simulatedFailures.length > 0) {
      this.logger.warn(
        `Failure simulation ON for: ${this.simulatedFailures.join(', ')}`,
      );
    }
    await this.connect();
  }

  // Graceful shutdown: stop taking messages, let in-flight ones finish (ack or retry), then
  // close. Anything still unacknowledged when the connection closes is redelivered later.
  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    if (this.channel && this.consumerTag) {
      await this.channel.cancel(this.consumerTag).catch(() => undefined);
    }
    await Promise.allSettled(this.inFlight);
    await this.connection?.close().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    let connection: ChannelModel | undefined;
    try {
      connection = await connect(this.rabbitMqUrl);
      // Without 'error' listeners, a broker disconnect would crash the worker.
      connection.on('error', (error: Error) =>
        this.logger.warn(`RabbitMQ connection error: ${error.message}`),
      );
      connection.on('close', () => this.scheduleReconnect('connection closed'));

      const channel = await connection.createConfirmChannel();
      channel.on('error', (error: Error) =>
        this.logger.warn(`RabbitMQ channel error: ${error.message}`),
      );
      await assertTopology(channel);
      await channel.prefetch(PREFETCH);
      const { consumerTag } = await channel.consume(EVENTS_QUEUE, (message) => {
        if (message) this.track(this.handle(channel, message));
      });

      this.connection = connection;
      this.channel = channel;
      this.consumerTag = consumerTag;
      this.logger.log(`Consuming ${EVENTS_QUEUE}`);
    } catch (error) {
      await connection?.close().catch(() => undefined);
      this.scheduleReconnect(String(error));
    }
  }

  // ponytail: fixed delay, no backoff. Enough for one worker and a local broker.
  private scheduleReconnect(reason: string) {
    this.connection = undefined;
    this.channel = undefined;
    if (this.stopping || this.reconnectTimer) return;
    this.logger.warn(
      `RabbitMQ unavailable (${reason}); reconnecting in ${RECONNECT_DELAY_MS} ms`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private track(work: Promise<void>) {
    const tracked = work
      .catch((error: unknown) =>
        // The message stays unacknowledged; RabbitMQ redelivers it when the channel closes.
        this.logger.error(`Message handling failed: ${String(error)}`),
      )
      .finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }

  private async handle(channel: ConfirmChannel, message: ConsumeMessage) {
    const attempt = attemptOf(message);
    // properties.type is the event type; the routing key is a queue name once a message is retried.
    const { messageId, type } = message.properties as {
      messageId?: string;
      type?: string;
    };
    const context = `event ${messageId} (${type ?? message.fields.routingKey}) attempt ${attempt}/${this.maxAttempts}`;
    try {
      const event = parseEventEnvelope(message.content);
      this.failIfSimulated(event.eventType);
      const outcome = await this.notifications.record(event);
      channel.ack(message);
      this.logger.log(
        outcome === 'created'
          ? `Processed ${context}: notification created`
          : `Processed ${context}: duplicate delivery, notification already exists`,
      );
    } catch (error) {
      await this.handleFailure(channel, message, attempt, context, error);
    }
  }

  private async handleFailure(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    attempt: number,
    context: string,
    error: unknown,
  ) {
    const reason = error instanceof Error ? error.message : String(error);
    if (decideOnFailure(error, attempt, this.maxAttempts) === 'retry') {
      this.logger.warn(
        `Failed ${context}: ${reason}. Retrying in ${this.retryDelayMs} ms`,
      );
      // Publish the retry copy and wait for the broker's confirm before acking the original;
      // a crash in between causes a duplicate, which the idempotent insert absorbs.
      await this.publishForRetry(channel, message, attempt + 1);
      channel.ack(message);
    } else {
      this.logger.error(
        `Failed ${context}: ${reason}. Sent to dead-letter queue`,
      );
      channel.nack(message, false, false);
    }
  }

  private publishForRetry(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    nextAttempt: number,
  ): Promise<void> {
    const { messageId, type, contentType } = message.properties as {
      messageId?: string;
      type?: string;
      contentType?: string;
    };
    return new Promise((resolve, reject) => {
      channel.sendToQueue(
        RETRY_QUEUE,
        message.content,
        {
          messageId,
          type,
          contentType,
          persistent: true,
          headers: { [ATTEMPT_HEADER]: nextAttempt },
          expiration: String(this.retryDelayMs),
        },
        (error: unknown) =>
          error
            ? reject(new Error('RabbitMQ did not confirm the retry message'))
            : resolve(),
      );
    });
  }

  private failIfSimulated(eventType: WorkOrderEventType) {
    if (this.simulatedFailures.includes(eventType)) {
      throw new Error(
        `Simulated failure for ${eventType} (SIMULATE_FAILURE_EVENT_TYPES)`,
      );
    }
  }
}

function attemptOf(message: ConsumeMessage): number {
  const headers = (message.properties.headers ?? {}) as Record<string, unknown>;
  const attempt = headers[ATTEMPT_HEADER];
  return typeof attempt === 'number' && attempt >= 1 ? attempt : 1;
}
