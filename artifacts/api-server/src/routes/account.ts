import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { db, tandemAccountQuotasTable, tandemUserCvsTable } from "@workspace/db";
import {
  DeleteUserCvResponse,
  GetAccountQuotaResponse,
  GetUserCvResponse,
  PurchaseAccountQuotaBody,
  PurchaseAccountQuotaResponse,
  UploadUserCvResponse,
} from "@workspace/api-zod";
import {
  accountUsage,
  PROJECT_PLANS,
  STORAGE_PLANS,
  getOrCreateQuota,
} from "../video/quota";
import { uploadDir } from "../video/worker";

const router: IRouter = Router();

// CV files land in their own subdir of the upload dir, capped at 15 MB.
const cvUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(uploadDir(), "cvs");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// GET /account/quota — the account's storage + project limits and current
// usage, plus the buy-more plans so the profile bars can render them.
router.get("/account/quota", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const usage = await accountUsage(userId);
  res.json(
    GetAccountQuotaResponse.parse({
      ...usage,
      plans: {
        storage: STORAGE_PLANS.map(({ id, label, priceUsd, bytes }) => ({ id, label, priceUsd, bytes })),
        projects: PROJECT_PLANS.map(({ id, label, priceUsd, count }) => ({ id, label, priceUsd, count })),
      },
    }),
  );
});

// POST /account/quota/purchase — apply a buy-more plan to the account.
// Payment itself is not processed here yet: this is the server-side application
// of the chosen plan (the endpoint a Stripe Checkout confirmation/webhook will
// call once payments are wired), so the profile bar updates immediately.
router.post(
  "/account/quota/purchase",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const body = PurchaseAccountQuotaBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "A plan kind and plan id are required" });
      return;
    }

    const quota = await getOrCreateQuota(userId);
    let purchased: { kind: "storage" | "projects"; planId: string; label: string; priceUsd: number };
    if (body.data.kind === "storage") {
      const plan = STORAGE_PLANS.find((item) => item.id === body.data.planId);
      if (!plan) {
        res.status(400).json({ error: `Unknown storage plan: ${body.data.planId}` });
        return;
      }
      await db
        .update(tandemAccountQuotasTable)
        .set({ storageLimitBytes: quota.storageLimitBytes + plan.bytes })
        .where(eq(tandemAccountQuotasTable.userId, userId));
      purchased = { kind: "storage", planId: plan.id, label: plan.label, priceUsd: plan.priceUsd };
    } else {
      const plan = PROJECT_PLANS.find((item) => item.id === body.data.planId);
      if (!plan) {
        res.status(400).json({ error: `Unknown project plan: ${body.data.planId}` });
        return;
      }
      await db
        .update(tandemAccountQuotasTable)
        .set({ projectLimit: quota.projectLimit + plan.count })
        .where(eq(tandemAccountQuotasTable.userId, userId));
      purchased = { kind: "projects", planId: plan.id, label: plan.label, priceUsd: plan.priceUsd };
    }

    const usage = await accountUsage(userId);
    res.json(
      PurchaseAccountQuotaResponse.parse({
        ...usage,
        purchased,
        plans: {
          storage: STORAGE_PLANS.map(({ id, label, priceUsd, bytes }) => ({ id, label, priceUsd, bytes })),
          projects: PROJECT_PLANS.map(({ id, label, priceUsd, count }) => ({ id, label, priceUsd, count })),
        },
      }),
    );
  },
);

// POST /users/:userId/cv — upload (or replace) the user's CV. Self only: the
// owner manages their own CV; everyone else can only read it.
router.post(
  "/users/:userId/cv",
  cvUpload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const targetUserId = String(req.params.userId);
    if (userId !== targetUserId) {
      res.status(403).json({ error: "You can only manage your own CV" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "A CV file is required" });
      return;
    }

    const [existing] = await db
      .select()
      .from(tandemUserCvsTable)
      .where(eq(tandemUserCvsTable.userId, targetUserId))
      .limit(1);

    if (existing) {
      // Replace: remove the previous blob from disk, then update the row.
      const oldPath = path.join(uploadDir(), "cvs", existing.storageKey);
      try {
        fs.unlinkSync(oldPath);
      } catch {
        // Missing blob — nothing to clean up.
      }
      const [row] = await db
        .update(tandemUserCvsTable)
        .set({
          fileName: req.file.originalname,
          mimeType: req.file.mimetype || "application/pdf",
          sizeBytes: req.file.size,
          storageKey: req.file.filename,
        })
        .where(eq(tandemUserCvsTable.userId, targetUserId))
        .returning();
      res.status(200).json(UploadUserCvResponse.parse(row));
      return;
    }

    const [row] = await db
      .insert(tandemUserCvsTable)
      .values({
        userId: targetUserId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype || "application/pdf",
        sizeBytes: req.file.size,
        storageKey: req.file.filename,
      })
      .returning();
    res.status(201).json(UploadUserCvResponse.parse(row));
  },
);

// GET /users/:userId/cv — CV metadata for a profile. Any signed-in user can
// see that a profile has a CV and open it.
router.get("/users/:userId/cv", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [cv] = await db
    .select()
    .from(tandemUserCvsTable)
    .where(eq(tandemUserCvsTable.userId, String(req.params.userId)))
    .limit(1);
  if (!cv) {
    res.status(404).json({ error: "No CV uploaded" });
    return;
  }
  res.json(GetUserCvResponse.parse(cv));
});

// GET /users/:userId/cv/file — stream the CV bytes so a profile visitor can
// view or download it.
router.get("/users/:userId/cv/file", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [cv] = await db
    .select()
    .from(tandemUserCvsTable)
    .where(eq(tandemUserCvsTable.userId, String(req.params.userId)))
    .limit(1);
  if (!cv) {
    res.status(404).json({ error: "No CV uploaded" });
    return;
  }
  const filePath = path.join(uploadDir(), "cvs", cv.storageKey);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "CV file missing on disk" });
    return;
  }
  res.setHeader("Content-Type", cv.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(cv.fileName)}"`,
  );
  fs.createReadStream(filePath).pipe(res);
});

// DELETE /users/:userId/cv — remove the CV. Self only.
router.delete("/users/:userId/cv", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const targetUserId = String(req.params.userId);
  if (userId !== targetUserId) {
    res.status(403).json({ error: "You can only manage your own CV" });
    return;
  }
  const [existing] = await db
    .select()
    .from(tandemUserCvsTable)
    .where(eq(tandemUserCvsTable.userId, targetUserId))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "No CV uploaded" });
    return;
  }
  const filePath = path.join(uploadDir(), "cvs", existing.storageKey);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Missing blob — the row still gets removed.
  }
  await db
    .delete(tandemUserCvsTable)
    .where(eq(tandemUserCvsTable.userId, targetUserId));
  res.json(DeleteUserCvResponse.parse({ deleted: true }));
});

export default router;
