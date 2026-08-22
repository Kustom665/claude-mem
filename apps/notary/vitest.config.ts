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

    // `.vitest.ts`, not the usual `.test.ts`.
    //
    // This app is nested inside the claude-mem repo, which has no npm
    // workspaces and runs its own suite with `bun test` from the repo root.
    // Bun's default discovery recurses the whole tree and matches `*.test.ts`
    // and `*.spec.ts`, so it would pick these files up and fail on them — the
    // root CI job never installs this app's dependencies, so `server-only` and
    // `vitest` are unresolvable there.
    //
    // Renaming keeps the two runners from colliding without touching shared
    // CI, which other branches depend on. If this app is ever extracted to its
    // own repo, rename these back to `.test.ts`.
    include: ['tests/**/*.vitest.ts'],
  },
});
