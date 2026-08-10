import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, ensureDirectories } from '../env.ts';

const here = dirname(fileURLToPath(import.meta.url));

export type Row = Record<string, unknown>;

let database: DatabaseSync | null = null;

/** Opens (and on first call, initialises) the SQLite database. */
export function getDb(): DatabaseSync {
  if (database) return database;
  ensureDirectories();
  database = new DatabaseSync(env.databaseFile);
  applyPragmas(database);
  applySchema(database);
  return database;
}

/** Swaps in a database for tests; pass ':memory:' for an isolated instance. */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  applyPragmas(db);
  applySchema(db);
  return db;
}

export function setDb(db: DatabaseSync): void {
  database = db;
}

export function closeDb(): void {
  database?.close();
  database = null;
}

function applyPragmas(db: DatabaseSync): void {
  // WAL keeps readers from blocking the writer; the rest are durability and
  // correctness defaults SQLite leaves off for backwards compatibility.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
}

function applySchema(db: DatabaseSync): void {
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A rollback failure means the transaction already unwound; surface the
      // original error rather than masking it.
    }
    throw error;
  }
}

export function query<T = Row>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function queryOne<T = Row>(sql: string, params: unknown[] = []): T | null {
  const row = getDb().prepare(sql).get(...(params as never[]));
  return (row as T | undefined) ?? null;
}

export function execute(sql: string, params: unknown[] = []): { changes: number } {
  const result = getDb().prepare(sql).run(...(params as never[]));
  return { changes: Number(result.changes) };
}

export const nowIso = (): string => new Date().toISOString();

/** SQLite has no boolean type; columns are 0/1 integers. */
export const toSqlBool = (value: boolean | undefined | null): number => (value ? 1 : 0);
export const fromSqlBool = (value: unknown): boolean => value === 1 || value === true;
