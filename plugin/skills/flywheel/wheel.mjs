#!/usr/bin/env node
/**
 * flywheel — the state and memory of the memory pipeline.
 *
 * The five leverage skills each produce findings. Without somewhere to put
 * them, every run starts from zero: the same drifted decision gets re-flagged,
 * the same unverifiable memories get re-verified, the same recurrence gets
 * re-discovered. That is a treadmill, not a wheel.
 *
 * This keeps two records, deliberately:
 *
 *   1. LOCAL STATE — ~/.claude-mem/flywheel/<project>.json. Deterministic,
 *      survives a stopped worker, and is what `due` and `recall` actually read.
 *      This is the wheel's memory of itself.
 *   2. MEMORY WRITE-BACK — POST /api/memory/save, so findings land in the
 *      observation store and reach future sessions through ordinary context
 *      injection, with no skill invoked at all. That is the compounding part.
 *
 * Write-back goes through /api/memory/save on purpose: the memory_add and
 * observation_add MCP tools require the server-beta runtime and throw on a
 * default SQLite install.
 *
 * Commands:
 *   state                      the wheel: last run, next due, open items
 *   due                        stages due now (drives the orchestration)
 *   record --stage --summary   log a finding locally + to memory
 *   recall [--stage]           prior findings, so a run resumes
 *   complete --stage           mark a stage run finished
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Single alphanumeric token so FTS5's unicode61 tokenizer keeps it whole. */
const MARKER = 'CMFLYWHEEL';

const STAGES = ['truth-decay', 'decision-decay', 'prompt-forensics', 'cross-pollinate', 'scar-tissue'];

/**
 * Default cadences. scar-tissue is null on purpose — it is gated on a diff, not
 * a clock, and putting it on a timer would be theatre.
 */
const DEFAULT_CADENCE = {
  'truth-decay': 30,
  'decision-decay': 30,
  'prompt-forensics': 14,
  'cross-pollinate': 60,
  'scar-tissue': null,
};

// ── plumbing ────────────────────────────────────────────────────────────

// Piping into `head` closes stdout early; that's normal usage, not a crash.
process.stdout.on('error', err => { if (err?.code === 'EPIPE') process.exit(0); throw err; });

function die(message, code = 1) {
  process.stderr.write(`wheel: ${message}\n`);
  process.exit(code);
}

