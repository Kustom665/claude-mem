import { execFileSync } from 'node:child_process';

/**
 * Direct database access for the browser flows: to arrange a state (an expired
 * commission, another notary's rows) and to check what was really stored.
 *
 * It shells out to `psql`, which reads the standard PGHOST, PGPORT, PGUSER,
 * PGPASSWORD and PGDATABASE variables — point them at the database the app under
 * test is using, as a role that can write to it (the app's own role is fine).
 * Set PSQL to use a psql that is not on the PATH.
 */
const PSQL = process.env.PSQL ?? 'psql';

/** Run SQL and return the rows as arrays of strings. */
export function sql(query) {
  const out = execFileSync(PSQL, ['-At', '-F', '|', '-c', query], {
    encoding: 'utf8',
    env: process.env,
  });
  return out
    .split('\n')
    .filter((line) => line !== '' && !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .map((line) => line.split('|'));
}

export const scalar = (query) => sql(query)[0]?.[0] ?? null;

export const DEMO_ID = () => scalar(`select id from "User" where email = 'demo@notarydesk.test'`);
