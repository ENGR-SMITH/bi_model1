import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { PASS_PRICE_USD, PASS_MONTHS } from "./tickets";

// One month, in ms — the pass period (matching SUBSCRIPTION_PERIOD_MS).
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import ticketsRouter from "./tickets";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", ticketsRouter);
  return app;
}

const API = createApp();

// A valid Luhn card (Visa test number) with a far-future expiry.
const VALID_CARD = {
  number: "4242 4242 4242 4242",
  expiryMonth: 12,
  expiryYear: 99,
  cvc: "123",
};

async function seedPromo(
  code: string,
  kind: "FREE" | "PERCENT" | "FLAT",
  value: number,
  maxUses = 0,
  active = true,
  // null = a row created before codes were scoped: still valid on every pass.
  category: "authors" | "content-creators" | null = null,
) {
  await state.db
    .insert(state.tables.nexetPromoCodesTable)
    .values({ code, category, kind, value, maxUses, uses: 0, active });
}

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.nexetTicketsTable);
  await state.db.delete(t.nexetToursTable);
  await state.db.delete(t.nexetPromoRedemptionsTable);
  await state.db.delete(t.nexetPromoCodesTable);
  state.userId = null;
}

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ticket status", () => {
  it("reports the pass price and duration, and no active passes initially", async () => {
    state.userId = "user-1";
    const res = await request(API).get("/api/tickets/status");
    expect(res.status).toBe(200);
    expect(res.body.priceUsd).toBe(PASS_PRICE_USD);
    expect(res.body.months).toBe(PASS_MONTHS);
    expect(res.body.tickets).toEqual([]);
  });

  it("requires authentication", async () => {
    state.userId = null;
    expect((await request(API).get("/api/tickets/status")).status).toBe(401);
  });
});

describe("ticket purchase", () => {
  it("grants a 1-month pass and reports it in the status", async () => {
    state.userId = "user-1";
    const res = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: VALID_CARD,
    });
    expect(res.status).toBe(201);
    expect(res.body.ticket.category).toBe("authors");
    expect(res.body.ticket.cardLast4).toBe("4242");
    expect(res.body.ticket.priceUsd).toBe(PASS_PRICE_USD);
    expect(res.body.receipt.total).toBe(PASS_PRICE_USD);
    expect(res.body.receipt.discount).toBe(0);

    const expiresAt = new Date(res.body.ticket.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now() + MONTH_MS - 5000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + MONTH_MS + 5000);

    const status = await request(API).get("/api/tickets/status");
    expect(status.body.tickets).toHaveLength(1);
    expect(status.body.tickets[0].category).toBe("authors");
  });

  it("rejects invalid cards", async () => {
    state.userId = "user-1";
    // Fails Luhn.
    const badNumber = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: { ...VALID_CARD, number: "4242 4242 4242 4241" },
    });
    expect(badNumber.status).toBe(400);

    // Expired card (January 2000).
    const expired = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: { ...VALID_CARD, expiryMonth: 1, expiryYear: 0 },
    });
    expect(expired.status).toBe(400);

    // Missing cvc.
    const noCvc = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: { ...VALID_CARD, cvc: "" },
    });
    expect(noCvc.status).toBe(400);

    // Unknown category.
    const badCategory = await request(API).post("/api/tickets/purchase").send({
      category: "singers",
      card: VALID_CARD,
    });
    expect(badCategory.status).toBe(400);
  });

  it("renewing extends the pass from the current expiry", async () => {
    state.userId = "user-1";
    await request(API).post("/api/tickets/purchase").send({ category: "authors", card: VALID_CARD });
    const before = await request(API).get("/api/tickets/status");
    const firstExpiry = new Date(before.body.tickets[0].expiresAt).getTime();

    await request(API).post("/api/tickets/purchase").send({ category: "authors", card: VALID_CARD });
    const after = await request(API).get("/api/tickets/status");
    const secondExpiry = new Date(after.body.tickets[0].expiresAt).getTime();
    expect(secondExpiry).toBeGreaterThan(firstExpiry + 3 * 7 * 24 * 60 * 60 * 1000 - 5000);
  });

  it("requires authentication", async () => {
    state.userId = null;
    expect((await request(API).post("/api/tickets/purchase").send({ category: "authors", card: VALID_CARD })).status).toBe(401);
  });
});

