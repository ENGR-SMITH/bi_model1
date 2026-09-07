import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { asc, eq } from "drizzle-orm";
import { db, tandemPromoCodesTable, tandemSubscriptionPlanSettingsTable } from "@workspace/db";
import {
  AdminLoginBody,
  CheckAdminProviderParams,
  CreateAdminPromoBody,
  CreateAdminPromoResponse,
  DeleteAdminPromoResponse,
  ListAdminPlanSettingsResponse,
  ListAdminPromosResponse,
  UpdateAdminPlanSettingBody,
  UpdateAdminPlanSettingParams,
  UpdateAdminPlanSettingResponse,
  UpdateAdminPromoBody,
  UpdateAdminPromoResponse,
  UpdateAdminProviderBody,
  UpdateAdminProviderParams,
} from "@workspace/api-zod";
import { checkProvider, listProviderStatuses, updateProvider, type ProviderId } from "../lib/oracle";
import { resolveSubscriptionProduct, subscriptionPlans, type SubscriptionKind } from "../video/subscriptions";

const router: IRouter = Router();
const COOKIE_NAME = "oracle_admin_session";

// The default admin access code keeps the admin page usable out of the box;
// set ADMIN_ACCESS_CODE in .env to change it.
const adminAccessCode = (): string => process.env.ADMIN_ACCESS_CODE ?? "TANDEM_123";

function sessionValue(): string {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET ?? "manuskript-development-key")
    .update(adminAccessCode())
    .digest("base64url");
}

function isAuthenticated(req: Request): boolean {
  return req.cookies?.[COOKIE_NAME] === sessionValue();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: "Admin session required" });
    return;
  }
  next();
}

router.get("/admin/session", (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

router.post("/admin/login", (req, res): void => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success || parsed.data.accessCode !== adminAccessCode()) {
    res.status(401).json({ error: "Invalid admin access code" });
    return;
  }
  res.cookie(COOKIE_NAME, sessionValue(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 });
  res.json({ authenticated: true });
});

router.post("/admin/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.sendStatus(204);
});

router.get("/admin/providers", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await listProviderStatuses());
});

router.put("/admin/providers/:providerId", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateAdminProviderParams.safeParse(req.params);
  const body = UpdateAdminProviderBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid provider configuration" });
    return;
  }
  try {
    await updateProvider(params.data.providerId, body.data);
    const providers = await listProviderStatuses();
    const provider = providers.find((item) => item.id === params.data.providerId);
    res.json(provider);
  } catch (error) {
    req.log.warn({ err: error }, "Invalid provider update");
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid provider configuration" });
  }
});

router.post("/admin/providers/:providerId/check", requireAdmin, async (req, res): Promise<void> => {
  const params = CheckAdminProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid provider" });
    return;
  }
  await checkProvider(params.data.providerId as ProviderId);
  const providers = await listProviderStatuses();
  res.json(providers.find((item) => item.id === params.data.providerId));
});

// ---------------------------------------------------------------------------
// Ticket promo codes — the admin surface that replaces the seed script. Codes
// are managed here (create/update/delete); the checkout validates them live.
// ---------------------------------------------------------------------------

const PROMO_KINDS = ["FREE", "PERCENT", "FLAT"] as const;

export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function promoView(promo: typeof tandemPromoCodesTable.$inferSelect) {
  return {
    code: promo.code,
    kind: promo.kind,
    value: promo.value,
    maxUses: promo.maxUses,
    uses: promo.uses,
    // false = paused by an admin; the code stops validating immediately.
    active: promo.active,
    expiresAt: promo.expiresAt ? promo.expiresAt.toISOString() : null,
    createdAt: promo.createdAt.toISOString(),
  };
}

router.get("/admin/promos", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(tandemPromoCodesTable)
    .orderBy(asc(tandemPromoCodesTable.createdAt));
  res.json(ListAdminPromosResponse.parse(rows.map(promoView)));
});

router.post("/admin/promos", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateAdminPromoBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Code, kind, value, and max uses are required" });
    return;
  }
  const code = normalizePromoCode(body.data.code);
  if (!code) {
    res.status(400).json({ error: "A promo code is required" });
    return;
  }
  if (!PROMO_KINDS.includes(body.data.kind as (typeof PROMO_KINDS)[number])) {
    res.status(400).json({ error: `Kind must be one of: ${PROMO_KINDS.join(", ")}` });
    return;
  }

  const [existing] = await db
    .select({ code: tandemPromoCodesTable.code })
    .from(tandemPromoCodesTable)
    .where(eq(tandemPromoCodesTable.code, code))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: `A promo code named ${code} already exists` });
    return;
  }

  const [promo] = await db
    .insert(tandemPromoCodesTable)
    .values({
      code,
      kind: body.data.kind,
      value: Math.max(0, body.data.value),
      maxUses: Math.max(0, body.data.maxUses),
      uses: 0,
      expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
    })
    .returning();
  res.status(201).json(CreateAdminPromoResponse.parse(promoView(promo)));
});

