import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ChannelModel, connect } from 'amqplib';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Env } from '../src/config/env';
import {
  OutboxRelay,
  WORK_ORDER_EVENTS_EXCHANGE,
} from '../src/outbox/outbox-relay';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Outbox relay (integration, real MySQL + RabbitMQ)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let rabbit: ChannelModel;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    rabbit = await connect(process.env.RABBITMQ_URL!);
  });

  afterAll(async () => {
    await rabbit.close();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.skill.upsert({
      where: { code: 'NETWORKING' },
      update: {},
      create: { code: 'NETWORKING', name: 'Networking' },
    });
  });

  it('keeps events pending while RabbitMQ is unreachable, then publishes them with confirms', async () => {
    // The API request does not touch RabbitMQ, so it succeeds during a broker outage.
    await request(app.getHttpServer())
      .post('/work-orders')
      .send({
        title: 'Repair POS terminal',
        city: 'Dhaka',
        requiredSkill: 'NETWORKING',
      })
      .expect(201);
    const pending = await prisma.outboxEvent.findFirstOrThrow();

    const unreachable = { get: () => 'amqp://guest:guest@localhost:1' };
    const relayDuringOutage = new OutboxRelay(
      prisma,
      unreachable as unknown as ConfigService<Env, true>,
    );
    await expect(relayDuringOutage.publishPending()).resolves.toBe(0);
    expect(
      await prisma.outboxEvent.findUniqueOrThrow({ where: { id: pending.id } }),
    ).toMatchObject({ publishedAt: null });

    // A temporary queue stands in for a consumer, so the message is routable.
    const channel = await rabbit.createChannel();
    await channel.assertExchange(WORK_ORDER_EVENTS_EXCHANGE, 'topic', {
      durable: true,
    });
    const { queue } = await channel.assertQueue('', { exclusive: true });
    await channel.bindQueue(queue, WORK_ORDER_EVENTS_EXCHANGE, 'workorder.*');

    await expect(app.get(OutboxRelay).publishPending()).resolves.toBe(1);

    const published = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(published.publishedAt).not.toBeNull();
    const message = await channel.get(queue, { noAck: true });
    if (!message) throw new Error('Expected the event in the bound queue');
    expect(message.fields.routingKey).toBe('workorder.created');
    expect(message.properties.messageId).toBe(pending.id);
    expect(JSON.parse(message.content.toString())).toEqual(pending.payload);
    await channel.close();
  });
});
