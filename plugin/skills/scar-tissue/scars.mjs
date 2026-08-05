#!/usr/bin/env node
/**
 * scar-tissue — join a working diff against claude-mem's bugfix history.
 *
 * Memory is normally used to recall. This uses it as a grudge: every file
 * carries scars (past bugfixes), and a diff that touches a scarred region
 * deserves a second look before it ships.
 *
 * Commands:
 *   changed [--base REF]                 files this branch/worktree touches
 *   history --file PATH [--project P]    observations that touched one file
 *   map [--project P] [--scan N]         files ranked by scar density
 *
 * All commands print a human table; pass --json for machine output.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCAR_TYPES = ['bugfix', 'security_alert'];

// ── plumbing ────────────────────────────────────────────────────────────

// Piping into `head` closes stdout early; that's normal usage, not a crash.
process.stdout.on('error', err => { if (err?.code === 'EPIPE') process.exit(0); throw err; });

function die(message, code = 1) {
  process.stderr.write(`scars: ${message}\n`);
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

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function repoRoot() {
  try { return git(['rev-parse', '--show-toplevel']).trim(); }
  catch { return die('not inside a git repository'); }
}

function posix(p) { return p.split(sep).join('/'); }

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

// ── git surface ─────────────────────────────────────────────────────────

/** Working tree + index + untracked, NUL-parsed so odd filenames survive. */
function statusFiles(root) {
  // -uall so untracked directories expand to files; a bare directory entry is
  // useless to a per-file reviewer.
  const entries = git(['status', '--porcelain=v1', '-z', '-uall'], root).split('\0');
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    files.push(entry.slice(3));
    // Rename/copy entries carry their source path in the next NUL field.
    if (xy[0] === 'R' || xy[0] === 'C') i++;
  }
  return files;
}

function diffFiles(root, base) {
  for (const range of [`${base}...HEAD`, base]) {
    try {
      return git(['diff', '--name-only', '-z', range], root).split('\0').filter(Boolean);
    } catch { /* try the next form */ }
  }
  return die(`cannot diff against "${base}" — is it a valid ref?`);
}

function changedFiles(root, base) {
  const files = new Set(statusFiles(root));
  if (base) for (const f of diffFiles(root, base)) files.add(f);
  return [...files].sort();
}

// ── memory surface ──────────────────────────────────────────────────────

/**
 * by-file matches stored paths by EXACT string equality, and PostToolUse may
 * have stored either form — so always ask with both.
 */
async function observationsForFile(root, file, { project, limit }) {
  const abs = isAbsolute(file) ? file : resolve(root, file);
  const params = new URLSearchParams();
  params.append('path', posix(abs));
  params.append('path', posix(relative(root, abs)));
  if (project) params.set('projects', project);
  params.set('limit', String(Math.min(Number(limit) || 25, 100)));
  const body = await api(`/api/observations/by-file?${params.toString()}`);
  return Array.isArray(body?.observations) ? body.observations : [];
}

/** Page newest-first through /api/observations (server caps limit at 100). */
async function* scanObservations({ project, scan }) {
  const budget = Math.max(1, Number(scan) || 2000);
  let offset = 0;
  while (offset < budget) {
    const params = new URLSearchParams({ offset: String(offset), limit: '100' });
    if (project) params.set('project', project);
    const page = await api(`/api/observations?${params.toString()}`);
    const items = Array.isArray(page?.items) ? page.items : [];
    for (const item of items) yield item;
    if (!page?.hasMore || items.length === 0) return;
    offset += items.length;
  }
}

function isScar(obs, types) {
  return types.includes(String(obs.type || '').toLowerCase());
}

// ── commands ────────────────────────────────────────────────────────────

async function cmdChanged(args) {
  const root = repoRoot();
  const files = changedFiles(root, args.base && args.base !== true ? args.base : null);
  emit(args, files, rows => rows.forEach(f => process.stdout.write(`${f}\n`)));
}