router.patch("/admin/promos/:code", requireAdmin, async (req, res): Promise<void> => {
  const body = UpdateAdminPromoBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Kind, value, and max uses are required" });
    return;
  }
  const code = normalizePromoCode(String(req.params.code ?? ""));
  if (!code) {
    res.status(400).json({ error: "A promo code is required" });
    return;
  }
  if (!PROMO_KINDS.includes(body.data.kind as (typeof PROMO_KINDS)[number])) {
    res.status(400).json({ error: `Kind must be one of: ${PROMO_KINDS.join(", ")}` });
    return;
  }

  const [existing] = await db
    .select({ code: tandemPromoCodesTable.code })
    .from(tandemPromoCodesTable)
    .where(eq(tandemPromoCodesTable.code, code))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Promo code not found" });
    return;
  }

  const [promo] = await db
    .update(tandemPromoCodesTable)
    .set({
      kind: body.data.kind,
      value: Math.max(0, body.data.value),
      maxUses: Math.max(0, body.data.maxUses),
      // An absent `active` leaves the code exactly as it is (pause/resume is
      // a separate admin action from editing a code's discount).
      ...(typeof body.data.active === "boolean" ? { active: body.data.active } : {}),
      expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
    })
    .where(eq(tandemPromoCodesTable.code, code))
    .returning();
  res.json(UpdateAdminPromoResponse.parse(promoView(promo)));
});

router.delete("/admin/promos/:code", requireAdmin, async (req, res): Promise<void> => {
  const code = normalizePromoCode(String(req.params.code ?? ""));
  const [existing] = await db
    .select({ code: tandemPromoCodesTable.code })
    .from(tandemPromoCodesTable)
    .where(eq(tandemPromoCodesTable.code, code))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Promo code not found" });
    return;
  }
  await db.delete(tandemPromoCodesTable).where(eq(tandemPromoCodesTable.code, code));
  res.json(DeleteAdminPromoResponse.parse({ deleted: true }));
});

// ---------------------------------------------------------------------------
// Subscription plan settings — per-plan knobs on the code-defined catalog. An
// admin can turn server-managed auto-renewal on/off for a plan here; the plans
// endpoint (and the paystack checkout) read the same rows, so the storefront
// checkbox follows what is switched on in this room.
// ---------------------------------------------------------------------------

const PLAN_KINDS = ["pass", "storage", "projects"] as const;

router.get("/admin/plan-settings", requireAdmin, async (_req, res): Promise<void> => {
  const plans = await subscriptionPlans();
  res.json(ListAdminPlanSettingsResponse.parse(plans));
});

router.patch("/admin/plan-settings/:kind/:planId", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateAdminPlanSettingParams.safeParse(req.params);
  const body = UpdateAdminPlanSettingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Kind, plan id, and autoRenewAvailable are required" });
    return;
  }
  const kind = params.data.kind as SubscriptionKind;
  if (!PLAN_KINDS.includes(kind as (typeof PLAN_KINDS)[number])) {
    res.status(400).json({ error: `Kind must be one of: ${PLAN_KINDS.join(", ")}` });
    return;
  }
  const planId = params.data.planId;
  if (!resolveSubscriptionProduct(kind, planId)) {
    res.status(400).json({ error: `Unknown ${kind} plan: ${planId}` });
    return;
  }

  await db
    .insert(tandemSubscriptionPlanSettingsTable)
    .values({ kind, planId, autoRenewAvailable: body.data.autoRenewAvailable })
    .onConflictDoUpdate({
      target: [tandemSubscriptionPlanSettingsTable.kind, tandemSubscriptionPlanSettingsTable.planId],
      set: { autoRenewAvailable: body.data.autoRenewAvailable, updatedAt: new Date() },
    });

  const plans = await subscriptionPlans();
  const updated = plans.find((plan) => plan.kind === kind && plan.planId === planId);
  res.json(UpdateAdminPlanSettingResponse.parse(updated));
});

export default router;