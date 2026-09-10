import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, gt } from "drizzle-orm";
import { db, nexetPromoCodesTable, nexetPromoRedemptionsTable, nexetTicketsTable, nexetToursTable } from "@workspace/db";
import { applySubscriptionPurchase } from "../video/subscriptions";
import {
  GetTicketStatusResponse,
  PurchaseTicketBody,
  PurchaseTicketResponse,
  ValidateTicketPromoBody,
  ValidateTicketPromoResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// The category pass: $5.88 per month, per category. One active pass opens the
// whole category (Author-Writer room / Content-Creators room). Billed monthly
// through a Whop subscription plan.
export const PASS_PRICE_USD = 588; // $5.88 in cents
export const PASS_MONTHS = 1;
// A visitor without a pass gets ONE 10-minute preview tour per den (a row in
// nexet_tours). Each den tours independently, matching its own pass.
export const TOUR_MINUTES = 10;
export const TOUR_MS = TOUR_MINUTES * 60 * 1000;
export const TICKET_CATEGORIES = ["authors", "content-creators"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export function luhnValid(number: string): boolean {
  const digits = number.replace(/\s+/g, "");
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Expiry is "MM/YY" — must be in the future (through the end of the month). */
export function expiryValid(month: number, year: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(year)) return false;
  if (month < 1 || month > 12) return false;
  if (year < 0 || year > 99) return false;
  const now = new Date();
  const expiry = new Date(2000 + year, month, 1); // first day after the month
  return expiry.getTime() > now.getTime();
}

interface ResolvedPromo {
  code: string;
  kind: "FREE" | "PERCENT" | "FLAT";
  value: number;
  discount: number; // cents off
  label: string;
}

/** True when this user has already redeemed the code (one per person). */
export async function promoRedeemedByUser(code: string, userId: string): Promise<boolean> {
  const [redemption] = await db
    .select({ code: nexetPromoRedemptionsTable.code })
    .from(nexetPromoRedemptionsTable)
    .where(
      and(eq(nexetPromoRedemptionsTable.code, code), eq(nexetPromoRedemptionsTable.userId, userId)),
    )
    .limit(1);
  return Boolean(redemption);
}

export async function resolvePromo(
  raw: string | undefined,
  priceUsd: number,
  userId?: string | null,
): Promise<ResolvedPromo | null> {
  if (!raw || !raw.trim()) return null;
  const code = raw.trim().toUpperCase();
  const [promo] = await db
    .select()
    .from(nexetPromoCodesTable)
    .where(eq(nexetPromoCodesTable.code, code))
    .limit(1);
  if (!promo) return null;
  // Paused by an admin — keep the row, stop accepting it.
  if (promo.active === false) return null;
  if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) return null;
  if (promo.maxUses > 0 && promo.uses >= promo.maxUses) return null;
  // A shared code is still one per person — this caller already used it.
  if (userId && (await promoRedeemedByUser(code, userId))) return null;

  if (promo.kind === "FREE") {
    return { code, kind: "FREE", value: 0, discount: priceUsd, label: "Free pass" };
  }
  if (promo.kind === "PERCENT") {
    const discount = Math.round((priceUsd * Math.min(100, Math.max(0, promo.value))) / 100);
    return { code, kind: "PERCENT", value: promo.value, discount, label: `${promo.value}% off` };
  }
  // FLAT — cents off.
  const discount = Math.min(priceUsd, Math.max(0, promo.value));
  return { code, kind: "FLAT", value: promo.value, discount, label: `$${(promo.value / 100).toFixed(2)} off` };
}

// GET /tickets/access/:category — the den entry state for one category:
// whether the viewer holds an active pass, whether their one-time tour is
// live (and when it ends), whether it has already been used, and whether a
// fresh tour may be started. The den apps consult this on every load, so a
// lapsed tour can never be re-granted client-side.
router.get("/tickets/access/:category", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const category = String(req.params.category ?? "");
  if (!TICKET_CATEGORIES.includes(category as TicketCategory)) {
    res.status(400).json({ error: `Unknown category: ${category}` });
    return;
  }

  const [pass] = await db
    .select()
    .from(nexetTicketsTable)
    .where(
      and(
        eq(nexetTicketsTable.userId, userId),
        eq(nexetTicketsTable.category, category),
        gt(nexetTicketsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(nexetTicketsTable.expiresAt)
    .limit(1);
  // At most one tour row per (user, category) is ever granted.
  const [tour] = await db
    .select()
    .from(nexetToursTable)
    .where(and(eq(nexetToursTable.userId, userId), eq(nexetToursTable.category, category)))
    .orderBy(nexetToursTable.startedAt)
    .limit(1);

  const passActive = Boolean(pass);
  const tourActive = Boolean(tour && tour.endsAt.getTime() > Date.now());
  const tourUsed = Boolean(tour && tour.endsAt.getTime() <= Date.now());

  res.json({
    category,
    tourMinutes: TOUR_MINUTES,
    passActive,
    tourActive,
    tourEndsAt: tourActive && tour ? tour.endsAt.toISOString() : null,
    tourUsed,
    canStartTour: !passActive && !tour,
  });
});

// POST /tickets/tour/start — grant the viewer's one-time 10-minute preview
// tour of a den. Refuses when they already hold an active pass (none needed)
// or when the tour has already been granted (it is one per user per den —
// after it ends, an active pass is the only way back in).
router.post("/tickets/tour/start", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { category } = (req.body ?? {}) as { category?: string };
  if (!TICKET_CATEGORIES.includes(category as TicketCategory)) {
    res.status(400).json({ error: "A category is required" });
    return;
  }

  const [pass] = await db
    .select()
    .from(nexetTicketsTable)
    .where(
      and(
        eq(nexetTicketsTable.userId, userId),
        eq(nexetTicketsTable.category, category as string),
        gt(nexetTicketsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(nexetTicketsTable.expiresAt)
    .limit(1);
  if (pass) {
    res.status(400).json({ error: "You already have an active pass — no tour needed." });
    return;
  }

  const [existing] = await db
    .select()
    .from(nexetToursTable)
    .where(
      and(eq(nexetToursTable.userId, userId), eq(nexetToursTable.category, category as string)),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({
      error:
        existing.endsAt.getTime() > Date.now()
          ? "Your preview tour is already running."
          : "Your 10-minute tour has already been used — buy a pass to come back.",
    });
    return;
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + TOUR_MS);
  const [tour] = await db
    .insert(nexetToursTable)
    .values({
      id: randomUUID(),
      userId,
      category: category as string,
      startedAt,
      endsAt,
    })
    .returning();

  res.status(201).json({
    tour: {
      category: tour.category,
      tourMinutes: TOUR_MINUTES,
      startedAt: tour.startedAt.toISOString(),
      endsAt: tour.endsAt.toISOString(),
    },
  });
});

// GET /tickets/status — the pass price/duration and the viewer's active
// passes, so the category pages can show the ticket gate (or unlock).
router.get("/tickets/status", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rows = await db
    .select()
    .from(nexetTicketsTable)
    .where(and(eq(nexetTicketsTable.userId, userId), gt(nexetTicketsTable.expiresAt, new Date())))
    .orderBy(nexetTicketsTable.purchasedAt);

  // One pass per category — the most recent purchase wins (a renewal extends
  // the same pass, so the latest row carries the furthest expiry).
  const latestByCategory = new Map<string, (typeof rows)[number]>();
  for (const ticket of rows) {
    latestByCategory.set(ticket.category, ticket);
  }

  res.json(
    GetTicketStatusResponse.parse({
      priceUsd: PASS_PRICE_USD,
      months: PASS_MONTHS,
      tickets: [...latestByCategory.values()].map((ticket) => ({
        category: ticket.category,
        expiresAt: ticket.expiresAt.toISOString(),
      })),
    }),
  );
});

// POST /tickets/promo/validate — live promo-code check for the checkout form:
// returns the discount + what the pass would cost with it applied.
router.post("/tickets/promo/validate", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = ValidateTicketPromoBody.safeParse(req.body);
  if (!body.success || !body.data.code.trim()) {
    res.status(400).json({ error: "A promo code is required" });
    return;
  }

  const promo = await resolvePromo(body.data.code, PASS_PRICE_USD, userId);
  if (!promo) {
    res.json(
      ValidateTicketPromoResponse.parse({
        valid: false,
        code: body.data.code.trim().toUpperCase(),
      }),
    );
    return;
  }

  res.json(
    ValidateTicketPromoResponse.parse({
      valid: true,
      code: promo.code,
      kind: promo.kind,
      label: promo.label,
      discountedPriceUsd: Math.max(0, PASS_PRICE_USD - promo.discount),
    }),
  );
});

// POST /tickets/purchase — dev/test simulated card checkout for a category
// pass. The card is validated in-house (Luhn + expiry + cvc), only the last-4
// is kept, and the ticket is granted immediately. This is NOT a payment rail:
// real purchases run through Whop hosted checkout (/whop/checkout →
// webhook/verify), which never collects card details. Disabled in production.
router.post("/tickets/purchase", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Simulated no-charge checkout — only for local dev and tests. All real
  // payments run through Whop, so never allow free grants in production.
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Payments are processed through Whop; this simulated checkout is disabled in production." });
    return;
  }

  const body = PurchaseTicketBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A category and card details are required" });
    return;
  }

  const { category, card } = body.data;
  if (!TICKET_CATEGORIES.includes(category as TicketCategory)) {
    res.status(400).json({ error: `Unknown category: ${category}` });
    return;
  }

  // Card validation — reject before anything is stored.
  if (!luhnValid(card.number)) {
    res.status(400).json({ error: "That card number is not valid" });
    return;
  }
  if (!expiryValid(card.expiryMonth, card.expiryYear)) {
    res.status(400).json({ error: "That card has expired" });
    return;
  }
  if (!/^\d{3,4}$/.test(String(card.cvc ?? ""))) {
    res.status(400).json({ error: "Enter the 3 or 4 digit security code" });
    return;
  }

  const promo = await resolvePromo(body.data.promoCode ?? undefined, PASS_PRICE_USD, userId);
  if ((body.data.promoCode ?? "").trim() && !promo) {
    res.status(400).json({ error: "That promo code is not valid" });
    return;
  }

  const total = Math.max(0, PASS_PRICE_USD - (promo?.discount ?? 0));
  const cardLast4 = card.number.replace(/\s+/g, "").slice(-4);

  // Grant the pass + record the subscription via the single shared grant path
  // (renewing stacks onto the live pass; promo uses bump here, once).
  const applied = await applySubscriptionPurchase({
    userId,
    kind: "pass",
    planId: category,
    planLabel: category === "authors" ? "Author & Writer pass" : "Content Creators pass",
    priceUsd: total,
    intervalLabel: "1 month",
    promoCode: promo?.code ?? null,
    cardLast4,
    source: "checkout",
  });

  res.status(201).json(
    PurchaseTicketResponse.parse({
      ticket: {
        category,
        expiresAt: applied.periodEnd.toISOString(),
        priceUsd: total,
        promoCode: promo?.code ?? null,
        cardLast4,
      },
      receipt: {
        subtotal: PASS_PRICE_USD,
        discount: promo?.discount ?? 0,
        total,
        cardLast4,
        promoCode: promo?.code ?? null,
      },
    }),
  );
});

export default router;
