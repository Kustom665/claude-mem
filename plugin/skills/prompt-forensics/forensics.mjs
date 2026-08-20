#!/usr/bin/env node
/**
 * prompt-forensics — mine your own prompt history for the briefs that cost you.
 *
 * claude-mem records every user prompt and every session summary. Joined, they
 * show which openings led to a clean landing and which led to ten turns of
 * clarification and an unfinished next_steps block. That is a debuggable
 * signal about the human, not the code.
 *
 * This script only counts. Judgment (why a brief failed, what rule prevents it)
 * belongs to the agents the skill dispatches.
 *
 * Commands:
 *   sessions [--project P] [--scan N] [--top N]   sessions ranked by friction
 *   prompts --session ID                          one session's prompts in order
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── plumbing ────────────────────────────────────────────────────────────

// Piping into `head` closes stdout early; that's normal usage, not a crash.
process.stdout.on('error', err => { if (err?.code === 'EPIPE') process.exit(0); throw err; });

function die(message, code = 1) {
  process.stderr.write(`forensics: ${message}\n`);
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

/** Page a paginated endpoint newest-first (server caps limit at 100). */
async function collect(endpoint, { project, scan }) {
  const budget = Math.max(1, Number(scan) || 1000);
  const items = [];
  let offset = 0;
  while (items.length < budget) {
    const params = new URLSearchParams({ offset: String(offset), limit: '100' });
    if (project) params.set('project', project);
    const page = await api(`${endpoint}?${params.toString()}`);
    const batch = Array.isArray(page?.items) ? page.items : [];
    items.push(...batch);
    if (!page?.hasMore || batch.length === 0) break;
    offset += batch.length;
  }
  return items.slice(0, budget);
}

function filled(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 && text.toLowerCase() !== 'none' && text.toLowerCase() !== 'n/a';
}

function truncate(text, width) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
}

