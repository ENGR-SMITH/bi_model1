import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  clerkEmail: null as string | null,
  whopCalls: [] as Array<{ method: string; url: string; body?: any }>,
  // Response builder: (url, init) => { status, json }
  fetchImpl: null as null | ((url: string, init?: any) => Promise<{ status: number; json: any }>),
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: state.clerkEmail ? { emailAddress: state.clerkEmail } : null,
        emailAddresses: state.clerkEmail ? [{ emailAddress: state.clerkEmail }] : [],
      }),
    },
  },
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import whopRouter from "./whop";

function createApp(): Express {
  const app = express();
  // Same raw-body capture as production app.ts, so webhook signatures verify.
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", whopRouter);
  return app;
}

const API = createApp();
const TEST_API_KEY = "whop_test_api_key";
const TEST_ACCOUNT_ID = "biz_test";
const TEST_PRODUCT_ID = "prod_test";
const TEST_WEBHOOK_SECRET = "ws_test_webhook_secret";

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.nexetWhopIntentsTable);
  await state.db.delete(t.nexetSubscriptionsTable);
  await state.db.delete(t.nexetWhopPlansTable);
  await state.db.delete(t.nexetTicketsTable);
  await state.db.delete(t.nexetAccountQuotasTable);
  await state.db.delete(t.nexetPromoCodesTable);
  await state.db.delete(t.nexetPromoRedemptionsTable);
  await state.db.delete(t.nexetSubscriptionPlanSettingsTable);
  state.userId = null;
  state.clerkEmail = "buyer@example.com";
  state.whopCalls = [];
}

/**
 * Sign a Whop webhook payload per the Standard Webhooks spec: HMAC-SHA256 over
 * `{webhook-id}.{webhook-timestamp}.{raw body}`, base64, header `v1,<sig>`.
 */
