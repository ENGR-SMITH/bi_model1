import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  emails: {} as Record<string, string>,
  whopCalls: [] as Array<{ method: string; url: string; body?: any }>,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        id,
        primaryEmailAddress: state.emails[id] ? { emailAddress: state.emails[id] } : null,
        emailAddresses: state.emails[id] ? [{ emailAddress: state.emails[id] }] : [],
      }),
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

import adminRouter, { clampPromoDurationDays } from "./admin";
import ticketsRouter from "./tickets";

// The admin gates on the Clerk user's email matching ADMIN_EMAIL; tests
// default to this address and flip the Clerk user via the state mock.
process.env.ADMIN_EMAIL = "admin@example.com";

/** Point the mocked Clerk session at the ADMIN_EMAIL user. */
function signInAsAdmin() {
  state.userId = "admin-user";
  state.emails["admin-user"] = "admin@example.com";
}

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
  await state.db.delete(t.nexetSubscriptionsTable);
  await state.db.delete(t.nexetPromoCodesTable);
  await state.db.delete(t.nexetPromoRedemptionsTable);
  await state.db.delete(t.nexetSubscriptionPlanSettingsTable);
  await state.db.delete(t.oracleHealthEventsTable);
  await state.db.delete(t.oracleProvidersTable);
  state.emails = {};
  state.userId = null;
  state.whopCalls = [];
}

/** Stub the Whop membership cancel/resume endpoint. */
function stubWhopMemberships() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      state.whopCalls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "mem_abc123" }),
      };
    }),
  );
}

beforeEach(async () => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.WHOP_API_KEY = "whop_test_api_key";
  process.env.WHOP_ACCOUNT_ID = "biz_test";
  await resetDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ADMIN_EMAIL;
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_ACCOUNT_ID;
});

describe("admin access", () => {
  // Simulate a Clerk-signed-in user whose email lives in state.emails.
  function signInAs(email: string, id = "user-" + Math.random().toString(36).slice(2, 10)) {
    state.userId = id;
    state.emails[id] = email;
  }

  it("opens for the ADMIN_EMAIL user signed in through Clerk", async () => {
    const unauth = await request(API).get("/api/admin/providers");
    expect(unauth.status).toBe(401);

    signInAs("admin@example.com");

    const session = await request(API).get("/api/admin/session");
    expect(session.status).toBe(200);
    expect(session.body.authenticated).toBe(true);

    const providers = await request(API).get("/api/admin/providers");
    expect(providers.status).toBe(200);
    expect(providers.body).toHaveLength(5);
    expect(providers.body.map((item: any) => item.id)).toEqual(["groq", "openrouter", "ollama", "lmstudio", "freebuff"]);
  });

  it("rejects signed-out requests and Clerk users whose email is not ADMIN_EMAIL", async () => {
    // Signed in, but a different email -> still locked out.
    signInAs("someone-else@example.com");
    expect((await request(API).get("/api/admin/providers")).status).toBe(401);
    expect((await request(API).get("/api/admin/session")).body.authenticated).toBe(false);

    // Signed in as a user Clerk cannot resolve -> treated as not an admin.
    signInAs("admin@example.com");
    state.userId = "ghost-user";
    delete state.emails["ghost-user"];
    expect((await request(API).get("/api/admin/providers")).status).toBe(401);
    expect((await request(API).get("/api/admin/session")).body.authenticated).toBe(false);
  });

  it("respects an ADMIN_EMAIL override", async () => {
    process.env.ADMIN_EMAIL = "owner@example.com";

    signInAs("admin@example.com");
    expect((await request(API).get("/api/admin/session")).body.authenticated).toBe(false);

    signInAs("owner@example.com");
    expect((await request(API).get("/api/admin/session")).body.authenticated).toBe(true);
  });

  it("seeds provider API keys from the environment when the row has none", async () => {
    process.env.GROQ_API_KEY = "env-groq-key-123";
    signInAs("admin@example.com");

    const providers = await request(API).get("/api/admin/providers");
    const groq = providers.body.find((item: any) => item.id === "groq");
    expect(groq.configured).toBe(true);
    expect(groq.keyHint).toContain("-123");
  });
});

