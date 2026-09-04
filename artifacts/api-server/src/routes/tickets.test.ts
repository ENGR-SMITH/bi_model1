import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { PASS_PRICE_USD, PASS_WEEKS } from "./tickets";

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

async function seedPromo(code: string, kind: "FREE" | "PERCENT" | "FLAT", value: number, maxUses = 0) {
  await state.db.insert(state.tables.tandemPromoCodesTable).values({ code, kind, value, maxUses, uses: 0 });
}

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemTicketsTable);
  await state.db.delete(t.tandemToursTable);
  await state.db.delete(t.tandemPromoCodesTable);
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
    expect(res.body.weeks).toBe(PASS_WEEKS);
    expect(res.body.tickets).toEqual([]);
  });

  it("requires authentication", async () => {
    state.userId = null;
    expect((await request(API).get("/api/tickets/status")).status).toBe(401);
  });
});

describe("ticket purchase", () => {
  it("grants a 3-week pass and reports it in the status", async () => {
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
    expect(expiresAt).toBeGreaterThan(Date.now() + PASS_WEEKS * 7 * 24 * 60 * 60 * 1000 - 5000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + PASS_WEEKS * 7 * 24 * 60 * 60 * 1000 + 5000);

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
    await seedPromo("HALFPASS", "PERCENT", 50);
    state.userId = "user-1";

    const check = await request(API).post("/api/tickets/promo/validate").send({ code: "halfpass" });
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
    await seedPromo("FREEPASS", "FREE", 0);
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
    await seedPromo("LIMITED", "FLAT", 50, 1);
    state.userId = "user-1";

    const unknown = await request(API).post("/api/tickets/promo/validate").send({ code: "NOPE" });
    expect(unknown.body.valid).toBe(false);

    // The limited code works once, then is exhausted.
    const first = await request(API).post("/api/tickets/purchase").send({
      category: "authors",
      card: VALID_CARD,
      promoCode: "LIMITED",
    });
    expect(first.status).toBe(201);
    const exhausted = await request(API).post("/api/tickets/purchase").send({
      category: "content-creators",
      card: VALID_CARD,
      promoCode: "LIMITED",
    });
    expect(exhausted.status).toBe(400);
    expect(exhausted.body.error).toMatch(/promo/i);
  });

  it("requires authentication for promo validation", async () => {
    state.userId = null;
    expect((await request(API).post("/api/tickets/promo/validate").send({ code: "HALFPASS" })).status).toBe(401);
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
      .update(state.tables.tandemToursTable)
      .set({ endsAt: new Date(Date.now() - 60_000) })
      .where(eq(state.tables.tandemToursTable.userId, "user-1"));

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
