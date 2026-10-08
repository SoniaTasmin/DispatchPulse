import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Local dev keeps one .env at the repo root; containers get real env vars instead.
const rootEnvFile = '../../.env';
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    // Optional so `prisma generate` works without a database (fresh clone, Docker build).
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