describe("admin promo codes", () => {
  // Sign in as the ADMIN_EMAIL user through the mocked Clerk session.
  async function login(): Promise<string> {
    state.userId = "admin-user";
    state.emails["admin-user"] = "admin@example.com";
    const session = await request(API).get("/api/admin/session");
    expect(session.status).toBe(200);
    expect(session.body.authenticated).toBe(true);
    return "session";
  }

  it("creates, lists, updates, and deletes promo codes", async () => {
    const cookie = await login();

    // Start empty.
    const empty = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    // Create — the code is normalized to uppercase, is FREE-only, and is
    // dedicated to the one category it was created for.
    const created = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "halfpass", category: "authors", kind: "FREE", value: 0, maxUses: 0 });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("HALFPASS");
    expect(created.body.category).toBe("authors");
    expect(created.body.kind).toBe("FREE");
    expect(created.body.uses).toBe(0);
    expect(created.body.active).toBe(true);

    // Percent/dollar-off codes are no longer accepted — the checkout rejects
    // them, so the admin API refuses to create dead codes.
    const percent = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "SAVE20", category: "authors", kind: "PERCENT", value: 20, maxUses: 0 });
    expect(percent.status).toBe(400);
    const flat = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "SAVE2", category: "authors", kind: "FLAT", value: 200, maxUses: 0 });
    expect(flat.status).toBe(400);

    // A code must say which category pass it belongs to.
    const noCategory = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "NOCAT", kind: "FREE", value: 0, maxUses: 0 });
    expect(noCategory.status).toBe(400);
    const bogusCategory = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "BADCAT", category: "storage", kind: "FREE", value: 0, maxUses: 0 });
    expect(bogusCategory.status).toBe(400);

    // Duplicate code → 409.
    const dup = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "HALFPASS", category: "authors", kind: "FREE", value: 0, maxUses: 1 });
    expect(dup.status).toBe(409);

    // Update — max uses and pause/resume still work; kind stays FREE.
    const updated = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 5 });
    expect(updated.status).toBe(200);
    expect(updated.body.kind).toBe("FREE");
    expect(updated.body.maxUses).toBe(5);

    // A FREE row can't be converted into a percent/dollar-off code.
    const converted = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ kind: "PERCENT", value: 25, maxUses: 5 });
    expect(converted.status).toBe(400);

    // The pass card sees the updated code — valid and free on its own
    // category, refused on the other one.
    state.userId = "user-1";
    const validated = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "HALFPASS", category: "authors" });
    expect(validated.body.valid).toBe(true);
    expect(validated.body.kind).toBe("FREE");
    expect(validated.body.discountedPriceUsd).toBe(0);

    const wrongPass = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "HALFPASS", category: "content-creators" });
    expect(wrongPass.body.valid).toBe(false);

    // An admin can re-scope a code to the other pass.
    signInAsAdmin();
    const rescoped = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ category: "content-creators", kind: "FREE", value: 0, maxUses: 5 });
    expect(rescoped.status).toBe(200);
    expect(rescoped.body.category).toBe("content-creators");
    const afterRescope = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "HALFPASS", category: "content-creators" });
    expect(afterRescope.body.valid).toBe(true);
    // Put it back so the later assertions read the same row.
    signInAsAdmin();
    await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ category: "authors", kind: "FREE", value: 0, maxUses: 5 });

    // List reflects the row.
    signInAsAdmin();
    const list = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].code).toBe("HALFPASS");

    // Pause (soft-disable) — the code stays listed but stops validating.
    const paused = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 5, active: false });
    expect(paused.status).toBe(200);
    expect(paused.body.active).toBe(false);
    state.userId = "user-2";
    const pausedCheck = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "HALFPASS", category: "authors" });
    expect(pausedCheck.body.valid).toBe(false);

    // Resume — valid again.
    signInAsAdmin();
    const resumed = await request(API)
      .patch("/api/admin/promos/HALFPASS")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 5, active: true });
    expect(resumed.status).toBe(200);
    expect(resumed.body.active).toBe(true);
    const resumedCheck = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "HALFPASS", category: "authors" });
    expect(resumedCheck.body.valid).toBe(true);

    // Delete.
    signInAsAdmin();
    const deleted = await request(API).delete("/api/admin/promos/HALFPASS").set("Cookie", cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    const after = await request(API).get("/api/admin/promos").set("Cookie", cookie);
    expect(after.body).toEqual([]);
  });

  it("carries the pass length the admin sets, and clamps a silly one", async () => {
    const cookie = await login();

    // A short campaign: a code that grants two days of pass.
    const created = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "TWODAY", category: "authors", kind: "FREE", value: 0, durationDays: 2, maxUses: 0 });
    expect(created.status).toBe(201);
    expect(created.body.durationDays).toBe(2);

    // A code with no stated length keeps the normal month.
    const defaulted = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "PLAIN", category: "authors", kind: "FREE", value: 0, maxUses: 0 });
    expect(defaulted.body.durationDays).toBe(30);

    // Editing without the field leaves the length alone (pause/resume must
    // never silently rewrite what a live campaign grants).
    const paused = await request(API)
      .patch("/api/admin/promos/TWODAY")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 0, active: false });
    expect(paused.body.durationDays).toBe(2);

    // An explicit length is honoured, and an absurd one is clamped into the
    // range a pass can actually be (1 day .. 1 year).
    const lengthened = await request(API)
      .patch("/api/admin/promos/TWODAY")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 0, durationDays: 7 });
    expect(lengthened.body.durationDays).toBe(7);

    // A length outside what a pass can be is refused rather than stored, so
    // a typo can never mint a year-long or zero-length pass.
    const tooLong = await request(API)
      .patch("/api/admin/promos/TWODAY")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 0, durationDays: 9999 });
    expect(tooLong.status).toBe(400);

    const tooShort = await request(API)
      .patch("/api/admin/promos/TWODAY")
      .set("Cookie", cookie)
      .send({ kind: "FREE", value: 0, maxUses: 0, durationDays: 0 });
    expect(tooShort.status).toBe(400);

    // The store-level guard sits behind that: anything that reaches it is
    // clamped into the same range (legacy rows, direct writes).
    expect(clampPromoDurationDays(0)).toBe(1);
    expect(clampPromoDurationDays(9999)).toBe(365);
    expect(clampPromoDurationDays("7")).toBe(7);
    expect(clampPromoDurationDays(undefined)).toBe(30);
  });

  it("rejects invalid input and unknown codes", async () => {
    const cookie = await login();

    const badKind = await request(API)
      .post("/api/admin/promos")
      .set("Cookie", cookie)
      .send({ code: "X", category: "authors", kind: "BOGUS", value: 10, maxUses: 0 });
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
  // Sign in as the ADMIN_EMAIL user through the mocked Clerk session.
  async function login(): Promise<string> {
    state.userId = "admin-user";
    state.emails["admin-user"] = "admin@example.com";
    const session = await request(API).get("/api/admin/session");
    expect(session.status).toBe(200);
    expect(session.body.authenticated).toBe(true);
    return "session";
  }

  it("lists the catalog with auto-renew on by default for every plan", async () => {
    const cookie = await login();
    const res = await request(API).get("/api/admin/plan-settings").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const authors = res.body.find((plan: any) => plan.kind === "pass" && plan.planId === "authors");
    expect(authors).toMatchObject({ kind: "pass", planId: "authors", autoRenewAvailable: true });
    const g200 = res.body.find((plan: any) => plan.kind === "storage" && plan.planId === "g200");
    expect(g200.autoRenewAvailable).toBe(true);
    const p50 = res.body.find((plan: any) => plan.kind === "projects" && plan.planId === "p50");
    expect(p50.autoRenewAvailable).toBe(true);
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

  it("switches auto-renew off for a storage plan too", async () => {
    const cookie = await login();

    const off = await request(API)
      .patch("/api/admin/plan-settings/storage/g200")
      .set("Cookie", cookie)
      .send({ autoRenewAvailable: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ kind: "storage", planId: "g200", autoRenewAvailable: false });
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

    // Signed out -> every admin route is 401 again.
    state.userId = null;
    expect((await request(API).get("/api/admin/plan-settings")).status).toBe(401);
    expect((await request(API).patch("/api/admin/plan-settings/pass/authors").send({ autoRenewAvailable: true })).status).toBe(401);
  });
});

describe("admin subscriptions", () => {
  // Sign in as the ADMIN_EMAIL user through the mocked Clerk session.
  async function login(): Promise<string> {
    state.userId = "admin-user";
    state.emails["admin-user"] = "admin@example.com";
    const session = await request(API).get("/api/admin/session");
    expect(session.status).toBe(200);
    expect(session.body.authenticated).toBe(true);
    return "session";
  }

  async function seedSubscription(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    await state.db.insert(state.tables.nexetSubscriptionsTable).values({
      id: "sub-" + Math.random().toString(36).slice(2, 10),
      userId: "user-1",
      kind: "pass",
      planId: "authors",
      planLabel: "Author & Writer pass",
      priceUsd: 588,
      status: "ACTIVE",
      intervalLabel: "1 month",
      periodStart: new Date(now),
      periodEnd: new Date(now + 30 * 24 * 60 * 60 * 1000),
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
      intervalLabel: "1 month",
      createdAt: new Date(1000),
    });
    await seedSubscription({
      id: "sub-new",
      autoRenew: true,
      whopMembershipId: "mem_123",
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

  it("toggles auto-renew on and off for one subscription (any kind), telling Whop", async () => {
    const cookie = await login();
    stubWhopMemberships();
    await seedSubscription({
      id: "sub-1",
      whopMembershipId: "mem_abc123",
    });

    // Turning it off sets cancel_at_period_end on the Whop membership so
    // charges stop at the end of the current period.
    const off = await request(API)
      .patch("/api/admin/subscriptions/sub-1/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.autoRenew).toBe(false);
    expect(state.whopCalls).toContainEqual(
      expect.objectContaining({ url: "https://api.whop.com/api/v1/memberships/mem_abc123", method: "PATCH", body: { cancel_at_period_end: true } }),
    );

    // Turning it back on resumes the same membership.
    const on = await request(API)
      .patch("/api/admin/subscriptions/sub-1/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.autoRenew).toBe(true);
    expect(state.whopCalls).toContainEqual(
      expect.objectContaining({ url: "https://api.whop.com/api/v1/memberships/mem_abc123", method: "PATCH", body: { cancel_at_period_end: false } }),
    );

    // Storage subscriptions can be toggled by the admin too.
    await seedSubscription({
      id: "sub-storage",
      kind: "storage",
      planId: "g200",
      planLabel: "200 GB more space",
      priceUsd: 2000,
      intervalLabel: "1 month",
      whopMembershipId: "mem_storage",
    });
    const storageOff = await request(API)
      .patch("/api/admin/subscriptions/sub-storage/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: false });
    expect(storageOff.status).toBe(200);
    expect(storageOff.body.autoRenew).toBe(false);
  });

  it("refuses to enable auto-renew without a linked Whop membership", async () => {
    const cookie = await login();
    await seedSubscription({ id: "sub-nolink" });

    const res = await request(API)
      .patch("/api/admin/subscriptions/sub-nolink/auto-renew")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Whop membership is linked/i);
  });

  it("rejects unknown ids, unlinked rows, and unauthenticated callers", async () => {
    const cookie = await login();
    await seedSubscription({
      id: "sub-storage",
      kind: "storage",
      planId: "g200",
      planLabel: "200 GB more space",
      priceUsd: 2000,
      intervalLabel: "1 month",
    });

    // A storage row without a Whop membership cannot be turned on.
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

    // Signed out -> every admin route is 401 again.
    state.userId = null;
    expect((await request(API).get("/api/admin/subscriptions")).status).toBe(401);
    expect((await request(API).patch("/api/admin/subscriptions/sub-1/auto-renew").send({ enabled: true })).status).toBe(401);
  });
});
