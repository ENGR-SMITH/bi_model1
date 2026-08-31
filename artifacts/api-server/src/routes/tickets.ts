import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, tandemPromoCodesTable, tandemTicketsTable } from "@workspace/db";
import {
  GetTicketStatusResponse,
  PurchaseTicketBody,
  PurchaseTicketResponse,
  ValidateTicketPromoBody,
  ValidateTicketPromoResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// The category pass: $1.88 for 3 weeks, per category. One active pass opens
// the whole category (Author-Writer room / Content-Creators room).
export const PASS_PRICE_USD = 188; // $1.88 in cents
export const PASS_WEEKS = 3;
export const TICKET_CATEGORIES = ["authors", "content-creators"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

function luhnValid(number: string): boolean {
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
function expiryValid(month: number, year: number): boolean {
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

async function resolvePromo(raw: string | undefined, priceUsd: number): Promise<ResolvedPromo | null> {
  if (!raw || !raw.trim()) return null;
  const code = raw.trim().toUpperCase();
  const [promo] = await db
    .select()
    .from(tandemPromoCodesTable)
    .where(eq(tandemPromoCodesTable.code, code))
    .limit(1);
  if (!promo) return null;
  if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) return null;
  if (promo.maxUses > 0 && promo.uses >= promo.maxUses) return null;

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
    .from(tandemTicketsTable)
    .where(and(eq(tandemTicketsTable.userId, userId), gt(tandemTicketsTable.expiresAt, new Date())))
    .orderBy(tandemTicketsTable.purchasedAt);

  // One pass per category — the most recent purchase wins (a renewal extends
  // the same pass, so the latest row carries the furthest expiry).
  const latestByCategory = new Map<string, (typeof rows)[number]>();
  for (const ticket of rows) {
    latestByCategory.set(ticket.category, ticket);
  }

  res.json(
    GetTicketStatusResponse.parse({
      priceUsd: PASS_PRICE_USD,
      weeks: PASS_WEEKS,
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

  const promo = await resolvePromo(body.data.code, PASS_PRICE_USD);
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

// POST /tickets/purchase — buy a category pass with a credit card.
//
// Card handling today: the card is validated in-house (Luhn + expiry + cvc)
// and only the last-4 is kept, so the checkout works end-to-end without a
// payment provider. When Stripe keys are added, this becomes a Stripe Checkout
// session — the ticket grant below stays identical, just triggered by the
// checkout webhook instead of this request body.
router.post("/tickets/purchase", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
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

  const promo = await resolvePromo(body.data.promoCode ?? undefined, PASS_PRICE_USD);
  if ((body.data.promoCode ?? "").trim() && !promo) {
    res.status(400).json({ error: "That promo code is not valid" });
    return;
  }

  const total = Math.max(0, PASS_PRICE_USD - (promo?.discount ?? 0));

  // Extend from the current pass (if still active) so renewing stacks; a fresh
  // pass runs 3 weeks from today.
  const [existing] = await db
    .select()
    .from(tandemTicketsTable)
    .where(
      and(
        eq(tandemTicketsTable.userId, userId),
        eq(tandemTicketsTable.category, category),
        gt(tandemTicketsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(tandemTicketsTable.expiresAt)
    .limit(1);
  const base = existing && existing.expiresAt.getTime() > Date.now() ? existing.expiresAt : new Date();
  const expiresAt = new Date(base.getTime() + PASS_WEEKS * 7 * 24 * 60 * 60 * 1000);

  const [ticket] = await db
    .insert(tandemTicketsTable)
    .values({
      id: randomUUID(),
      userId,
      category,
      priceUsd: total,
      promoCode: promo?.code ?? null,
      cardLast4: card.number.replace(/\s+/g, "").slice(-4),
      expiresAt,
    })
    .returning();

  if (promo) {
    await db
      .update(tandemPromoCodesTable)
      .set({ uses: sql`${tandemPromoCodesTable.uses} + 1` })
      .where(eq(tandemPromoCodesTable.code, promo.code));
  }

  res.status(201).json(
    PurchaseTicketResponse.parse({
      ticket: {
        category: ticket.category,
        expiresAt: ticket.expiresAt.toISOString(),
        priceUsd: ticket.priceUsd,
        promoCode: ticket.promoCode,
        cardLast4: ticket.cardLast4,
      },
      receipt: {
        subtotal: PASS_PRICE_USD,
        discount: promo?.discount ?? 0,
        total,
        cardLast4: ticket.cardLast4,
        promoCode: promo?.code ?? null,
      },
    }),
  );
});

export default router;
