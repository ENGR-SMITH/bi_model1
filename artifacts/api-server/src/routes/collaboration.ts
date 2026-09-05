import fs from "node:fs";
import path from "node:path";
import { getAuth } from "@clerk/express";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { emitToUser } from "../realtime";
import {
  collaborationActivityEventsTable,
  collaborationGenealogyTable,
  collaborationNotificationsTable,
  collaborationProjectsTable,
  collaborationSeedsTable,
  collaborationMessagesTable,
  collaborationStoryBibleEntriesTable,
  collaborationThreadsTable,
  collaborationWorkBlocksTable,
  continuationAnnotationsTable,
  continuationSubmissionsTable,
  db,
  seedApplicationsTable,
} from "@workspace/db";
import {
  ApproveCollaborationWorkBlockParams,
  CreateContinuationAnnotationBody,
  CreateContinuationAnnotationParams,
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
  ListCollaborationGenealogyParams,
  ListContinuationAnnotationsParams,
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
  SendCollaborationVoiceNoteParams,
  SendCollaborationVoiceNoteResponse,
  GetCollaborationThreadAudioParams,
  ListExploreAuthorsResponse,
  StartContinuationThreadParams,
  SubmitCollaborationWorkBlockParams,
  SubmitSeedApplicationParams,
  UpdateCollaborationSeedBody,
  UpdateCollaborationSeedParams,
} from "@workspace/api-zod";
import { observeCollaboration } from "../lib/oracle";
import { resolveUserProfiles } from "../lib/user-names";
import { upload } from "../video/upload";
import { uploadDir } from "../video/worker";
import { getFollowCounts, resolveFollowState } from "./video-social";

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
    creatorName: seed.creatorName ?? "Author",
    sourceProjectId: seed.sourceProjectId,
    sourceProjectTitle: seed.sourceProjectTitle,
    sourceSceneId: seed.sourceSceneId ?? null,
    sourceVersion: seed.sourceVersion,
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
  const id = crypto.randomUUID();
  await db.insert(collaborationNotificationsTable).values({
    id,
    recipientId,
    category,
    title,
    body,
    deepLink,
    resourceId,
  });
  // Stream the notice to the recipient's personal socket room (`user:{id}`)
  // so open tabs — the Author Den bell and the Tandem inbox — update the
  // moment it is written, no polling needed. Shape matches the inbox REST
  // response (read is false until the recipient marks it). No-ops when the
  // socket server isn't running (isolated route tests).
  emitToUser(recipientId, "notification.new", {
    id,
    category,
    title,
    body,
    deepLink,
    resourceId,
    read: false,
    createdAt: new Date().toISOString(),
    // Tells clients this notice came from the Author Den feed.
    source: "authors",
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

// Immutable contribution genealogy: one row per contribution that entered the
// project (seed, accepted continuation, each approved pass). Idempotent per
// block so re-runs (e.g. approving after a retry) never duplicate rows.
async function recordGenealogy(entry: {
  projectId: string;
  blockId?: string | null;
  parentBlockId?: string | null;
  contributorId: string;
  contributorName: string;
  role: "CREATOR" | "RESPONDENT";
  kind: "SEED" | "CONTINUATION" | "BLOCK";
}) {
  const [existing] = entry.blockId
    ? await db
        .select({ id: collaborationGenealogyTable.id })
        .from(collaborationGenealogyTable)
        .where(eq(collaborationGenealogyTable.blockId, entry.blockId))
        .limit(1)
    : [];
  if (existing) return;
  await db.insert(collaborationGenealogyTable).values({
    id: crypto.randomUUID(),
    projectId: entry.projectId,
    blockId: entry.blockId ?? null,
    parentBlockId: entry.parentBlockId ?? null,
    contributorId: entry.contributorId,
    contributorName: entry.contributorName,
    role: entry.role,
    kind: entry.kind,
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
    creatorName: parsed.data.creatorName ?? "Author",
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

router.get("/collaborations/seeds/:seedId/project", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const seedId = parseParam(req.params.seedId);
  const [seed] = await db.select().from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, seedId));
  if (!seed) {
    res.status(404).json({ error: "Seed not found" });
    return;
  }
  const [application] = viewerId === seed.creatorId
    ? [null]
    : await db
        .select({ id: seedApplicationsTable.id })
        .from(seedApplicationsTable)
        .where(and(
          eq(seedApplicationsTable.seedId, seedId),
          eq(seedApplicationsTable.respondentId, viewerId),
          inArray(seedApplicationsTable.status, ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED_PENDING_CONTRACT"]),
        ))
        .limit(1);
  if (viewerId !== seed.creatorId && !application) {
    res.status(403).json({ error: "You can only fork a seed you are answering" });
    return;
  }
  if (!seed.projectDocument) {
    res.status(404).json({ error: "This seed has no project snapshot" });
    return;
  }
  res.json(seed.projectDocument);
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
    projectDocument: application.projectDocument ?? null,
  }).returning();
  await notify(seed.creatorId, "continuation_submitted", "A continuation is ready", "A writer submitted a continuation to your seed. Open it in Author Den to read the full project before you decide.", `/authors-den/?preview=${submission.id}`, submission.id);
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

router.get("/collaborations/continuations/:continuationId/project", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const continuationId = parseParam(req.params.continuationId);
  const [submission] = await db
    .select({ id: continuationSubmissionsTable.id, creatorId: continuationSubmissionsTable.creatorId, projectDocument: continuationSubmissionsTable.projectDocument })
    .from(continuationSubmissionsTable)
    .where(eq(continuationSubmissionsTable.id, continuationId));
  if (!submission || submission.creatorId !== creatorId) {
    res.status(403).json({ error: "Only the seed creator can preview this submission" });
    return;
  }
  if (!submission.projectDocument) {
    res.status(404).json({ error: "This submission has no project snapshot" });
    return;
  }
  res.json(submission.projectDocument);
});

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
  const [submission] = await db
    .select({
      seedId: continuationSubmissionsTable.seedId,
      creatorId: continuationSubmissionsTable.creatorId,
      respondentName: continuationSubmissionsTable.respondentName,
    })
    .from(continuationSubmissionsTable)
    .where(eq(continuationSubmissionsTable.id, thread.continuationId));
  let creatorName = "Author";
  if (submission) {
    const [seed] = await db
      .select({ creatorName: collaborationSeedsTable.creatorName })
      .from(collaborationSeedsTable)
      .where(eq(collaborationSeedsTable.id, submission.seedId));
    if (seed?.creatorName) creatorName = seed.creatorName;
  }
  // The private room belongs to the shared project (accepted fork); pre-accept
  // conversations live on the continuation alone.
  const [project] = submission
    ? await db
        .select({ id: collaborationProjectsTable.id })
        .from(collaborationProjectsTable)
        .where(and(
          eq(collaborationProjectsTable.seedId, submission.seedId),
          eq(collaborationProjectsTable.respondentId, thread.respondentId),
        ))
        .limit(1)
    : [];
  return {
    id: thread.id,
    continuationId: thread.continuationId,
    creatorId: thread.creatorId,
    respondentId: thread.respondentId,
    projectId: project?.id ?? null,
    creatorName,
    respondentName: submission?.respondentName ?? "Your collaborator",
    messages: messages.map((message) => ({
      id: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
      body: message.body,
      audioUrl: message.audioUrl ?? null,
      audioName: message.audioName ?? null,
      audioDurationMs: message.audioDurationMs ?? null,
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

router.get("/collaborations/continuations/:continuationId/annotations", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = ListContinuationAnnotationsParams.safeParse({ continuationId: parseParam(req.params.continuationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const submission = await getPermittedSubmission(params.data.continuationId, viewerId, res);
  if (!submission) return;
  const rows = await db
    .select()
    .from(continuationAnnotationsTable)
    .where(eq(continuationAnnotationsTable.continuationId, submission.id))
    .orderBy(asc(continuationAnnotationsTable.rangeStart), asc(continuationAnnotationsTable.createdAt));
  res.json(rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  })));
});

router.post("/collaborations/continuations/:continuationId/annotations", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = CreateContinuationAnnotationParams.safeParse({ continuationId: parseParam(req.params.continuationId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateContinuationAnnotationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const submission = await getPermittedSubmission(params.data.continuationId, viewerId, res);
  if (!submission) return;
  const { rangeStart, rangeEnd, body } = parsed.data;
  if (rangeEnd <= rangeStart) {
    res.status(400).json({ error: "The annotation range must end after it starts" });
    return;
  }
  if (rangeEnd > submission.continuationText.length) {
    res.status(400).json({ error: "The annotation range exceeds the submitted continuation" });
    return;
  }
  const [annotation] = await db.insert(continuationAnnotationsTable).values({
    id: crypto.randomUUID(),
    continuationId: submission.id,
    authorId: viewerId,
    rangeStart,
    rangeEnd,
    body,
  }).returning();
  await recordActivity({
    eventType: "continuation_annotated",
    summary: `${viewerId === submission.creatorId ? "The creator" : "A writer"} annotated a submitted continuation.`,
    actorId: viewerId,
    seedId: submission.seedId,
    resourceId: submission.id,
  });
  res.status(201).json({
    ...annotation,
    createdAt: annotation.createdAt.toISOString(),
  });
});

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
  // Once the fork is accepted, the private room lives in the shared project in
  // Author Den — the notification deep-links there with the chat open.
  const [projectRow] = await db
    .select({ id: collaborationProjectsTable.id })
    .from(collaborationProjectsTable)
    .innerJoin(continuationSubmissionsTable, and(
      eq(collaborationProjectsTable.seedId, continuationSubmissionsTable.seedId),
      eq(collaborationProjectsTable.respondentId, thread.respondentId),
    ))
    .where(eq(continuationSubmissionsTable.id, thread.continuationId))
    .limit(1);
  const messageLink = projectRow
    ? `/authors-den/?project=${projectRow.id}&chat=1`
    : `/authors/collaborations/thread/${thread.id}`;
  await notify(recipientId, "collaboration_message", "A private message is waiting", "Your collaborator sent a private message — open it in the shared project.", messageLink, thread.id);
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
    audioUrl: message.audioUrl ?? null,
    audioName: message.audioName ?? null,
    audioDurationMs: message.audioDurationMs ?? null,
    createdAt: message.createdAt.toISOString(),
  });
});

// POST /collaborations/threads/:threadId/voice — send a voice note to the
// private collaboration thread. Multipart: the recorded audio blob lands on
// disk (same upload dir as the Creator Den) and the message carries the served
// URL + duration, mirroring the crew-room voice notes. The body is empty for
// voice notes — the audio IS the message.
router.post(
  "/collaborations/threads/:threadId/voice",
  upload.single("audio"),
  async (req: Request, res: Response): Promise<void> => {
    const viewerId = userId(req, res);
    if (!viewerId) return;

    const params = SendCollaborationVoiceNoteParams.safeParse({
      threadId: parseParam(req.params.threadId),
    });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread id" });
      return;
    }

    const thread = await getThreadForViewer(params.data.threadId, viewerId, res);
    if (!thread) return;

    if (!req.file) {
      res.status(400).json({ error: "A recorded voice note is required" });
      return;
    }

    const durationMs = Number(req.body.durationMs);
    const audioUrl = `/api/collaborations/threads/${thread.id}/audio/${req.file.filename}`;
    const [message] = await db
      .insert(collaborationMessagesTable)
      .values({
        id: crypto.randomUUID(),
        threadId: thread.id,
        senderId: viewerId,
        body: "",
        audioUrl,
        audioName:
          typeof req.body.name === "string" && req.body.name.trim()
            ? req.body.name.trim().slice(0, 200)
            : req.file.originalname.slice(0, 200),
        audioDurationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null,
      })
      .returning();
    await db.update(collaborationThreadsTable).set({ updatedAt: new Date() }).where(eq(collaborationThreadsTable.id, thread.id));

    const recipientId = thread.creatorId === viewerId ? thread.respondentId : thread.creatorId;
    // The private room lives in the shared project (accepted fork) — deep-link
    // there with the chat open, mirroring the text-message notification.
    const [projectRow] = await db
      .select({ id: collaborationProjectsTable.id })
      .from(collaborationProjectsTable)
      .innerJoin(continuationSubmissionsTable, and(
        eq(collaborationProjectsTable.seedId, continuationSubmissionsTable.seedId),
        eq(collaborationProjectsTable.respondentId, thread.respondentId),
      ))
      .where(eq(continuationSubmissionsTable.id, thread.continuationId))
      .limit(1);
    const messageLink = projectRow
      ? `/authors-den/?project=${projectRow.id}&chat=1`
      : `/authors/collaborations/thread/${thread.id}`;
    await notify(
      recipientId,
      "collaboration_message",
      "A voice note is waiting",
      "Your collaborator sent a voice note — open it in the shared project.",
      messageLink,
      thread.id,
    );
    await recordActivity({
      eventType: "message_sent",
      summary: "A voice note was exchanged in the collaboration thread.",
      actorId: viewerId,
      resourceId: thread.id,
    });

    res.status(201).json(
      SendCollaborationVoiceNoteResponse.parse({
        id: message.id,
        threadId: message.threadId,
        senderId: message.senderId,
        body: message.body,
        audioUrl: message.audioUrl ?? null,
        audioName: message.audioName ?? null,
        audioDurationMs: message.audioDurationMs ?? null,
        createdAt: message.createdAt.toISOString(),
      }),
    );
  },
);

// GET /collaborations/threads/:threadId/audio/:fileId — stream a collaboration
// thread voice note. Participants only; the file lives in the shared upload
// dir under its uuid filename (same ephemeral-disk model as vault media).
router.get(
  "/collaborations/threads/:threadId/audio/:fileId",
  async (req: Request, res: Response): Promise<void> => {
    const viewerId = userId(req, res);
    if (!viewerId) return;

    const params = GetCollaborationThreadAudioParams.safeParse({
      threadId: parseParam(req.params.threadId),
      fileId: parseParam(req.params.fileId),
    });
    if (!params.success) {
      res.status(400).json({ error: "Invalid audio file id" });
      return;
    }

    const thread = await getThreadForViewer(params.data.threadId, viewerId, res);
    if (!thread) return;

    // Only allow plain uploaded filenames (uuid + short extension) — never
    // path segments — so a crafted fileId can't escape the upload dir.
    if (!/^[a-f0-9-]{36}(\.[a-z0-9]{1,12})?$/i.test(params.data.fileId)) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }

    const filePath = path.join(uploadDir(), params.data.fileId);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }

    res.sendFile(filePath);
  },
);

