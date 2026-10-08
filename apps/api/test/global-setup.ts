import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Runs once before the integration tests. Test workers inherit process.env, so the
// app under test (and Prisma's config, which never overrides set variables) use the test database.
export default function globalSetup(): void {
  const rootEnvFile = '../../.env';
  if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  }
  process.env.DATABASE_URL = testDatabaseUrl;
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
}
