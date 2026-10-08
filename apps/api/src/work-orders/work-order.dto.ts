import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WorkOrderStatus } from '../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateWorkOrderDto {
  /** @example "Repair POS terminal" */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  /** @example "Card reader does not connect to the network." */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** @example "Dhaka" */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  city!: string;

  /** Skill code from GET /skills. @example "NETWORKING" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  requiredSkill!: string;
}

export class ListWorkOrdersQuery {
  @IsOptional()
  @IsEnum(WorkOrderStatus)
  status?: WorkOrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class AssignWorkOrderDto {
  /** @example 1 */
  @IsInt()
  @Min(1)
  technicianId!: number;
}
