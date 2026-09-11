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

import whopRouter, { reconcileRecentPayments, reconcileWhopIntents } from "./whop";
import { DEFAULT_STORAGE_LIMIT_BYTES } from "../video/quota";

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

/** Stub the Whop REST API (plans, checkout configurations, payments list). */
function stubWhop(overrides: {
  createPlan?: { id?: string; purchase_url?: string; message?: string };
  checkout?: { id?: string; purchase_url?: string; message?: string };
  /** Rows GET /payments returns — matched against metadata.reference. */
  payments?: Array<Record<string, unknown>>;
  /** Body of GET /payments/{id}; omitted means Whop 404s (unknown payment). */
  payment?: Record<string, unknown>;
}) {
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    state.whopCalls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    const path = String(url).replace("https://api.whop.com/api/v1", "");
    let httpStatus = 404;
    let json: any = { error: { message: "Not found" } };
    if ((path === "/payments" || path.startsWith("/payments?")) && (init?.method ?? "GET") === "GET") {
      // GET /payments — the pull side of the same mapping the webhook uses.
      httpStatus = 200;
      json = { data: overrides.payments ?? [] };
    } else if (path.startsWith("/payments/") && (init?.method ?? "GET") === "GET") {
      // GET /payments/{id} — re-read one payment (refund/dispute state).
      if (overrides.payment) {
        httpStatus = 200;
        json = overrides.payment;
      }
    } else if (path === "/plans" && init?.method === "POST") {
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

/**
 * A settled payment as Whop reports it: whole dollars (5.88 for $5.88) and a
 * lowercase currency. `paid_at` is what marks it as having gone through.
 */
function paidPayment(reference: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_recovered",
    status: "paid",
    paid_at: new Date().toISOString(),
    total: 5.88,
    currency: "usd",
    card_last4: "4242",
    metadata: { reference },
    membership: { id: "mem_recovered" },
    plan: { id: "plan_test" },
    ...overrides,
  };
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
    expect(res.body).toMatchObject({ granted: false });
    // Whop's email input is hidden (the address came from Clerk) by decorating
    // the purchase URL — Whop exposes no API field for it.
    const checkoutUrl = new URL(res.body.checkoutUrl);
    expect(checkoutUrl.origin + checkoutUrl.pathname).toBe("https://whop.com/checkout/ch_test");
    expect(checkoutUrl.searchParams.get("email")).toBe("buyer@example.com");
    expect(checkoutUrl.searchParams.get("email.hidden")).toBe("1");
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
      // The return gates read ?reference= off the URL they land on, so it has
      // to survive the round trip through Whop.
      redirect_url: `https://nexet.app/subscriptions?reference=${reference}`,
      metadata: { reference, kind: "pass", planId: "authors" },
    });

    const [intent] = await state.db
      .select()
      .from(state.tables.nexetWhopIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent).toMatchObject({ kind: "pass", planId: "authors", amountUsd: 588, currency: "USD", status: "PENDING" });
  });

  it("keeps Whop's email field visible when the address is unknown", async () => {
    state.userId = "user-1";
    state.clerkEmail = null;
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });

    expect(res.status).toBe(201);
    // No address to fill in — hiding the input would leave the customer unable
    // to pay at all, so the URL is left untouched.
    expect(res.body.checkoutUrl).toBe("https://whop.com/checkout/ch_test");
  });

  it("preserves the client's own query params when adding the return reference", async () => {
    state.userId = "user-1";
    const res = await request(API)
      .post("/api/whop/checkout")
      .send({ kind: "pass", planId: "authors", callbackUrl: "https://nexet.app/subscriptions?tab=storage" });

    const checkoutCall = state.whopCalls.find((call) => call.url.endsWith("/checkout_configurations"));
    const redirect = new URL(checkoutCall!.body.redirect_url);
    expect(redirect.origin + redirect.pathname).toBe("https://nexet.app/subscriptions");
    expect(redirect.searchParams.get("tab")).toBe("storage");
    expect(redirect.searchParams.get("reference")).toBe(res.body.reference);
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

  it("clamps the plan title to Whop's 30-character limit", async () => {
    state.userId = "user-1";
    // "Content Creators pass (Monthly)" is 31 chars — Whop answers 400 ("Title
    // is too long") and the whole checkout fails without the clamp.
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "content-creators" });
    expect(res.status).toBe(201);

    const planCall = state.whopCalls.find((call) => call.url.endsWith("/plans"));
    expect(planCall).toBeTruthy();
    const title: string = planCall!.body.title;
    expect(title.length).toBeLessThanOrEqual(30);
    // Trimmed at a word boundary, so it reads as the plan not a fragment.
    expect(title).toBe("Content Creators pass");
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

  it("surfaces Whop's reason when it refuses to create the mirror plan", async () => {
    state.userId = "user-1";
    // Whop answers POST /plans with 400 when the product/account pairing is
    // wrong (e.g. a bad WHOP_PRODUCT_ID). That error used to escape unhandled
    // and Express rendered it as an HTML "<pre>Bad Request</pre>" page, hiding
    // the cause from the client and the logs.
    await stubWhop({ createPlan: { message: "product_id is invalid" } });

    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("product_id is invalid");
    // The failure happened before any intent existed, and the checkout was
    // never opened — nothing to roll back, nothing cached.
    expect(state.whopCalls.some((call) => call.url.endsWith("/checkout_configurations"))).toBe(false);
    expect(await state.db.select().from(state.tables.nexetWhopIntentsTable)).toHaveLength(0);
    expect(await state.db.select().from(state.tables.nexetWhopPlansTable)).toHaveLength(0);
  });

  it("reuses the mirrored Whop plan while the catalog price still matches", async () => {
    state.userId = "user-1";
    await state.db.insert(state.tables.nexetWhopPlansTable).values({
      kind: "pass",
      planId: "authors",
      whopPlanId: "plan_cached",
      amountUsd: 588,
      billingPeriodDays: 30,
    });
    stubWhop({});

    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });

    expect(res.status).toBe(201);
    expect(state.whopCalls.some((call) => call.url.endsWith("/plans"))).toBe(false);
    const checkoutCall = state.whopCalls.find((call) => call.url.endsWith("/checkout_configurations"));
    expect(checkoutCall!.body.plan_id).toBe("plan_cached");
  });

  it("mirrors a fresh Whop plan when the cached one is priced differently", async () => {
    state.userId = "user-1";
    // A $1.00 mirror cannot bill a $5.88 pass: reusing it would leave Whop
    // charging the old amount, and every grant would fail the amount check.
    await state.db.insert(state.tables.nexetWhopPlansTable).values({
      kind: "pass",
      planId: "authors",
      whopPlanId: "plan_stale",
      amountUsd: 100,
      billingPeriodDays: 30,
    });
    stubWhop({ createPlan: { id: "plan_fresh" } });

    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });

    expect(res.status).toBe(201);
    const planCall = state.whopCalls.find((call) => call.url.endsWith("/plans"));
    expect(planCall!.body.renewal_price).toBe(5.88);
    const checkoutCall = state.whopCalls.find((call) => call.url.endsWith("/checkout_configurations"));
    expect(checkoutCall!.body.plan_id).toBe("plan_fresh");

    const [row] = await state.db.select().from(state.tables.nexetWhopPlansTable);
    expect(row).toMatchObject({ whopPlanId: "plan_fresh", amountUsd: 588 });
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

  it("mirrors Whop when the customer cancels at period end", async () => {
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

    // The customer cancelled on Whop's own billing page — our admin toggle was
    // never involved, so only this event can keep the local flag honest.
    const { raw, headers } = signWebhook({
      type: "membership.cancel_at_period_end_changed",
      data: { id: "mem_abc123", cancel_at_period_end: true },
    });
    const res = await postWebhook(raw, headers);
    expect(res.status).toBe(200);

    const [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.autoRenew).toBe(false);
  });

  it("stops the plan reading as active once the payment is refunded", async () => {
    const reference = await createPassIntent();
    const paid = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", status: "paid", total: 5.88, currency: "usd", metadata: { reference } },
    });
    await postWebhook(paid.raw, paid.headers);

    let [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.status).toBe("ACTIVE");

    // Whop reports the refund as a separate event; without this we would keep
    // claiming a paid, live plan for a charge that was reversed.
    const refund = signWebhook({
      type: "refund.created",
      data: { id: "rf_1", payment: { id: "pay_1" } },
    });
    const res = await postWebhook(refund.raw, refund.headers);
    expect(res.status).toBe(200);

    [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.status).toBe("REFUNDED");
    expect(sub.autoRenew).toBe(false);
  });

  it("stops the plan reading as active when a charge is disputed", async () => {
    const reference = await createPassIntent();
    const paid = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", status: "paid", total: 5.88, currency: "usd", metadata: { reference } },
    });
    await postWebhook(paid.raw, paid.headers);

    const dispute = signWebhook({
      type: "dispute.created",
      data: { id: "dspt_1", status: "needs_response", payment: { id: "pay_1" } },
    });
    const res = await postWebhook(dispute.raw, dispute.headers);
    expect(res.status).toBe(200);

    const [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.status).toBe("REFUNDED");
    expect(sub.renewalFailure).toMatch(/dispute/i);
  });

  it("grants a renewal even when our auto-renew flag drifted", async () => {
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
      autoRenew: false,
      whopMembershipId: "mem_x",
    });

    // Whop billed the saved card. Refusing because our flag says "not
    // renewing" would take the money and give nothing back.
    const { raw, headers } = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_renew", status: "paid", total: 5.88, currency: "usd", membership: { id: "mem_x" } },
    });
    const res = await postWebhook(raw, headers);
    expect(res.status).toBe(200);

    const subs = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(subs).toHaveLength(2);
    expect(subs.some((s: any) => s.whopPaymentId === "pay_renew")).toBe(true);
  });

  it("keeps a partially refunded plan active", async () => {
    const reference = await createPassIntent();
    const paid = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", status: "paid", total: 5.88, currency: "usd", metadata: { reference } },
    });
    await postWebhook(paid.raw, paid.headers);

    // Half of $5.88 came back — the customer kept what they paid for.
    await stubWhop({
      payment: {
        id: "pay_1",
        status: "paid",
        total: 5.88,
        currency: "usd",
        refunded_amount: 2.94,
        refunded_at: new Date().toISOString(),
      },
    });
    const refund = signWebhook({
      type: "refund.created",
      data: { id: "rf_partial", payment: { id: "pay_1" } },
    });
    const res = await postWebhook(refund.raw, refund.headers);
    expect(res.status).toBe(200);

    const [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.status).toBe("ACTIVE");
  });

  it("restores access when a dispute is resolved in our favour", async () => {
    const reference = await createPassIntent();
    const paid = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", status: "paid", total: 5.88, currency: "usd", metadata: { reference } },
    });
    await postWebhook(paid.raw, paid.headers);

    // Chargeback opened: Whop reports the dispute as needing a response.
    await stubWhop({
      payment: { id: "pay_1", status: "paid", total: 5.88, currency: "usd", disputes: [{ id: "dspt_1", status: "needs_response" }] },
    });
    const opened = signWebhook({
      type: "dispute.created",
      data: { id: "dspt_1", payment: { id: "pay_1" } },
    });
    await postWebhook(opened.raw, opened.headers);
    let [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.status).toBe("REFUNDED");

    // We won it — the dispute is decided and no money came back.
    await stubWhop({
      payment: { id: "pay_1", status: "paid", total: 5.88, currency: "usd", disputes: [{ id: "dspt_1", status: "won" }] },
    });
    const decided = signWebhook({
      type: "dispute.updated",
      data: { id: "dspt_1", status: "won", payment: { id: "pay_1" } },
    });
    const res = await postWebhook(decided.raw, decided.headers);
    expect(res.status).toBe(200);

    [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.status).toBe("ACTIVE");
  });
});

