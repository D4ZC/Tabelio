import path from 'node:path';
import { defineConfig } from 'prisma/config';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.resolve(__dirname, '../../.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
