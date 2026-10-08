import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env';
import { EventConsumer } from './event-consumer';
import { NotificationsService } from './notifications.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      // Local dev reads the repo-root .env; in containers the file is absent and real env vars are used.
      envFilePath: '../../.env',
      validate: validateEnv,
    }),
  ],
  providers: [PrismaService, NotificationsService, EventConsumer],
})
export class WorkerModule {}
