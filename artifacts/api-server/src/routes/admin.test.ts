import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  emails: {} as Record<string, string>,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUserList: async (params: { userId?: string[] }) => {
        const ids = params.userId ?? Object.keys(state.emails);
        return {
          data: ids.map((id) => ({
            id,
            primaryEmailAddress: state.emails[id] ? { emailAddress: state.emails[id] } : null,
            emailAddresses: state.emails[id] ? [{ emailAddress: state.emails[id] }] : [],
          })),
        };
      },
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

import adminRouter from "./admin";
import ticketsRouter from "./tickets";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", adminRouter);
  app.use("/api", ticketsRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemSubscriptionsTable);
  await state.db.delete(t.tandemPromoCodesTable);
  await state.db.delete(t.tandemPromoRedemptionsTable);
  await state.db.delete(t.tandemSubscriptionPlanSettingsTable);
  await state.db.delete(t.oracleHealthEventsTable);
  await state.db.delete(t.oracleProvidersTable);
  state.emails = {};
}

beforeEach(async () => {
  delete process.env.ADMIN_ACCESS_CODE;
  await resetDb();
});

afterEach(() => {
  delete process.env.ADMIN_ACCESS_CODE;
  vi.unstubAllGlobals();
});

describe("admin access", () => {
  it("unlocks with the default access code TANDEM_123 when no env var is set", async () => {
    const unauth = await request(API).get("/api/admin/providers");
    expect(unauth.status).toBe(401);

    const login = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    expect(login.status).toBe(200);
    expect(login.body.authenticated).toBe(true);

    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(cookie).toBeTruthy();

    const providers = await request(API).get("/api/admin/providers").set("Cookie", cookie);
    expect(providers.status).toBe(200);
    expect(providers.body).toHaveLength(5);
    expect(providers.body.map((item: any) => item.id)).toEqual(["groq", "openrouter", "ollama", "lmstudio", "freebuff"]);
  });

  it("rejects a wrong access code and respects an ADMIN_ACCESS_CODE override", async () => {
    process.env.ADMIN_ACCESS_CODE = "SECRET_OVERRIDE";
    const wrong = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    expect(wrong.status).toBe(401);

    const right = await request(API).post("/api/admin/login").send({ accessCode: "SECRET_OVERRIDE" });
    expect(right.status).toBe(200);
  });

  it("seeds provider API keys from the environment when the row has none", async () => {
    process.env.GROQ_API_KEY = "env-groq-key-123";
    const login = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0];

    const providers = await request(API).get("/api/admin/providers").set("Cookie", cookie);
    const groq = providers.body.find((item: any) => item.id === "groq");
    expect(groq.configured).toBe(true);
    expect(groq.keyHint).toContain("-123");
  });
});

