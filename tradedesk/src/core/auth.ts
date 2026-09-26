/**
 * Role-based authorization.
 *
 * Deliberately orthogonal to plan entitlements (see plans.ts):
 *   - A plan says what the ACCOUNT bought.
 *   - A role says what this MEMBER may do with it.
 * Both must pass. Owner bypasses roles, never billing — otherwise an owner could
 * use features the account has not paid for and break revenue accounting.
 */

export type Role = "owner" | "admin" | "staff" | "customer";

export type Permission =
  // CRM
  | "customer:read"
  | "customer:write"
  | "customer:delete"
  // Sales documents
  | "estimate:read"
  | "estimate:write"
  | "invoice:read"
  | "invoice:write"
  | "invoice:void"
  // Field operations
  | "job:read"
  | "job:write"
  | "job:assign"
  | "timesheet:write"
  | "timesheet:approve"
  // Money
  | "payment:refund"
  | "report:read"
  | "pnl:read"
  // Finance module — company tax profile, pay runs, accounting.
  // Handles tax identifiers and compensation, so it is never staff-visible.
  | "finance:read"
  | "finance:write"
  | "tax:read"
  | "tax:write"
  | "payroll:read"
  | "payroll:write"
  | "payroll:approve"
  // Operations log — day-to-day custom data entry.
  | "oplog:read"
  | "oplog:write"
  | "oplog:template:manage"
  | "oplog:delete"
  // Administration
  | "member:invite"
  | "member:role:set"
  | "billing:manage"
  | "settings:write"
  | "audit:read"
  | "data:export"
  | "data:purge"
  // Owner-only operational tooling
  | "diagnostics:run"
  | "impersonate";

/** Everything a customer may do in the client portal. Intentionally tiny. */
const CUSTOMER: readonly Permission[] = [
  "estimate:read",
  "invoice:read",
  "job:read",
];

/** Field staff: do the work, see the work, touch no money and no settings. */
const STAFF: readonly Permission[] = [
  "customer:read",
  "customer:write",
  "estimate:read",
  "estimate:write",
  "invoice:read",
  "job:read",
  "job:write",
  "timesheet:write",
];

/** Admin: runs the business day to day. No billing, no destructive data ops. */
const ADMIN: readonly Permission[] = [
  ...STAFF,
  "customer:delete",
  "invoice:write",
  "invoice:void",
  "job:assign",
  "timesheet:approve",
  "payment:refund",
  "report:read",
  "pnl:read",
  "finance:read",
  "finance:write",
  "tax:read",
  "tax:write",
  "payroll:read",
  "payroll:write",
  "payroll:approve",
  "oplog:read",
  "oplog:write",
  "oplog:template:manage",
  "member:invite",
  "settings:write",
  "audit:read",
  "data:export",
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  customer: CUSTOMER,
  staff: STAFF,
  admin: ADMIN,
  // Owner is handled by bypass in can(); listing is for introspection/UI only.
  owner: [
    ...ADMIN,
    "member:role:set",
    "billing:manage",
    // Deleting an operations-log entry destroys an audit record, so it stays
    // with the owner even though admins may create and edit entries.
    "oplog:delete",
    "billing:manage",
    "data:purge",
    "diagnostics:run",
    "impersonate",
  ],
};

export interface Principal {
  userId: string;
  accountId: string;
  role: Role;
}

/**
 * Authorize `permission` for `principal` against a resource in `accountId`.
 *
 * Tenant isolation is checked first and unconditionally: no role, owner
 * included, may act on another account's data.
 */
export function can(
  principal: Principal,
  permission: Permission,
  accountId: string,
): boolean {
  if (principal.accountId !== accountId) return false;
  if (principal.role === "owner") return true;
  return ROLE_PERMISSIONS[principal.role].includes(permission);
}

export class AuthorizationError extends Error {
  readonly code = "forbidden";
  constructor(readonly permission: Permission) {
    super(`Not authorized: ${permission}`);
    this.name = "AuthorizationError";
  }
}

/** Throwing variant for use at API handler boundaries. */
export function authorize(
  principal: Principal,
  permission: Permission,
  accountId: string,
): void {
  if (!can(principal, permission, accountId)) {
    throw new AuthorizationError(permission);
  }
}

/**
 * Only an owner may change roles, and no one may create a second owner or strip
 * the last one — ownership transfer is a separate, deliberate flow.
 */
export function canSetRole(actor: Principal, target: Role): boolean {
  if (actor.role !== "owner") return false;
  return target !== "owner";
}
