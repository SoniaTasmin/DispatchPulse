import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics/metrics.controller';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';
import { TechniciansModule } from './technicians/technicians.module';
import { WorkOrdersModule } from './work-orders/work-orders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Local dev reads the repo-root .env; in containers the file is absent and real env vars are used.
      envFilePath: '../../.env',
      validate: validateEnv,
    }),
    PrismaModule,
    WorkOrdersModule,
    TechniciansModule,
    OutboxModule,
  ],
  controllers: [HealthController, MetricsController],
})
export class AppModule {}