describe("admin promo codes", () => {
  async function login(): Promise<string> {
    const loginRes = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(cookie).toBeTruthy();
    return cookie as string;
  }

  it("creates, lists, updates, and deletes promo codes", async () => {
    const cookie = await login();

    // Start empty.
    const empty = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    // Create — the code is normalized to uppercase.
    const created = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "halfpass", kind: "PERCENT", value: 50, maxUses: 0 });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("HALFPASS");
    expect(created.body.kind).toBe("PERCENT");
    expect(created.body.uses).toBe(0);
    expect(created.body.active).toBe(true);

    // Duplicate code → 409.
    const dup = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "HALFPASS", kind: "FLAT", value: 20, maxUses: 1 });
    expect(dup.status).toBe(409);

    // Update.
    const updated = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ kind: "FLAT", value: 25, maxUses: 5 });
    expect(updated.status).toBe(200);
    expect(updated.body.kind).toBe("FLAT");
    expect(updated.body.value).toBe(25);
    expect(updated.body.maxUses).toBe(5);

    // The checkout sees the updated code (valid + discounted price).
    state.userId = "user-1";
    const validated = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "HALFPASS" });
    expect(validated.body.valid).toBe(true);
    expect(validated.body.kind).toBe("FLAT");
    expect(validated.body.discountedPriceUsd).toBe(188 - 25);

    // List reflects the row.
    const list = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].code).toBe("HALFPASS");

    // Pause (soft-disable) — the code stays listed but stops validating.
    const paused = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ kind: "FLAT", value: 25, maxUses: 5, active: false });
    expect(paused.status).toBe(200);
    expect(paused.body.active).toBe(false);
    state.userId = "user-2";
    const pausedCheck = await request(API).post("/api/tickets/promo/validate").send({ code: "HALFPASS" });
    expect(pausedCheck.body.valid).toBe(false);

    // Resume — valid again.
    const resumed = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ kind: "FLAT", value: 25, maxUses: 5, active: true });
    expect(resumed.status).toBe(200);
    expect(resumed.body.active).toBe(true);
    const resumedCheck = await request(API).post("/api/tickets/promo/validate").send({ code: "HALFPASS" });
    expect(resumedCheck.body.valid).toBe(true);

    // Delete.
    const deleted = await request(API).delete("/api/admin/promos/HALFPASS").set("Cookie", cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    const after = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(after.body).toEqual([]);
  });

  it("rejects invalid input and unknown codes", async () => {
    const cookie = await login();

    const badKind = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "X", kind: "BOGUS", value: 10, maxUses: 0 });
    expect(badKind.status).toBe(400);

    const missing = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 0 });
    expect(missing.status).toBe(400);

    const notFound = await request(API).patch("/api/admin/promos/NOPE").set("Cookie", cookie).send({ kind: "FREE", value: 0, maxUses: 0 });
    expect(notFound.status).toBe(404);
    const deleteMissing = await request(API).delete("/api/admin/promos/NOPE").set("Cookie", cookie);
    expect(deleteMissing.status).toBe(404);
  });

  it("requires an admin session", async () => {
    expect((await request(API).get("/api/admin/promos")).status).toBe(401);
    expect((await request(API).post("/api/admin/promos").send({ code: "X", kind: "FREE", value: 0, maxUses: 0 })).status).toBe(401);
    expect((await request(API).patch("/api/admin/promos/X").send({ kind: "FREE", value: 0, maxUses: 0 })).status).toBe(401);
    expect((await request(API).delete("/api/admin/promos/X")).status).toBe(401);
  });
});

describe("admin plan settings", () => {
  async function login(): Promise<string> {
    const loginRes = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(cookie).toBeTruthy();
    return cookie as string;
  }

  it("lists the catalog with auto-renew defaults (passes on, others off)", async () => {
    const cookie = await login();
    const res = await request(API).get("/api/admin/plan-settings").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const authors = res.body.find((plan: any) => plan.kind === "pass" && plan.planId === "authors");
    expect(authors).toMatchObject({ kind: "pass", planId: "authors", autoRenewAvailable: true });
    const g200 = res.body.find((plan: any) => plan.kind === "storage" && plan.planId === "g200");
    expect(g200.autoRenewAvailable).toBe(false);
    const p50 = res.body.find((plan: any) => plan.kind === "projects" && plan.planId === "p50");
    expect(p50.autoRenewAvailable).toBe(false);
  });

  it("toggles auto-renew availability per plan and persists it", async () => {
    const cookie = await login();

    // Turn auto-renew OFF for the authors pass.
    const off = await request(API)
      .patch("/api/admin/plan-settings/pass/authors")
      .set("Cookie", cookie)
      .send({ autoRenewAvailable: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ kind: "pass", planId: "authors", autoRenewAvailable: false });

    // The list reflects the override.
    const list = await request(API).get("/api/admin/plan-settings").set("Cookie", cookie);
    expect(list.body.find((plan: any) => plan.kind === "pass" && plan.planId === "authors").autoRenewAvailable).toBe(false);

    // Switching it back on upserts the same row.
    const on = await request(API)
      .patch("/api/admin/plan-settings/pass/authors")
      .set("Cookie", cookie)
      .send({ autoRenewAvailable: true });
    expect(on.status).toBe(200);
    expect(on.body.autoRenewAvailable).toBe(true);
  });

  it("rejects unknown plans, invalid bodies, and unauthenticated callers", async () => {
    const cookie = await login();

    const unknownPlan = await request(API)
      .patch("/api/admin/plan-settings/storage/nope")
      .set("Cookie", cookie)
      .send({ autoRenewAvailable: true });
    expect(unknownPlan.status).toBe(400);

    const badKind = await request(API)
      .patch("/api/admin/plan-settings/singers/authors")
      .set("Cookie", cookie)
      .send({ autoRenewAvailable: true });
    expect(badKind.status).toBe(400);

    const missingBody = await request(API).patch("/api/admin/plan-settings/pass/authors").set("Cookie", cookie).send({});
    expect(missingBody.status).toBe(400);

    expect((await request(API).get("/api/admin/plan-settings")).status).toBe(401);
    expect((await request(API).patch("/api/admin/plan-settings/pass/authors").send({ autoRenewAvailable: true })).status).toBe(401);
  });
});

