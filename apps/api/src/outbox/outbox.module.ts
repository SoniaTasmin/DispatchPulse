import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OutboxRelay } from './outbox-relay';

@Module({
  imports: [PrismaModule],
  providers: [OutboxRelay],
  exports: [OutboxRelay],
})
export class OutboxModule {}
