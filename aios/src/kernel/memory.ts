/**
 * OS-wide agent memory.
 *
 * Every process shares this store, which is what makes agents in AIOS
 * cooperative rather than isolated: one agent's finding is another agent's
 * starting context. Retrieval is lexical (weighted token overlap with a small
 * recency nudge) so the whole OS runs with no external index and no network.
 */

export interface MemoryEntry {
  key: string;
  value: string;
  tags: string[];
  /** pid that wrote the entry. */
  author: number;
  createdAt: number;
  /** Bumped on every recall that returns this entry. */
  hits: number;
}

export interface ScoredEntry extends MemoryEntry {
  score: number;
}

export class MemoryStore {
  private entries = new Map<string, MemoryEntry>();

  /** Insert or overwrite a fact. */
  remember(key: string, value: string, tags: string[], author: number): void {
    const existing = this.entries.get(key);
    this.entries.set(key, {
      key,
      value,
      tags,
      author,
      createdAt: existing?.createdAt ?? Date.now(),
      hits: existing?.hits ?? 0,
    });
  }

  /** Best-matching entries for `query`, highest score first. */
  recall(query: string, limit: number): ScoredEntry[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const now = Date.now();
    const scored: ScoredEntry[] = [];

    for (const entry of this.entries.values()) {
      // Tags and keys are curated, so a hit there means more than one in prose.
      const keyTokens = new Set(tokenize(entry.key));
      const tagTokens = new Set(entry.tags.flatMap(tokenize));
      const valueTokens = new Set(tokenize(entry.value));

      let score = 0;
      for (const term of terms) {
        if (keyTokens.has(term)) score += 3;
        if (tagTokens.has(term)) score += 2;
        if (valueTokens.has(term)) score += 1;
      }
      if (score === 0) continue;

      // Normalize by query length so long queries do not dominate, then add a
      // small recency bonus decaying over roughly an hour.
      score /= terms.length;
      const ageHours = (now - entry.createdAt) / 3_600_000;
      score += Math.max(0, 0.5 - ageHours * 0.5);

      scored.push({ ...entry, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    for (const entry of top) {
      const stored = this.entries.get(entry.key);
      if (stored) stored.hits++;
    }
    return top;
  }

  forget(key: string): boolean {
    return this.entries.delete(key);
  }

  get(key: string): MemoryEntry | undefined {
    return this.entries.get(key);
  }

  all(): MemoryEntry[] {
    return [...this.entries.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get size(): number {
    return this.entries.size;
  }

  snapshot(): string {
    return JSON.stringify([...this.entries.values()], null, 2);
  }

  restore(json: string): void {
    this.entries = new Map((JSON.parse(json) as MemoryEntry[]).map((e) => [e.key, e]));
  }
}

/**
 * Lowercase word tokens, minus very common filler.
 *
 * Hyphens and underscores are separators, not word characters: keys are slugs
 * like `agent-7-explain-scheduling`, and keeping them whole would make a key
 * match only an exact repeat of the entire slug.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'this', 'that', 'with', 'from',
  'has', 'have', 'had', 'not', 'but', 'you', 'all', 'can', 'its', 'into',
  'what', 'which', 'when', 'how', 'why', 'who',
]);
