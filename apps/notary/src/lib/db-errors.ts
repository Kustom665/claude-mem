/**
 * Prisma's unique-constraint violation (error code P2002), recognized without
 * importing its error classes — which differ between the SQLite and Postgres
 * driver adapters this app can run on.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}
