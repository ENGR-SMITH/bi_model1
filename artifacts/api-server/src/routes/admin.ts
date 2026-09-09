import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import { db, nexetPromoCodesTable, nexetSubscriptionPlanSettingsTable, nexetSubscriptionsTable } from "@workspace/db";
import {
  CheckAdminProviderParams,
  CreateAdminPromoBody,
  CreateAdminPromoResponse,
  DeleteAdminPromoResponse,
  ListAdminPlanSettingsResponse,
  ListAdminPromosResponse,
  ListAdminSubscriptionsResponse,
  UpdateAdminPlanSettingBody,
  UpdateAdminPlanSettingParams,
  UpdateAdminPlanSettingResponse,
  UpdateAdminPromoBody,
  UpdateAdminPromoResponse,
  UpdateAdminProviderBody,
  UpdateAdminProviderParams,
  UpdateAdminSubscriptionAutoRenewBody,
  UpdateAdminSubscriptionAutoRenewParams,
  UpdateAdminSubscriptionAutoRenewResponse,
} from "@workspace/api-zod";
import { checkProvider, listProviderStatuses, updateProvider, type ProviderId } from "../lib/oracle";
import { disableSubscription, enableSubscription, PaystackApiError } from "../lib/paystack";
import { resolveSubscriptionProduct, subscriptionPlans, type SubscriptionKind } from "../video/subscriptions";

const router: IRouter = Router();

// Dev-only fallback that (via lib/secrets) encrypts stored provider API keys.
const DEFAULT_SESSION_SECRET = "manuskript-development-key";

// The Oracle Admin signs in with a Clerk magic link (the email-link strategy:
// type your admin email, Clerk emails you a link, click it, you're in). No
// password to create, remember, or lose. The link flow lives entirely in
// Clerk, so there is no SMTP/email provider to configure; this server only
// needs to recognise the one email that may open the control room.
//
// Fail closed in production: the Oracle Admin panel manages provider
// credentials, subscriptions, and promo codes, so a missing ADMIN_EMAIL or a
// weak SESSION_SECRET must stop the server from booting rather than silently
// leaving the panel locked out or the keys weakly encrypted.
if (process.env.NODE_ENV === "production") {
  if (!process.env.ADMIN_EMAIL) {
    throw new Error(
      "ADMIN_EMAIL must be set in production — the Oracle Admin signs in via a Clerk magic link " +
        "sent to this address (e.g. ADMIN_EMAIL=you@yourdomain.com).",
    );
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === DEFAULT_SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET must be set to a strong, non-default value in production " +
        "— it encrypts the stored provider API keys.",
    );
  }
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error(
      "CLERK_SECRET_KEY must be set in production — the Oracle Admin authenticates through the " +
        "Clerk session, so Clerk must be configured for the API server.",
    );
  }
} else if (!process.env.ADMIN_EMAIL) {
  console.warn(
    "[oracle-admin] ADMIN_EMAIL is not set — the Oracle Admin login is disabled. " +
      "Set ADMIN_EMAIL to your email in .env to open the control room.",
  );
}

function isAdminEmail(email: string | null | undefined): boolean {
  const allowed = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  return allowed !== "" && Boolean(email) && email!.trim().toLowerCase() === allowed;
}

/**
 * Bound an outbound Clerk Backend API call so a stalled Clerk connection
 * cannot hang the admin surface forever (the admin page would otherwise sit
 * on its loading skeleton with no way to recover).
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Clerk backend request timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Resolve the Clerk-authenticated user's email, or null when not signed in.
 * A failed/unreachable Clerk Backend API rejects (fail closed) rather than
 * silently reporting "not an admin" — the frontend then shows the session
 * check as failed with a retry instead of an endless loading state.
 */
async function clerkUserEmail(req: Request): Promise<string | null> {
  const { userId } = getAuth(req) ?? {};
  if (!userId) return null;
  const user = await withTimeout(clerkClient.users.getUser(userId), 5_000);
  return (
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses?.[0]?.emailAddress ??
    null
  );
}

/** True when the request carries a Clerk session for the ADMIN_EMAIL user. */
async function isAdminRequest(req: Request): Promise<boolean> {
  return isAdminEmail(await clerkUserEmail(req));
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await isAdminRequest(req))) {
    res.status(401).json({ error: "Admin session required" });
    return;
  }
  next();
}

router.get("/admin/session", async (req, res) => {
  res.json({ authenticated: await isAdminRequest(req) });
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

export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function promoView(promo: typeof nexetPromoCodesTable.$inferSelect) {
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
    .from(nexetPromoCodesTable)
    .orderBy(asc(nexetPromoCodesTable.createdAt));
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
  if (body.data.kind !== "FREE") {
    res.status(400).json({ error: "Only FREE promo codes are accepted — percent and dollar-off codes don't apply to monthly subscriptions." });
    return;
  }

  const [existing] = await db
    .select({ code: nexetPromoCodesTable.code })
    .from(nexetPromoCodesTable)
    .where(eq(nexetPromoCodesTable.code, code))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: `A promo code named ${code} already exists` });
    return;
  }

  const [promo] = await db
    .insert(nexetPromoCodesTable)
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

  const [existing] = await db
    .select()
    .from(nexetPromoCodesTable)
    .where(eq(nexetPromoCodesTable.code, code))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Promo code not found" });
    return;
  }
  // Only FREE codes are accepted at checkout. Legacy PERCENT/FLAT rows keep
  // their kind so they can still be paused/resumed; a FREE row cannot be
  // converted into a code the checkout would reject.
  if (body.data.kind !== "FREE" && existing.kind !== body.data.kind) {
    res.status(400).json({ error: "Only FREE promo codes are accepted — percent and dollar-off codes don't apply to monthly subscriptions." });
    return;
  }

  const [promo] = await db
    .update(nexetPromoCodesTable)
    .set({
      kind: body.data.kind,
      value: Math.max(0, body.data.value),
      maxUses: Math.max(0, body.data.maxUses),
      // An absent `active` leaves the code exactly as it is (pause/resume is
      // a separate admin action from editing a code's discount).
      ...(typeof body.data.active === "boolean" ? { active: body.data.active } : {}),
      expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
    })
    .where(eq(nexetPromoCodesTable.code, code))
    .returning();
  res.json(UpdateAdminPromoResponse.parse(promoView(promo)));
});