// GET /collaborations/explore/authors — discoverable authors for the Author
// Den explore page: writers who have published seeds (public work), with their
// published-seed count, follower count, and the viewer's follow state.
router.get("/collaborations/explore/authors", async (req: Request, res: Response): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;

  const seeds = await db
    .select({ creatorId: collaborationSeedsTable.creatorId })
    .from(collaborationSeedsTable)
    .where(eq(collaborationSeedsTable.visibility, "SEED_AND_BRIEF"));

  const seedCountByAuthor = new Map<string, number>();
  for (const seed of seeds) {
    seedCountByAuthor.set(seed.creatorId, (seedCountByAuthor.get(seed.creatorId) ?? 0) + 1);
  }
  const authorIds = [...seedCountByAuthor.keys()];

  if (authorIds.length === 0) {
    res.json(ListExploreAuthorsResponse.parse([]));
    return;
  }

  const profiles = await resolveUserProfiles(authorIds);
  const authors = await Promise.all(
    authorIds.map(async (authorId) => {
      const counts = await getFollowCounts(authorId);
      const profile = profiles[authorId];
      return {
        userId: authorId,
        displayName: profile?.name ?? authorId.slice(0, 12),
        imageUrl: profile?.imageUrl ?? null,
        publishedSeedCount: seedCountByAuthor.get(authorId) ?? 0,
        followerCount: counts.followerCount,
        isFollowing: await resolveFollowState(viewerId, authorId),
      };
    }),
  );

  authors.sort((a, b) => b.publishedSeedCount - a.publishedSeedCount);
  res.json(ListExploreAuthorsResponse.parse(authors));
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

// Merges the respondent's fork over the frozen seed project so the accepted
// shared document always contains every part of both sides. Collection items
// are unioned by id (fork first, seed items appended when the fork dropped
// them); scalar fields prefer the fork.
function mergeProjectDocuments(seedDoc: unknown, forkDoc: unknown): Record<string, unknown> {
  const seed = (seedDoc && typeof seedDoc === "object" ? seedDoc : {}) as Record<string, unknown>;
  const fork = (forkDoc && typeof forkDoc === "object" ? forkDoc : {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...seed, ...fork };
  for (const key of ["scenes", "characters", "plots", "world", "revisions"]) {
    const seedItems = Array.isArray(seed[key]) ? seed[key] as Array<Record<string, unknown>> : [];
    const forkItems = Array.isArray(fork[key]) ? fork[key] as Array<Record<string, unknown>> : [];
    if (!seedItems.length && !forkItems.length) continue;
    const seen = new Set<string>();
    const items: Array<Record<string, unknown>> = [];
    for (const item of [...forkItems, ...seedItems]) {
      const id = typeof item?.id === "string" ? item.id : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      items.push(item);
    }
    merged[key] = items;
  }
  return merged;
}

router.post("/collaborations/continuations/:continuationId/accept", async (req, res): Promise<void> => {
  const creatorId = userId(req, res);
  if (!creatorId) return;
  const continuationId = parseParam(req.params.continuationId);
  const result = await db.transaction(async (tx) => {
    const [submission] = await tx.select().from(continuationSubmissionsTable).where(eq(continuationSubmissionsTable.id, continuationId));
    if (!submission || submission.creatorId !== creatorId || submission.status !== "UNDER_REVIEW") return null;
    const [seed] = await tx.select().from(collaborationSeedsTable).where(eq(collaborationSeedsTable.id, submission.seedId));
    if (!seed || seed.availability !== "OPEN") return null;
    const mergedDocument = mergeProjectDocuments(seed.projectDocument, submission.projectDocument);
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
      document: mergedDocument,
    }).returning();
    // Open the private room right away so the shared project has its thread.
    const [existingThread] = await tx.select().from(collaborationThreadsTable).where(eq(collaborationThreadsTable.continuationId, submission.id));
    if (!existingThread) {
      await tx.insert(collaborationThreadsTable).values({
        id: crypto.randomUUID(),
        continuationId: submission.id,
        creatorId,
        respondentId: submission.respondentId,
      });
    }
    await tx.update(continuationSubmissionsTable).set({ status: "ACCEPTED_PENDING_CONTRACT" }).where(eq(continuationSubmissionsTable.id, continuationId));
    await tx.update(seedApplicationsTable).set({ status: "ACCEPTED_PENDING_CONTRACT", updatedAt: new Date() }).where(eq(seedApplicationsTable.id, submission.applicationId));
    await tx.update(seedApplicationsTable).set({ status: "DECLINED", updatedAt: new Date() }).where(and(
      eq(seedApplicationsTable.seedId, seed.id),
      eq(seedApplicationsTable.status, "UNDER_REVIEW"),
      eq(seedApplicationsTable.respondentId, submission.respondentId),
    ));
    await tx.update(continuationSubmissionsTable).set({ status: "ARCHIVED" }).where(and(
      eq(continuationSubmissionsTable.seedId, seed.id),
      eq(continuationSubmissionsTable.status, "UNDER_REVIEW"),
      eq(continuationSubmissionsTable.creatorId, creatorId),
    ));
    await tx.update(collaborationSeedsTable).set({ availability: "ACCEPTED", closedAt: new Date(), updatedAt: new Date() }).where(eq(collaborationSeedsTable.id, seed.id));
    return { project, submission };
  });
  if (!result) {
    res.status(409).json({ error: "This continuation is no longer available for acceptance" });
    return;
  }
  const { project, submission } = result;
  await notify(project.respondentId, "respondent_accepted", "Your fork was accepted", "The creator accepted your submission. The merged project is now shared in both studios.", `/authors-den/?project=${project.id}`, project.id);
  await notify(project.creatorId, "respondent_accepted", "Collaborator accepted", "You accepted the submission. The merged project is now shared in both studios.", `/authors-den/?project=${project.id}`, project.id);
  await recordActivity({
    eventType: "respondent_accepted",
    summary: `Accepted ${submission.respondentName} as a collaborator and merged their fork into “${project.title}”.`,
    actorId: creatorId,
    projectId: project.id,
    seedId: project.seedId,
    resourceId: project.id,
  });
  res.json(await projectView(project));
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
  await notify(result.respondentId, "respondent_selected", "You were selected", "The creator accepted your continuation. The shared project is open in both studios.", `/authors-den/?project=${result.id}`, result.id);
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

// Build a minimal Author Den project document from a legacy shared room's
// work blocks + shared story bible entries, so rooms created before the
// fork/merge model still open in the studio. Returns null when there is no
// legacy content at all.
async function legacyProjectDocument(project: typeof collaborationProjectsTable.$inferSelect): Promise<Record<string, unknown> | null> {
  const [blocks, bible] = await Promise.all([
    db.select().from(collaborationWorkBlocksTable).where(eq(collaborationWorkBlocksTable.projectId, project.id)).orderBy(asc(collaborationWorkBlocksTable.turnOrder), asc(collaborationWorkBlocksTable.createdAt)),
    db.select().from(collaborationStoryBibleEntriesTable).where(and(
      eq(collaborationStoryBibleEntriesTable.projectId, project.id),
      eq(collaborationStoryBibleEntriesTable.shared, true),
    )).orderBy(asc(collaborationStoryBibleEntriesTable.createdAt)),
  ]);
  if (!blocks.length && !bible.length) return null;
  const scenes = blocks.map((block, index) => ({
    id: block.id,
    title: block.kind === "SEED" ? "Opening" : block.kind === "CONTINUATION" ? "Continuation" : `Pass ${index + 1}`,
    synopsis: "",
    content: block.content ? block.content.split(/\n\n+/).filter(Boolean).map((part) => `<p>${part.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />")}</p>`).join("") : "",
    status: "Draft",
    compile: true,
    target: 0,
    pov: "",
    labels: "",
    notes: "",
    media: [],
  }));
  return {
    id: project.id,
    title: project.title,
    author: project.creatorName ?? "Author",
    template: "Novel",
    premise: "",
    synopsis: "",
    summary: "",
    created: project.createdAt.toISOString(),
    updated: project.updatedAt.toISOString(),
    scenes,
    characters: [],
    plots: [],
    world: bible.map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      description: entry.content,
      notes: "",
      fantasy: "",
      mapUrl: "",
    })),
    revisions: [],
    dailyTarget: 750,
    sessionTarget: 500,
  };
}

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
  const [block] = await db
    .select({ id: collaborationWorkBlocksTable.id })
    .from(collaborationWorkBlocksTable)
    .where(eq(collaborationWorkBlocksTable.projectId, project.id))
    .limit(1);
  return {
    ...project,
    threadId: thread?.id ?? null,
    documentAvailable: Boolean(project.document) || Boolean(block),
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

// The private room for a shared project: get-or-create it, read the unread
// message count, or mark the viewer's messages read.
async function findProjectThread(project: typeof collaborationProjectsTable.$inferSelect) {
  const [submission] = await db
    .select()
    .from(continuationSubmissionsTable)
    .where(and(
      eq(continuationSubmissionsTable.seedId, project.seedId),
      eq(continuationSubmissionsTable.respondentId, project.respondentId),
    ))
    .orderBy(asc(continuationSubmissionsTable.createdAt))
    .limit(1);
  if (!submission) return null;
  const [thread] = await db.select().from(collaborationThreadsTable).where(eq(collaborationThreadsTable.continuationId, submission.id));
  return thread ?? null;
}

router.post("/collaborations/projects/:projectId/thread", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const projectId = parseParam(req.params.projectId);
  const project = await getPermittedProject(projectId, viewerId, res);
  if (!project) return;
  const existing = await findProjectThread(project);
  if (existing) {
    res.json(await threadView(existing));
    return;
  }
  const [submission] = await db
    .select({ id: continuationSubmissionsTable.id })
    .from(continuationSubmissionsTable)
    .where(and(
      eq(continuationSubmissionsTable.seedId, project.seedId),
      eq(continuationSubmissionsTable.respondentId, project.respondentId),
    ))
    .orderBy(asc(continuationSubmissionsTable.createdAt))
    .limit(1);
  if (!submission) {
    res.status(404).json({ error: "No submission found for this project" });
    return;
  }
  const [thread] = await db.insert(collaborationThreadsTable).values({
    id: crypto.randomUUID(),
    continuationId: submission.id,
    creatorId: project.creatorId,
    respondentId: project.respondentId,
  }).returning();
  res.status(201).json(await threadView(thread));
});

