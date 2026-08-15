import { getAuth } from "@clerk/express";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  collaborationActivityEventsTable,
  collaborationNotificationsTable,
  collaborationProjectsTable,
  collaborationSeedsTable,
  collaborationMessagesTable,
  collaborationStoryBibleEntriesTable,
  collaborationThreadsTable,
  collaborationWorkBlocksTable,
  continuationSubmissionsTable,
  db,
  seedApplicationsTable,
} from "@workspace/db";
import {
  ApproveCollaborationWorkBlockParams,
  CreateCollaborationSeedBody,
  CreateCollaborationStoryBibleEntryBody,
  CreateCollaborationStoryBibleEntryParams,
  CreateCollaborationWorkBlockBody,
  CreateCollaborationWorkBlockParams,
  CreateSeedApplicationBody,
  SaveCollaborationWorkBlockDraftBody,
  SaveCollaborationWorkBlockDraftParams,
  GetCollaborationThreadParams,
  GetCollaborationSeedParams,
  GetSeedApplicationParams,
  GetContinuationParams,
  GetContinuationAdvisoryParams,
  GetContinuationWriterProfileParams,
  GetContinuationThreadParams,
  GetCollaborationProjectParams,
  GetSeedSelectionParams,
  ListCollaborationActivityParams,
  ListCollaborationSeedsQueryParams,
  ListCollaborationStoryBibleParams,
  ListCollaborationWorkBlocksParams,
  SaveSeedApplicationDraftBody,
  SendCollaborationMessageBody,
  SendCollaborationMessageParams,
  StartContinuationThreadParams,
  SubmitCollaborationWorkBlockParams,
  SubmitSeedApplicationParams,
  UpdateCollaborationSeedBody,
  UpdateCollaborationSeedParams,
} from "@workspace/api-zod";
import { observeCollaboration } from "../lib/oracle";

const router: IRouter = Router();

type SafeRequest = Request & { log: { warn: (data: unknown, message: string) => void } };

function userId(req: Request, res: Response): string | null {
  const id = getAuth(req).userId;
  if (!id) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return id;
}

