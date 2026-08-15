import { getAuth } from "@clerk/express";
import { db, waitlistTable } from "@workspace/db";
import {
  CreateWaitlistEntryBody,
  CreateWaitlistEntryResponse,
} from "@workspace/api-zod";
import { eq, and } from "drizzle-orm";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/waitlist", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const userId = auth.userId;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const entries = await db
    .select()
    .from(waitlistTable)
    .where(eq(waitlistTable.userId, userId));

  res.json(entries.map((entry) => CreateWaitlistEntryResponse.parse(entry)));
});

router.post("/waitlist", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const userId = auth.userId;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = CreateWaitlistEntryBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid waitlist request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select({ id: waitlistTable.id })
    .from(waitlistTable)
    .where(
      and(
        eq(waitlistTable.userId, userId),
        eq(waitlistTable.categorySlug, parsed.data.categorySlug),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Already on this waitlist" });
    return;
  }

  const [entry] = await db
    .insert(waitlistTable)
    .values({
      userId,
      email: parsed.data.email,
      categorySlug: parsed.data.categorySlug,
    })
    .returning();

  res.status(201).json(CreateWaitlistEntryResponse.parse(entry));
});

export default router;