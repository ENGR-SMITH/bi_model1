import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as any,
  tables: null as any,
  chargeCalls: [] as Array<{ amount: number; authorizationCode: string; reference: string }>,
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import { runSubscriptionRenewals } from "./renewals";
import { PASS_PRICE_USD } from "../routes/tickets";
import { STORAGE_PLANS, PROJECT_PLANS } from "./quota";

const TEST_SECRET = "sk_test_secret_key";

/** Stub the Paystack charge_authorization endpoint; records every charge. */
function stubPaystack() {
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    state.chargeCalls.push({
      amount: body.amount,
      authorizationCode: body.authorization_code,
      reference: body.reference,
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: true, data: {} }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function seedSubscription(overrides: Record<string, unknown>) {
  const now = Date.now();
  await state.db.insert(state.tables.tandemSubscriptionsTable).values({
    id: "sub-" + Math.random().toString(36).slice(2, 10),
    userId: "user-1",
    kind: "pass",
    planId: "authors",
    planLabel: "Author & Writer pass",
    priceUsd: PASS_PRICE_USD,
    status: "ACTIVE",
    intervalLabel: "3 weeks",
    periodStart: new Date(now),
    periodEnd: new Date(now + 1 * 24 * 60 * 60 * 1000), // due within the lead window
    autoRenew: true,
    paystackEmail: "buyer@example.com",
    paystackAuthorizationCode: "auth_123",
    ...overrides,
  });
}

beforeEach(() => {
  stubPaystack();
  process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
});

beforeEach(async () => {
  await state.db.delete(state.tables.tandemPaystackIntentsTable);
  await state.db.delete(state.tables.tandemSubscriptionsTable);
  state.chargeCalls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PAYSTACK_SECRET_KEY;
});

describe("runSubscriptionRenewals", () => {
  it("re-charges due auto-renewing subscriptions of every kind at the plan price", async () => {
    await seedSubscription({ kind: "pass", planId: "authors", priceUsd: PASS_PRICE_USD });
    const g200 = STORAGE_PLANS.find((p) => p.id === "g200")!;
    await seedSubscription({ kind: "storage", planId: "g200", planLabel: "200 GB more space", priceUsd: g200.priceUsd, intervalLabel: "1 year" });
    const p50 = PROJECT_PLANS.find((p) => p.id === "p50")!;
    await seedSubscription({ kind: "projects", planId: "p50", planLabel: "+50 projects", priceUsd: p50.priceUsd, intervalLabel: "1 year" });

    const result = await runSubscriptionRenewals();
    expect(result).toEqual({ charged: 3, failed: 0 });

    // One intent per subscription, each carrying its own kind + plan price so
    // the webhook's amount check matches what was actually charged.
    const intents = await state.db.select().from(state.tables.tandemPaystackIntentsTable);
    expect(intents).toHaveLength(3);
    const byKind = Object.fromEntries(intents.map((i: any) => [i.kind, i]));
    expect(byKind.pass).toMatchObject({ amountUsd: PASS_PRICE_USD, renewalFor: expect.any(String), status: "PENDING" });
    expect(byKind.storage).toMatchObject({ amountUsd: g200.priceUsd, renewalFor: expect.any(String) });
    expect(byKind.projects).toMatchObject({ amountUsd: p50.priceUsd, renewalFor: expect.any(String) });

    // Paystack was charged the plan prices with the saved authorization.
    expect(state.chargeCalls).toHaveLength(3);
    expect(state.chargeCalls.map((c) => c.amount).sort()).toEqual(
      [PASS_PRICE_USD, g200.priceUsd, p50.priceUsd].sort(),
    );
    expect(state.chargeCalls.every((c) => c.authorizationCode === "auth_123")).toBe(true);
  });

  it("stops the chain when no card is on file", async () => {
    await seedSubscription({ paystackAuthorizationCode: null });

    const result = await runSubscriptionRenewals();
    expect(result).toEqual({ charged: 0, failed: 1 });
    expect(state.chargeCalls).toHaveLength(0);

    const [sub] = await state.db.select().from(state.tables.tandemSubscriptionsTable);
    expect(sub.autoRenew).toBe(false);
    expect(sub.renewalFailure).toMatch(/no card is on file/i);
  });

  it("skips subscriptions outside the renewal window", async () => {
    // Far future expiry — nothing due.
    await seedSubscription({ periodEnd: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000) });

    const result = await runSubscriptionRenewals();
    expect(result).toEqual({ charged: 0, failed: 0 });
    expect(state.chargeCalls).toHaveLength(0);
  });
});