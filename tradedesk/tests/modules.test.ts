import { expect, test, describe } from "bun:test";
import { can, type Principal } from "../src/core/auth";
import { hasFeature, minimumPlanFor } from "../src/core/plans";
import { validateEntry, validateTemplate, type Template } from "../src/core/oplog";
import {
  buildPayRun, buildLine, lineGrossCents, maskTaxId, isValidEin,
  redactForLog, PayRunError,
} from "../src/core/finance";

const owner: Principal = { userId: "u1", accountId: "a1", role: "owner" };
const admin: Principal = { userId: "u2", accountId: "a1", role: "admin" };
const staff: Principal = { userId: "u3", accountId: "a1", role: "staff" };
const client: Principal = { userId: "u4", accountId: "a1", role: "customer" };

describe("finance + oplog are owner/admin only", () => {
  const gated = [
    "finance:read", "finance:write", "tax:read", "tax:write",
    "payroll:read", "payroll:write", "payroll:approve",
    "oplog:read", "oplog:write", "oplog:template:manage",
  ] as const;

  test("owner and admin have every gated permission", () => {
    for (const p of gated) {
      expect(can(owner, p, "a1")).toBe(true);
      expect(can(admin, p, "a1")).toBe(true);
    }
  });

  test("staff and portal customers have none of them", () => {
    for (const p of gated) {
      expect(can(staff, p, "a1")).toBe(false);
      expect(can(client, p, "a1")).toBe(false);
    }
  });

  test("deleting an oplog entry is owner-only, since it destroys a record", () => {
    expect(can(owner, "oplog:delete", "a1")).toBe(true);
    expect(can(admin, "oplog:delete", "a1")).toBe(false);
  });

  test("tenant isolation still applies to finance", () => {
    expect(can(owner, "tax:read", "a2")).toBe(false);
    expect(can(admin, "payroll:write", "a2")).toBe(false);
  });

  test("plan gating: ops log from starter, finance suite at premium", () => {
    expect(minimumPlanFor("ops_log")).toBe("starter");
    expect(minimumPlanFor("finance_suite")).toBe("premium");
    expect(hasFeature("starter", "finance_suite")).toBe(false);
  });
});

describe("pay run arithmetic", () => {
  test("net reconciles and totals sum from rounded lines", () => {
    const { lines, totals } = buildPayRun([
      { memberId: "m1", hours: 38.5, rateCents: 4250, taxCents: 30000 },
      { memberId: "m2", grossCents: 250000, taxCents: 62500 },
    ]);
    expect(lines[0].grossCents).toBe(163625); // 38.5 * 4250 exactly
    expect(totals.netCents).toBe(totals.grossCents - totals.taxCents);
  });

  test("fractional cents round once at the line, not at the total", () => {
    // 3 lines of 0.333h * 1000c = 333c each (332.99 -> 333), total 999.
    // Rounding the summed 998.99... instead would give 999 too, but rounding
    // per line is what each person is actually paid.
    const { lines, totals } = buildPayRun([
      { memberId: "m1", hours: 0.333, rateCents: 1000, taxCents: 0 },
      { memberId: "m2", hours: 0.333, rateCents: 1000, taxCents: 0 },
      { memberId: "m3", hours: 0.333, rateCents: 1000, taxCents: 0 },
    ]);
    expect(lines.map((l) => l.grossCents)).toEqual([333, 333, 333]);
    expect(totals.grossCents).toBe(999);
  });

  test("tax may never exceed gross", () => {
    expect(() => buildLine({ memberId: "m1", grossCents: 100, taxCents: 101 }))
      .toThrow(PayRunError);
  });

  test("a member cannot be paid twice in one run", () => {
    expect(() => buildPayRun([
      { memberId: "m1", grossCents: 100, taxCents: 0 },
      { memberId: "m1", grossCents: 200, taxCents: 0 },
    ])).toThrow(/twice/);
  });

  test("non-integer or negative money is rejected", () => {
    expect(() => lineGrossCents({ memberId: "m", grossCents: 10.5, taxCents: 0 })).toThrow();
    expect(() => lineGrossCents({ memberId: "m", grossCents: -1, taxCents: 0 })).toThrow();
    expect(() => lineGrossCents({ memberId: "m", hours: -1, rateCents: 100, taxCents: 0 })).toThrow();
  });

  test("a line missing both gross and hours/rate is rejected", () => {
    expect(() => lineGrossCents({ memberId: "m", taxCents: 0 })).toThrow(/either/);
  });
});