function emit(args, rows, render) {
  if (args.json) { process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`); return; }
  if (rows.length === 0) { process.stdout.write('(nothing found)\n'); return; }
  render(rows);
}

// ── scoring ─────────────────────────────────────────────────────────────

/**
 * Friction is deliberately dumb and legible: turns spent, plus penalties for a
 * session that ended owing work. Agents get the raw components too — if they
 * disagree with the weighting they can re-rank from the JSON.
 */
function friction({ turns, unfinished, noCompletion }) {
  return turns + (unfinished ? 3 : 0) + (noCompletion ? 2 : 0);
}

// ── commands ────────────────────────────────────────────────────────────

async function cmdSessions(args) {
  const project = args.project && args.project !== true ? args.project : null;
  const scan = Math.max(1, Number(args.scan) || 1000);

  // Both feeds are newest-first, but there are many prompts per session — so an
  // equal budget covers far fewer sessions on the prompt side. Scanning them at
  // the same depth silently scores older sessions as zero-turn and buries them
  // at the bottom of a ranking that claims to be about friction.
  const promptScan = Math.max(1, Number(args['prompt-scan']) || scan * 5);

  const [prompts, summaries] = await Promise.all([
    collect('/api/prompts', { project, scan: promptScan }),
    collect('/api/summaries', { project, scan }),
  ]);

  const bySession = new Map();
  for (const prompt of prompts) {
    const key = prompt.content_session_id;
    if (!key) continue;
    const entry = bySession.get(key) || { turns: 0, opening: null, openingNumber: Infinity, project: prompt.project };
    entry.turns++;
    const number = Number(prompt.prompt_number);
    if (Number.isFinite(number) && number < entry.openingNumber) {
      entry.openingNumber = number;
      entry.opening = prompt.prompt_text;
    }
    bySession.set(key, entry);
  }

  const minTurns = Number(args['min-turns']) || 0;
  const uncovered = summaries.filter(s => !bySession.has(s.session_id)).length;
  const rows = summaries
    .filter(summary => bySession.has(summary.session_id))
    .map(summary => {
      const key = summary.session_id;
      const counted = bySession.get(key) || { turns: 0, opening: null, project: summary.project };
      const unfinished = filled(summary.next_steps);
      const noCompletion = !filled(summary.completed);
      return {
        session_id: key,
        project: summary.project || counted.project,
        created_at: summary.created_at,
        turns: counted.turns,
        unfinished,
        no_completion: noCompletion,
        friction: friction({ turns: counted.turns, unfinished, noCompletion }),
        opening_prompt: counted.opening,
        request: summary.request,
        next_steps: summary.next_steps,
      };
    })
    .filter(row => row.turns >= minTurns)
    .sort((a, b) => b.friction - a.friction || b.turns - a.turns)
    .slice(0, Math.max(1, Number(args.top) || 20));

  emit(args, rows, list => {
    process.stdout.write(`${summaries.length} session(s) / ${prompts.length} prompt(s) scanned${project ? ` in ${project}` : ''}\n`);
    if (uncovered > 0) {
      // Never silently drop them: a ranking that quietly omits a third of the
      // history reads exactly like one that covered everything.
      process.stdout.write(`${uncovered} session(s) EXCLUDED — no prompts within the scan window; raise --prompt-scan to include them\n`);
    }
    process.stdout.write('friction = turns + 3 if next_steps left open + 2 if nothing recorded as completed\n\n');
    process.stdout.write('SCORE  TURNS  FLAGS  OPENING PROMPT\n');
    for (const r of list) {
      const flags = `${r.unfinished ? 'U' : '-'}${r.no_completion ? 'C' : '-'}`;
      process.stdout.write(`${String(r.friction).padStart(5)}  ${String(r.turns).padStart(5)}  ${flags.padEnd(5)}  ${truncate(r.opening_prompt || r.request, 78)}\n`);
      process.stdout.write(`                      ↳ ${r.session_id}\n`);
    }
    process.stdout.write('\nU = ended with open next_steps   C = nothing recorded as completed\n');
  });
}

async function cmdPrompts(args) {
  const session = args.session;
  if (!session || session === true) die('prompts needs --session ID');

  const prompts = await collect('/api/prompts', {
    project: args.project && args.project !== true ? args.project : null,
    scan: args.scan || 5000,
  });

  const rows = prompts
    .filter(p => p.content_session_id === session)
    .sort((a, b) => Number(a.prompt_number) - Number(b.prompt_number))
    .map(p => ({
      prompt_number: p.prompt_number,
      created_at: p.created_at,
      prompt_text: p.prompt_text,
    }));

  if (rows.length === 0 && !args.json) {
    process.stdout.write(`no prompts found for ${session} within the scan window — raise --scan\n`);
    return;
  }

  emit(args, rows, list => {
    process.stdout.write(`${session} — ${list.length} prompt(s)\n\n`);
    for (const r of list) {
      process.stdout.write(`[${r.prompt_number}] ${truncate(r.prompt_text, 400)}\n\n`);
    }
  });
}

// ── entry ───────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

const commands = { sessions: cmdSessions, prompts: cmdPrompts };

if (!command || args.help) {
  process.stdout.write(`forensics — rank your own briefs by what they cost

  forensics sessions [--project P] [--scan N] [--prompt-scan N] [--top N] [--min-turns N] [--json]
  forensics prompts --session ID [--project P] [--scan N] [--json]

--scan bounds sessions; --prompt-scan bounds prompts and defaults to 5x --scan,
since there are many prompts per session. Sessions with no prompts in the window
are excluded and counted, never scored as zero-turn.

Worker port resolves from CLAUDE_MEM_WORKER_PORT, then ~/.claude-mem/settings.json.
`);
  process.exit(args.help ? 0 : 1);
}

if (!commands[command]) die(`unknown command "${command}" (try: sessions, prompts)`);

await commands[command](args);
