import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { Env } from './env';
import { PrismaClient } from './generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaMariaDb(
        config.get('WORKER_DATABASE_URL', { infer: true }),
      ),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  // Last shutdown phase, so the consumer can finish in-flight messages first.
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