router.get("/collaborations/projects/:projectId/thread/unread", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const projectId = parseParam(req.params.projectId);
  const project = await getPermittedProject(projectId, viewerId, res);
  if (!project) return;
  const thread = await findProjectThread(project);
  if (!thread) {
    res.json({ unread: false, count: 0 });
    return;
  }
  const unreadNotes = await db
    .select({ id: collaborationNotificationsTable.id })
    .from(collaborationNotificationsTable)
    .where(and(
      eq(collaborationNotificationsTable.recipientId, viewerId),
      eq(collaborationNotificationsTable.category, "collaboration_message"),
      eq(collaborationNotificationsTable.resourceId, thread.id),
      isNull(collaborationNotificationsTable.readAt),
    ));
  res.json({ unread: unreadNotes.length > 0, count: unreadNotes.length });
});

router.post("/collaborations/projects/:projectId/thread/read", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const projectId = parseParam(req.params.projectId);
  const project = await getPermittedProject(projectId, viewerId, res);
  if (!project) return;
  const thread = await findProjectThread(project);
  if (thread) {
    await db.update(collaborationNotificationsTable).set({ readAt: new Date() }).where(and(
      eq(collaborationNotificationsTable.recipientId, viewerId),
      eq(collaborationNotificationsTable.category, "collaboration_message"),
      eq(collaborationNotificationsTable.resourceId, thread.id),
      isNull(collaborationNotificationsTable.readAt),
    ));
  }
  res.status(204).end();
});

