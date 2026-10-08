import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

// No web framework: the worker consumes RabbitMQ messages and serves only /metrics and
// /health (see OpsServer).
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
void bootstrap();
