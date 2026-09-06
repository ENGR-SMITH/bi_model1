import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { accountUsage } from "../video/quota";
import {
  applySubscriptionPurchase,
  listUserSubscriptions,
  resolveSubscriptionProduct,
  subscriptionPlans,
  unknownProductMessage,
  type SubscriptionKind,
} from "../video/subscriptions";
import { luhnValid, expiryValid, resolvePromo } from "./tickets";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Subscriptions — a consolidated checkout + history for every purchase across
// TANDEM (category passes), the Creator Den (storage) and the Author Den
// (projects). The Subscriptions page on TANDEM and the buy-more modals in both
// dens all speak to these endpoints.
// ---------------------------------------------------------------------------

interface CardInput {
  number: string;
  expiryMonth: number;
  expiryYear: number;
  cvc: string;
}

function parseCard(card: unknown): CardInput | null {
  if (!card || typeof card !== "object") return null;
  const c = card as Record<string, unknown>;
  if (typeof c.number !== "string") return null;
  if (typeof c.expiryMonth !== "number" || typeof c.expiryYear !== "number") return null;
  if (typeof c.cvc !== "string") return null;
  return { number: c.number, expiryMonth: c.expiryMonth, expiryYear: c.expiryYear, cvc: c.cvc };
}

// GET /subscriptions/plans — the full catalog (passes, storage, projects) plus
// the viewer's live entitlements so the payments page can show what is active.
router.get("/subscriptions/plans", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [subscriptions, config] = await Promise.all([
    listUserSubscriptions(userId),
    accountUsage(userId),
  ]);

  res.json({
    plans: subscriptionPlans(),
    current: subscriptions,
    usage: {
      storage: config.storageBytes,
      projects: config.projects,
    },
  });
});

// GET /subscriptions — every subscription the user has made (type, plan,
// status, expiry, source), newest first. This is what the Subscriptions page
// renders as the account's full history.
router.get("/subscriptions", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.json(await listUserSubscriptions(userId));
});

// POST /subscriptions/purchase — subscribe to any product (category pass,
// storage plan, or project plan). This is the card-checkout path used while
// no payment provider is connected: the card is validated in-house (Luhn +
// expiry + cvc), only the last-4 is kept, and the entitlement is granted
// immediately. When Paystack is wired to the buy buttons this endpoint is
// superseded by the /paystack/checkout → webhook/verify flow, which grants
// through the same applySubscriptionPurchase helper.
router.post("/subscriptions/purchase", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawKind = body.kind;
  const planId = typeof body.planId === "string" ? body.planId : "";
  const card = parseCard(body.card);
  const promoCode = typeof body.promoCode === "string" ? body.promoCode : undefined;

  if (rawKind !== "pass" && rawKind !== "storage" && rawKind !== "projects") {
    res.status(400).json({ error: "A subscription kind (pass, storage, or projects) is required" });
    return;
  }
  if (!planId) {
    res.status(400).json({ error: "A plan id is required" });
    return;
  }
  const kind = rawKind as SubscriptionKind;

  // Resolve the product + price (shared with the Paystack checkout).
  const product = resolveSubscriptionProduct(kind, planId);
  if (!product) {
    res.status(400).json({ error: unknownProductMessage(kind, planId) });
    return;
  }
  const { priceUsd, planLabel, intervalLabel } = product;

  // Card validation before anything is stored.
  if (!card || !luhnValid(card.number)) {
    res.status(400).json({ error: "That card number is not valid" });
    return;
  }
  if (!card || !expiryValid(card.expiryMonth, card.expiryYear)) {
    res.status(400).json({ error: "That card has expired" });
    return;
  }
  if (!card || !/^\d{3,4}$/.test(String(card.cvc ?? ""))) {
    res.status(400).json({ error: "Enter the 3 or 4 digit security code" });
    return;
  }

  const promo = await resolvePromo(promoCode, priceUsd);
  if (promoCode?.trim() && !promo) {
    res.status(400).json({ error: "That promo code is not valid" });
    return;
  }
  const total = Math.max(0, priceUsd - (promo?.discount ?? 0));
  const cardLast4 = card!.number.replace(/\s+/g, "").slice(-4);

  // Grant the entitlement + record the subscription (single shared grant path).
  const applied = await applySubscriptionPurchase({
    userId,
    kind,
    planId,
    planLabel,
    priceUsd: total,
    intervalLabel,
    promoCode: promo?.code ?? null,
    cardLast4,
    source: "checkout",
  });

  const subscriptions = await listUserSubscriptions(userId);
  const subscription = subscriptions.find((sub) => sub.id === applied.subscriptionId) ?? subscriptions[0];
  res.status(201).json({
    subscription,
    receipt: {
      subtotal: priceUsd,
      discount: promo?.discount ?? 0,
      total,
      cardLast4,
      promoCode: promo?.code ?? null,
    },
  });
});

export default router;
