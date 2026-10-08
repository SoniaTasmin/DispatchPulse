import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Runs once before the integration tests. Test workers inherit process.env, and the worker's
// config is read when its module is imported, so test settings must be set here.
export default async function globalSetup(): Promise<void> {
  const rootEnvFile = '../../.env';
  if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

  process.env.WORKER_DATABASE_URL = required('TEST_WORKER_DATABASE_URL');
  process.env.RABBITMQ_URL = required('TEST_RABBITMQ_URL');
  process.env.RETRY_DELAY_MS = '200';
  process.env.MAX_ATTEMPTS = '3';
  process.env.SIMULATE_FAILURE_EVENT_TYPES = 'workorder.completed';
  process.env.HTTP_PORT = '39101'; // not the dev worker's 3001
  await ensureVirtualHost(process.env.RABBITMQ_URL);
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

// AMQP cannot create virtual hosts, so use the management HTTP API (port 15672). Idempotent.
async function ensureVirtualHost(amqpUrl: string): Promise<void> {
  const url = new URL(amqpUrl);
  const vhost = encodeURIComponent(decodeURIComponent(url.pathname.slice(1)));
  const user = decodeURIComponent(url.username);
  const auth = Buffer.from(`${user}:${decodeURIComponent(url.password)}`);
  const requests: Array<[string, object]> = [
    [`vhosts/${vhost}`, {}],
    [
      `permissions/${vhost}/${encodeURIComponent(user)}`,
      { configure: '.*', write: '.*', read: '.*' },
    ],
  ];
  for (const [path, body] of requests) {
    const response = await fetch(`http://${url.hostname}:15672/api/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth.toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `RabbitMQ management API ${path}: HTTP ${response.status}`,
      );
    }
  }
}