describe("refunds cut access immediately", () => {
  const G200_BYTES = 200 * 1024 ** 3;

  async function checkout(kind: "pass" | "storage" | "projects", planId: string): Promise<string> {
    state.userId = "user-1";
    const res = await request(API).post("/api/whop/checkout").send({ kind, planId });
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

  /** Settle the charge for a fresh checkout, so the entitlement is granted. */
  async function buy(reference: string, total: number) {
    const paid = signWebhook({
      type: "payment.succeeded",
      data: { id: "pay_1", status: "paid", total, currency: "usd", metadata: { reference } },
    });
    const res = await postWebhook(paid.raw, paid.headers);
    expect(res.status).toBe(200);
  }

  /** The payment as Whop reports it after a whole (or partial) refund. */
  function refundedPayment(total: number, refunded: number) {
    return {
      id: "pay_1",
      status: "paid",
      total,
      currency: "usd",
      refunded_amount: refunded,
      refunded_at: new Date().toISOString(),
    };
  }

  function refundEvent() {
    return signWebhook({ type: "refund.created", data: { id: "rf_1", payment: { id: "pay_1" } } });
  }

  it("takes the pass away the moment the charge is refunded", async () => {
    const reference = await checkout("pass", "authors");
    await buy(reference, 5.88);
    expect(await state.db.select().from(state.tables.nexetTicketsTable)).toHaveLength(1);

    await stubWhop({ payment: refundedPayment(5.88, 5.88) });
    const refund = refundEvent();
    const res = await postWebhook(refund.raw, refund.headers);
    expect(res.status).toBe(200);

    // The pass is gone *now* — not at the end of the month they paid for. The
    // ticket is what opens the den, so nothing else needs to be believed.
    expect(await state.db.select().from(state.tables.nexetTicketsTable)).toHaveLength(0);
    const [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.status).toBe("REFUNDED");
  });

  it("shrinks the storage allowance the moment the charge is refunded", async () => {
    const reference = await checkout("storage", "g200");
    await buy(reference, 20);

    let [quota] = await state.db.select().from(state.tables.nexetAccountQuotasTable);
    expect(quota.storageLimitBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES + G200_BYTES);

    await stubWhop({ payment: refundedPayment(20, 20) });
    const refund = refundEvent();
    await postWebhook(refund.raw, refund.headers);

    // The extra 200 GB goes back with the money, and never below the free tier.
    [quota] = await state.db.select().from(state.tables.nexetAccountQuotasTable);
    expect(quota.storageLimitBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES);
  });

  it("cannot take the same credits back twice when Whop redelivers the event", async () => {
    const reference = await checkout("storage", "g200");
    await buy(reference, 20);
    await stubWhop({ payment: refundedPayment(20, 20) });

    const refund = refundEvent();
    await postWebhook(refund.raw, refund.headers);
    const replay = await postWebhook(refund.raw, refund.headers);
    expect(replay.status).toBe(200);

    // The status claim makes the reversal once-only, so a redelivery cannot
    // quietly strip a second purchase's worth of storage.
    const [quota] = await state.db.select().from(state.tables.nexetAccountQuotasTable);
    expect(quota.storageLimitBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES);
  });

  it("still cuts access when Whop cannot be re-read", async () => {
    const reference = await checkout("pass", "authors");
    await buy(reference, 5.88);

    // No `payment` stub, so GET /payments/{id} 404s and the event is all we
    // have. A refund we cannot verify must still cut access — the safe way.
    const refund = refundEvent();
    const res = await postWebhook(refund.raw, refund.headers);
    expect(res.status).toBe(200);
    expect(await state.db.select().from(state.tables.nexetTicketsTable)).toHaveLength(0);
  });

  it("keeps the pass when only part of the charge came back", async () => {
    const reference = await checkout("pass", "authors");
    await buy(reference, 5.88);

    await stubWhop({ payment: refundedPayment(5.88, 2.94) });
    const refund = refundEvent();
    const res = await postWebhook(refund.raw, refund.headers);
    expect(res.status).toBe(200);

    // Half came back — the customer kept what they paid for.
    expect(await state.db.select().from(state.tables.nexetTicketsTable)).toHaveLength(1);
    const [sub] = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(sub.status).toBe("ACTIVE");
  });

  it("gives the pass back when a dispute is decided in our favour", async () => {
    const reference = await checkout("pass", "authors");
    await buy(reference, 5.88);

    await stubWhop({
      payment: {
        id: "pay_1",
        status: "paid",
        total: 5.88,
        currency: "usd",
        disputes: [{ id: "dspt_1", status: "needs_response" }],
      },
    });
    const opened = signWebhook({
      type: "dispute.created",
      data: { id: "dspt_1", payment: { id: "pay_1" } },
    });
    await postWebhook(opened.raw, opened.headers);
    expect(await state.db.select().from(state.tables.nexetTicketsTable)).toHaveLength(0);

    await stubWhop({
      payment: {
        id: "pay_1",
        status: "paid",
        total: 5.88,
        currency: "usd",
        disputes: [{ id: "dspt_1", status: "won" }],
      },
    });
    const decided = signWebhook({
      type: "dispute.updated",
      data: { id: "dspt_1", status: "won", payment: { id: "pay_1" } },
    });
    const res = await postWebhook(decided.raw, decided.headers);
    expect(res.status).toBe(200);
    expect(await state.db.select().from(state.tables.nexetTicketsTable)).toHaveLength(1);

    // A repeated `.updated` must not hand out a second pass.
    await postWebhook(decided.raw, decided.headers);
    expect(await state.db.select().from(state.tables.nexetTicketsTable)).toHaveLength(1);
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

  // The webhook is the fast path, not the only path. If a payment.succeeded
  // delivery is ever missed, the customer has been charged and nothing would
  // otherwise notice — these are the pull-based recovery paths.
  it("grants when the webhook never arrived but Whop has a paid payment", async () => {
    const reference = await createPassIntent();
    await stubWhop({ payments: [paidPayment(reference)] });

    const res = await request(API).post("/api/whop/confirm").send({ reference });

    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(true);
    expect(res.body.receipt).toEqual({ total: 588, cardLast4: "4242", promoCode: null });

    const subs = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ userId: "user-1", planId: "authors", whopPaymentId: "pay_recovered" });
  });

  it("stays pending when Whop has no payment for the reference", async () => {
    const reference = await createPassIntent();
    await stubWhop({ payments: [] });

    const res = await request(API).post("/api/whop/confirm").send({ reference });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ granted: false, status: "pending" });
    expect(await state.db.select().from(state.tables.nexetSubscriptionsTable)).toHaveLength(0);
  });

  it("never grants on a payment that has not settled", async () => {
    const reference = await createPassIntent();
    // Whop knows the charge, but it has not gone through: no paid_at.
    await stubWhop({ payments: [paidPayment(reference, { status: "pending", paid_at: null })] });

    const res = await request(API).post("/api/whop/confirm").send({ reference });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ granted: false, status: "pending" });
    expect(await state.db.select().from(state.tables.nexetSubscriptionsTable)).toHaveLength(0);
    expect(await state.db.select().from(state.tables.nexetTicketsTable)).toHaveLength(0);
  });

  it("fails the intent when Whop voided the charge", async () => {
    const reference = await createPassIntent();
    await stubWhop({ payments: [paidPayment(reference, { status: "void", paid_at: null })] });

    const res = await request(API).post("/api/whop/confirm").send({ reference });

    expect(res.body).toMatchObject({ granted: false, status: "failed" });
    const [intent] = await state.db.select().from(state.tables.nexetWhopIntentsTable);
    expect(intent.status).toBe("FAILED");
  });

  it("refuses to grant when the paid amount does not match the plan", async () => {
    const reference = await createPassIntent();
    await stubWhop({ payments: [paidPayment(reference, { total: 1 })] });

    const res = await request(API).post("/api/whop/confirm").send({ reference });

    expect(res.body).toMatchObject({ granted: false, status: "failed" });
    expect(await state.db.select().from(state.tables.nexetSubscriptionsTable)).toHaveLength(0);
  });

  it("stays pending (not failed) when Whop is unreachable", async () => {
    const reference = await createPassIntent();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const res = await request(API).post("/api/whop/confirm").send({ reference });

    expect(res.body).toMatchObject({ granted: false, status: "pending" });
    const [intent] = await state.db.select().from(state.tables.nexetWhopIntentsTable);
    expect(intent.status).toBe("PENDING");
  });
});

