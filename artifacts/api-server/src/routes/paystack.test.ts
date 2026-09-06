import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  clerkEmail: null as string | null,
  paystackCalls: [] as Array<{ method: string; url: string; body?: any }>,
  // Response builders: (url, init) => { status, json }
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

import paystackRouter from "./paystack";

function createApp(): Express {
  const app = express();
  // Same raw-body capture as production app.ts, so webhook signatures verify.
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", paystackRouter);
  return app;
}

const API = createApp();
const TEST_SECRET = "sk_test_secret_key";

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemPaystackIntentsTable);
  await state.db.delete(t.tandemSubscriptionsTable);
  await state.db.delete(t.tandemTicketsTable);
  await state.db.delete(t.tandemAccountQuotasTable);
  state.userId = null;
  state.clerkEmail = "buyer@example.com";
  state.paystackCalls = [];
}

function signWebhook(body: unknown): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha512", TEST_SECRET).update(raw).digest("hex");
  return { raw, signature };
}

/** Stub the Paystack REST API (initialize + verify). */
function stubPaystack(overrides: {
  initialize?: { authorization_url?: string; message?: string; status?: boolean };
  verify?: { status?: string; amount?: number; currency?: string; last4?: string | null };
}) {
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    state.paystackCalls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(init.body) : undefined });
    const path = String(url).replace("https://api.paystack.co", "");
    let httpStatus = 404;
    let json: any = { status: false, message: "Not found" };
    if (path.startsWith("/transaction/initialize")) {
      const initResp = overrides.initialize ?? {};
      httpStatus = initResp.status === false ? 400 : 200;
      json = {
        status: httpStatus === 200,
        message: initResp.message ?? "Success",
        data: { authorization_url: initResp.authorization_url ?? "https://checkout.paystack.com/abc123", reference: init?.body ? JSON.parse(init.body).reference : undefined },
      };
    } else if (path.startsWith("/transaction/verify/")) {
      const verify = overrides.verify ?? {};
      httpStatus = 200;
      json = { status: true, data: { status: verify.status ?? "success", amount: verify.amount ?? 188, currency: verify.currency ?? "USD", authorization: { last4: verify.last4 ?? "4081" } } };
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
  vi.stubGlobal("fetch", stubPaystack({}));
  process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
});
beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PAYSTACK_SECRET_KEY;
});

describe("POST /api/paystack/checkout", () => {
  it("requires authentication", async () => {
    state.userId = null;
    const res = await request(API).post("/api/paystack/checkout").send({ kind: "pass", planId: "authors" });
    expect(res.status).toBe(401);
  });

  it("refuses when Paystack is not configured", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    state.userId = "user-1";
    const res = await request(API).post("/api/paystack/checkout").send({ kind: "pass", planId: "authors" });
    expect(res.status).toBe(503);
  });

  it("rejects unknown plans and kinds", async () => {
    state.userId = "user-1";
    const unknownPlan = await request(API).post("/api/paystack/checkout").send({ kind: "storage", planId: "nope" });
    expect(unknownPlan.status).toBe(400);
    const badKind = await request(API).post("/api/paystack/checkout").send({ kind: "singers", planId: "authors" });
    expect(badKind.status).toBe(400);
  });

  it("opens a USD checkout with the right amount and saves a PENDING intent", async () => {
    state.userId = "user-1";
    const res = await request(API)
      .post("/api/paystack/checkout")
      .send({ kind: "pass", planId: "authors", callbackUrl: "https://tandem.app/subscriptions" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ granted: false, checkoutUrl: "https://checkout.paystack.com/abc123" });
    const reference: string = res.body.reference;
    expect(reference.startsWith("tan_")).toBe(true);

    // The initialize call carried USD + the full price in cents.
    const initCall = state.paystackCalls.find((call) => call.url.endsWith("/transaction/initialize"));
    expect(initCall).toBeTruthy();
    expect(initCall!.body).toMatchObject({
      email: "buyer@example.com",
      amount: 188,
      currency: "USD",
      callback_url: "https://tandem.app/subscriptions",
      reference,
    });

    const [intent] = await state.db
      .select()
      .from(state.tables.tandemPaystackIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent).toMatchObject({ kind: "pass", planId: "authors", amountUsd: 188, currency: "USD", status: "PENDING" });
  });

  it("grants immediately for a FREE promo (no charge, no checkout)", async () => {
    state.userId = "user-1";
    await state.db.insert(state.tables.tandemPromoCodesTable).values({
      code: "FREEBIE",
      kind: "FREE",
      value: 0,
      maxUses: 1,
      uses: 0,
    });

    const res = await request(API)
      .post("/api/paystack/checkout")
      .send({ kind: "pass", planId: "authors", promoCode: "FREEBIE" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ granted: true, checkoutUrl: null, reference: null });
    expect(state.paystackCalls.some((call) => call.url.endsWith("/transaction/initialize"))).toBe(false);

    // The pass was granted without a charge.
    const tickets = await state.db.select().from(state.tables.tandemTicketsTable);
    expect(tickets).toHaveLength(1);
    const [promo] = await state.db.select().from(state.tables.tandemPromoCodesTable);
    expect(promo.uses).toBe(1);
  });
});

