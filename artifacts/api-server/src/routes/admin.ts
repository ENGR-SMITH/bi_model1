import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  AdminLoginBody,
  CheckAdminProviderParams,
  UpdateAdminProviderBody,
  UpdateAdminProviderParams,
} from "@workspace/api-zod";
import { checkProvider, listProviderStatuses, updateProvider, type ProviderId } from "../lib/oracle";

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

export default router;