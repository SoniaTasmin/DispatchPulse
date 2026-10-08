import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TechniciansController } from './technicians.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TechniciansController],
})
export class TechniciansModule {}
