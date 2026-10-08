import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { WORK_ORDER_EVENT_TYPES, WorkOrderEventType } from './event-envelope';

export class Env {
  @IsNotEmpty()
  @IsUrl({ protocols: ['mysql'], require_tld: false, require_protocol: true })
  WORKER_DATABASE_URL!: string;

  @IsNotEmpty()
  @IsUrl({ protocols: ['amqp'], require_tld: false, require_protocol: true })
  RABBITMQ_URL!: string;

  @IsInt()
  @Min(100)
  @Max(600_000)
  RETRY_DELAY_MS: number = 5000;

  /** Total processing attempts, including the first, before an event is dead-lettered. */
  @IsInt()
  @Min(1)
  @Max(10)
  MAX_ATTEMPTS: number = 3;

  /** Demo only: event types the worker fails on purpose to show the retry and DLQ path. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((type) => type.trim())
          .filter(Boolean)
      : value,
  )
  @IsIn(WORK_ORDER_EVENT_TYPES, { each: true })
  SIMULATE_FAILURE_EVENT_TYPES: WorkOrderEventType[] = [];
}

// Fail at startup with every problem listed, rather than at the first message.
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true });
  const errors = validateSync(env);
  if (errors.length > 0) {
    const problems = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new Error(
      `Invalid environment configuration:\n- ${problems.join('\n- ')}`,
    );
  }
  return env;
}
