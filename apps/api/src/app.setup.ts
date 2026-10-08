import { INestApplication, ValidationPipe } from '@nestjs/common';

// Shared by main.ts and the integration tests so both run the same request pipeline.
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
