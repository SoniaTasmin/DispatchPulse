import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export class Env {
  @IsNotEmpty()
  @IsUrl({ protocols: ['mysql'], require_tld: false, require_protocol: true })
  DATABASE_URL!: string;

  @IsNotEmpty()
  @IsUrl({ protocols: ['amqp'], require_tld: false, require_protocol: true })
  RABBITMQ_URL!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;
}

// Fail at startup with every problem listed, rather than at the first query.
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
