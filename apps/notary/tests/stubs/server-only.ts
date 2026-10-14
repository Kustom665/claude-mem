/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * The real package throws on import outside a React Server Component. The
 * modules under test import it as a guard against being pulled into a client
 * bundle, which is correct in the app but meaningless in a Node test runner.
 */
export {};