async function cmdHistory(args) {
  const file = args.file;
  if (!file || file === true) die('history needs --file PATH');
  const root = repoRoot();
  const types = String(args.types || SCAR_TYPES.join(',')).split(',').map(s => s.trim()).filter(Boolean);
  const observations = await observationsForFile(root, file, {
    project: args.project && args.project !== true ? args.project : null,
    limit: args.limit,
  });

  const root_rel = posix(relative(root, isAbsolute(file) ? file : resolve(root, file)));
  const rows = observations.map(obs => {
    const modified = parseFileList(obs.files_modified).map(posix);
    const wasModified = modified.some(f => f === root_rel || f.endsWith(`/${root_rel}`) || root_rel.endsWith(f));
    return {
    id: obs.id,
    type: obs.type,
    // A bugfix that only READ this file investigated it; one that modified it
    // left a scar. The distinction changes how much weight a verdict carries.
    scar: isScar(obs, types) && wasModified,
    touch: wasModified ? 'modified' : 'read',
    age_days: ageDays(obs.created_at_epoch),
    created_at: obs.created_at,
    title: obs.title,
    subtitle: obs.subtitle,
      project: obs.project,
    };
  });

  emit(args, rows, list => {
    process.stdout.write(`${file} — ${list.length} observation(s), ${list.filter(r => r.scar).length} scar(s)\n\n`);
    process.stdout.write('  ID      AGE   TOUCH     TYPE            TITLE\n');
    for (const r of list) {
      const mark = r.scar ? '*' : ' ';
      const age = r.age_days === null ? '   ?' : `${String(r.age_days).padStart(3)}d`;
      process.stdout.write(`${mark} #${String(r.id).padEnd(6)} ${age}  ${r.touch.padEnd(8)}  ${String(r.type).padEnd(14)}  ${truncate(r.title, 52)}\n`);
    }
    process.stdout.write('\n* = scar (a past bugfix or security alert that MODIFIED this file)\n');
  });
}

async function cmdMap(args) {
  const types = String(args.types || SCAR_TYPES.join(',')).split(',').map(s => s.trim()).filter(Boolean);
  const project = args.project && args.project !== true ? args.project : null;
  const byFile = new Map();
  let scanned = 0;

  for await (const obs of scanObservations({ project, scan: args.scan })) {
    scanned++;
    if (!isScar(obs, types)) continue;
    // A scar is a file the fix CHANGED. Files merely read during a fix are
    // investigation context — counting them buries real scars under whatever
    // file gets opened most often. --include-reads widens it deliberately.
    const touched = new Set(args['include-reads']
      ? [...parseFileList(obs.files_modified), ...parseFileList(obs.files_read)]
      : parseFileList(obs.files_modified));
    for (const file of touched) {
      const entry = byFile.get(file) || { file, scars: 0, last_epoch: 0, last_title: null, ids: [] };
      entry.scars++;
      entry.ids.push(obs.id);
      if (Number(obs.created_at_epoch) > entry.last_epoch) {
        entry.last_epoch = Number(obs.created_at_epoch);
        entry.last_title = obs.title;
      }
      byFile.set(file, entry);
    }
  }

  const top = Math.max(1, Number(args.top) || 25);
  const rows = [...byFile.values()]
    .sort((a, b) => b.scars - a.scars || b.last_epoch - a.last_epoch)
    .slice(0, top)
    .map(r => ({ ...r, last_age_days: ageDays(r.last_epoch), ids: r.ids.slice(0, 10) }));

  emit(args, rows, list => {
    process.stdout.write(`scanned ${scanned} observation(s)${project ? ` in ${project}` : ''}\n\n`);
    process.stdout.write('SCARS  LAST   FILE\n');
    for (const r of list) {
      const age = r.last_age_days === null ? '   ?' : `${String(r.last_age_days).padStart(3)}d`;
      process.stdout.write(`${String(r.scars).padStart(5)}  ${age}   ${r.file}\n`);
      process.stdout.write(`                ↳ ${truncate(r.last_title, 70)}\n`);
    }
  });
}

// ── entry ───────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

const commands = { changed: cmdChanged, history: cmdHistory, map: cmdMap };

if (!command || args.help) {
  process.stdout.write(`scars — memory as a regression oracle

  scars changed [--base REF] [--json]
  scars history --file PATH [--project P] [--limit N] [--types t1,t2] [--json]
  scars map [--project P] [--scan N] [--top N] [--types t1,t2] [--json]

Scar types default to: ${SCAR_TYPES.join(', ')}
Worker port resolves from CLAUDE_MEM_WORKER_PORT, then ~/.claude-mem/settings.json.
`);
  process.exit(args.help ? 0 : 1);
}

if (!commands[command]) die(`unknown command "${command}" (try: changed, history, map)`);

await commands[command](args);