router.delete("/admin/promos/:code", requireAdmin, async (req, res): Promise<void> => {
  const code = normalizePromoCode(String(req.params.code ?? ""));
  const [existing] = await db
    .select({ code: nexetPromoCodesTable.code })
    .from(nexetPromoCodesTable)
    .where(eq(nexetPromoCodesTable.code, code))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Promo code not found" });
    return;
  }
  await db.delete(nexetPromoCodesTable).where(eq(nexetPromoCodesTable.code, code));
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
    .insert(nexetSubscriptionPlanSettingsTable)
    .values({ kind, planId, autoRenewAvailable: body.data.autoRenewAvailable })
    .onConflictDoUpdate({
      target: [nexetSubscriptionPlanSettingsTable.kind, nexetSubscriptionPlanSettingsTable.planId],
      set: { autoRenewAvailable: body.data.autoRenewAvailable, updatedAt: new Date() },
    });

  const plans = await subscriptionPlans();
  const updated = plans.find((plan) => plan.kind === kind && plan.planId === planId);
  res.json(UpdateAdminPlanSettingResponse.parse(updated));
});

// ---------------------------------------------------------------------------
// Subscriptions admin — every purchase across all users, newest first, with
// the buyer's email resolved from Clerk. The auto-renew toggle here is the
// per-account override: it switches the Paystack subscription on/off (so
// Paystack stops or resumes the monthly charges) and mirrors that on the row.
// Every Paystack subscription auto-renews by default; this is the only place
// (besides the per-plan setting) that can turn it off.
// ---------------------------------------------------------------------------

function adminSubscriptionView(row: typeof nexetSubscriptionsTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    planId: row.planId,
    planLabel: row.planLabel,
    priceUsd: row.priceUsd,
    status: row.status,
    intervalLabel: row.intervalLabel,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    source: row.source,
    promoCode: row.promoCode,
    cardLast4: row.cardLast4,
    autoRenew: row.autoRenew === true,
    renewalFailure: row.renewalFailure ?? null,
    active: row.status === "ACTIVE" && row.periodEnd.getTime() > Date.now(),
  };
}

/** Batch-resolve Clerk user emails; never fails the listing when Clerk is down. */
async function resolveUserEmails(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  try {
    const users = await withTimeout(
      clerkClient.users.getUserList({ userId: unique, limit: 100 }),
      5_000,
    );
    return new Map(
      users.data
        .map((user) => {
          const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? null;
          return [user.id, email] as const;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
  } catch {
    return new Map();
  }
}

router.get("/admin/subscriptions", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(nexetSubscriptionsTable)
    .orderBy(desc(nexetSubscriptionsTable.createdAt));
  const emails = await resolveUserEmails(rows.map((row) => row.userId));
  res.json(
    ListAdminSubscriptionsResponse.parse(
      rows.map((row) => ({ ...adminSubscriptionView(row), userEmail: emails.get(row.userId) ?? null })),
    ),
  );
});

router.patch("/admin/subscriptions/:id/auto-renew", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateAdminSubscriptionAutoRenewParams.safeParse(req.params);
  const body = UpdateAdminSubscriptionAutoRenewBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Subscription id and enabled are required" });
    return;
  }

  const [sub] = await db
    .select()
    .from(nexetSubscriptionsTable)
    .where(eq(nexetSubscriptionsTable.id, params.data.id))
    .limit(1);
  if (!sub) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  if (body.data.enabled && !sub.paystackSubscriptionCode) {
    res.status(400).json({
      error: "No Paystack subscription is linked to this row — automatic renewal cannot be turned on.",
    });
    return;
  }

  // Turning a Paystack-backed row off must stop Paystack from charging the
  // card first — otherwise the customer keeps getting billed. Turning it back
  // on resumes the same subscription.
  if (sub.paystackSubscriptionCode && sub.paystackEmailToken) {
    try {
      if (body.data.enabled) {
        await enableSubscription(sub.paystackSubscriptionCode, sub.paystackEmailToken);
      } else {
        await disableSubscription(sub.paystackSubscriptionCode, sub.paystackEmailToken);
      }
    } catch (cause) {
      res.status(502).json({
        error:
          cause instanceof PaystackApiError
            ? `Paystack could not ${body.data.enabled ? "resume" : "stop"} this subscription: ${cause.message}`
            : `Paystack could not ${body.data.enabled ? "resume" : "stop"} this subscription.`,
      });
      return;
    }
  }

  const [updated] = await db
    .update(nexetSubscriptionsTable)
    .set({
      autoRenew: body.data.enabled,
      renewalFailure: body.data.enabled ? null : sub.renewalFailure,
      updatedAt: new Date(),
    })
    .where(eq(nexetSubscriptionsTable.id, params.data.id))
    .returning();

  const emails = await resolveUserEmails([updated.userId]);
  res.json(
    UpdateAdminSubscriptionAutoRenewResponse.parse({
      ...adminSubscriptionView(updated),
      userEmail: emails.get(updated.userId) ?? null,
    }),
  );
});

export default router;