describe("POST /api/paystack/webhook", () => {
  async function createPassIntent(): Promise<string> {
    state.userId = "user-1";
    const res = await request(API).post("/api/paystack/checkout").send({ kind: "pass", planId: "authors" });
    return res.body.reference as string;
  }

  it("rejects requests with a bad signature", async () => {
    const reference = await createPassIntent();
    const { raw } = signWebhook({ event: "charge.success", data: { reference, amount: 188, currency: "USD" } });
    const res = await request(API)
      .post("/api/paystack/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", "deadbeef")
      .send(raw);
    expect(res.status).toBe(401);

    const [intent] = await state.db
      .select()
      .from(state.tables.tandemPaystackIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.status).toBe("PENDING");
  });

  it("grants the entitlement on charge.success and is idempotent on replay", async () => {
    const reference = await createPassIntent();
    const { raw, signature } = signWebhook({ event: "charge.success", data: { reference, amount: 188, currency: "USD", authorization: { last4: "4081" } } });

    const first = await request(API)
      .post("/api/paystack/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(raw);
    expect(first.status).toBe(200);

    // The entitlement + subscription landed, the intent flipped to SUCCESS.
    const tickets = await state.db.select().from(state.tables.tandemTicketsTable);
    const subs = await state.db.select().from(state.tables.tandemSubscriptionsTable);
    expect(tickets).toHaveLength(1);
    expect(subs).toHaveLength(1);
    expect(subs[0].priceUsd).toBe(188);
    const [intent] = await state.db
      .select()
      .from(state.tables.tandemPaystackIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.status).toBe("SUCCESS");
    expect(intent.cardLast4).toBe("4081");

    // Replaying the same event must not double-grant.
    const replay = await request(API)
      .post("/api/paystack/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(raw);
    expect(replay.status).toBe(200);
    const ticketsAfter = await state.db.select().from(state.tables.tandemTicketsTable);
    const subsAfter = await state.db.select().from(state.tables.tandemSubscriptionsTable);
    expect(ticketsAfter).toHaveLength(1);
    expect(subsAfter).toHaveLength(1);
  });

  it("marks the intent FAILED and does not grant when the paid amount mismatches", async () => {
    const reference = await createPassIntent();
    const { raw, signature } = signWebhook({ event: "charge.success", data: { reference, amount: 1, currency: "USD" } });

    const res = await request(API)
      .post("/api/paystack/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(raw);
    expect(res.status).toBe(200);

    const tickets = await state.db.select().from(state.tables.tandemTicketsTable);
    expect(tickets).toHaveLength(0);
    const [intent] = await state.db
      .select()
      .from(state.tables.tandemPaystackIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.status).toBe("FAILED");
  });
});

describe("POST /api/paystack/confirm", () => {
  async function createPassIntent(): Promise<string> {
    state.userId = "user-1";
    const res = await request(API).post("/api/paystack/checkout").send({ kind: "pass", planId: "authors" });
    return res.body.reference as string;
  }

  it("requires authentication and ownership", async () => {
    const reference = await createPassIntent();

    state.userId = null;
    const anon = await request(API).post("/api/paystack/confirm").send({ reference });
    expect(anon.status).toBe(401);

    state.userId = "someone-else";
    const other = await request(API).post("/api/paystack/confirm").send({ reference });
    expect(other.status).toBe(403);
  });

  it("returns 404 for an unknown reference", async () => {
    state.userId = "user-1";
    const res = await request(API).post("/api/paystack/confirm").send({ reference: "tan_does-not-exist" });
    expect(res.status).toBe(404);
  });

  it("verifies the charge with Paystack and grants the entitlement", async () => {
    const reference = await createPassIntent();
    const res = await request(API).post("/api/paystack/confirm").send({ reference });

    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(true);
    expect(res.body.receipt).toEqual({ total: 188, cardLast4: "4081", promoCode: null });

    const tickets = await state.db.select().from(state.tables.tandemTicketsTable);
    const subs = await state.db.select().from(state.tables.tandemSubscriptionsTable);
    expect(tickets).toHaveLength(1);
    expect(subs).toHaveLength(1);
    const [intent] = await state.db
      .select()
      .from(state.tables.tandemPaystackIntentsTable)
      .where((t: any) => t.reference === reference);
    expect(intent.status).toBe("SUCCESS");
  });

  it("does not double-grant when the webhook already won the race", async () => {
    const reference = await createPassIntent();

    // Webhook grants first.
    const { raw, signature } = signWebhook({ event: "charge.success", data: { reference, amount: 188, currency: "USD" } });
    await request(API)
      .post("/api/paystack/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(raw);

    // Then the user returns and the page confirms.
    const res = await request(API).post("/api/paystack/confirm").send({ reference });
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(true);

    const tickets = await state.db.select().from(state.tables.tandemTicketsTable);
    const subs = await state.db.select().from(state.tables.tandemSubscriptionsTable);
    expect(tickets).toHaveLength(1);
    expect(subs).toHaveLength(1);
  });
});