describe("admin subscriptions", () => {
  async function login(): Promise<string> {
    const loginRes = await request(API).post("/api/admin/login").send({ accessCode: "TANDEM_123" });
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(cookie).toBeTruthy();
    return cookie as string;
  }

  async function seedSubscription(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    await state.db.insert(state.tables.tandemSubscriptionsTable).values({
      id: "sub-" + Math.random().toString(36).slice(2, 10),
      userId: "user-1",
      kind: "pass",
      planId: "authors",
      planLabel: "Author & Writer pass",
      priceUsd: 188,
      status: "ACTIVE",
      intervalLabel: "4 weeks",
      periodStart: new Date(now),
      periodEnd: new Date(now + 4 * 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    });
  }

  it("lists every subscription with the buyer's email, newest first", async () => {
    const cookie = await login();
    state.emails["user-1"] = "buyer@example.com";

    await seedSubscription({
      id: "sub-old",
      kind: "storage",
      planId: "g200",
      planLabel: "200 GB more space",
      priceUsd: 2000,
      intervalLabel: "recurring",
      createdAt: new Date(1000),
    });
    await seedSubscription({
      id: "sub-new",
      autoRenew: true,
      paystackAuthorizationCode: "auth_123",
      cardLast4: "4081",
      createdAt: new Date(2000),
    });

    const res = await request(API).get("/api/admin/subscriptions").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("sub-new");
    expect(res.body[0]).toMatchObject({
      userEmail: "buyer@example.com",
      userId: "user-1",
      kind: "pass",
      planId: "authors",
      autoRenew: true,
      cardLast4: "4081",
      active: true,
    });
    expect(res.body[1].autoRenew).toBe(false);
  });

  it("falls back to a null email when Clerk cannot resolve the user", async () => {
    const cookie = await login();
    await seedSubscription({ id: "sub-ghost", userId: "no-such-clerk-user" });

    const res = await request(API).get("/api/admin/subscriptions").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].userEmail).toBeNull();
  });

  it("toggles auto-renew on and off for one pass", async () => {
    const cookie = await login();
    await seedSubscription({ id: "sub-1", paystackAuthorizationCode: "auth_123" });

    const on = await request(API)
      .patch("/api/admin/subscriptions/sub-1/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.autoRenew).toBe(true);

    const off = await request(API)
      .patch("/api/admin/subscriptions/sub-1/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.autoRenew).toBe(false);
  });

  it("refuses to enable auto-renew without a card on file", async () => {
    const cookie = await login();
    await seedSubscription({ id: "sub-nocard" });

    const res = await request(API)
      .patch("/api/admin/subscriptions/sub-nocard/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/card is on file/i);
  });

  it("rejects non-pass subscriptions, unknown ids, and unauthenticated callers", async () => {
    const cookie = await login();
    await seedSubscription({
      id: "sub-storage",
      kind: "storage",
      planId: "g200",
      planLabel: "200 GB more space",
      priceUsd: 2000,
      intervalLabel: "recurring",
    });

    const nonPass = await request(API)
      .patch("/api/admin/subscriptions/sub-storage/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect(nonPass.status).toBe(400);

    const notFound = await request(API)
      .patch("/api/admin/subscriptions/sub-nope/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect(notFound.status).toBe(404);

    expect((await request(API).get("/api/admin/subscriptions")).status).toBe(401);
    expect((await request(API).patch("/api/admin/subscriptions/sub-1/auto-renew").send({ enabled: true })).status).toBe(401);
  });
});
