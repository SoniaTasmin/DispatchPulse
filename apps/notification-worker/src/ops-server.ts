import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { register } from '@prometheus-io/client';
import { Env } from './env';
import { EventConsumer } from './event-consumer';
import { PrismaService } from './prisma.service';

/**
 * The worker's only HTTP surface: GET /metrics for Prometheus and GET /health for Docker.
 * Node's built-in http module is enough for two read-only endpoints; a web framework
 * would add a dependency and routing the worker does not need.
 */
@Injectable()
export class OpsServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OpsServer.name);
  private readonly port: number;
  private server?: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumer: EventConsumer,
    config: ConfigService<Env, true>,
  ) {
    this.port = config.get('HTTP_PORT', { infer: true });
  }

  onApplicationBootstrap(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        this.logger.error(`Ops request failed: ${String(error)}`);
        res.writeHead(500).end();
      });
    });
    this.server = server;
    return new Promise((resolve) => {
      server.listen(this.port, () => {
        this.logger.log(`Serving /metrics and /health on port ${this.port}`);
        resolve();
      });
    });
  }

  onModuleDestroy(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/metrics') {
      const body = await register.metrics();
      res.writeHead(200, { 'Content-Type': register.contentType }).end(body);
    } else if (req.method === 'GET' && req.url === '/health') {
      const health = await this.health();
      res
        .writeHead(health.status === 'ok' ? 200 : 503, {
          'Content-Type': 'application/json',
        })
        .end(JSON.stringify(health));
    } else {
      res.writeHead(404).end();
    }
  }

  // Healthy means able to do its job: consuming from RabbitMQ and able to write to MySQL.
  private async health() {
    const database = await this.prisma.$queryRaw`SELECT 1`.then(
      () => 'up',
      () => 'down',
    );
    const rabbitmq = this.consumer.isConsuming ? 'up' : 'down';
    const status = database === 'up' && rabbitmq === 'up' ? 'ok' : 'error';
    return { status, database, rabbitmq };
  }
}
