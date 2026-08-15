import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { encryptSecret } from "../lib/oracle";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import collaborationRouter from "./collaboration";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", collaborationRouter);
  return app;
}

const API = createApp();

const SEED_BODY = {
  sourceProjectId: "solo-project-1",
  sourceProjectTitle: "The Salt Road",
  seedText: "The road began where the maps stopped. Ada carried one lantern and a debt older than the town.",
  unitType: "opening",
  protocol: "Continue from the final line",
  genre: "Literary",
  tone: "Open and searching",
  language: "English",
  plotConstraints: "Ada never lies, but she hides.",
  desiredRole: "Co-author",
  visibility: "SEED_AND_BRIEF",
  respondentLimit: 3,
};

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.oracleHealthEventsTable);
  await state.db.delete(t.oracleProvidersTable);
  await state.db.delete(t.collaborationMessagesTable);
  await state.db.delete(t.collaborationThreadsTable);
  await state.db.delete(t.collaborationActivityEventsTable);
  await state.db.delete(t.collaborationStoryBibleEntriesTable);
  await state.db.delete(t.collaborationWorkBlocksTable);
  await state.db.delete(t.collaborationNotificationsTable);
  await state.db.delete(t.collaborationProjectsTable);
  await state.db.delete(t.continuationSubmissionsTable);
  await state.db.delete(t.seedApplicationsTable);
  await state.db.delete(t.collaborationSeedsTable);
  state.userId = null;
}

async function countRows(table: any): Promise<number> {
  const rows = await state.db.select().from(table);
  return rows.length;
}

async function publishSeed(userId = "creator-1") {
  state.userId = userId;
  const res = await request(API).post("/api/collaborations/seeds").send(SEED_BODY);
  expect(res.status).toBe(201);
  return res.body as any;
}

async function applyToSeed(seedId: string, userId = "writer-1") {
  state.userId = userId;
  const res = await request(API)
    .post(`/api/collaborations/seeds/${seedId}/applications`)
    .send({ respondentName: userId === "writer-1" ? "Writer One" : "Writer Two" });
  expect(res.status).toBe(201);
  return res.body as any;
}

async function saveDraft(applicationId: string, draftText: string, userId = "writer-1") {
  state.userId = userId;
  const res = await request(API)
    .patch(`/api/collaborations/applications/${applicationId}`)
    .send({ draftText, draftComments: "A quiet note." });
  expect(res.status).toBe(200);
  return res.body as any;
}

async function submitContinuation(applicationId: string, userId = "writer-1") {
  state.userId = userId;
  const res = await request(API).post(`/api/collaborations/applications/${applicationId}/submit`);
  expect(res.status).toBe(200);
  return res.body as any;
}

