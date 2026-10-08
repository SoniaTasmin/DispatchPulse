import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Local dev keeps one .env at the repo root; containers get real env vars instead.
const rootEnvFile = '../../.env';
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Optional so `prisma generate` works without a database (fresh clone, Docker build).
    url: process.env.WORKER_DATABASE_URL,
    shadowDatabaseUrl: process.env.WORKER_SHADOW_DATABASE_URL,
  },
});