function value(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

type ActiveApplication = Pick<typeof seedApplicationsTable.$inferSelect, "id" | "status">;

function seedView(
  seed: typeof collaborationSeedsTable.$inferSelect,
  respondentCount: number,
  application?: ActiveApplication,
) {
  return {
    id: seed.id,
    creatorId: seed.creatorId,
    creatorName: "Author",
    sourceProjectTitle: seed.sourceProjectTitle,
    seedText: seed.seedText,
    unitType: seed.unitType,
    protocol: seed.protocol,
    genre: seed.genre,
    tone: seed.tone,
    language: seed.language,
    plotConstraints: seed.plotConstraints,
    desiredRole: seed.desiredRole,
    visibility: seed.visibility,
    respondentLimit: seed.respondentLimit,
    respondentCount,
    myApplicationId: application?.id ?? null,
    myApplicationStatus: application?.status ?? null,
    availability: seed.availability,
    publishedAt: seed.publishedAt.toISOString(),
    createdAt: seed.createdAt.toISOString(),
  };
}

async function seedCount(seedId: string): Promise<number> {
  const rows = await db
    .select({ id: seedApplicationsTable.id })
    .from(seedApplicationsTable)
    .where(and(eq(seedApplicationsTable.seedId, seedId), inArray(seedApplicationsTable.status, ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED_PENDING_CONTRACT"])));
  return rows.length;
}

async function notify(
  recipientId: string,
  category: string,
  title: string,
  body: string,
  deepLink: string,
  resourceId: string | null,
) {
  await db.insert(collaborationNotificationsTable).values({
    id: crypto.randomUUID(),
    recipientId,
    category,
    title,
    body,
    deepLink,
    resourceId,
  });
}

async function recordActivity(event: {
  eventType: string;
  summary: string;
  actorId: string;
  projectId?: string | null;
  seedId?: string | null;
  resourceId?: string | null;
}) {
  await db.insert(collaborationActivityEventsTable).values({
    id: crypto.randomUUID(),
    projectId: event.projectId ?? null,
    seedId: event.seedId ?? null,
    actorId: event.actorId,
    eventType: event.eventType,
    summary: event.summary,
    resourceId: event.resourceId ?? null,
  });
}

function roleFor(viewerId: string, project: { creatorId: string }): "CREATOR" | "RESPONDENT" | null {
  if (viewerId === project.creatorId) return "CREATOR";
  return "RESPONDENT";
}

function otherRole(role: "CREATOR" | "RESPONDENT"): "CREATOR" | "RESPONDENT" {
  return role === "CREATOR" ? "RESPONDENT" : "CREATOR";
}

function blockView(block: typeof collaborationWorkBlocksTable.$inferSelect) {
  return {
    ...block,
    parentBlockId: block.parentBlockId ?? null,
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
  };
}

async function getPermittedProject(projectId: string, viewerId: string, res: Response) {
  const [project] = await db.select().from(collaborationProjectsTable).where(eq(collaborationProjectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (project.creatorId !== viewerId && project.respondentId !== viewerId) {
    res.status(403).json({ error: "You are not a participant in this project" });
    return null;
  }
  return project;
}

function parseParam(raw: string | string[] | undefined): string {
  return Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
}

router.get("/collaborations/seeds", async (req, res): Promise<void> => {
  const parsedQuery = ListCollaborationSeedsQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  const filters = parsedQuery.data;
  const viewerId = getAuth(req).userId;
  const viewerApplications = viewerId
    ? await db
        .select({
          seedId: seedApplicationsTable.seedId,
          id: seedApplicationsTable.id,
          status: seedApplicationsTable.status,
        })
        .from(seedApplicationsTable)
        .where(eq(seedApplicationsTable.respondentId, viewerId))
    : [];
  const activeApplicationBySeed = new Map(
    viewerApplications
      .filter((application) =>
        ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED_PENDING_CONTRACT"].includes(application.status),
      )
      .map((application) => [application.seedId, application] as const),
  );
  const seeds = await db
    .select()
    .from(collaborationSeedsTable)
    .where(eq(collaborationSeedsTable.availability, filters.availability ?? "OPEN"))
    .orderBy(desc(collaborationSeedsTable.publishedAt));

  const response = await Promise.all(
    seeds
      .filter((seed) =>
        (!filters.genre || seed.genre === filters.genre)
        && (!filters.unit || seed.unitType === filters.unit)
        && (!filters.language || seed.language === filters.language)
        && (!filters.protocol || seed.protocol === filters.protocol),
      )
      .map(async (seed) => seedView(seed, await seedCount(seed.id), activeApplicationBySeed.get(seed.id))),
  );
  res.json(response);
});

router.post("/collaborations/seeds", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const parsed = CreateCollaborationSeedBody.safeParse(req.body);
  if (!parsed.success) {
    (req as SafeRequest).log.warn({ errors: parsed.error.message }, "Invalid collaboration seed");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [seed] = await db.insert(collaborationSeedsTable).values({
    id: crypto.randomUUID(),
    creatorId,
    ...parsed.data,
    availability: "OPEN",
  }).returning();
  await recordActivity({
    eventType: "seed_published",
    summary: `Published “${seed.sourceProjectTitle}” to the pitch board.`,
    actorId: creatorId,
    seedId: seed.id,
    resourceId: seed.id,
  });
  res.status(201).json(seedView(seed, 0));
});

router.get("/collaborations/seeds/:seedId", async (req, res): Promise<void> => {
  const params = GetCollaborationSeedParams.safeParse({ seedId: parseParam(req.params.seedId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [seed] = await db.select().from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, params.data.seedId));
  if (!seed) {
    res.status(404).json({ error: "Seed not found" });
    return;
  }
  const viewerId = getAuth(req).userId;
  const [viewerApplication] = viewerId
    ? await db
        .select({ id: seedApplicationsTable.id, status: seedApplicationsTable.status })
        .from(seedApplicationsTable)
        .where(and(
          eq(seedApplicationsTable.seedId, seed.id),
          eq(seedApplicationsTable.respondentId, viewerId),
          inArray(seedApplicationsTable.status, ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED_PENDING_CONTRACT"]),
        ))
    : [];
  res.json(seedView(seed, await seedCount(seed.id), viewerApplication));
});

router.patch("/collaborations/seeds/:seedId", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const params = UpdateCollaborationSeedParams.safeParse({ seedId: parseParam(req.params.seedId) });
  const parsed = UpdateCollaborationSeedBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, params.data.seedId));
  if (!existing) {
    res.status(404).json({ error: "Seed not found" });
    return;
  }
  if (existing.creatorId !== creatorId || existing.availability !== "OPEN") {
    res.status(403).json({ error: "Only an open seed owner can edit this seed" });
    return;
  }
  const [seed] = await db.update(collaborationSeedsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(collaborationSeedsTable.id, existing.id)).returning();
  res.json(seedView(seed, await seedCount(seed.id)));
});

router.delete("/collaborations/seeds/:seedId", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const seedId = parseParam(req.params.seedId);
  const [existing] = await db.select().from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, seedId));
  if (!existing) {
    res.status(404).json({ error: "Seed not found" });
    return;
  }
  if (existing.creatorId !== creatorId) {
    res.status(403).json({ error: "Only the seed owner can close it" });
    return;
  }
  await db.update(collaborationSeedsTable).set({ availability: "CLOSED", closedAt: new Date(), updatedAt: new Date() }).where(eq(collaborationSeedsTable.id, seedId));
  res.sendStatus(204);
});

router.post("/collaborations/seeds/:seedId/applications", async (req, res): Promise<void> => {
  const respondentId = userId(req, res);
  if (!respondentId) return;
  const parsed = CreateSeedApplicationBody.safeParse(req.body);
  const seedId = parseParam(req.params.seedId);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [seed] = await db.select().from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, seedId));
  if (!seed || seed.availability !== "OPEN") {
    res.status(409).json({ error: "This seed is no longer accepting continuations" });
    return;
  }
  if (seed.creatorId === respondentId) {
    res.status(403).json({ error: "You cannot apply to your own seed" });
    return;
  }
  const count = await seedCount(seedId);
  if (seed.respondentLimit > 0 && count >= seed.respondentLimit) {
    res.status(409).json({ error: "This seed has reached its respondent limit" });
    return;
  }
  const [existing] = await db.select().from(seedApplicationsTable).where(and(eq(seedApplicationsTable.seedId, seedId), eq(seedApplicationsTable.respondentId, respondentId)));
  if (existing && ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED_PENDING_CONTRACT"].includes(existing.status)) {
    res.status(409).json({ error: "You already have an unresolved application for this seed" });
    return;
  }
  const [application] = await db.insert(seedApplicationsTable).values({
    id: crypto.randomUUID(),
    seedId,
    respondentId,
    respondentName: parsed.data.respondentName,
    sourceProjectTitle: seed.sourceProjectTitle,
    sourceSeedText: seed.seedText,
  }).returning();
  res.status(201).json({
    ...application,
    submittedAt: value(application.submittedAt),
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  });
});

router.get("/collaborations/applications/:applicationId", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = GetSeedApplicationParams.safeParse({ applicationId: parseParam(req.params.applicationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [application] = await db.select().from(seedApplicationsTable).where(eq(seedApplicationsTable.id, params.data.applicationId));
  if (!application) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  const [seed] = await db.select({ creatorId: collaborationSeedsTable.creatorId }).from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, application.seedId));
  if (!seed || (seed.creatorId !== viewerId && application.respondentId !== viewerId)) {
    res.status(403).json({ error: "You cannot view this application" });
    return;
  }
  res.json({
    ...application,
    submittedAt: value(application.submittedAt),
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  });
});

