import { INestApplication, ValidationPipe } from '@nestjs/common';
import { httpMetricsMiddleware } from './metrics/metrics';

// Shared by main.ts and the integration tests so both run the same request pipeline.
export function configureApp(app: INestApplication): void {
  app.use(httpMetricsMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
