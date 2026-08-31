import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  db,
  tandemAccountQuotasTable,
  tandemPromoCodesTable,
  tandemSubscriptionsTable,
  tandemTicketsTable,
} from "@workspace/db";
import { getOrCreateQuota, accountUsage } from "../video/quota";
import {
  storagePlanBytes,
  projectPlanCount,
  isPassCategory,
  listUserSubscriptions,
  subscriptionPlans,
  recordSubscription,
} from "../video/subscriptions";
import { luhnValid, expiryValid, resolvePromo, PASS_PRICE_USD, PASS_WEEKS, type TicketCategory } from "./tickets";

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

// Buried beneath the entitlement logic below — a small helper for the plan price.
function planPrice(kind: "pass" | "storage" | "projects", planId: string): number {
  return subscriptionPlans().find((plan) => plan.kind === kind && plan.planId === planId)?.priceUsd ?? 0;
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
// storage plan, or project plan) with a credit card. On success grants the
// entitlement (a ticket, extra storage, or extra projects) and records the
// subscription so the history page reflects it immediately.
router.post("/subscriptions/purchase", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = body.kind;
  const planId = typeof body.planId === "string" ? body.planId : "";
  const card = parseCard(body.card);
  const promoCode = typeof body.promoCode === "string" ? body.promoCode : undefined;

  if (kind !== "pass" && kind !== "storage" && kind !== "projects") {
    res.status(400).json({ error: "A subscription kind (pass, storage, or projects) is required" });
    return;
  }
  if (!planId) {
    res.status(400).json({ error: "A plan id is required" });
    return;
  }

  // Resolve the product + price.
  let priceUsd = 0;
  let planLabel = "";
  let intervalLabel = "";
  if (kind === "pass") {
    if (!isPassCategory(planId)) {
      res.status(400).json({ error: `Unknown category: ${planId}` });
      return;
    }
    priceUsd = PASS_PRICE_USD;
    planLabel = planId === "authors" ? "Author & Writer pass" : "Content Creators pass";
    intervalLabel = `${PASS_WEEKS} weeks`;
  } else if (kind === "storage") {
    if (storagePlanBytes(planId) <= 0) {
      res.status(400).json({ error: `Unknown storage plan: ${planId}` });
      return;
    }
    priceUsd = planPrice("storage", planId);
    planLabel = `${formatStorageBytes(storagePlanBytes(planId))} more space`;
    intervalLabel = "recurring";
  } else {
    if (projectPlanCount(planId) <= 0) {
      res.status(400).json({ error: `Unknown projects plan: ${planId}` });
      return;
    }
    priceUsd = planPrice("projects", planId);
    planLabel = `+${projectPlanCount(planId)} projects`;
    intervalLabel = "one-time";
  }

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
  const now = new Date();
  const cardLast4 = card!.number.replace(/\s+/g, "").slice(-4);

  // Apply the entitlement + its billing period.
  let periodStart = now;
  let periodEnd: Date;

  if (kind === "pass") {
    const category = planId as TicketCategory;
    const [existing] = await db
      .select()
      .from(tandemTicketsTable)
      .where(
        and(
          eq(tandemTicketsTable.userId, userId),
          eq(tandemTicketsTable.category, category),
          gt(tandemTicketsTable.expiresAt, now),
        ),
      )
      .orderBy(tandemTicketsTable.expiresAt)
      .limit(1);
    const base = existing && existing.expiresAt.getTime() > Date.now() ? existing.expiresAt : now;
    periodStart = base;
    periodEnd = new Date(base.getTime() + PASS_WEEKS * 7 * 24 * 60 * 60 * 1000);
    await db.insert(tandemTicketsTable).values({
      id: randomUUID(),
      userId,
      category,
      priceUsd: total,
      promoCode: promo?.code ?? null,
      cardLast4,
      expiresAt: periodEnd,
    });
  } else {
    const quota = await getOrCreateQuota(userId);
    periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    await db
      .update(tandemAccountQuotasTable)
      .set(
        kind === "storage"
          ? { storageLimitBytes: quota.storageLimitBytes + storagePlanBytes(planId) }
          : { projectLimit: quota.projectLimit + projectPlanCount(planId) },
      )
      .where(eq(tandemAccountQuotasTable.userId, userId));
  }

  if (promo) {
    await db
      .update(tandemPromoCodesTable)
      .set({ uses: sql`${tandemPromoCodesTable.uses} + 1` })
      .where(eq(tandemPromoCodesTable.code, promo.code));
  }

  await recordSubscription({
    userId,
    kind,
    planId,
    planLabel,
    priceUsd: total,
    intervalLabel,
    periodStart,
    periodEnd,
    source: "checkout",
    promoCode: promo?.code ?? null,
    cardLast4,
  });

  const subscriptions = await listUserSubscriptions(userId);
  res.status(201).json({
    subscription: subscriptions[0],
    receipt: {
      subtotal: priceUsd,
      discount: promo?.discount ?? 0,
      total,
      cardLast4,
      promoCode: promo?.code ?? null,
    },
  });
});

function formatStorageBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(0)} TB`;
  return `${(bytes / 1024 ** 3).toFixed(0)} GB`;
}

export default router;