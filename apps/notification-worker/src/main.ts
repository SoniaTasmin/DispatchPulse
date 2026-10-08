import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

// No HTTP server: the worker only consumes RabbitMQ messages.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
void bootstrap();
