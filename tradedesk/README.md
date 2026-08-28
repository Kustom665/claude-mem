# TradeDesk

An all-in-one field-service business app: CRM, estimates, invoicing, scheduling,
payments, and team management.

> **Branding.** Every brand-facing string lives in `brand.config.ts`. Renaming
> the product is a one-file edit; nothing else hardcodes a name.

## Status

Foundation layer. Implemented and tested:

| Area | File | State |
|---|---|---|
| Brand/theme config | `brand.config.ts` | done |
| Plan tiers + entitlements | `src/core/plans.ts` | done, tested |
| Roles + authorization | `src/core/auth.ts` | done, tested |
| Schema + RLS + audit log | `src/db/001_init.sql` | written, not yet applied |
| API / UI / integrations | — | not started |

Run `bun test` for the entitlement and authorization suites.

## Access model

Two independent gates. Both must pass.

**Plan** — what the account bought (`src/core/plans.ts`). Tiers are strictly
cumulative. Limits are metered per billing period; `null` means unlimited.

**Role** — what the person may do (`src/core/auth.ts`).

| Role | Scope |
|---|---|
| `owner` | Full access: billing, role assignment, data purge, diagnostics, impersonation |
| `admin` | Day-to-day operations, refunds, reports, P&L, invites, audit log. No billing, no destructive data ops |
| `staff` | Jobs, customers, estimates, own timesheets. No money, no settings |
| `customer` | Read-only portal: their own estimates, invoices, jobs |

Owner bypasses **roles**, never **billing** — otherwise an owner could consume
features the account has not paid for and break revenue accounting.

Tenant isolation is checked before any role and applies to every role, owner
included. It is enforced twice: in `can()` and again in Postgres RLS, so an
application bug cannot cross tenants on its own.

## Money

All monetary values are integer minor units (cents). No floats anywhere in the
schema or the domain layer.

## Provenance

Feature scope was derived from publicly published plan comparisons of competing
field-service products. All code, schema, copy, and design here is original
work — no third-party source, markup, styling, or brand asset is reproduced.
