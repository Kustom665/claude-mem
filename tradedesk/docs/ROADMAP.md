# Roadmap

Ordered by dependency, not by ambition. Each phase is shippable.

## Phase 1 — Foundation (done)
Brand config, plan entitlements, RBAC, schema with RLS and audit log.

## Phase 2 — Core money loop
The shortest path to a business getting paid, and the part that must be exact.

- Document totals engine: per-line tax, integer-cent rounding, discounts.
  Rounding is applied once at the line level and summed; never re-rounded.
- Estimate lifecycle: draft → sent → accepted/declined.
- Estimate → invoice conversion, preserving `converted_from` for audit.
- Invoice lifecycle: sent → paid/void. Voids are never deletes.
- Stripe: checkout, webhook reconciliation, refunds behind `payment:refund`.

## Phase 3 — Field operations
- Job scheduling with assignment and conflict detection.
- Calendar and dispatch views.
- Time tracking with an approval step (`timesheet:approve`).

## Phase 4 — Client-facing
- Customer portal scoped by the `customer` role.
- Online booking.
- Attachments on jobs, estimates, invoices.
- Two-way SMS, metered against `sms_sent`.

## Phase 5 — Growth and reporting
- Recurring invoices and schedules.
- Review requests, marketing campaigns.
- Inventory and suppliers.
- Reports and P&L.

## Phase 6 — Owner tooling
- Admin console: audit log viewer, impersonation with mandatory audit entries,
  diagnostics runner behind `diagnostics:run`.
- Data export and purge with confirmation.

## Our twist
An AI job assistant available from Pro up rather than reserved for the top tier:
drafts estimates from a job description, writes customer follow-ups, and
summarizes job history. Metered via `ai_assist_calls`.
