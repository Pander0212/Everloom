import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'server', include: ['test/**/*.test.ts'], testTimeout: 30000, pool: 'forks' } });
