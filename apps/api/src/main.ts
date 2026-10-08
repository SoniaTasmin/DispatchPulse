import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env } from './config/env';
import { OutboxRelay } from './outbox/outbox-relay';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const openApi = new DocumentBuilder()
    .setTitle('DispatchPulse API')
    .setDescription('Work orders, technician matching and lifecycle')
    .setVersion('1')
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, openApi),
  );

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
  // Started here rather than in a lifecycle hook, so tests control when the relay runs.
  app.get(OutboxRelay).start();
}
void bootstrap();
