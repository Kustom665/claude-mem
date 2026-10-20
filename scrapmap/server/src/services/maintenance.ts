import { execute, nowIso } from '../db/index.ts';

/**
 * Moves open listings past their expiry to 'expired'.
 *
 * Scrap sitting in a driveway gets taken, thrown out, or forgotten; a
 * marketplace full of dead posts wastes scrappers' fuel. Claimed listings are
 * left alone — a pickup already in motion should not vanish underneath the
 * people arranging it.
 */
export function expireStaleListings(): number {
  const result = execute(
    `UPDATE listings
        SET status = 'expired', updated_at = ?
      WHERE status = 'open'
        AND expires_at IS NOT NULL
        AND expires_at < ?`,
    [nowIso(), nowIso()],
  );
  return result.changes;
}
