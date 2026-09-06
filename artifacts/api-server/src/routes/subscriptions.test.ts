import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { STORAGE_PLANS, PROJECT_PLANS } from "../video/quota";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
}));

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: state.userId }) }));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import subscriptionsRouter from "./subscriptions";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", subscriptionsRouter);
  return app;
}

const API = createApp();

const VALID_CARD = {
  number: "4242 4242 4242 4242",
  expiryMonth: 12,
  expiryYear: 99,
  cvc: "123",
};

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemSubscriptionsTable);
  await state.db.delete(t.tandemTicketsTable);
  await state.db.delete(t.tandemAccountQuotasTable);
  state.userId = null;
}

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());

describe("subscription plans", () => {
  it("lists the catalog with passes, storage, and projects", async () => {
    state.userId = "user-1";
    const res = await request(API).get("/api/subscriptions/plans");
    expect(res.status).toBe(200);
    const kinds = res.body.plans.map((p: any) => p.kind);
    expect(kinds).toContain("pass");
    expect(kinds).toContain("storage");
    expect(kinds).toContain("projects");
    // Authors pass is $1.88.
    const authorPass = res.body.plans.find((p: any) => p.kind === "pass" && p.planId === "authors");
    expect(authorPass.priceUsd).toBe(188);
    expect(res.body.current).toEqual([]);
  });

  it("requires authentication", async () => {
    state.userId = null;
    expect((await request(API).get("/api/subscriptions")).status).toBe(401);
    expect((await request(API).get("/api/subscriptions/plans")).status).toBe(401);
  });
});

describe("subscription purchase", () => {
  it("buys a category pass and records the subscription", async () => {
    state.userId = "user-1";
    const res = await request(API)
      .post("/api/subscriptions/purchase")
      .send({ kind: "pass", planId: "authors", card: VALID_CARD });
    expect(res.status).toBe(201);
    expect(res.body.subscription.kind).toBe("pass");
    expect(res.body.subscription.planLabel).toBe("Author & Writer pass");
    expect(res.body.subscription.active).toBe(true);
    expect(res.body.subscription.priceUsd).toBe(188);
    expect(res.body.receipt.total).toBe(188);

    // Listing reflects the recorded subscription.
    const list = await request(API).get("/api/subscriptions");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].kind).toBe("pass");
    expect(list.body[0].periodEnd).toBe(res.body.subscription.periodEnd);
  });

  it("extends storage quota and records a storage subscription", async () => {
    state.userId = "user-1";
    const g200 = STORAGE_PLANS.find((p) => p.id === "g200")!;

    const res = await request(API)
      .post("/api/subscriptions/purchase")
      .send({ kind: "storage", planId: "g200", card: VALID_CARD });
    expect(res.status).toBe(201);
    expect(res.body.subscription.kind).toBe("storage");
    expect(res.body.receipt.total).toBe(g200.priceUsd);

    // The quota grew by exactly one plan on top of the 2 GB free default.
    const after = await request(API).get("/api/subscriptions/plans");
    expect(after.body.usage.storage.totalBytes).toBe(2 * 1024 ** 3 + g200.bytes);
  });

  it("extends the project limit and records a project subscription", async () => {
    state.userId = "user-1";
    const res = await request(API)
      .post("/api/subscriptions/purchase")
      .send({ kind: "projects", planId: "p50", card: VALID_CARD });
    expect(res.status).toBe(201);
    expect(res.body.subscription.kind).toBe("projects");
    expect(res.body.receipt.total).toBe(PROJECT_PLANS.find((p) => p.id === "p50")!.priceUsd);
    const after = await request(API).get("/api/subscriptions/plans");
    expect(after.body.usage.projects.total).toBe(5 + 50);
  });

  it("rejects invalid cards and unknown plans", async () => {
    state.userId = "user-1";
    const badCard = await request(API)
      .post("/api/subscriptions/purchase")
      .send({ kind: "storage", planId: "g200", card: { ...VALID_CARD, number: "4242 4242 4242 4241" } });
    expect(badCard.status).toBe(400);

    const unknownPlan = await request(API)
      .post("/api/subscriptions/purchase")
      .send({ kind: "storage", planId: "nope", card: VALID_CARD });
    expect(unknownPlan.status).toBe(400);

    const badKind = await request(API)
      .post("/api/subscriptions/purchase")
      .send({ kind: "singers", planId: "authors", card: VALID_CARD });
    expect(badKind.status).toBe(400);
  });
});

describe("storage plan values", () => {
  it("matches the specified pricing (2GB free, $40/500GB $20/200GB $60/1TB)", () => {
    const g200 = STORAGE_PLANS.find((p) => p.id === "g200")!;
    const g500 = STORAGE_PLANS.find((p) => p.id === "g500")!;
    const tb1 = STORAGE_PLANS.find((p) => p.id === "tb1")!;
    expect(g200.priceUsd).toBe(2000);
    expect(g500.priceUsd).toBe(4000);
    expect(tb1.priceUsd).toBe(6000);
  });
});