async function submittedFlow() {
  const seed = await publishSeed();
  const application = await applyToSeed(seed.id, "writer-1");
  await saveDraft(application.id, "Ada followed the road past the salt pools, her lantern steady.");
  const submission = await submitContinuation(application.id, "writer-1");
  return { seed, application, submission };
}

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authorization", () => {
  it("rejects unauthenticated writes and private reads", async () => {
    state.userId = null;
    expect((await request(API).post("/api/collaborations/seeds").send(SEED_BODY)).status).toBe(401);
    expect((await request(API).get("/api/collaborations/projects")).status).toBe(401);
    expect((await request(API).get("/api/collaborations/continuations")).status).toBe(401);
    expect((await request(API).get("/api/collaborations/inbox")).status).toBe(401);
  });

  it("only the creator can edit an open seed", async () => {
    const seed = await publishSeed();
    state.userId = "writer-1";
    const res = await request(API).patch(`/api/collaborations/seeds/${seed.id}`).send({ genre: "Speculative" });
    expect(res.status).toBe(403);
  });

  it("a writer cannot apply to their own seed", async () => {
    const seed = await publishSeed();
    state.userId = "creator-1";
    const res = await request(API)
      .post(`/api/collaborations/seeds/${seed.id}/applications`)
      .send({ respondentName: "Creator" });
    expect(res.status).toBe(403);
  });

  it("blocks a second unresolved application from the same writer", async () => {
    const seed = await publishSeed();
    await applyToSeed(seed.id, "writer-1");
    state.userId = "writer-1";
    const res = await request(API)
      .post(`/api/collaborations/seeds/${seed.id}/applications`)
      .send({ respondentName: "Writer One" });
    expect(res.status).toBe(409);
  });

  it("blocks applications to a closed seed", async () => {
    const seed = await publishSeed();
    state.userId = "creator-1";
    await request(API).delete(`/api/collaborations/seeds/${seed.id}`);
    state.userId = "writer-1";
    const res = await request(API)
      .post(`/api/collaborations/seeds/${seed.id}/applications`)
      .send({ respondentName: "Writer One" });
    expect(res.status).toBe(409);
  });

  it("submitted continuations are immutable", async () => {
    const { application } = await submittedFlow();
    state.userId = "writer-1";
    const patch = await request(API)
      .patch(`/api/collaborations/applications/${application.id}`)
      .send({ draftText: "Changed after submission.", draftComments: "note" });
    expect(patch.status).toBe(409);
    const resubmit = await request(API).post(`/api/collaborations/applications/${application.id}/submit`);
    expect(resubmit.status).toBe(409);
  });

  it("non-participants cannot read a continuation", async () => {
    const { submission } = await submittedFlow();
    state.userId = "writer-3";
    const res = await request(API).get(`/api/collaborations/continuations/${submission.id}`);
    expect(res.status).toBe(403);
  });

  it("only the seed creator can open the selection pool", async () => {
    const seed = await publishSeed();
    await applyToSeed(seed.id, "writer-1");
    state.userId = "writer-1";
    const res = await request(API).get(`/api/collaborations/seeds/${seed.id}/selection`);
    expect(res.status).toBe(403);
    state.userId = "creator-2";
    const res2 = await request(API).get(`/api/collaborations/seeds/${seed.id}/selection`);
    expect(res2.status).toBe(403);
  });

  it("a creator only sees continuations for their own seeds", async () => {
    const { seed } = await submittedFlow();
    state.userId = "writer-1";
    const empty = await request(API).get("/api/collaborations/continuations");
    expect(empty.status).toBe(200);
    expect(empty.body).toHaveLength(0);
    state.userId = "creator-1";
    const own = await request(API).get("/api/collaborations/continuations");
    expect(own.body).toHaveLength(1);
    expect(own.body[0].seedId).toBe(seed.id);
  });

  it("a read-only preview creates no project copy and no extra application", async () => {
    const { submission } = await submittedFlow();
    state.userId = "creator-1";
    const res = await request(API).get(`/api/collaborations/continuations/${submission.id}`);
    expect(res.status).toBe(200);
    expect(await countRows(state.tables.collaborationProjectsTable)).toBe(0);
    const applications = await state.db.select().from(state.tables.seedApplicationsTable);
    expect(applications).toHaveLength(1);
  });

  it("only the respondent can request a pre-submit advisory check", async () => {
    const { application } = await submittedFlow();
    state.userId = "creator-1";
    const res = await request(API).post(`/api/collaborations/applications/${application.id}/advisory`);
    expect(res.status).toBe(403);
  });
});

