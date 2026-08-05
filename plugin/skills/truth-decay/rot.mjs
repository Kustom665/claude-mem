#!/usr/bin/env node
/**
 * truth-decay — find the memories most likely to be lying to you now.
 *
 * Observations are true when written and never re-checked. Code moves; the
 * memory doesn't. A memory that describes a deleted file or a rewritten
 * subsystem is worse than no memory, because it gets injected as context and
 * read as fact.
 *
 * This script is only the cheap prefilter: it flags observations whose
 * referenced files no longer exist on disk, and observations old enough to
 * deserve a re-check. Deciding whether a memory is actually false is the
 * verifier agents' job.
 *
 * Commands:
 *   scan  [--project P] [--scan N] [--root DIR]   observations ranked by rot risk
 *   files [--project P] [--scan N] [--root DIR]   vanished files, by blast radius
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_AGE_DAYS = 90;

// ── plumbing ────────────────────────────────────────────────────────────

// Piping into `head` closes stdout early; that's normal usage, not a crash.
process.stdout.on('error', err => { if (err?.code === 'EPIPE') process.exit(0); throw err; });

function die(message, code = 1) {
  process.stderr.write(`rot: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const eq = arg.indexOf('=');
    if (eq !== -1) { out[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function workerPort() {
  if (process.env.CLAUDE_MEM_WORKER_PORT) return String(process.env.CLAUDE_MEM_WORKER_PORT);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 77;
  const fallback = String(37700 + (uid % 100));
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.claude-mem', 'settings.json'), 'utf8'));
    return String(settings.CLAUDE_MEM_WORKER_PORT || fallback);
  } catch {
    return fallback;
  }
}

const PORT = workerPort();

async function api(path) {
  const url = `http://localhost:${PORT}${path}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    die(`worker unreachable at localhost:${PORT} — start it, or set CLAUDE_MEM_WORKER_PORT`);
  }
  if (!res.ok) die(`${res.status} from ${path}`);
  return res.json();
}

async function* scanObservations({ project, scan }) {
  const budget = Math.max(1, Number(scan) || 1500);
  let seen = 0;
  let offset = 0;
  while (seen < budget) {
    const params = new URLSearchParams({ offset: String(offset), limit: '100' });
    if (project) params.set('project', project);
    const page = await api(`/api/observations?${params.toString()}`);
    const items = Array.isArray(page?.items) ? page.items : [];
    for (const item of items) {
      if (seen++ >= budget) return;
      yield item;
    }
    if (!page?.hasMore || items.length === 0) return;
    offset += items.length;
  }
}

function repoRoot(explicit) {
  if (explicit && explicit !== true) return resolve(String(explicit));
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
}

function parseFileList(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(f => typeof f === 'string') : [];
  } catch {
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }
}

function truncate(text, width) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
}

function ageDays(epoch) {
  if (!epoch) return null;
  return Math.max(0, Math.round((Date.now() - Number(epoch)) / 86_400_000));
}

function emit(args, rows, render) {
  if (args.json) { process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`); return; }
  if (rows.length === 0) { process.stdout.write('(nothing found)\n'); return; }
  render(rows);
}

// ── rot detection ───────────────────────────────────────────────────────

function inspect(obs, root, cache) {
  const referenced = [...new Set([...parseFileList(obs.files_modified), ...parseFileList(obs.files_read)])];
  const missing = [];
  for (const file of referenced) {
    const path = isAbsolute(file) ? file : join(root, file);
    let present = cache.get(path);
    if (present === undefined) {
      present = existsSync(path);
      cache.set(path, present);
    }
    if (!present) missing.push(file);
  }
  return { referenced, missing };
}

function signalFor({ referenced, missing, age, minAge }) {
  if (missing.length > 0) return referenced.length === missing.length ? 'all-files-gone' : 'some-files-gone';
  if (age !== null && age >= minAge) return 'aged';
  return 'ok';
}

const SIGNAL_RANK = { 'all-files-gone': 0, 'some-files-gone': 1, aged: 2, ok: 3 };

// ── commands ────────────────────────────────────────────────────────────

async function cmdScan(args) {
  const root = repoRoot(args.root);
  const project = args.project && args.project !== true ? args.project : null;
  const minAge = Number(args['min-age-days']) || DEFAULT_AGE_DAYS;
  const cache = new Map();
  const rows = [];
  let scanned = 0;

  for await (const obs of scanObservations({ project, scan: args.scan })) {
    scanned++;
    const { referenced, missing } = inspect(obs, root, cache);
    if (referenced.length === 0) continue;
    const age = ageDays(obs.created_at_epoch);
    const signal = signalFor({ referenced, missing, age, minAge });
    if (signal === 'ok') continue;
    rows.push({
      id: obs.id,
      type: obs.type,
      title: obs.title,
      project: obs.project,
      age_days: age,
      signal,
      referenced_count: referenced.length,
      missing_files: missing,
    });
  }

  rows.sort((a, b) =>
    SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal] ||
    b.missing_files.length - a.missing_files.length ||
    (b.age_days ?? 0) - (a.age_days ?? 0));

  const top = rows.slice(0, Math.max(1, Number(args.top) || 30));

  emit(args, top, list => {
    process.stdout.write(`scanned ${scanned} observation(s) against ${root}\n`);
    process.stdout.write(`${rows.length} carry a rot signal (aged = older than ${minAge}d)\n\n`);
    process.stdout.write('ID       AGE   SIGNAL           TITLE\n');
    for (const r of list) {
      const age = r.age_days === null ? '   ?' : `${String(r.age_days).padStart(3)}d`;
      process.stdout.write(`#${String(r.id).padEnd(7)} ${age}  ${r.signal.padEnd(15)}  ${truncate(r.title, 58)}\n`);
      if (r.missing_files.length > 0) {
        process.stdout.write(`                          ↳ gone: ${truncate(r.missing_files.join(', '), 66)}\n`);
      }
    }
  });
}

async function cmdFiles(args) {
  const root = repoRoot(args.root);
  const project = args.project && args.project !== true ? args.project : null;
  const cache = new Map();
  const byFile = new Map();
  let scanned = 0;

  for await (const obs of scanObservations({ project, scan: args.scan })) {
    scanned++;
    const { missing } = inspect(obs, root, cache);
    for (const file of missing) {
      const entry = byFile.get(file) || { file, observations: 0, ids: [], newest_age_days: null };
      entry.observations++;
      if (entry.ids.length < 10) entry.ids.push(obs.id);
      const age = ageDays(obs.created_at_epoch);
      if (age !== null && (entry.newest_age_days === null || age < entry.newest_age_days)) {
        entry.newest_age_days = age;
      }
      byFile.set(file, entry);
    }
  }

  const rows = [...byFile.values()]
    .sort((a, b) => b.observations - a.observations)
    .slice(0, Math.max(1, Number(args.top) || 30));

  emit(args, rows, list => {
    process.stdout.write(`scanned ${scanned} observation(s) against ${root}\n\n`);
    process.stdout.write('  OBS  NEWEST  FILE (no longer on disk)\n');
    for (const r of list) {
      const age = r.newest_age_days === null ? '     ?' : `${String(r.newest_age_days).padStart(4)}d `;
      process.stdout.write(`${String(r.observations).padStart(5)}  ${age}  ${r.file}\n`);
    }
    process.stdout.write('\nA file can be "gone" because it was deleted, renamed, or moved to another repo.\nRenames are the interesting case: the memory is stale, not wrong.\n');
  });
}

// ── entry ───────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

const commands = { scan: cmdScan, files: cmdFiles };

if (!command || args.help) {
  process.stdout.write(`rot — triage memories that may no longer be true

  rot scan  [--project P] [--scan N] [--root DIR] [--min-age-days N] [--top N] [--json]
  rot files [--project P] [--scan N] [--root DIR] [--top N] [--json]

Default age threshold: ${DEFAULT_AGE_DAYS} days. Root defaults to the git toplevel.
Worker port resolves from CLAUDE_MEM_WORKER_PORT, then ~/.claude-mem/settings.json.
`);
  process.exit(args.help ? 0 : 1);
}

if (!commands[command]) die(`unknown command "${command}" (try: scan, files)`);

await commands[command](args);