describe("reconcileWhopIntents (missed-webhook sweep)", () => {
  const staleIntent = (reference: string, ageMs: number) => {
    const at = new Date(Date.now() - ageMs);
    return state.db.insert(state.tables.nexetWhopIntentsTable).values({
      reference,
      userId: "user-1",
      kind: "pass",
      planId: "authors",
      planLabel: "Author & Writer pass",
      intervalLabel: "1 month",
      amountUsd: 588,
      currency: "USD",
      status: "PENDING",
      autoRenew: true,
      createdAt: at,
      updatedAt: at,
    });
  };

  it("grants a paid intent the webhook never delivered", async () => {
    await staleIntent("whp_stale_paid", 10 * 60 * 1000);
    await stubWhop({ payments: [paidPayment("whp_stale_paid")] });

    const result = await reconcileWhopIntents();

    expect(result).toEqual({ checked: 1, granted: 1, failed: 0 });
    const subs = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(subs).toHaveLength(1);
    expect(subs[0].whopPaymentId).toBe("pay_recovered");
  });

  it("leaves a fresh intent alone so the webhook gets first refusal", async () => {
    state.userId = "user-1";
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    await stubWhop({ payments: [paidPayment(res.body.reference)] });

    const result = await reconcileWhopIntents();

    expect(result).toEqual({ checked: 0, granted: 0, failed: 0 });
    expect(await state.db.select().from(state.tables.nexetSubscriptionsTable)).toHaveLength(0);
  });

  it("fails a long-abandoned checkout so intents do not linger forever", async () => {
    await staleIntent("whp_abandoned", 48 * 60 * 60 * 1000);
    await stubWhop({ payments: [] });

    const result = await reconcileWhopIntents();

    expect(result).toEqual({ checked: 1, granted: 0, failed: 1 });
    const [intent] = await state.db.select().from(state.tables.nexetWhopIntentsTable);
    expect(intent.status).toBe("FAILED");
  });

  it("does nothing when Whop is not configured", async () => {
    await staleIntent("whp_unconfigured", 10 * 60 * 1000);
    delete process.env.WHOP_API_KEY;

    expect(await reconcileWhopIntents()).toEqual({ checked: 0, granted: 0, failed: 0 });
  });

  it("recovers a settled payment that was never recorded", async () => {
    state.userId = "user-1";
    const res = await request(API).post("/api/whop/checkout").send({ kind: "pass", planId: "authors" });
    const reference = res.body.reference as string;
    await stubWhop({ payments: [paidPayment(reference)] });

    const result = await reconcileRecentPayments();

    expect(result).toEqual({ seen: 1, recovered: 1, unmatched: 0 });
    const subs = await state.db.select().from(state.tables.nexetSubscriptionsTable);
    expect(subs).toHaveLength(1);

    // Re-running is a no-op: the payment id is now recorded.
    expect(await reconcileRecentPayments()).toEqual({ seen: 1, recovered: 0, unmatched: 0 });
  });

  it("flags a settled payment that matches nothing as a dead letter", async () => {
    // No intent reference and no membership — nothing can be granted from it.
    await stubWhop({
      payments: [paidPayment("whp_orphan", { id: "pay_orphan", metadata: {}, membership: null })],
    });

    const result = await reconcileRecentPayments();

    expect(result).toEqual({ seen: 1, recovered: 0, unmatched: 1 });
    expect(await state.db.select().from(state.tables.nexetSubscriptionsTable)).toHaveLength(0);
  });

  it("ignores payments that never settled", async () => {
    await stubWhop({
      payments: [paidPayment("whp_pending", { status: "pending", paid_at: null })],
    });

    expect(await reconcileRecentPayments()).toEqual({ seen: 1, recovered: 0, unmatched: 0 });
  });
});