describe("sensitive identifiers", () => {
  test("only the last four digits are exposed", () => {
    expect(maskTaxId("12-3456789")).toBe("6789");
    expect(maskTaxId("123456789")).toBe("6789");
  });

  test("EIN format validation", () => {
    expect(isValidEin("12-3456789")).toBe(true);
    expect(isValidEin("123456789")).toBe(true);
    expect(isValidEin("12-345678")).toBe(false);
    expect(isValidEin("abc")).toBe(false);
  });

  test("log redaction removes every sensitive field but keeps the rest", () => {
    const out = redactForLog({
      accountId: "a1", ein: "12-3456789", ssn: "111-22-3333",
      routingNumber: "021000021", legalName: "Acme",
    });
    expect(out.ein).toBe("[redacted]");
    expect(out.ssn).toBe("[redacted]");
    expect(out.routingNumber).toBe("[redacted]");
    expect(out.legalName).toBe("Acme");
    expect(out.accountId).toBe("a1");
  });
});

describe("ops log custom entries", () => {
  const tpl: Template = {
    id: "t1",
    name: "Daily Site Log",
    fields: [
      { key: "site", label: "Site", type: "text", required: true, max: 60 },
      { key: "crew_size", label: "Crew size", type: "number", min: 1, max: 50 },
      { key: "visited_on", label: "Date", type: "date", required: true },
      { key: "safety_ok", label: "Safety check", type: "boolean" },
      { key: "shift", label: "Shift", type: "select", options: ["am", "pm"] },
    ],
  };

  test("accepts a well-formed entry", () => {
    const r = validateEntry(tpl, {
      site: "Yard 4", crew_size: 6, visited_on: "2026-08-28",
      safety_ok: true, shift: "am",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values.crew_size).toBe(6);
  });

  test("reports every problem at once, not just the first", () => {
    const r = validateEntry(tpl, { crew_size: 99, visited_on: "nope", shift: "night" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.key).sort())
        .toEqual(["crew_size", "shift", "site", "visited_on"]);
    }
  });

  test("optional blank fields are fine; required blanks are not", () => {
    const r = validateEntry(tpl, { site: "Yard 4", visited_on: "2026-08-28" });
    expect(r.ok).toBe(true);
    const r2 = validateEntry(tpl, { crew_size: 3 });
    expect(r2.ok).toBe(false);
  });

  test("impossible calendar dates are rejected", () => {
    const r = validateEntry(tpl, { site: "s", visited_on: "2026-02-30" });
    expect(r.ok).toBe(false);
  });

  test("NaN and Infinity are rejected, since JSON turns them into null", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const r = validateEntry(tpl, { site: "s", visited_on: "2026-08-28", crew_size: bad });
      expect(r.ok).toBe(false);
    }
  });

  test("unknown keys are dropped, never stored unvalidated", () => {
    const r = validateEntry(tpl, {
      site: "s", visited_on: "2026-08-28", injected: "rogue",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect("injected" in r.values).toBe(false);
  });

  test("malformed templates are caught before they are saved", () => {
    expect(validateTemplate([{ key: "Bad Key", label: "x", type: "text" }])).not.toEqual([]);
    expect(validateTemplate([{ key: "s", label: "x", type: "select" }])).not.toEqual([]);
    expect(validateTemplate([
      { key: "a", label: "x", type: "text" }, { key: "a", label: "y", type: "text" },
    ])).not.toEqual([]);
    expect(validateTemplate([{ key: "n", label: "x", type: "number", min: 9, max: 1 }])).not.toEqual([]);
    expect(validateTemplate(tpl.fields)).toEqual([]);
  });
});