router.get("/collaborations/projects/:projectId/document", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const projectId = parseParam(req.params.projectId);
  const project = await getPermittedProject(projectId, viewerId, res);
  if (!project) return;
  // Legacy rooms (created under the old turn/contract model) have work blocks
  // instead of a merged document. Synthesize a document from those blocks so
  // the room still opens in the Author Den instead of dead-ending.
  const document = project.document ?? await legacyProjectDocument(project);
  res.json({
    document: document ?? null,
    updatedAt: (document ? project.updatedAt : project.createdAt).toISOString(),
  });
});

router.put("/collaborations/projects/:projectId/document", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const projectId = parseParam(req.params.projectId);
  const project = await getPermittedProject(projectId, viewerId, res);
  if (!project) return;
  const document = req.body?.document;
  if (!document || typeof document !== "object") {
    res.status(400).json({ error: "A project document object is required" });
    return;
  }
  const [updated] = await db.update(collaborationProjectsTable).set({ document, updatedAt: new Date() }).where(eq(collaborationProjectsTable.id, project.id)).returning();
  res.json({
    document: updated.document ?? null,
    updatedAt: updated.updatedAt.toISOString(),
  });
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
      const seedBlockId = crypto.randomUUID();
      const continuationBlockId = crypto.randomUUID();
      await db.insert(collaborationWorkBlocksTable).values([
        {
          id: seedBlockId,
          projectId: updated.id,
          ownerId: updated.creatorId,
          kind: "SEED",
          content: updated.seedText,
          status: "APPROVED",
          turnOrder: 0,
        },
        {
          id: continuationBlockId,
          projectId: updated.id,
          ownerId: updated.respondentId,
          kind: "CONTINUATION",
          content: updated.continuationText,
          status: "APPROVED",
          turnOrder: 1,
        },
      ]);
      await recordGenealogy({
        projectId: updated.id,
        blockId: seedBlockId,
        parentBlockId: null,
        contributorId: updated.creatorId,
        contributorName: updated.creatorName,
        role: "CREATOR",
        kind: "SEED",
      });
      await recordGenealogy({
        projectId: updated.id,
        blockId: continuationBlockId,
        parentBlockId: seedBlockId,
        contributorId: updated.respondentId,
        contributorName: updated.respondentName,
        role: "RESPONDENT",
        kind: "CONTINUATION",
      });
    }
    await recordActivity({
      eventType: "contract_locked",
      summary: `The contract for “${updated.title}” was locked. The shared project is open.`,
      actorId: viewerId,
      projectId: updated.id,
      seedId: updated.seedId,
      resourceId: updated.id,
    });
    await notify(updated.creatorId, "contract_locked", "Contract locked", "Your shared project is ready — both studios stay in sync.", `/authors-den/?project=${updated.id}`, updated.id);
    await notify(updated.respondentId, "contract_locked", "Contract locked", "Your shared project is ready — both studios stay in sync.", `/authors-den/?project=${updated.id}`, updated.id);
  } else {
    await recordActivity({
      eventType: "contract_approved",
      summary: `${viewerId === updated.creatorId ? updated.creatorName : updated.respondentName} approved the contract for “${updated.title}”.`,
      actorId: viewerId,
      projectId: updated.id,
      seedId: updated.seedId,
      resourceId: updated.id,
    });
    await notify(updated.creatorId === viewerId ? updated.respondentId : updated.creatorId, "contract_action_required", "Contract approval requested", "Your collaborator is waiting for your approval.", `/authors-den/?project=${updated.id}`, updated.id);
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
  await notify(reviewerId, "your_turn", "A new pass awaits your review", "Your collaborator submitted a new pass. The project is waiting in your studio.", `/authors-den/?project=${project.id}`, block.id);
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
  await recordGenealogy({
    projectId: project.id,
    blockId: updated.id,
    parentBlockId: updated.parentBlockId,
    contributorId: updated.ownerId,
    contributorName: updated.ownerId === project.creatorId ? project.creatorName : project.respondentName,
    role: roleFor(updated.ownerId, project) ?? "RESPONDENT",
    kind: "BLOCK",
  });
  await notify(block.ownerId, "block_approved", "Your pass was approved", "Your collaborator approved your pass. The project is waiting in your studio.", `/authors-den/?project=${project.id}`, block.id);
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

router.get("/collaborations/projects/:projectId/genealogy", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;
  const params = ListCollaborationGenealogyParams.safeParse({ projectId: parseParam(req.params.projectId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const project = await getPermittedProject(params.data.projectId, viewerId, res);
  if (!project) return;
  const rows = await db
    .select()
    .from(collaborationGenealogyTable)
    .where(eq(collaborationGenealogyTable.projectId, project.id))
    .orderBy(asc(collaborationGenealogyTable.createdAt));
  res.json(rows.map((row) => ({
    ...row,
    blockId: row.blockId ?? null,
    parentBlockId: row.parentBlockId ?? null,
    createdAt: row.createdAt.toISOString(),
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

// Account-wide activity feed: every privacy-safe event where the viewer is
// involved — as the actor, as a participant in the related project, or as the
// creator of the related seed. This powers the top-level /activity page so the
// account reflects the major activities across all collaboration rooms.
router.get("/collaborations/activity", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;

  const [myProjects, mySeeds] = await Promise.all([
    db
      .select({ id: collaborationProjectsTable.id })
      .from(collaborationProjectsTable)
      .where(or(
        eq(collaborationProjectsTable.creatorId, viewerId),
        eq(collaborationProjectsTable.respondentId, viewerId),
      )),
    db
      .select({ id: collaborationSeedsTable.id })
      .from(collaborationSeedsTable)
      .where(eq(collaborationSeedsTable.creatorId, viewerId)),
  ]);
  const projectIds = myProjects.map((row) => row.id);
  const seedIds = mySeeds.map((row) => row.id);

  const conditions = [eq(collaborationActivityEventsTable.actorId, viewerId)];
  if (projectIds.length) {
    conditions.push(inArray(collaborationActivityEventsTable.projectId, projectIds));
  }
  if (seedIds.length) {
    conditions.push(inArray(collaborationActivityEventsTable.seedId, seedIds));
  }
  const events = await db
    .select()
    .from(collaborationActivityEventsTable)
    .where(or(...conditions))
    .orderBy(desc(collaborationActivityEventsTable.createdAt))
    .limit(200);

  res.json(events.map((event) => ({
    ...event,
    projectId: event.projectId ?? null,
    seedId: event.seedId ?? null,
    resourceId: event.resourceId ?? null,
    createdAt: event.createdAt.toISOString(),
  })));
});

// Inbox threads: every private conversation the viewer participates in, with
// the latest message preview and whether the other side has written since the
// viewer last read the room (derived from the unread message notification).
router.get("/collaborations/threads", async (req, res): Promise<void> => {
  const viewerId = userId(req, res);
  if (!viewerId) return;

  const threads = await db
    .select()
    .from(collaborationThreadsTable)
    .where(or(
      eq(collaborationThreadsTable.creatorId, viewerId),
      eq(collaborationThreadsTable.respondentId, viewerId),
    ))
    .orderBy(desc(collaborationThreadsTable.updatedAt));
  if (!threads.length) {
    res.json([]);
    return;
  }

  const continuationIds = threads.map((thread) => thread.continuationId);
  const submissions = await db
    .select({
      id: continuationSubmissionsTable.id,
      seedId: continuationSubmissionsTable.seedId,
      sourceProjectTitle: continuationSubmissionsTable.sourceProjectTitle,
      creatorId: continuationSubmissionsTable.creatorId,
      respondentName: continuationSubmissionsTable.respondentName,
    })
    .from(continuationSubmissionsTable)
    .where(inArray(continuationSubmissionsTable.id, continuationIds));
  const submissionById = new Map(submissions.map((s) => [s.id, s]));
  const projectRows = submissions.length
    ? await db
        .select({
          id: collaborationProjectsTable.id,
          seedId: collaborationProjectsTable.seedId,
          respondentId: collaborationProjectsTable.respondentId,
        })
        .from(collaborationProjectsTable)
        .where(inArray(collaborationProjectsTable.seedId, submissions.map((s) => s.seedId)))
    : [];
  const projectByKey = new Map(projectRows.map((row) => [`${row.seedId}|${row.respondentId}`, row.id]));

  const threadIds = threads.map((thread) => thread.id);
  const [messages, unreadThreads] = await Promise.all([
    db
      .select()
      .from(collaborationMessagesTable)
      .where(inArray(collaborationMessagesTable.threadId, threadIds))
      .orderBy(asc(collaborationMessagesTable.createdAt)),
    db
      .select({ threadId: collaborationNotificationsTable.resourceId })
      .from(collaborationNotificationsTable)
      .where(and(
        eq(collaborationNotificationsTable.recipientId, viewerId),
        eq(collaborationNotificationsTable.category, "collaboration_message"),
        isNull(collaborationNotificationsTable.readAt),
        inArray(collaborationNotificationsTable.resourceId, threadIds),
      )),
  ]);
  const unreadSet = new Set(
    unreadThreads.map((row) => row.threadId).filter((id): id is string => Boolean(id)),
  );
  const messagesByThread = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = messagesByThread.get(message.threadId) ?? [];
    list.push(message);
    messagesByThread.set(message.threadId, list);
  }

  res.json(threads.map((thread) => {
    const submission = submissionById.get(thread.continuationId);
    const threadMessages = messagesByThread.get(thread.id) ?? [];
    const last = threadMessages[threadMessages.length - 1] ?? null;
    const partnerId = thread.creatorId === viewerId ? thread.respondentId : thread.creatorId;
    return {
      id: thread.id,
      continuationId: thread.continuationId,
      projectId: submission ? projectByKey.get(`${submission.seedId}|${thread.respondentId}`) ?? null : null,
      seedId: submission?.seedId ?? null,
      sourceProjectTitle: submission?.sourceProjectTitle ?? "Private conversation",
      partnerId,
      partnerName: thread.creatorId === viewerId
        ? (submission?.respondentName ?? "Your collaborator")
        : "Author",
      lastMessage: last?.body ?? null,
      lastMessageAt: last?.createdAt.toISOString() ?? null,
      messageCount: threadMessages.length,
      unread: unreadSet.has(thread.id),
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
  }));
});

export default router;