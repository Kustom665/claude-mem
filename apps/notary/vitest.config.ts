import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the app's path alias so modules under test resolve imports the
      // same way Next does.
      '@': `${root}src`,
      // The real `server-only` package throws outside a React Server Component.
      // Under Vitest that guard is meaningless, so it resolves to a no-op.
      'server-only': `${root}tests/stubs/server-only.ts`,
    },
  },
  test: {
    // Everything under test is pure domain logic — hashing, money, tax and
    // jurisdiction rules. No DOM, no database.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
