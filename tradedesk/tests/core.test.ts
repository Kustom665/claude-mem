import { expect, test, describe } from "bun:test";
import {
  PLANS, checkFeature, checkMeter, hasFeature, minimumPlanFor,
} from "../src/core/plans";
import { can, authorize, canSetRole, AuthorizationError, type Principal } from "../src/core/auth";

const owner: Principal = { userId: "u1", accountId: "a1", role: "owner" };
const admin: Principal = { userId: "u2", accountId: "a1", role: "admin" };
const staff: Principal = { userId: "u3", accountId: "a1", role: "staff" };
const client: Principal = { userId: "u4", accountId: "a1", role: "customer" };

describe("plan entitlements", () => {
  test("tiers are strictly cumulative", () => {
    for (const f of PLANS.starter.features) expect(hasFeature("pro", f)).toBe(true);
    for (const f of PLANS.pro.features) expect(hasFeature("premium", f)).toBe(true);
  });

  test("starter cannot send SMS and is told where to go", () => {
    const d = checkFeature("starter", "two_way_sms");
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.upgradeTo).toBe("pro");
  });

  test("premium-only features resolve to premium", () => {
    expect(minimumPlanFor("profit_and_loss")).toBe("premium");
    expect(minimumPlanFor("inventory")).toBe("premium");
  });

  test("meter allows up to the cap inclusively", () => {
    expect(checkMeter("pro", "sms_sent", 199, 1).allowed).toBe(true);
    expect(checkMeter("pro", "sms_sent", 200, 1).allowed).toBe(false);
  });

  test("unlimited meters never block", () => {
    expect(checkMeter("premium", "ai_assist_calls", 10_000_000).allowed).toBe(true);
  });

  test("upsell names a plan that actually fits the request", () => {
    // A 900-message batch does not fit Pro's 200 cap; must point at premium.
    const d = checkMeter("pro", "sms_sent", 0, 900);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.upgradeTo).toBe("premium");
  });

  test("a request no plan can satisfy reports no upgrade path", () => {
    const d = checkMeter("starter", "team_seats", 0, 50);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.upgradeTo).toBe(null);
  });
});

describe("authorization", () => {
  test("owner has full access within the account", () => {
    expect(can(owner, "data:purge", "a1")).toBe(true);
    expect(can(owner, "diagnostics:run", "a1")).toBe(true);
    expect(can(owner, "billing:manage", "a1")).toBe(true);
  });

  test("tenant isolation beats every role, owner included", () => {
    expect(can(owner, "customer:read", "a2")).toBe(false);
    expect(can(admin, "customer:read", "a2")).toBe(false);
  });

  test("admin runs operations but not billing or destructive data ops", () => {
    expect(can(admin, "invoice:void", "a1")).toBe(true);
    expect(can(admin, "pnl:read", "a1")).toBe(true);
    expect(can(admin, "billing:manage", "a1")).toBe(false);
    expect(can(admin, "data:purge", "a1")).toBe(false);
    expect(can(admin, "diagnostics:run", "a1")).toBe(false);
  });

  test("staff cannot touch money or settings", () => {
    expect(can(staff, "job:write", "a1")).toBe(true);
    expect(can(staff, "payment:refund", "a1")).toBe(false);
    expect(can(staff, "settings:write", "a1")).toBe(false);
    expect(can(staff, "pnl:read", "a1")).toBe(false);
  });

  test("portal customers are read-only and see no financials", () => {
    expect(can(client, "invoice:read", "a1")).toBe(true);
    expect(can(client, "invoice:write", "a1")).toBe(false);
    expect(can(client, "customer:read", "a1")).toBe(false);
    expect(can(client, "report:read", "a1")).toBe(false);
  });

  test("no privilege escalation: only owner sets roles, never to owner", () => {
    expect(canSetRole(admin, "staff")).toBe(false);
    expect(canSetRole(owner, "admin")).toBe(true);
    expect(canSetRole(owner, "owner")).toBe(false);
  });

  test("authorize throws for denials", () => {
    expect(() => authorize(staff, "billing:manage", "a1")).toThrow(AuthorizationError);
    expect(() => authorize(owner, "billing:manage", "a1")).not.toThrow();
  });
});