describe("acceptance and contract transactions", () => {
  it("declining archives a continuation without creating a Tandem", async () => {
    const seed = await publishSeed();
    await applyToSeed(seed.id, "writer-1");
    const application = await applyToSeed(seed.id, "writer-2");
    await saveDraft(application.id, "Writer two's continuation begins here.", "writer-2");
    const submission = await submitContinuation(application.id, "writer-2");
    state.userId = "creator-1";
    const res = await request(API).delete(`/api/collaborations/continuations/${submission.id}`);
    expect(res.status).toBe(204);
    expect(await countRows(state.tables.collaborationProjectsTable)).toBe(0);
    const [row] = await state.db.select().from(state.tables.continuationSubmissionsTable).where(eq(state.tables.continuationSubmissionsTable.id, submission.id));
    expect(row.status).toBe("ARCHIVED");
    const [appRow] = await state.db.select().from(state.tables.seedApplicationsTable).where(eq(state.tables.seedApplicationsTable.id, application.id));
    expect(appRow.status).toBe("DECLINED");
  });

  it("acceptance closes the seed once, creates the project, and archives the rest", async () => {
    const seed = await publishSeed();
    const a1 = await applyToSeed(seed.id, "writer-1");
    const a2 = await applyToSeed(seed.id, "writer-2");
    await saveDraft(a1.id, "Writer one's continuation begins here.", "writer-1");
    await saveDraft(a2.id, "Writer two's continuation begins here.", "writer-2");
    const s1 = await submitContinuation(a1.id, "writer-1");
    const s2 = await submitContinuation(a2.id, "writer-2");

    state.userId = "creator-1";
    const select = await request(API).post(`/api/collaborations/continuations/${s1.id}/select`);
    expect(select.status).toBe(200);
    expect(select.body.creatorId).toBe("creator-1");
    expect(select.body.respondentId).toBe("writer-1");

    expect(await countRows(state.tables.collaborationProjectsTable)).toBe(1);
    const [seedRow] = await state.db.select().from(state.tables.collaborationSeedsTable).where(eq(state.tables.collaborationSeedsTable.id, seed.id));
    expect(seedRow.availability).toBe("ACCEPTED");

    const [s1Row] = await state.db.select().from(state.tables.continuationSubmissionsTable).where(eq(state.tables.continuationSubmissionsTable.id, s1.id));
    const [s2Row] = await state.db.select().from(state.tables.continuationSubmissionsTable).where(eq(state.tables.continuationSubmissionsTable.id, s2.id));
    expect(s1Row.status).toBe("ACCEPTED_PENDING_CONTRACT");
    expect(s2Row.status).toBe("ARCHIVED");

    const reselect = await request(API).post(`/api/collaborations/continuations/${s2.id}/select`);
    expect(reselect.status).toBe(409);
  });

  it("unselected submissions keep attribution outside the official manuscript", async () => {
    const seed = await publishSeed();
    const a1 = await applyToSeed(seed.id, "writer-1");
    const a2 = await applyToSeed(seed.id, "writer-2");
    await saveDraft(a1.id, "Writer one's continuation begins here.", "writer-1");
    await saveDraft(a2.id, "Writer two's continuation begins here.", "writer-2");
    const s1 = await submitContinuation(a1.id, "writer-1");
    await submitContinuation(a2.id, "writer-2");
    state.userId = "creator-1";
    await request(API).post(`/api/collaborations/continuations/${s1.id}/select`);
    const [archived] = await state.db.select().from(state.tables.continuationSubmissionsTable).where(eq(state.tables.continuationSubmissionsTable.id, s1.id));
    const all = await state.db.select().from(state.tables.continuationSubmissionsTable);
    expect(all).toHaveLength(2);
    expect(archived.status).toBe("ACCEPTED_PENDING_CONTRACT");
    const archivedOther = all.find((row: any) => row.respondentId === "writer-2");
    expect(archivedOther.status).toBe("ARCHIVED");
    expect(archivedOther.respondentName).toBe("Writer Two");
  });

  it("contract locks only after both participants approve", async () => {
    const { submission } = await submittedFlow();
    state.userId = "creator-1";
    const select = await request(API).post(`/api/collaborations/continuations/${submission.id}/select`);
    expect(select.status).toBe(200);
    const projectId = select.body.id;

    state.userId = "creator-1";
    const first = await request(API).post(`/api/collaborations/projects/${projectId}/approve`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("CONTRACT_PENDING");
    expect(first.body.creatorApproved).toBe(true);
    expect(first.body.respondentApproved).toBe(false);

    state.userId = "writer-1";
    const second = await request(API).post(`/api/collaborations/projects/${projectId}/approve`);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("ACTIVE");
    expect(second.body.lockedAt).toBeTruthy();

    state.userId = "creator-1";
    const third = await request(API).post(`/api/collaborations/projects/${projectId}/approve`);
    expect(third.status).toBe(409);
  });

  it("a locked contract cannot be changed without an approved amendment", async () => {
    const seed = await publishSeed();
    const a = await applyToSeed(seed.id, "writer-1");
    await saveDraft(a.id, "Writer one's continuation begins here.", "writer-1");
    const s = await submitContinuation(a.id, "writer-1");
    state.userId = "creator-1";
    const select = await request(API).post(`/api/collaborations/continuations/${s.id}/select`);
    const projectId = select.body.id;
    await request(API).post(`/api/collaborations/projects/${projectId}/approve`);
    state.userId = "writer-1";
    await request(API).post(`/api/collaborations/projects/${projectId}/approve`);
    // No amendment endpoint exists in first release: the approve route itself
    // must refuse any further mutation once the contract is locked.
    state.userId = "creator-1";
    const patch = await request(API).post(`/api/collaborations/projects/${projectId}/approve`);
    expect(patch.status).toBe(409);
    const project = await request(API).get(`/api/collaborations/projects/${projectId}`);
    expect(project.body.status).toBe("ACTIVE");
    expect(project.body.contractVersion).toBe(1);
  });
});

describe("work block turn and ownership enforcement", () => {
  async function lockedProject() {
    const seed = await publishSeed();
    const a = await applyToSeed(seed.id, "writer-1");
    await saveDraft(a.id, "Writer one's continuation begins here.", "writer-1");
    const s = await submitContinuation(a.id, "writer-1");
    state.userId = "creator-1";
    const select = await request(API).post(`/api/collaborations/continuations/${s.id}/select`);
    const projectId = select.body.id;
    await request(API).post(`/api/collaborations/projects/${projectId}/approve`);
    state.userId = "writer-1";
    await request(API).post(`/api/collaborations/projects/${projectId}/approve`);
    return { seed, projectId };
  }

  it("refuses work blocks before the contract is locked", async () => {
    const seed = await publishSeed();
    const a = await applyToSeed(seed.id, "writer-1");
    await saveDraft(a.id, "Writer one's continuation begins here.", "writer-1");
    const s = await submitContinuation(a.id, "writer-1");
    state.userId = "creator-1";
    const select = await request(API).post(`/api/collaborations/continuations/${s.id}/select`);
    state.userId = "creator-1";
    const res = await request(API)
      .post(`/api/collaborations/projects/${select.body.id}/blocks`)
      .send({ content: "Too early to write." });
    expect(res.status).toBe(409);
  });

  it("only the current turn can create, submit, and approve blocks", async () => {
    const { projectId } = await lockedProject();

    // Creator is the first turn: creating a draft works, submitting works.
    state.userId = "creator-1";
    const created = await request(API)
      .post(`/api/collaborations/projects/${projectId}/blocks`)
      .send({ content: "Ada reached the salt pools at dusk." });
    expect(created.status).toBe(201);
    const blockId = created.body.id;

    // Nobody can approve their own block.
    const selfApprove = await request(API).post(`/api/collaborations/projects/${projectId}/blocks/${blockId}/approve`);
    expect(selfApprove.status).toBe(403);

    // Respondent cannot create while it is the creator's turn.
    state.userId = "writer-1";
    const outsiderCreate = await request(API)
      .post(`/api/collaborations/projects/${projectId}/blocks`)
      .send({ content: "Not my turn yet." });
    expect(outsiderCreate.status).toBe(409);

    // Respondent cannot edit the creator's draft.
    const outsiderPatch = await request(API)
      .patch(`/api/collaborations/projects/${projectId}/blocks/${blockId}`)
      .send({ content: "Tampered." });
    expect(outsiderPatch.status).toBe(403);

    // Creator submits; the turn moves to the respondent.
    state.userId = "creator-1";
    const submitted = await request(API).post(`/api/collaborations/projects/${projectId}/blocks/${blockId}/submit`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("SUBMITTED");
    const projectAfter = await request(API).get(`/api/collaborations/projects/${projectId}`);
    expect(projectAfter.body.currentTurn).toBe("RESPONDENT");

    // Creator cannot submit again (no open draft remains).
    const resubmit = await request(API).post(`/api/collaborations/projects/${projectId}/blocks/${blockId}/submit`);
    expect(resubmit.status).toBe(409);

    // Respondent approves the submitted pass.
    state.userId = "writer-1";
    const approved = await request(API).post(`/api/collaborations/projects/${projectId}/blocks/${blockId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");
  });
});

describe("notifications and activity", () => {
  it("notifications carry privacy-safe summaries only", async () => {
    const { submission } = await submittedFlow();
    state.userId = "creator-1";
    const inbox = await request(API).get("/api/collaborations/inbox");
    expect(inbox.status).toBe(200);
    const notice = inbox.body.find((n: any) => n.category === "continuation_submitted");
    expect(notice).toBeTruthy();
    expect(notice.deepLink).toContain(submission.id);
    expect(notice.body).not.toContain(submission.continuationText.slice(0, 20));
    expect(notice.title).toBeTruthy();
  });

  it("records activity events for participants at transitions", async () => {
    const seed = await publishSeed();
    const a = await applyToSeed(seed.id, "writer-1");
    await saveDraft(a.id, "Writer one's continuation begins here.", "writer-1");
    const s = await submitContinuation(a.id, "writer-1");
    state.userId = "creator-1";
    const select = await request(API).post(`/api/collaborations/continuations/${s.id}/select`);
    const projectId = select.body.id;
    const events = await state.db.select().from(state.tables.collaborationActivityEventsTable);
    const types = events.map((e: any) => e.eventType);
    expect(types).toContain("seed_published");
    expect(types).toContain("continuation_submitted");
    expect(types).toContain("respondent_selected");
    const projectEvents = events.filter((e: any) => e.projectId === projectId);
    expect(projectEvents.length).toBeGreaterThan(0);
  });

  it("project responses expose only permitted project fields to both participants", async () => {
    const seed = await publishSeed();
    const a = await applyToSeed(seed.id, "writer-1");
    await saveDraft(a.id, "Writer one's continuation begins here.", "writer-1");
    const s = await submitContinuation(a.id, "writer-1");
    state.userId = "creator-1";
    const select = await request(API).post(`/api/collaborations/continuations/${s.id}/select`);
    const projectId = select.body.id;
    state.userId = "writer-1";
    const view = await request(API).get(`/api/collaborations/projects/${projectId}`);
    expect(view.status).toBe(200);
    expect(view.body.title).toBe(SEED_BODY.sourceProjectTitle);
    expect(view.body.creatorId).toBe("creator-1");
    expect(view.body.respondentId).toBe("writer-1");
    expect(view.body.seedId).toBe(seed.id);
    expect(view.body.threadId).toBe(null);
  });
});

describe("oracle advisory", () => {
  it("degrades to local checks when no Story Oracle provider is configured", async () => {
    const { submission } = await submittedFlow();
    state.userId = "creator-1";
    const res = await request(API).get(`/api/collaborations/continuations/${submission.id}/advisory`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("local");
    expect(res.body.available).toBe(false);
    expect(res.body.signals.length).toBeGreaterThanOrEqual(3);
  });

  it("uses the Story Oracle when a provider responds, with provenance", async () => {
    const { submission } = await submittedFlow();
    await state.db.insert(state.tables.oracleProvidersTable).values({
      id: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      enabled: true,
      priority: 1,
      status: "connected",
      apiKeyCiphertext: encryptSecret("dummy-key"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  signals: [
                    { category: "tone", level: "positive", title: "Tone holds", detail: "The continuation keeps the seed's quiet register." },
                    { category: "continuity", level: "attention", title: "Lantern detail", detail: "The seed implies one lantern; the continuation adds a second without setup." },
                  ],
                }),
              },
            },
          ],
        }),
      })),
    );
    state.userId = "creator-1";
    const res = await request(API).get(`/api/collaborations/continuations/${submission.id}/advisory`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("oracle");
    expect(res.body.available).toBe(true);
    expect(res.body.providerId).toBe("groq");
    expect(res.body.signals.length).toBe(2);
  });

  it("a pre-submit advisory check never blocks submission", async () => {
    const seed = await publishSeed();
    const a = await applyToSeed(seed.id, "writer-1");
    await saveDraft(a.id, "Writer one's continuation begins here.", "writer-1");
    state.userId = "writer-1";
    const advisory = await request(API).post(`/api/collaborations/applications/${a.id}/advisory`);
    expect(advisory.status).toBe(200);
    expect(advisory.body.source).toBe("local");
    const submit = await request(API).post(`/api/collaborations/applications/${a.id}/submit`);
    expect(submit.status).toBe(200);
  });
});