router.patch("/collaborations/applications/:applicationId", async (req, res): Promise<void> => {
  const respondentId = userId(req, res);
  if (!respondentId) return;
  const params = GetSeedApplicationParams.safeParse({ applicationId: parseParam(req.params.applicationId) });
  const parsed = SaveSeedApplicationDraftBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [application] = await db.select().from(seedApplicationsTable).where(eq(seedApplicationsTable.id, params.data.applicationId));
  if (!application || application.respondentId !== respondentId) {
    res.status(403).json({ error: "Only the respondent can edit this application" });
    return;
  }
  if (application.status !== "DRAFT") {
    res.status(409).json({ error: "Submitted continuations are immutable" });
    return;
  }
  const [updated] = await db.update(seedApplicationsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(seedApplicationsTable.id, application.id)).returning();
  res.json({
    ...updated,
    submittedAt: value(updated.submittedAt),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.post("/collaborations/applications/:applicationId/advisory", async (req, res): Promise<void> => {
  const respondentId = userId(req, res);
  if (!respondentId) return;
  const params = GetSeedApplicationParams.safeParse({ applicationId: parseParam(req.params.applicationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [application] = await db.select().from(seedApplicationsTable).where(eq(seedApplicationsTable.id, params.data.applicationId));
  if (!application || application.respondentId !== respondentId) {
    res.status(403).json({ error: "Only the respondent can request a pre-submit advisory check" });
    return;
  }
  if (!application.draftText.trim()) {
    res.status(409).json({ error: "Write a draft before running an advisory check" });
    return;
  }
  res.json(await advisoryForMaterial({
    seedText: application.sourceSeedText,
    continuationText: application.draftText,
  }));
});

router.post("/collaborations/applications/:applicationId/submit", async (req, res): Promise<void> => {
  const respondentId = userId(req, res);
  if (!respondentId) return;
  const params = SubmitSeedApplicationParams.safeParse({ applicationId: parseParam(req.params.applicationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [application] = await db.select().from(seedApplicationsTable).where(eq(seedApplicationsTable.id, params.data.applicationId));
  if (!application || application.respondentId !== respondentId) {
    res.status(403).json({ error: "Only the respondent can submit this application" });
    return;
  }
  if (application.status !== "DRAFT" || application.draftText.trim().length < 1) {
    res.status(409).json({ error: "A non-empty draft can only be submitted once" });
    return;
  }
  const [seed] = await db.select().from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, application.seedId));
  if (!seed || seed.availability !== "OPEN") {
    res.status(409).json({ error: "This seed is no longer accepting continuations" });
    return;
  }
  const [updated] = await db.update(seedApplicationsTable).set({ status: "UNDER_REVIEW", submittedAt: new Date(), updatedAt: new Date() }).where(eq(seedApplicationsTable.id, application.id)).returning();
  const [submission] = await db.insert(continuationSubmissionsTable).values({
    id: crypto.randomUUID(),
    applicationId: application.id,
    seedId: seed.id,
    creatorId: seed.creatorId,
    respondentId: application.respondentId,
    respondentName: application.respondentName,
    sourceProjectTitle: seed.sourceProjectTitle,
    seedText: seed.seedText,
    continuationText: application.draftText,
    comments: application.draftComments,
  }).returning();
  await notify(seed.creatorId, "continuation_submitted", "A continuation is ready", "A writer submitted a continuation to your seed.", `/authors/collaborations/continuation/${submission.id}`, submission.id);
  await recordActivity({
    eventType: "continuation_submitted",
    summary: `${application.respondentName} submitted a continuation for “${seed.sourceProjectTitle}”.`,
    actorId: application.respondentId,
    seedId: seed.id,
    resourceId: submission.id,
  });
  res.json({
    ...submission,
    submittedAt: submission.submittedAt.toISOString(),
    createdAt: submission.createdAt.toISOString(),
  });
});

type SubmissionNotice = { id: string; readAt: Date | null } | undefined;

function submissionView(
  submission: typeof continuationSubmissionsTable.$inferSelect,
  notice?: SubmissionNotice,
) {
  return {
    ...submission,
    notificationId: notice?.id ?? null,
    read: notice ? Boolean(notice.readAt) : true,
    submittedAt: submission.submittedAt.toISOString(),
    createdAt: submission.createdAt.toISOString(),
  };
}

router.get("/collaborations/continuations", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const rows = await db.select().from(continuationSubmissionsTable).where(eq(continuationSubmissionsTable.creatorId, creatorId)).orderBy(desc(continuationSubmissionsTable.submittedAt));
  const notices = await db
    .select({ id: collaborationNotificationsTable.id, resourceId: collaborationNotificationsTable.resourceId, readAt: collaborationNotificationsTable.readAt })
    .from(collaborationNotificationsTable)
    .where(and(
      eq(collaborationNotificationsTable.recipientId, creatorId),
      eq(collaborationNotificationsTable.category, "continuation_submitted"),
    ));
  const noticeBySubmission = new Map(
    notices.filter((notice) => notice.resourceId).map((notice) => [notice.resourceId, notice] as const),
  );
  res.json(rows.map((submission) => submissionView(submission, noticeBySubmission.get(submission.id))));
});

router.get("/collaborations/continuations/:continuationId", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const params = GetContinuationParams.safeParse({ continuationId: parseParam(req.params.continuationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [submission] = await db.select().from(continuationSubmissionsTable).where(eq(continuationSubmissionsTable.id, params.data.continuationId));
  if (!submission) {
    res.status(404).json({ error: "Continuation not found" });
    return;
  }
  if (submission.creatorId !== creatorId && submission.respondentId !== creatorId) {
    res.status(403).json({ error: "You cannot view this continuation" });
    return;
  }
  const [notice] = submission.creatorId === creatorId
    ? await db
      .select({ id: collaborationNotificationsTable.id, readAt: collaborationNotificationsTable.readAt })
      .from(collaborationNotificationsTable)
      .where(and(
        eq(collaborationNotificationsTable.recipientId, creatorId),
        eq(collaborationNotificationsTable.resourceId, submission.id),
        eq(collaborationNotificationsTable.category, "continuation_submitted"),
      ))
    : [];
  if (notice && !notice.readAt) {
    await db.update(collaborationNotificationsTable)
      .set({ readAt: new Date() })
      .where(eq(collaborationNotificationsTable.id, notice.id));
  }
  res.json(submissionView(submission, notice ? { ...notice, readAt: notice.readAt ?? new Date() } : undefined));
});

async function getPermittedSubmission(
  continuationId: string,
  viewerId: string,
  res: Response,
) {
  const [submission] = await db
    .select()
    .from(continuationSubmissionsTable)
    .where(eq(continuationSubmissionsTable.id, continuationId));
  if (!submission) {
    res.status(404).json({ error: "Continuation not found" });
    return null;
  }
  if (submission.creatorId !== viewerId && submission.respondentId !== viewerId) {
    res.status(403).json({ error: "You cannot view this continuation" });
    return null;
  }
  return submission;
}

router.get("/collaborations/continuations/:continuationId/profile", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = GetContinuationWriterProfileParams.safeParse({ continuationId: parseParam(req.params.continuationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const submission = await getPermittedSubmission(params.data.continuationId, viewerId, res);
  if (!submission) return;
  const respondentSubmissions = await db
    .select({ status: continuationSubmissionsTable.status })
    .from(continuationSubmissionsTable)
    .where(eq(continuationSubmissionsTable.respondentId, submission.respondentId));
  const respondentProjects = await db
    .select({ status: collaborationProjectsTable.status })
    .from(collaborationProjectsTable)
    .where(eq(collaborationProjectsTable.respondentId, submission.respondentId));
  res.json({
    userId: submission.respondentId,
    displayName: submission.respondentName,
    bio: "",
    genres: [],
    tones: [],
    languages: [],
    submittedCount: respondentSubmissions.length,
    acceptedCount: respondentSubmissions.filter((item) => item.status === "ACCEPTED_PENDING_CONTRACT").length,
    completedCount: respondentProjects.filter((item) => item.status === "COMPLETED").length,
  });
});

function localAdvisorySignals(material: { seedText: string; continuationText: string }) {
  const continuationWordCount = material.continuationText.trim().split(/\s+/).filter(Boolean).length;
  const seedWordCount = material.seedText.trim().split(/\s+/).filter(Boolean).length;
  return [
    {
      category: "completeness",
      level: continuationWordCount > 0 ? "positive" : "attention",
      title: continuationWordCount > 0 ? "A complete response is present" : "The response is empty",
      detail: continuationWordCount > 0
        ? `${continuationWordCount.toLocaleString()} words are available for a human read.`
        : "There is no continuation text to compare yet.",
    },
    {
      category: "scope",
      level: continuationWordCount >= Math.max(20, Math.round(seedWordCount * 0.25)) ? "positive" : "neutral",
      title: "Response has room to develop",
      detail: "This is a lightweight scope observation, not a quality score or ranking.",
    },
    {
      category: "decision",
      level: "neutral",
      title: "Human choice required",
      detail: "Compatibility notes are advisory. Only the creator can select a collaborator.",
    },
  ];
}

async function advisoryForMaterial(material: { seedText: string; continuationText: string }) {
  try {
    const result = await observeCollaboration(material.seedText, material.continuationText, AbortSignal.timeout(14_000));
    if (!result.signals.length) {
      return {
        disclaimer: "Advisory observations only. They do not rank writers, alter prose, or make selection decisions.",
        signals: localAdvisorySignals(material),
        source: "local",
        available: false,
        note: "The Story Oracle found nothing supported to report. Local checks are shown instead.",
        providerId: null,
        modelId: null,
        generatedAt: new Date().toISOString(),
      };
    }
    return {
      disclaimer: "Story Oracle observations only. They do not rank writers, alter prose, or make selection decisions.",
      signals: result.signals,
      source: "oracle",
      available: true,
      note: null,
      providerId: result.providerId,
      modelId: result.modelId,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      disclaimer: "Advisory observations only. They do not rank writers, alter prose, or make selection decisions.",
      signals: localAdvisorySignals(material),
      source: "local",
      available: false,
      note: "The Story Oracle is not available right now. Local checks are shown instead.",
      providerId: null,
      modelId: null,
      generatedAt: new Date().toISOString(),
    };
  }
}

router.get("/collaborations/continuations/:continuationId/advisory", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = GetContinuationAdvisoryParams.safeParse({ continuationId: parseParam(req.params.continuationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const submission = await getPermittedSubmission(params.data.continuationId, viewerId, res);
  if (!submission) return;
  res.json(await advisoryForMaterial({ seedText: submission.seedText, continuationText: submission.continuationText }));
});

async function threadView(thread: typeof collaborationThreadsTable.$inferSelect) {
  const messages = await db
    .select()
    .from(collaborationMessagesTable)
    .where(eq(collaborationMessagesTable.threadId, thread.id))
    .orderBy(asc(collaborationMessagesTable.createdAt));
  return {
    id: thread.id,
    continuationId: thread.continuationId,
    creatorId: thread.creatorId,
    respondentId: thread.respondentId,
    messages: messages.map((message) => ({
      id: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    })),
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

async function getThreadForViewer(threadId: string, viewerId: string, res: Response) {
  const [thread] = await db.select().from(collaborationThreadsTable).where(eq(collaborationThreadsTable.id, threadId));
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return null;
  }
  if (thread.creatorId !== viewerId && thread.respondentId !== viewerId) {
    res.status(403).json({ error: "You are not a participant in this thread" });
    return null;
  }
  return thread;
}

router.get("/collaborations/continuations/:continuationId/thread", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = GetContinuationThreadParams.safeParse({ continuationId: parseParam(req.params.continuationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const submission = await getPermittedSubmission(params.data.continuationId, viewerId, res);
  if (!submission) return;
  const [thread] = await db.select().from(collaborationThreadsTable).where(eq(collaborationThreadsTable.continuationId, submission.id));
  if (!thread) {
    res.status(404).json({ error: "No message thread exists yet" });
    return;
  }
  res.json(await threadView(thread));
});

router.post("/collaborations/continuations/:continuationId/thread", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = StartContinuationThreadParams.safeParse({ continuationId: parseParam(req.params.continuationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const submission = await getPermittedSubmission(params.data.continuationId, viewerId, res);
  if (!submission) return;
  const [existing] = await db.select().from(collaborationThreadsTable).where(eq(collaborationThreadsTable.continuationId, submission.id));
  if (existing) {
    res.json(await threadView(existing));
    return;
  }
  const [thread] = await db.insert(collaborationThreadsTable).values({
    id: crypto.randomUUID(),
    continuationId: submission.id,
    creatorId: submission.creatorId,
    respondentId: submission.respondentId,
  }).returning();
  res.status(201).json(await threadView(thread));
});

router.get("/collaborations/threads/:threadId", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = GetCollaborationThreadParams.safeParse({ threadId: parseParam(req.params.threadId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const thread = await getThreadForViewer(params.data.threadId, viewerId, res);
  if (!thread) return;
  res.json(await threadView(thread));
});

router.post("/collaborations/threads/:threadId/messages", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = SendCollaborationMessageParams.safeParse({ threadId: parseParam(req.params.threadId) });
  const parsed = SendCollaborationMessageBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const thread = await getThreadForViewer(params.data.threadId, viewerId, res);
  if (!thread) return;
  const [message] = await db.insert(collaborationMessagesTable).values({
    id: crypto.randomUUID(),
    threadId: thread.id,
    senderId: viewerId,
    body: parsed.data.body,
  }).returning();
  await db.update(collaborationThreadsTable).set({ updatedAt: new Date() }).where(eq(collaborationThreadsTable.id, thread.id));
  const recipientId = thread.creatorId === viewerId ? thread.respondentId : thread.creatorId;
  await notify(recipientId, "collaboration_message", "A private message is waiting", "Your collaborator sent a private message about a continuation.", `/authors/collaborations/thread/${thread.id}`, thread.id);
  await recordActivity({
    eventType: "message_sent",
    summary: "A private message was exchanged in the collaboration thread.",
    actorId: viewerId,
    resourceId: thread.id,
  });
  res.status(201).json({
    id: message.id,
    threadId: message.threadId,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  });
});

router.get("/collaborations/seeds/:seedId/selection", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const params = GetSeedSelectionParams.safeParse({ seedId: parseParam(req.params.seedId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [seed] = await db
    .select({ creatorId: collaborationSeedsTable.creatorId })
    .from(collaborationSeedsTable)
    .where(eq(collaborationSeedsTable.id, params.data.seedId));
  if (!seed) {
    res.status(404).json({ error: "Seed not found" });
    return;
  }
  if (seed.creatorId !== creatorId) {
    res.status(403).json({ error: "Only the seed creator can open the selection room" });
    return;
  }
  const submissions = await db
    .select()
    .from(continuationSubmissionsTable)
    .where(eq(continuationSubmissionsTable.seedId, params.data.seedId))
    .orderBy(desc(continuationSubmissionsTable.submittedAt));
  res.json(submissions.map((submission) => submissionView(submission)));
});

router.delete("/collaborations/continuations/:continuationId", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const continuationId = parseParam(req.params.continuationId);
  const [submission] = await db.select().from(continuationSubmissionsTable).where(eq(continuationSubmissionsTable.id, continuationId));
  if (!submission || submission.creatorId !== creatorId) {
    res.status(403).json({ error: "Only the seed creator can decline this continuation" });
    return;
  }
  await db.update(continuationSubmissionsTable).set({ status: "ARCHIVED" }).where(eq(continuationSubmissionsTable.id, continuationId));
  await db.update(seedApplicationsTable).set({ status: "DECLINED", updatedAt: new Date() }).where(eq(seedApplicationsTable.id, submission.applicationId));
  await notify(submission.respondentId, "continuation_declined", "Continuation archived", "The creator has archived this continuation.", "/authors/collaborations/continuations", submission.id);
  await recordActivity({
    eventType: "continuation_declined",
    summary: `Archived a continuation by ${submission.respondentName} for “${submission.sourceProjectTitle}”.`,
    actorId: creatorId,
    seedId: submission.seedId,
    resourceId: submission.id,
  });
  res.sendStatus(204);
});

router.post("/collaborations/continuations/:continuationId/select", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const continuationId = parseParam(req.params.continuationId);
  const result = await db.transaction(async (tx) => {
    const [submission] = await tx.select().from(continuationSubmissionsTable).where(eq(continuationSubmissionsTable.id, continuationId));
    if (!submission || submission.creatorId !== creatorId || submission.status !== "UNDER_REVIEW") return null;
    const [seed] = await tx.select().from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, submission.seedId));
    if (!seed || seed.availability !== "OPEN") return null;
    const [project] = await tx.insert(collaborationProjectsTable).values({
      id: crypto.randomUUID(),
      seedId: seed.id,
      title: seed.sourceProjectTitle,
      creatorId,
      creatorName: "Author",
      respondentId: submission.respondentId,
      respondentName: submission.respondentName,
      seedText: submission.seedText,
      continuationText: submission.continuationText,
    }).returning();
    await tx.update(continuationSubmissionsTable).set({ status: "ACCEPTED_PENDING_CONTRACT" }).where(eq(continuationSubmissionsTable.id, continuationId));
    await tx.update(continuationSubmissionsTable).set({ status: "ARCHIVED" }).where(and(eq(continuationSubmissionsTable.seedId, seed.id), eq(continuationSubmissionsTable.status, "UNDER_REVIEW"), eq(continuationSubmissionsTable.creatorId, creatorId)));
    await tx.update(collaborationSeedsTable).set({ availability: "ACCEPTED", closedAt: new Date(), updatedAt: new Date() }).where(eq(collaborationSeedsTable.id, seed.id));
    return project;
  });
  if (!result) {
    res.status(409).json({ error: "This continuation is no longer available for selection" });
    return;
  }
  await notify(result.respondentId, "respondent_selected", "You were selected", "The creator selected your continuation. Review the contract before the shared project opens.", `/authors/tandem/${result.id}/contract`, result.id);
  await recordActivity({
    eventType: "respondent_selected",
    summary: `Selected ${result.respondentName} as the collaborator for “${result.title}”.`,
    actorId: creatorId,
    projectId: result.id,
    seedId: result.seedId,
    resourceId: result.id,
  });
  res.json({
    ...result,
    threadId: null,
    createdAt: result.createdAt.toISOString(),
    lockedAt: value(result.lockedAt),
  });
});

async function projectView(project: typeof collaborationProjectsTable.$inferSelect) {
  const [thread] = await db
    .select({ id: collaborationThreadsTable.id })
    .from(collaborationThreadsTable)
    .innerJoin(continuationSubmissionsTable, eq(collaborationThreadsTable.continuationId, continuationSubmissionsTable.id))
    .where(and(
      eq(continuationSubmissionsTable.seedId, project.seedId),
      eq(continuationSubmissionsTable.respondentId, project.respondentId),
    ))
    .limit(1);
  return {
    ...project,
    threadId: thread?.id ?? null,
    createdAt: project.createdAt.toISOString(),
    lockedAt: value(project.lockedAt),
  };
}

router.get("/collaborations/projects", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const rows = await db.select().from(collaborationProjectsTable).where(
    and(
      eq(collaborationProjectsTable.status, "CONTRACT_PENDING"),
      eq(collaborationProjectsTable.creatorId, viewerId),
    ),
  );
  const shared = await db.select().from(collaborationProjectsTable).where(
    eq(collaborationProjectsTable.respondentId, viewerId),
  );
  const own = await db.select().from(collaborationProjectsTable).where(
    eq(collaborationProjectsTable.creatorId, viewerId),
  );
  const uniqueRows = [...new Map([...rows, ...shared, ...own].map((row) => [row.id, row])).values()];
  res.json(await Promise.all(uniqueRows.map(projectView)));
});

router.get("/collaborations/projects/:projectId", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = GetCollaborationProjectParams.safeParse({ projectId: parseParam(req.params.projectId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db.select().from(collaborationProjectsTable).where(eq(collaborationProjectsTable.id, params.data.projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.creatorId !== viewerId && project.respondentId !== viewerId) {
    res.status(403).json({ error: "You are not a participant in this project" });
    return;
  }
  res.json(await projectView(project));
});

router.post("/collaborations/projects/:projectId/approve", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const projectId = parseParam(req.params.projectId);
  const [project] = await db.select().from(collaborationProjectsTable).where(eq(collaborationProjectsTable.id, projectId));
  if (!project || (project.creatorId !== viewerId && project.respondentId !== viewerId)) {
    res.status(403).json({ error: "You are not a participant in this project" });
    return;
  }
  if (project.status !== "CONTRACT_PENDING") {
    res.status(409).json({ error: "This contract is already locked" });
    return;
  }
  const patch = project.creatorId === viewerId ? { creatorApproved: true } : { respondentApproved: true };
  const nextCreatorApproved = project.creatorApproved || ("creatorApproved" in patch && patch.creatorApproved === true);
  const nextRespondentApproved = project.respondentApproved || ("respondentApproved" in patch && patch.respondentApproved === true);
  const [updated] = await db.update(collaborationProjectsTable).set({
    ...patch,
    status: nextCreatorApproved && nextRespondentApproved ? "ACTIVE" : "CONTRACT_PENDING",
    lockedAt: nextCreatorApproved && nextRespondentApproved ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(collaborationProjectsTable.id, projectId)).returning();
  if (updated.status === "ACTIVE") {
    const [existingSeedBlock] = await db
      .select({ id: collaborationWorkBlocksTable.id })
      .from(collaborationWorkBlocksTable)
      .where(eq(collaborationWorkBlocksTable.projectId, updated.id))
      .limit(1);
    if (!existingSeedBlock) {
      await db.insert(collaborationWorkBlocksTable).values([
        {
          id: crypto.randomUUID(),
          projectId: updated.id,
          ownerId: updated.creatorId,
          kind: "SEED",
          content: updated.seedText,
          status: "APPROVED",
          turnOrder: 0,
        },
        {
          id: crypto.randomUUID(),
          projectId: updated.id,
          ownerId: updated.respondentId,
          kind: "CONTINUATION",
          content: updated.continuationText,
          status: "APPROVED",
          turnOrder: 1,
        },
      ]);
    }
    await recordActivity({
      eventType: "contract_locked",
      summary: `The contract for “${updated.title}” was locked. The shared project is open.`,
      actorId: viewerId,
      projectId: updated.id,
      seedId: updated.seedId,
      resourceId: updated.id,
    });
    await notify(updated.creatorId, "contract_locked", "Contract locked", "Your shared project is ready for the first turn.", `/authors/tandem/${updated.id}`, updated.id);
    await notify(updated.respondentId, "contract_locked", "Contract locked", "Your shared project is ready for the first turn.", `/authors/tandem/${updated.id}`, updated.id);
  } else {
    await recordActivity({
      eventType: "contract_approved",
      summary: `${viewerId === updated.creatorId ? updated.creatorName : updated.respondentName} approved the contract for “${updated.title}”.`,
      actorId: viewerId,
      projectId: updated.id,
      seedId: updated.seedId,
      resourceId: updated.id,
    });
    await notify(updated.creatorId === viewerId ? updated.respondentId : updated.creatorId, "contract_action_required", "Contract approval requested", "Your collaborator is waiting for your approval.", `/authors/tandem/${updated.id}/contract`, updated.id);
  }
  res.json(await projectView(updated));
});

router.get("/collaborations/projects/:projectId/blocks", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = ListCollaborationWorkBlocksParams.safeParse({ projectId: parseParam(req.params.projectId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  const blocks = await db
    .select()
    .from(collaborationWorkBlocksTable)
    .where(eq(collaborationWorkBlocksTable.projectId, project.id))
    .orderBy(asc(collaborationWorkBlocksTable.turnOrder), asc(collaborationWorkBlocksTable.createdAt));
  res.json(blocks.map(blockView));
});

router.post("/collaborations/projects/:projectId/blocks", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = CreateCollaborationWorkBlockParams.safeParse({ projectId: parseParam(req.params.projectId) });
  const parsed = CreateCollaborationWorkBlockBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  if (project.status !== "ACTIVE") {
    res.status(409).json({ error: "The project contract must be locked before writing continues" });
    return;
  }
  const myRole = roleFor(viewerId, project);
  if (myRole !== project.currentTurn) {
    res.status(409).json({ error: "It is not your turn to write in this project" });
    return;
  }
  const [openDraft] = await db
    .select({ id: collaborationWorkBlocksTable.id })
    .from(collaborationWorkBlocksTable)
    .where(and(
      eq(collaborationWorkBlocksTable.projectId, project.id),
      eq(collaborationWorkBlocksTable.ownerId, viewerId),
      eq(collaborationWorkBlocksTable.status, "DRAFT"),
    ))
    .limit(1);
  if (openDraft) {
    res.status(409).json({ error: "You already have an open draft in this project" });
    return;
  }
  const [lastApproved] = await db
    .select({ id: collaborationWorkBlocksTable.id, turnOrder: collaborationWorkBlocksTable.turnOrder })
    .from(collaborationWorkBlocksTable)
    .where(and(
      eq(collaborationWorkBlocksTable.projectId, project.id),
      inArray(collaborationWorkBlocksTable.status, ["APPROVED", "LOCKED"]),
    ))
    .orderBy(desc(collaborationWorkBlocksTable.turnOrder))
    .limit(1);
  const [block] = await db.insert(collaborationWorkBlocksTable).values({
    id: crypto.randomUUID(),
    projectId: project.id,
    ownerId: viewerId,
    kind: parsed.data.kind ?? "FOLLOWUP",
    content: parsed.data.content,
    status: "DRAFT",
    parentBlockId: lastApproved?.id ?? null,
    turnOrder: (lastApproved?.turnOrder ?? 0) + 1,
  }).returning();
  res.status(201).json(blockView(block));
});

router.patch("/collaborations/projects/:projectId/blocks/:blockId", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = SaveCollaborationWorkBlockDraftParams.safeParse({
    projectId: parseParam(req.params.projectId),
    blockId: parseParam(req.params.blockId),
  });
  const parsed = SaveCollaborationWorkBlockDraftBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  const [block] = await db
    .select()
    .from(collaborationWorkBlocksTable)
    .where(eq(collaborationWorkBlocksTable.id, params.data.blockId));
  if (!block || block.projectId !== project.id) {
    res.status(404).json({ error: "Work block not found" });
    return;
  }
  if (block.ownerId !== viewerId) {
    res.status(403).json({ error: "Only the block owner can edit this draft" });
    return;
  }
  if (block.status !== "DRAFT") {
    res.status(409).json({ error: "Only an open draft can be edited" });
    return;
  }
  const [updated] = await db.update(collaborationWorkBlocksTable)
    .set({ content: parsed.data.content, updatedAt: new Date() })
    .where(eq(collaborationWorkBlocksTable.id, block.id))
    .returning();
  res.json(blockView(updated));
});

router.post("/collaborations/projects/:projectId/blocks/:blockId/submit", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = SubmitCollaborationWorkBlockParams.safeParse({
    projectId: parseParam(req.params.projectId),
    blockId: parseParam(req.params.blockId),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  if (project.status !== "ACTIVE") {
    res.status(409).json({ error: "The project contract must be locked before submitting work" });
    return;
  }
  const [block] = await db
    .select()
    .from(collaborationWorkBlocksTable)
    .where(eq(collaborationWorkBlocksTable.id, params.data.blockId));
  if (!block || block.projectId !== project.id) {
    res.status(404).json({ error: "Work block not found" });
    return;
  }
  if (block.ownerId !== viewerId) {
    res.status(403).json({ error: "Only the block owner can submit this draft" });
    return;
  }
  if (block.status !== "DRAFT") {
    res.status(409).json({ error: "Only an open draft can be submitted" });
    return;
  }
  if (roleFor(viewerId, project) !== project.currentTurn) {
    res.status(409).json({ error: "It is not your turn to submit in this project" });
    return;
  }
  const [updated] = await db.update(collaborationWorkBlocksTable)
    .set({ status: "SUBMITTED", updatedAt: new Date() })
    .where(eq(collaborationWorkBlocksTable.id, block.id))
    .returning();
  const nextTurn = otherRole(roleFor(viewerId, project) as "CREATOR" | "RESPONDENT");
  await db.update(collaborationProjectsTable)
    .set({ currentTurn: nextTurn, updatedAt: new Date() })
    .where(eq(collaborationProjectsTable.id, project.id));
  const reviewerId = project.creatorId === viewerId ? project.respondentId : project.creatorId;
  await notify(reviewerId, "your_turn", "A new pass awaits your review", "Your collaborator submitted a new block. Approve it to continue.", `/authors/tandem/${project.id}`, block.id);
  await recordActivity({
    eventType: "block_submitted",
    summary: `${viewerId === project.creatorId ? project.creatorName : project.respondentName} submitted a new block.`,
    actorId: viewerId,
    projectId: project.id,
    seedId: project.seedId,
    resourceId: block.id,
  });
  res.json(blockView(updated));
});

router.post("/collaborations/projects/:projectId/blocks/:blockId/approve", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = ApproveCollaborationWorkBlockParams.safeParse({
    projectId: parseParam(req.params.projectId),
    blockId: parseParam(req.params.blockId),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  if (project.status !== "ACTIVE") {
    res.status(409).json({ error: "The project contract must be locked before approving work" });
    return;
  }
  const [block] = await db
    .select()
    .from(collaborationWorkBlocksTable)
    .where(eq(collaborationWorkBlocksTable.id, params.data.blockId));
  if (!block || block.projectId !== project.id) {
    res.status(404).json({ error: "Work block not found" });
    return;
  }
  if (block.ownerId === viewerId) {
    res.status(403).json({ error: "You cannot approve your own block" });
    return;
  }
  if (block.status !== "SUBMITTED") {
    res.status(409).json({ error: "This block is not awaiting review" });
    return;
  }
  const [updated] = await db.update(collaborationWorkBlocksTable)
    .set({ status: "APPROVED", updatedAt: new Date() })
    .where(eq(collaborationWorkBlocksTable.id, block.id))
    .returning();
  await notify(block.ownerId, "block_approved", "Your pass was approved", "Your collaborator approved your block. It is your turn to continue.", `/authors/tandem/${project.id}`, block.id);
  await recordActivity({
    eventType: "block_approved",
    summary: `${viewerId === project.creatorId ? project.creatorName : project.respondentName} approved a submitted block.`,
    actorId: viewerId,
    projectId: project.id,
    seedId: project.seedId,
    resourceId: block.id,
  });
  res.json(blockView(updated));
});

router.get("/collaborations/projects/:projectId/story-bible", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = ListCollaborationStoryBibleParams.safeParse({ projectId: parseParam(req.params.projectId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  const entries = await db
    .select()
    .from(collaborationStoryBibleEntriesTable)
    .where(and(
      eq(collaborationStoryBibleEntriesTable.projectId, project.id),
      eq(collaborationStoryBibleEntriesTable.shared, true),
    ))
    .orderBy(desc(collaborationStoryBibleEntriesTable.createdAt));
  const own = await db
    .select()
    .from(collaborationStoryBibleEntriesTable)
    .where(and(
      eq(collaborationStoryBibleEntriesTable.projectId, project.id),
      eq(collaborationStoryBibleEntriesTable.ownerId, viewerId),
      eq(collaborationStoryBibleEntriesTable.shared, false),
    ))
    .orderBy(desc(collaborationStoryBibleEntriesTable.createdAt));
  const rows = [...entries, ...own].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(rows.map((entry) => ({
    ...entry,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  })));
});

router.post("/collaborations/projects/:projectId/story-bible", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = CreateCollaborationStoryBibleEntryParams.safeParse({ projectId: parseParam(req.params.projectId) });
  const parsed = CreateCollaborationStoryBibleEntryBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  const [entry] = await db.insert(collaborationStoryBibleEntriesTable).values({
    id: crypto.randomUUID(),
    projectId: project.id,
    kind: parsed.data.kind,
    name: parsed.data.name,
    content: parsed.data.content,
    ownerId: viewerId,
    shared: parsed.data.shared ?? false,
  }).returning();
  if (parsed.data.shared) {
    await recordActivity({
      eventType: "story_bible_updated",
      summary: `${viewerId === project.creatorId ? project.creatorName : project.respondentName} shared a story bible note: “${parsed.data.name}”.`,
      actorId: viewerId,
      projectId: project.id,
      seedId: project.seedId,
      resourceId: entry.id,
    });
  }
  res.status(201).json({
    ...entry,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  });
});

router.get("/collaborations/projects/:projectId/activity", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = ListCollaborationActivityParams.safeParse({ projectId: parseParam(req.params.projectId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  const events = await db
    .select()
    .from(collaborationActivityEventsTable)
    .where(eq(collaborationActivityEventsTable.projectId, project.id))
    .orderBy(desc(collaborationActivityEventsTable.createdAt));
  res.json(events.map((event) => ({
    ...event,
    projectId: event.projectId ?? null,
    seedId: event.seedId ?? null,
    resourceId: event.resourceId ?? null,
    createdAt: event.createdAt.toISOString(),
  })));
});

router.get("/collaborations/inbox", async (req, res): Promise<void> => {
  const recipientId = userId(req, res);
  if (!recipientId) return;
  const rows = await db.select().from(collaborationNotificationsTable).where(eq(collaborationNotificationsTable.recipientId, recipientId)).orderBy(desc(collaborationNotificationsTable.createdAt));
  res.json(rows.map((row) => ({
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    deepLink: row.deepLink,
    resourceId: row.resourceId,
    read: Boolean(row.readAt),
    createdAt: row.createdAt.toISOString(),
  })));
});

router.post("/collaborations/notifications/:notificationId/read", async (req, res): Promise<void> => {
  const recipientId = userId(req, res);
  if (!recipientId) return;
  const notificationId = parseParam(req.params.notificationId);
  await db.update(collaborationNotificationsTable).set({ readAt: new Date() }).where(and(eq(collaborationNotificationsTable.id, notificationId), eq(collaborationNotificationsTable.recipientId, recipientId)));
  res.sendStatus(204);
});

export default router;