# AIOS

An operating system where **AI agents are processes**.

Not a chat wrapper and not an agent framework — a small kernel that applies real
OS primitives to agent work: a process table, a preemptive scheduler, syscalls,
signals, IPC, a virtual filesystem, and memory shared across every process.

```
/home $ swarm --n 4 "name this project"
[swarm] 4 agents running concurrently: 4 5 6 7
--- agent 1 (pid 4) ---
...

/home $ ps
  PID  PPID  STATE      PRI   CPU  COMMAND
    1    0  blocked    0     7  init (wait)
    2    1  blocked    0     9  sh (wait)
    4    2  blocked    0     4  agent (infer)
    5    2  blocked    0     4  agent (infer)
```

Those four agents are genuinely in flight at once. Each is parked in `BLOCKED`
on an `infer` syscall while the kernel keeps scheduling everyone else.

## Quick start

Requires [Bun](https://bun.sh) 1.1+. There is no build step.

```bash
bun run src/main.ts                       # boot into the shell
bun run src/main.ts run 'help' 'ps'       # run commands, then halt
bun test                                  # 90 tests
```

**No API key is needed.** Without `ANTHROPIC_API_KEY`, AIOS runs a deterministic
offline provider, so every command works. Set the key to use the real model:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AIOS_MODEL=claude-sonnet-4-5     # optional
```

## The idea

A program is a **generator that yields syscalls**. The kernel drives it, runs
each syscall, and passes the result back in:

```ts
export const echo: Program = {
  name: 'echo',
  description: 'print arguments to stdout',
  *main(ctx) {
    yield sys.print(ctx.argv.slice(1).join(' '));
    return 0;
  },
};
```

This buys three things a plain `async function` cannot:

1. **A real syscall boundary** — userland never touches kernel state directly.
2. **Real preemption** — the kernel counts syscalls and suspends a process
   mid-flight when its quantum expires.
3. **Real blocking** — an async syscall parks *that* process and hands the CPU
   to somebody else. That is why a dozen agents can wait on model calls at once
   with no threads and no async contagion.

## What's in the box

| Subsystem | Where | Notes |
|---|---|---|
| Kernel loop, syscall dispatch | `src/kernel/kernel.ts` | 35 syscalls |
| Scheduler | `src/kernel/scheduler.ts` | Priority + round-robin + aging |
| Process control block | `src/kernel/process.ts` | States, signals, mailbox |
| Virtual filesystem | `src/kernel/vfs.ts` | Incl. synthetic `/proc` |
| Shared agent memory | `src/kernel/memory.ts` | Lexical recall, no network |
| Inference backends | `src/llm/provider.ts` | Anthropic + offline mock |
| Sockets | `src/kernel/net.ts` | WebSockets + fake for tests |
| Shell | `src/shell/` | Pipes, redirection, jobs, vars |
| Programs | `src/programs/` | 24 installed in `/bin` |

### Processes

States are `NEW → READY → RUNNING → BLOCKED/STOPPED → ZOMBIE → TERMINATED`.
Zombies persist until a parent `wait`s on them; orphans are re-parented to init.

Signals behave the way you'd expect: `SIGKILL` and `SIGSTOP` cannot be caught,
`SIGTERM`/`SIGINT` can be, and a process that catches one drains it with
`sys.signals()` — which is how `cron` shuts down without losing a tick.

### Scheduling

Priority scheduling (lower number = more urgent), round-robin within a level,
and **aging** across levels so a saturated high-priority level cannot starve
what's below it forever. Quantum is 64 syscalls.

### `/proc` is real

`/proc` is a synthetic mount: its contents are generated from live kernel state
on every read, not cached.

```bash
cat /proc/1/status      # what init is doing right now
cat /proc/sysinfo       # uptime, context switches, backend
cat /proc/meminfo       # shared memory contents
```

### Shared memory is what makes agents cooperative

Every process reads and writes one memory store, so one agent's finding becomes
another agent's starting context:

```bash
remember --tags kernel deadline "ship on friday"
agent "what should I prioritize?"     # recalls the deadline automatically
```

## Programs

```
init sh                                    boot and shell
echo cat ls write mkdir rm pwd grep sleep  coreutils
ps kill top uname help                     process control
agent pipeline swarm                       agents
remember recall forget                     shared memory
cron builtwith                             daemons
```

Shell builtins: `cd`, `exit`, `export`, `env`, `jobs`, `clear`.

### Composing them

```bash
# chain agents, each stage fed the previous stage's output
pipeline "draft a launch plan" "critique that plan" "rewrite it"

# N agents on one question, concurrently
swarm --n 5 --role "skeptical reviewer" "is this architecture sound?"

# agents compose with ordinary shell plumbing
recall kernel | agent "summarize these findings" > /home/work/summary.txt

# background daemons
cron --every 5000 --forever agent "check for anything new" &
ps
kill -TERM 3
```

## Networking and the BuiltWith live feed

Sockets are a kernel resource behind a device abstraction, the same as the
console — so the OS is fully testable offline and a fake transport is a drop-in.
Descriptors start at 3 (0–2 are stdio), are per-process, and are closed
automatically when their owner exits.

```ts
const fd = yield sys.connect('wss://example.com/feed');
yield sys.sockSend(fd, JSON.stringify({ action: 'subscribe', channel: 'Shopify' }));
const frame = yield sys.sockRecv(fd);   // blocks; null once the peer closes
```

The `builtwith` daemon uses this to stream the
[BuiltWith live feed](https://api.builtwith.com/) into shared memory, so an agent
can qualify leads as they land — the feed and the agent never reference each
other, they just share memory:

```bash
export BUILTWITH_API_KEY=...            # never commit this

builtwith --channel Shopify --limit 20 --out /home/work/leads.csv
recall shopify | agent "which of these are worth contacting, and why?"

# or run it in the background and let it accumulate
builtwith --channel new --quiet &
ps
kill 3
```

Each detection is stored as `lead-<domain>` tagged `builtwith`, `lead`, and the
technology name, and optionally appended to a CSV.

**On the API key:** it is read from `BUILTWITH_API_KEY` and never written to
stdout, stderr, or the VFS. Because the key travels in the connection URL's
query string, `redactUrl()` strips query strings from anything that could reach
a log or an error message. Tests assert the key never appears in program output.

**On shutdown:** this daemon deliberately does *not* catch SIGTERM. It sits
blocked in `sockRecv`, so a caught signal would go unobserved until the next
frame arrived — which on a quiet channel could be minutes. Letting the kernel
terminate it is prompt, and the kernel closes its socket during teardown.

**On reconnects:** `--retries` bounds *consecutive unproductive* reconnects. A
session that delivers at least one detection resets the budget, so a healthy
feed reconnects indefinitely while a peer that accepts and immediately closes
gives up instead of spinning. `--backoff` sets the first step; it doubles per
attempt, capped at 30s.

## Testing

113 tests across kernel, VFS, memory, shell parsing, sockets, the live-feed
daemon, end-to-end boot, and CLI integration.

```bash
bun test
bun run typecheck     # strict + noUncheckedIndexedAccess, clean
```

The concurrency claim is tested, not asserted: `tests/kernel.test.ts` swaps in a
provider that records peak in-flight calls and checks all four agents overlap
and that wall-clock stays well under the serialized time.

## Limits

Worth knowing before you build on it:

- **One virtual CPU.** Concurrency comes from overlapping *blocked* processes,
  not parallel execution. CPU-bound programs still serialize.
- **The VFS is in memory.** `snapshot()`/`restore()` exist, but nothing is
  persisted to host disk automatically, and the filesystem is not sandboxed
  between processes — there are no users or permissions.
- **Recall is lexical**, not semantic. It matches tokens, so a query phrased
  entirely differently from what was stored will miss.
- **`wait` returns captured output** alongside the exit code, which is a
  deliberate departure from POSIX — AIOS buffers process output instead of
  wiring file descriptors before a fork.
- **Background pipelines** are rejected; background a single command instead.
- **Sockets are WebSocket-only** and have no `dup`/inherit, so a descriptor
  cannot be passed to a child process.
- A process stopped with `SIGSTOP` keeps the kernel alive, since only an
  external `SIGCONT` can revive it.
