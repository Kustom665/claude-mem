import { ProcState } from './types.ts';
import type { Process } from './process.ts';

/**
 * Priority scheduler with round-robin inside each priority level and aging
 * across levels.
 *
 * Selection picks the lowest effective priority number (most urgent). Every
 * process that is passed over accrues a wait tick, which eventually pulls its
 * effective priority down far enough to be picked — so a saturated high
 * priority level cannot starve the ones below it forever.
 */
export class Scheduler {
  private readyQueue: Process[] = [];
  /** Completed scheduling decisions. Useful for tests and for `top`. */
  contextSwitches = 0;

  /** Admit a process to the run queue. */
  enqueue(proc: Process): void {
    if (this.readyQueue.includes(proc)) return;
    proc.state = ProcState.READY;
    proc.waitTicks = 0;
    this.readyQueue.push(proc);
  }

  /** Remove a process from the run queue (on block, exit, or stop). */
  remove(proc: Process): void {
    const idx = this.readyQueue.indexOf(proc);
    if (idx !== -1) this.readyQueue.splice(idx, 1);
  }

  /**
   * Pick the next process to run and remove it from the queue.
   * Returns null when nothing is runnable.
   */
  next(): Process | null {
    if (this.readyQueue.length === 0) return null;

    let bestIdx = 0;
    let best = this.readyQueue[0]!.effectivePriority();
    for (let i = 1; i < this.readyQueue.length; i++) {
      const p = this.readyQueue[i]!.effectivePriority();
      // Strictly-less keeps FIFO order among equals, giving round-robin.
      if (p < best) {
        best = p;
        bestIdx = i;
      }
    }

    const [chosen] = this.readyQueue.splice(bestIdx, 1);
    // Everyone still queued waited out another decision.
    for (const proc of this.readyQueue) proc.waitTicks++;

    chosen!.waitTicks = 0;
    this.contextSwitches++;
    return chosen!;
  }

  get length(): number {
    return this.readyQueue.length;
  }

  /** Snapshot of the queue, most urgent first. Does not mutate wait ticks. */
  peek(): Process[] {
    return [...this.readyQueue].sort((a, b) => a.effectivePriority() - b.effectivePriority());
  }
}