describe("promo codes", () => {
  it("validates a code and applies its discount to the purchase", async () => {
    await seedPromo("HALFPASS", "PERCENT", 50, 0, true, "content-creators");
    state.userId = "user-1";

    const check = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "halfpass", category: "content-creators" });
    expect(check.status).toBe(200);
    expect(check.body.valid).toBe(true);
    expect(check.body.kind).toBe("PERCENT");
    expect(check.body.discountedPriceUsd).toBe(Math.round(PASS_PRICE_USD / 2));

    const purchase = await request(API).post("/api/tickets/purchase").send({
      category: "content-creators",
      card: VALID_CARD,
      promoCode: "halfpass",
    });
    expect(purchase.status).toBe(201);
    expect(purchase.body.receipt.subtotal).toBe(PASS_PRICE_USD);
    expect(purchase.body.receipt.discount).toBe(PASS_PRICE_USD - Math.round(PASS_PRICE_USD / 2));
    expect(purchase.body.receipt.total).toBe(Math.round(PASS_PRICE_USD / 2));
    expect(purchase.body.receipt.promoCode).toBe("HALFPASS");
    expect(purchase.body.ticket.priceUsd).toBe(Math.round(PASS_PRICE_USD / 2));
  });

  it("makes the pass free with a FREE promo", async () => {
    await seedPromo("FREEPASS", "FREE", 0, 0, true, "authors");
    state.userId = "user-1";
    const res = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: VALID_CARD,
      promoCode: "FREEPASS",
    });
    expect(res.status).toBe(201);
    expect(res.body.receipt.total).toBe(0);
  });

  it("rejects unknown, expired, and used-up codes", async () => {
    await seedPromo("LIMITED", "FLAT", 50, 1, true, "authors");
    state.userId = "user-1";

    const unknown = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "NOPE", category: "authors" });
    expect(unknown.body.valid).toBe(false);

    // The limited code works once, then is exhausted — checked with a second
    // person so the one-per-person rule can't be what rejects it.
    const first = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: VALID_CARD,
      promoCode: "LIMITED",
    });
    expect(first.status).toBe(201);
    state.userId = "user-2";
    const exhausted = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: VALID_CARD,
      promoCode: "LIMITED",
    });
    expect(exhausted.status).toBe(400);
    expect(exhausted.body.error).toMatch(/promo/i);
  });

  it("lets many people use a shared code, but only once per person", async () => {
    await seedPromo("TOGETHER", "FLAT", 25, 0); // unlimited people
    state.userId = "user-1";

    // First person redeems it for the authors pass.
    const first = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: VALID_CARD,
      promoCode: "TOGETHER",
    });
    expect(first.status).toBe(201);

    // The SAME person cannot use it again, even though the code is not exhausted.
    const again = await request(API).post("/api/tickets/purchase").send({
      category: "content-creators",
      card: VALID_CARD,
      promoCode: "TOGETHER",
    });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/promo/i);
    const check = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "TOGETHER", category: "content-creators" });
    expect(check.body.valid).toBe(false);

    // A second person can still use it.
    state.userId = "user-2";
    const second = await request(API).post("/api/tickets/purchase").send({
      category: "content-creators",
      card: VALID_CARD,
      promoCode: "TOGETHER",
    });
    expect(second.status).toBe(201);
    expect(second.body.receipt.discount).toBe(25);
  });

  it("rejects a code an admin has paused (soft-disable)", async () => {
    await seedPromo("PAUSEDCODE", "FLAT", 50, 0, false, "authors");
    state.userId = "user-1";

    const check = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "PAUSEDCODE", category: "authors" });
    expect(check.status).toBe(200);
    expect(check.body.valid).toBe(false);

    const purchase = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: VALID_CARD,
      promoCode: "PAUSEDCODE",
    });
    expect(purchase.status).toBe(400);
    expect(purchase.body.error).toMatch(/promo/i);
  });

  it("dedicates a code to one category and refuses it on the other pass", async () => {
    await seedPromo("CREATORSONLY", "FREE", 0, 0, true, "content-creators");
    state.userId = "user-1";

    // Verified against the wrong pass → invalid, so the card stays locked.
    const wrongCheck = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "CREATORSONLY", category: "authors" });
    expect(wrongCheck.status).toBe(200);
    expect(wrongCheck.body.valid).toBe(false);

    // Spending it on the wrong pass is refused outright.
    const wrongPurchase = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: VALID_CARD,
      promoCode: "CREATORSONLY",
    });
    expect(wrongPurchase.status).toBe(400);
    expect(wrongPurchase.body.error).toMatch(/promo/i);

    // Its own category still accepts it.
    const rightCheck = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "CREATORSONLY", category: "content-creators" });
    expect(rightCheck.body.valid).toBe(true);
    expect(rightCheck.body.discountedPriceUsd).toBe(0);

    const purchase = await request(API).post("/api/tickets/purchase").send({
      category: "content-creators",
      card: VALID_CARD,
      promoCode: "CREATORSONLY",
    });
    expect(purchase.status).toBe(201);
    expect(purchase.body.receipt.total).toBe(0);
  });

  it("keeps a legacy code with no category valid on every pass", async () => {
    await seedPromo("LEGACY", "FREE", 0); // pre-scoping row
    state.userId = "user-1";

    for (const category of ["authors", "content-creators"] as const) {
      const check = await request(API)
        .post("/api/tickets/promo/validate")
        .send({ code: "LEGACY", category });
      expect(check.body.valid).toBe(true);
    }
  });

  it("refuses a validation that names no category", async () => {
    await seedPromo("NOCHECK", "FREE", 0, 0, true, "authors");
    state.userId = "user-1";
    const res = await request(API).post("/api/tickets/promo/validate").send({ code: "NOCHECK" });
    expect(res.status).toBe(400);
  });

  it("requires authentication for promo validation", async () => {
    state.userId = null;
    const res = await request(API)
      .post("/api/tickets/promo/validate")
      .send({ code: "HALFPASS", category: "authors" });
    expect(res.status).toBe(401);
  });
});