function warn(message) {
  process.stderr.write(`wheel: ${message}\n`);
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

function str(value) { return typeof value === 'string' && value.length > 0 ? value : null; }

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

async function api(path, { method = 'GET', body } = {}) {
  const url = `http://localhost:${PORT}${path}`;
  const res = await fetch(url, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${res.status} from ${path}`);
  return res.json();
}

/**
 * Project name, worktree-aware: in a worktree the memory lives under the parent
 * project, matching how the other claude-mem skills resolve it.
 */
function detectProject() {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const root = gitDir !== commonDir
      ? dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim())
      : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    return root.split('/').filter(Boolean).pop() || null;
  } catch {
    return process.cwd().split('/').filter(Boolean).pop() || null;
  }
}

// ── state ───────────────────────────────────────────────────────────────

function statePath(project) {
  return join(homedir(), '.claude-mem', 'flywheel', `${project.replace(/[^\w.-]/g, '_')}.json`);
}

function emptyState(project) {
  return {
    version: 1,
    project,
    cadence_days: { ...DEFAULT_CADENCE },
    stages: {},
    findings: [],
  };
}

function loadState(project) {
  const path = statePath(project);
  if (!existsSync(path)) return emptyState(project);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      ...emptyState(project),
      ...parsed,
      cadence_days: { ...DEFAULT_CADENCE, ...(parsed.cadence_days ?? {}) },
      stages: parsed.stages ?? {},
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch (err) {
    die(`state file at ${path} is not valid JSON (${err.message}) — fix or delete it`);
  }
}

/**
 * Write via temp + rename so a crash mid-write can't truncate the wheel's state.
 * Each writer gets its own temp name — a shared `.tmp` is itself a race.
 */
function saveState(state) {
  const path = statePath(state.project);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  return path;
}

const LOCK_STALE_MS = 30_000;

/**
 * Exclusive lock around read-modify-write.
 *
 * Every skill in this pipeline fans agents out in parallel and tells each one to
 * record what it found. Without this, six concurrent `record` calls collapse to
 * one surviving finding: each process reads the same state, appends its own
 * entry, and the last writer wins. Silently — every call reports success. The
 * whole promise of the wheel is that a finding is never lost, so the lock is
 * load-bearing, not defensive.
 *
 * Held for microseconds: callers do their network I/O before acquiring.
 */
function withLock(project, fn) {
  const path = `${statePath(project)}.lock`;
  mkdirSync(dirname(path), { recursive: true });

  let fd = null;
  const deadline = Date.now() + LOCK_STALE_MS;
  while (fd === null) {
    try {
      fd = openSync(path, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // A crashed process leaves its lock behind; reclaim it once it's stale.
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(path);
          continue;
        }
      } catch { /* lock vanished under us — just retry */ }
      if (Date.now() > deadline) die(`could not lock ${path} after ${LOCK_STALE_MS}ms — delete it if no other run is active`);
      // Busy-wait: contention windows here are milliseconds, and a sleep would
      // need async plumbing through every caller for no real gain.
      const spinUntil = Date.now() + 5 + Math.floor(process.pid % 15);
      while (Date.now() < spinUntil) { /* spin */ }
    }
  }

  try {
    return fn();
  } finally {
    closeSync(fd);
    try { unlinkSync(path); } catch { /* already gone */ }
  }
}

function daysSince(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function stageStatus(state, stage) {
  const record = state.stages[stage] ?? {};
  const cadence = state.cadence_days[stage] ?? null;
  const since = daysSince(record.last_run);
  const open = state.findings.filter(f => f.stage === stage && f.open).length;
  return {
    stage,
    cadence_days: cadence,
    last_run: record.last_run ?? null,
    days_since: since,
    runs: record.runs ?? 0,
    open_items: open,
    // No cadence (scar-tissue) is never due on a clock — it is diff-gated.
    due: cadence === null ? false : since === null || since >= cadence,
  };
}

// ── commands ────────────────────────────────────────────────────────────

function cmdState(args, project) {
  const state = loadState(project);
  const rows = STAGES.map(stage => stageStatus(state, stage));

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ project, state_file: statePath(project), stages: rows, findings: state.findings }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`flywheel — ${project}\n${statePath(project)}\n\n`);
  process.stdout.write('STAGE              CADENCE  LAST RUN     DUE  OPEN\n');
  for (const r of rows) {
    const cadence = r.cadence_days === null ? 'on diff' : `${r.cadence_days}d`;
    const last = r.last_run ? `${String(r.days_since)}d ago` : 'never';
    process.stdout.write(`${r.stage.padEnd(17)}  ${cadence.padEnd(7)}  ${last.padEnd(11)}  ${(r.due ? 'yes' : '-').padEnd(3)}  ${r.open_items}\n`);
  }
  const open = state.findings.filter(f => f.open);
  if (open.length > 0) {
    process.stdout.write(`\nOpen items (carried into the next run):\n`);
    for (const f of open) process.stdout.write(`  [${f.stage}] ${f.summary}\n`);
  }
}

function cmdDue(args, project) {
  const state = loadState(project);
  const due = STAGES.map(s => stageStatus(state, s)).filter(r => r.due);
  if (args.json) { process.stdout.write(`${JSON.stringify(due, null, 2)}\n`); return; }
  if (due.length === 0) { process.stdout.write('nothing due — scar-tissue still runs on any diff\n'); return; }
  for (const r of due) {
    process.stdout.write(`${r.stage} (${r.last_run ? `${r.days_since}d since last run` : 'never run'}, cadence ${r.cadence_days}d)\n`);
  }
}

async function cmdRecord(args, project) {
  const stage = str(args.stage);
  const summary = str(args.summary);
  if (!stage) die(`record needs --stage (${STAGES.join(', ')})`);
  if (!STAGES.includes(stage)) die(`unknown stage "${stage}" (${STAGES.join(', ')})`);
  if (!summary) die('record needs --summary "what you found"');

  const refs = String(args.refs && args.refs !== true ? args.refs : '')
    .split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
  const files = String(args.files && args.files !== true ? args.files : '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const finding = {
    // id is assigned under the lock — deriving it from an unlocked read hands
    // concurrent writers the same number.
    id: null,
    stage,
    kind: str(args.kind) ?? 'finding',
    summary,
    refs,
    files,
    open: Boolean(args.open),
    recorded_at: new Date().toISOString(),
    memory_id: null,
  };

  // Memory write-back happens BEFORE the lock: it is a network round trip, and
  // holding the lock across it would serialize every parallel agent behind it.
  // Best-effort either way — the local record is the source of truth, so a
  // stopped worker must not lose the finding.
  if (!args['no-memory']) {
    const lines = [
      `${MARKER} ${stage} ${finding.kind}`,
      '',
      summary,
      refs.length ? `refs: ${refs.map(r => `#${r}`).join(', ')}` : null,
      files.length ? `files: ${files.join(', ')}` : null,
      `recorded: ${finding.recorded_at}`,
    ].filter(line => line !== null); // keep the intentional blank line

    try {
      const saved = await api('/api/memory/save', {
        method: 'POST',
        body: {
          text: lines.join('\n'),
          title: `${MARKER} ${stage}: ${summary.slice(0, 60)}`,
          project,
          metadata: { flywheel: true, stage, kind: finding.kind, refs, files },
        },
      });
      finding.memory_id = saved?.id ?? null;
    } catch (err) {
      finding.memory_error = err.message;
      warn(`memory write-back failed (${err.message}) — finding kept locally only`);
    }
  }

  const path = withLock(project, () => {
    const state = loadState(project);
    finding.id = state.findings.reduce((max, f) => Math.max(max, Number(f.id) || 0), 0) + 1;
    state.findings.push(finding);
    return saveState(state);
  });

  if (args.json) { process.stdout.write(`${JSON.stringify(finding, null, 2)}\n`); return; }
  process.stdout.write(`recorded #${finding.id} [${stage}]${finding.memory_id ? ` → observation #${finding.memory_id}` : ''}\n${path}\n`);
}

async function cmdRecall(args, project) {
  const state = loadState(project);
  const stage = str(args.stage);
  const local = state.findings
    .filter(f => !stage || f.stage === stage)
    .slice(-Math.max(1, Number(args.limit) || 25))
    .reverse();

  let remote = [];
  if (args.memory) {
    // Best-effort only: the unified search prefers semantic ranking when Chroma
    // is up, so a marker token is not guaranteed to rank. Local state is what
    // this command actually promises.
    try {
      const body = await api(`/api/search/observations?query=${encodeURIComponent(MARKER)}&project=${encodeURIComponent(project)}&limit=25`);
      remote = body?.content?.[0]?.text ? [body.content[0].text] : [];
    } catch (err) {
      warn(`memory recall failed (${err.message}) — showing local state only`);
    }
  }

  if (args.json) { process.stdout.write(`${JSON.stringify({ local, remote }, null, 2)}\n`); return; }
  if (local.length === 0) { process.stdout.write('no prior findings — this is the first turn of the wheel\n'); return; }

  process.stdout.write(`${local.length} prior finding(s)${stage ? ` for ${stage}` : ''}\n\n`);
  for (const f of local) {
    const age = daysSince(f.recorded_at);
    process.stdout.write(`#${f.id} [${f.stage}/${f.kind}] ${age === null ? '' : `${age}d ago`}${f.open ? ' OPEN' : ''}\n`);
    process.stdout.write(`  ${f.summary}\n`);
    if (f.refs?.length) process.stdout.write(`  refs: ${f.refs.map(r => `#${r}`).join(', ')}\n`);
    if (f.files?.length) process.stdout.write(`  files: ${f.files.join(', ')}\n`);
  }
  if (remote.length > 0) process.stdout.write(`\n--- memory ---\n${remote.join('\n')}\n`);
}

function cmdComplete(args, project) {
  const stage = str(args.stage);
  if (!stage) die(`complete needs --stage (${STAGES.join(', ')})`);
  if (!STAGES.includes(stage)) die(`unknown stage "${stage}" (${STAGES.join(', ')})`);

  const closing = String(args.close && args.close !== true ? args.close : '')
    .split(',').map(s => s.trim()).filter(Boolean);

  // Same lock as record: a stage closing while agents are still recording must
  // not roll back their findings.
  const { path, runs } = withLock(project, () => {
    const state = loadState(project);
    const prior = state.stages[stage] ?? {};
    state.stages[stage] = {
      last_run: new Date().toISOString(),
      runs: (Number(prior.runs) || 0) + 1,
      ...(str(args.note) ? { last_note: str(args.note) } : {}),
    };
    for (const f of state.findings) {
      if (closing.includes(String(f.id))) f.open = false;
    }
    return { path: saveState(state), runs: state.stages[stage].runs };
  });

  process.stdout.write(`${stage} run ${runs} recorded${closing.length ? `, closed ${closing.length} item(s)` : ''}\n${path}\n`);
}

// ── entry ───────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (!command || args.help) {
  process.stdout.write(`wheel — state and memory for the claude-mem leverage pipeline

  wheel state   [--project P] [--json]
  wheel due     [--project P] [--json]
  wheel record  --stage S --summary "..." [--kind K] [--refs 1,2] [--files a,b] [--open] [--no-memory]
  wheel recall  [--stage S] [--limit N] [--memory] [--json]
  wheel complete --stage S [--note "..."] [--close 1,2]

Stages: ${STAGES.join(', ')}
State:  ~/.claude-mem/flywheel/<project>.json   (local state is the source of truth)
Memory: POST /api/memory/save, tagged ${MARKER}  (best-effort, for future sessions)
`);
  process.exit(args.help ? 0 : 1);
}

const commands = { state: cmdState, due: cmdDue, record: cmdRecord, recall: cmdRecall, complete: cmdComplete };
if (!commands[command]) die(`unknown command "${command}" (try: ${Object.keys(commands).join(', ')})`);

const project = str(args.project) ?? detectProject();
if (!project) die('cannot determine the project name — pass --project');

await commands[command](args, project);