function signWebhook(body: unknown): {
  raw: string;
  headers: { "webhook-id": string; "webhook-timestamp": string; "webhook-signature": string };
} {
  const raw = JSON.stringify(body);
  const id = "msg_" + Math.random().toString(36).slice(2);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", TEST_WEBHOOK_SECRET)
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  return { raw, headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` } };
}

/** Stub the Whop REST API (plans create + checkout configurations create). */
function stubWhop(overrides: {
  createPlan?: { id?: string; purchase_url?: string; message?: string };
  checkout?: { id?: string; purchase_url?: string; message?: string };
}) {
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    state.whopCalls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    const path = String(url).replace("https://api.whop.com/api/v1", "");
    let httpStatus = 404;
    let json: any = { error: { message: "Not found" } };
    if (path === "/plans" && init?.method === "POST") {
      const plan = overrides.createPlan ?? {};
      httpStatus = plan.message ? 400 : 200;
      json = plan.message
        ? { error: { message: plan.message } }
        : { id: plan.id ?? "plan_test", purchase_url: plan.purchase_url ?? "https://whop.com/checkout/plan_test" };
    } else if (path === "/checkout_configurations" && init?.method === "POST") {
      const co = overrides.checkout ?? {};
      httpStatus = co.message ? 400 : 200;
      json = co.message
        ? { error: { message: co.message } }
        : { id: co.id ?? "ch_test", purchase_url: co.purchase_url ?? "https://whop.com/checkout/ch_test" };
    }
    return {
      ok: httpStatus >= 200 && httpStatus < 300,
      status: httpStatus,
      text: async () => JSON.stringify(json),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal("fetch", stubWhop({}));
  process.env.WHOP_API_KEY = TEST_API_KEY;
  process.env.WHOP_ACCOUNT_ID = TEST_ACCOUNT_ID;
  process.env.WHOP_PRODUCT_ID = TEST_PRODUCT_ID;
  process.env.WHOP_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
});
beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_ACCOUNT_ID;
  delete process.env.WHOP_PRODUCT_ID;
  delete process.env.WHOP_WEBHOOK_SECRET;
});

describe("POST /api/whop/checkout", () => {
  it("requires authentication", async () => {
    state.userId = null;
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    expect(res.status).toBe(401);
  });

  it("refuses when Whop is not configured", async () => {
    delete process.env.WHOP_API_KEY;
    state.userId = "user-1";
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    expect(res.status).toBe(503);
  });

  it("rejects unknown plans and kinds", async () => {
    state.userId = "user-1";
    const unknownPlan = await request(API).post("/api/whop/checkout").send({ kind: "storage", planId: "nope" });
    expect(unknownPlan.status).toBe(400);
    const badKind = await request(API).post("/api/whop/checkout").send({ kind: "singers", planId: "authors" });
    expect(badKind.status).toBe(400);
  });

  it("mirrors the plan to Whop (renewal, 30 days) and returns the purchase URL", async () => {
    state.userId = "user-1";
    const res = await request(API)
      .post("/api/whop/checkout")
      .send({ kind: "pass", planId: "authors", callbackUrl: "https://nexet.app/subscriptions" });


    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ granted: false, checkoutUrl: "https://whop.com/checkout/ch_test" });
    const reference: string = res.body.reference;
    expect(reference.startsWith("whp_")).toBe(true);

    // The plan create carried a monthly renewal price in DOLLARS (588¢ → 5.88).
    const planCall = state.whopCalls.find((call) => call.url.endsWith("/plans"));
    expect(planCall).toBeTruthy();
    expect(planCall!.body).toMatchObject({
      account_id: TEST_ACCOUNT_ID,
      product_id: TEST_PRODUCT_ID,
      title: "Author & Writer pass (Monthly)",
      plan_type: "renewal",
      renewal_price: 5.88,
      billing_period: 30,
      currency: "usd",
    });

    // The checkout configuration carries our reference in the metadata.
    const checkoutCall = state.whopCalls.find((call) => call.url.endsWith("/checkout_configurations"));
    expect(checkoutCall).toBeTruthy();
    expect(checkoutCall!.body).toMatchObject({
      account_id: TEST_ACCOUNT_ID,
      plan_id: "plan_test",
      redirect_url: "https://nexet.app/subscriptions",
      metadata: { reference, kind: "pass", planId: "authors" },
    });

    const [intent] = await state.db
      .select()
      .from(state.tables.nexetWhopIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent).toMatchObject({ kind: "pass", planId: "authors", amountUsd: 588, currency: "USD", status: "PENDING" });
  });

  it("signs every plan up for auto-renew by default (no client opt-in needed)", async () => {
    state.userId = "user-1";
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    expect(res.status).toBe(201);

    const reference: string = res.body.reference;
    const [intent] = await state.db
      .select()
      .from(state.tables.nexetWhopIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.autoRenew).toBe(true);

    // Storage plans auto-renew too.
    const storage = await request(API).post("/api/whop/checkout").send({ kind: "storage", planId: "g200" });
    expect(storage.status).toBe(201);
    const [storageIntent] = await state.db
      .select()
      .from(state.tables.nexetWhopIntentsTable)
      .where((t: any) => t.reference === storage.body.reference);
    expect(storageIntent.autoRenew).toBe(true);
  });

  it("turns auto-renew off when an admin switched it off for the plan", async () => {
    state.userId = "user-1";
    await state.db.insert(state.tables.nexetSubscriptionPlanSettingsTable).values({
      kind: "pass",
      planId: "authors",
      autoRenewAvailable: false,
    });

    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    expect(res.status).toBe(201);

    const reference: string = res.body.reference;
    const [intent] = await state.db
      .select()
      .from(state.tables.nexetWhopIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.autoRenew).toBe(false);
  });

  it("creates the Whop plan once and reuses it on later checkouts", async () => {
    state.userId = "user-1";
    await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    const planCallsAfterFirst = state.whopCalls.filter((call) => call.url.endsWith("/plans")).length;
    expect(planCallsAfterFirst).toBe(1);

    await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    const planCallsAfterSecond = state.whopCalls.filter((call) => call.url.endsWith("/plans")).length;
    expect(planCallsAfterSecond).toBe(1);
  });

  it("refuses percentage/dollar-off promos on monthly subscriptions", async () => {
    state.userId = "user-1";
    await state.db.insert(state.tables.nexetPromoCodesTable).values({
      code: "SAVE20",
      kind: "PERCENT",
      value: 20,
      maxUses: 0,
      uses: 0,
    });

    const res = await request(API)
      .post("/api/whop/checkout")
      .send({ kind: "pass", planId: "authors", promoCode: "SAVE20" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/don't apply to monthly subscriptions/i);
    expect(state.whopCalls.some((call) => call.url.endsWith("/checkout_configurations"))).toBe(false);
  });

  it("grants immediately for a FREE promo (no charge, no subscription)", async () => {
    state.userId = "user-1";
    await state.db.insert(state.tables.nexetPromoCodesTable).values({
      code: "FREEBIE",
      kind: "FREE",
      value: 0,
      maxUses: 1,
      uses: 0,
    });

    const res = await request(API)
      .post("/api/whop/checkout")
      .send({ kind: "pass", planId: "authors", promoCode: "FREEBIE" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ granted: true, checkoutUrl: null, reference: null });
    expect(state.whopCalls.some((call) => call.url.endsWith("/checkout_configurations"))).toBe(false);

    // The pass was granted without a charge and without a Whop membership.
    const tickets = await state.db.select().from(state.tables.nexetTicketsTable);
    expect(tickets).toHaveLength(1);
    const subs = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoRenew).toBe(false);
    expect(subs[0].whopMembershipId).toBeNull();
    const [promo] = await state.db.select().from(state.tables.nexetPromoCodesTable);
    expect(promo.uses).toBe(1);
  });

  it("rolls the intent back when Whop cannot open the checkout", async () => {
    state.userId = "user-1";
    await stubWhop({ checkout: { message: "plan is required" } });
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    expect(res.status).toBe(502);
    const intents = await state.db.select().from(state.tables.nexetWhopIntentsTable);
    expect(intents).toHaveLength(0);
  });
});

describe("POST /api/whop/webhook", () => {
  async function createPassIntent(): Promise<string> {
    state.userId = "user-1";
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    return res.body.reference as string;
  }

  function postWebhook(raw: string, headers: Record<string, string>) {
    return request(API)
      .post("/api/whop/webhook")
      .set("Content-Type", "application/json")
      .set("webhook-id", headers["webhook-id"])
      .set("webhook-timestamp", headers["webhook-timestamp"])
      .set("webhook-signature", headers["webhook-signature"])
      .send(raw);
  }

  it("rejects requests with a bad signature", async () => {
    const reference = await createPassIntent();
    const { raw, headers } = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", total: 5.88, currency: "usd", metadata: { reference } },
    });
    const res = await request(API)
      .post("/api/whop/webhook")
      .set("Content-Type", "application/json")
      .set("webhook-id", headers["webhook-id"])
      .set("webhook-timestamp", headers["webhook-timestamp"])
      .set("webhook-signature", "v1,deadbeef")
      .send(raw);
    expect(res.status).toBe(401);

    const [intent] = await state.db
      .select()
      .from(state.tables.nexetWhopIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.status).toBe("PENDING");
  });

  it("rejects replays with a stale timestamp", async () => {
    const reference = await createPassIntent();
    const raw = JSON.stringify({
      type: "payment.succeeded",
      data: { id: "pay_1", total: 5.88, currency: "usd", metadata: { reference } },
    });
    const id = "msg_stale";
    const timestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const signature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(`${id}.${timestamp}.${raw}`).digest("base64");
    const res = await postWebhook(raw, {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    });
    expect(res.status).toBe(401);
  });

  it("grants the entitlement on payment.succeeded and is idempotent on replay", async () => {
    const reference = await createPassIntent();
    const { raw, headers } = signWebhook({
      type: "payment.succeeded",
      data: {
        id: "pay_1",
        total: 5.88,
        currency: "usd",
        card_last4: "4242",
        metadata: { reference },
      },
    });

    const first = await postWebhook(raw, headers);
    expect(first.status).toBe(200);

    // The entitlement + subscription landed, the intent flipped to SUCCESS.
    const tickets = await state.db.select().from(state.tables.nexetTicketsTable);
    const subs = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(tickets).toHaveLength(1);
    expect(subs).toHaveLength(1);
    expect(subs[0].priceUsd).toBe(588);
    expect(subs[0].whopPaymentId).toBe("pay_1");
    const [intent] = await state.db
      .select()
      .from(state.tables.nexetWhopIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.status).toBe("SUCCESS");
    expect(intent.cardLast4).toBe("4242");

    // Replaying the same event must not double-grant.
    const replay = await postWebhook(raw, headers);
    expect(replay.status).toBe(200);
    const ticketsAfter = await state.db.select().from(state.tables.nexetTicketsTable);
    const subsAfter = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(ticketsAfter).toHaveLength(1);
    expect(subsAfter).toHaveLength(1);
  });

  it("marks the intent FAILED and does not grant when the paid amount mismatches", async () => {
    const reference = await createPassIntent();
    const { raw, headers } = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", total: 0.01, currency: "usd", metadata: { reference } },
    });

    const res = await postWebhook(raw, headers);
    expect(res.status).toBe(200);

    const tickets = await state.db.select().from(state.tables.nexetTicketsTable);
    expect(tickets).toHaveLength(0);
    const [intent] = await state.db
      .select()
      .from(state.tables.nexetWhopIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.status).toBe("FAILED");
  });

  it("captures the Whop membership on the first charge", async () => {
    const reference = await createPassIntent();
    const { raw, headers } = signWebhook({
      type: "payment.succeeded",
      data: {
        id: "pay_1",
        total: 5.88,
        currency: "usd",
        plan: { id: "plan_test" },
        membership: { id: "mem_abc123" },
        metadata: { reference },
      },
    });

    const res = await postWebhook(raw, headers);
    expect(res.status).toBe(200);

    const [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub).toMatchObject({
      autoRenew: true,
      whopMembershipId: "mem_abc123",
      whopPlanId: "plan_test",
      whopPaymentId: "pay_1",
    });
  });

  it("grants recurring subscription charges from the live subscription row, exactly once", async () => {
    // Seed a live auto-renewing subscription (as if bought last month).
    const now = Date.now();
    await state.db.insert(state.tables.nexetSubscriptionsTable).values({
      id: "sub-live",
      userId: "user-1",
      kind: "pass",
      planId: "authors",
      planLabel: "Author & Writer pass",
      priceUsd: 588,
      status: "ACTIVE",
      intervalLabel: "1 month",
      periodStart: new Date(now - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(now + 1 * 24 * 60 * 60 * 1000),
      autoRenew: true,
      whopMembershipId: "mem_abc123",
      whopPlanId: "plan_test",
      whopEmail: "buyer@example.com",
    });

    // Whop bills the plan on its own: a NEW payment with no intent reference.
    const { raw, headers } = signWebhook({
      type: "payment.succeeded",
      data: {
        id: "pay_renewal_1",
        total: 5.88,
        currency: "usd",
        plan: { id: "plan_test" },
        membership: { id: "mem_abc123" },
        metadata: {},
      },
    });
    const post = () => postWebhook(raw, headers);

    expect((await post()).status).toBe(200);
    // The old row stopped being the live record; the new row extends it and
    // carries the same Whop membership.
    const subs = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(subs).toHaveLength(2);
    const old = subs.find((s: any) => s.id === "sub-live");
    expect(old.autoRenew).toBe(false);
    const fresh = subs.find((s: any) => s.id !== "sub-live");
    expect(fresh).toMatchObject({
      autoRenew: true,
      whopMembershipId: "mem_abc123",
      whopPaymentId: "pay_renewal_1",
      priceUsd: 588,
    });
    const tickets = await state.db.select().from(state.tables.nexetTicketsTable);
    expect(tickets).toHaveLength(1);

    // Replaying the same charge must not grant again.
    expect((await post()).status).toBe(200);
    const subsAfter = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(subsAfter).toHaveLength(2);
  });

  it("records a declined monthly charge on the live subscription", async () => {
    await state.db.insert(state.tables.nexetSubscriptionsTable).values({
      id: "sub-live",
      userId: "user-1",
      kind: "pass",
      planId: "authors",
      planLabel: "Author & Writer pass",
      priceUsd: 588,
      status: "ACTIVE",
      intervalLabel: "1 month",
      periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      autoRenew: true,
      whopMembershipId: "mem_abc123",
    });

    const { raw, headers } = signWebhook({
      type: "payment.failed",
      data: { id: "pay_fail_1", membership: { id: "mem_abc123" } },
    });
    const res = await postWebhook(raw, headers);
    expect(res.status).toBe(200);

    const [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.renewalFailure).toMatch(/declined/i);
  });

  it("stops treating a membership as auto-renewing once Whop deactivates it", async () => {
    await state.db.insert(state.tables.nexetSubscriptionsTable).values({
      id: "sub-live",
      userId: "user-1",
      kind: "pass",
      planId: "authors",
      planLabel: "Author & Writer pass",
      priceUsd: 588,
      status: "ACTIVE",
      intervalLabel: "1 month",
      periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      autoRenew: true,
      whopMembershipId: "mem_abc123",
    });

    const { raw, headers } = signWebhook({
      type: "membership.deactivated",
      data: { id: "mem_abc123" },
    });
    const res = await postWebhook(raw, headers);
    expect(res.status).toBe(200);

    const [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.autoRenew).toBe(false);
  });
});

describe("POST /api/whop/confirm", () => {
  async function createPassIntent(): Promise<string> {
    state.userId = "user-1";
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    return res.body.reference as string;
  }

  it("requires authentication and ownership", async () => {
    const reference = await createPassIntent();

    state.userId = null;
    const anon = await request(API).post("/api/whop/confirm").send({ reference });
    expect(anon.status).toBe(401);

    state.userId = "someone-else";
    const other = await request(API).post("/api/whop/confirm").send({ reference });
    expect(other.status).toBe(403);
  });

  it("returns 404 for an unknown reference", async () => {
    state.userId = "user-1";
    const res = await request(API).post("/api/whop/confirm").send({ reference: "whp_does-not-exist" });
    expect(res.status).toBe(404);
  });

  it("returns the receipt once the webhook granted the intent", async () => {
    const reference = await createPassIntent();

    // The webhook lands first (source of truth).
    const { raw, headers } = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", total: 5.88, currency: "usd", card_last4: "4242", metadata: { reference } },
    });
    await request(API)
      .post("/api/whop/webhook")
      .set("Content-Type", "application/json")
      .set("webhook-id", headers["webhook-id"])
      .set("webhook-timestamp", headers["webhook-timestamp"])
      .set("webhook-signature", headers["webhook-signature"])
      .send(raw);

    const res = await request(API).post("/api/whop/confirm").send({ reference });
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(true);
    expect(res.body.receipt).toEqual({ total: 588, cardLast4: "4242", promoCode: null });

    const tickets = await state.db.select().from(state.tables.nexetTicketsTable);
    const subs = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(tickets).toHaveLength(1);
    expect(subs).toHaveLength(1);
  });

  it("reports pending when the webhook has not landed yet (no double grant later)", async () => {
    const reference = await createPassIntent();

    // The webhook hasn't arrived — confirm says pending.
    const res = await request(API).post("/api/whop/confirm").send({ reference });
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(false);
    expect(res.body.status).toBe("pending");

    // When the webhook lands, the grant happens exactly once.
    const { raw, headers } = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", total: 5.88, currency: "usd", metadata: { reference } },
    });
    await request(API)
      .post("/api/whop/webhook")
      .set("Content-Type", "application/json")
      .set("webhook-id", headers["webhook-id"])
      .set("webhook-timestamp", headers["webhook-timestamp"])
      .set("webhook-signature", headers["webhook-signature"])
      .send(raw);

    const tickets = await state.db.select().from(state.tables.nexetTicketsTable);
    expect(tickets).toHaveLength(1);
  });
});