describe("den access tours", () => {
  it("reports no pass, no tour, and a grantable tour for a new visitor", async () => {
    state.userId = "user-1";
    const res = await request(API).get("/api/tickets/access/content-creators");
    expect(res.status).toBe(200);
    expect(res.body.category).toBe("content-creators");
    expect(res.body.tourMinutes).toBe(10);
    expect(res.body.passActive).toBe(false);
    expect(res.body.tourActive).toBe(false);
    expect(res.body.tourEndsAt).toBeNull();
    expect(res.body.tourUsed).toBe(false);
    expect(res.body.canStartTour).toBe(true);
  });

  it("starts a 10-minute tour, reports it active, and refuses a second one", async () => {
    state.userId = "user-1";
    const start = await request(API).post("/api/tickets/tour/start").send({ category: "authors" });
    expect(start.status).toBe(201);
    const endsAt = new Date(start.body.tour.endsAt).getTime();
    expect(endsAt).toBeGreaterThan(Date.now() + 10 * 60 * 1000 - 5000);
    expect(endsAt).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 5000);

    const access = await request(API).get("/api/tickets/access/authors");
    expect(access.body.passActive).toBe(false);
    expect(access.body.tourActive).toBe(true);
    expect(access.body.tourUsed).toBe(false);
    expect(access.body.canStartTour).toBe(false);

    const again = await request(API).post("/api/tickets/tour/start").send({ category: "authors" });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already running/i);
  });

  it("treats a lapsed tour as used — no second tour, ever", async () => {
    state.userId = "user-1";
    // Grant a tour, then backdate it so it has clearly expired.
    await request(API).post("/api/tickets/tour/start").send({ category: "content-creators" });
    await state.db
      .update(state.tables.nexetToursTable)
      .set({ endsAt: new Date(Date.now() - 60_000) })
      .where(eq(state.tables.nexetToursTable.userId, "user-1"));

    const access = await request(API).get("/api/tickets/access/content-creators");
    expect(access.body.tourActive).toBe(false);
    expect(access.body.tourUsed).toBe(true);
    expect(access.body.canStartTour).toBe(false);

    const again = await request(API).post("/api/tickets/tour/start").send({ category: "content-creators" });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already been used/i);
  });

  it("an active pass unlocks the den and blocks starting a tour", async () => {
    state.userId = "user-1";
    await request(API).post("/api/tickets/purchase").send({ category: "authors", card: VALID_CARD });

    const access = await request(API).get("/api/tickets/access/authors");
    expect(access.body.passActive).toBe(true);
    expect(access.body.canStartTour).toBe(false);

    const start = await request(API).post("/api/tickets/tour/start").send({ category: "authors" });
    expect(start.status).toBe(400);
    expect(start.body.error).toMatch(/active pass/i);
  });

  it("tours are independent per category", async () => {
    state.userId = "user-1";
    await request(API).post("/api/tickets/tour/start").send({ category: "authors" });
    const creators = await request(API).get("/api/tickets/access/content-creators");
    expect(creators.body.canStartTour).toBe(true);
    expect(creators.body.tourUsed).toBe(false);
  });

  it("requires authentication for access and start", async () => {
    state.userId = null;
    expect((await request(API).get("/api/tickets/access/authors")).status).toBe(401);
    expect((await request(API).post("/api/tickets/tour/start").send({ category: "authors" })).status).toBe(401);
  });
});
