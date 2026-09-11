import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Writers' Audition Arena (Author Den) — route tests.
//
// Phase 1 of AUTHOR-DEN-AUDITION-ARENA-PLAN.md. Both rails ride the existing
// collaboration_seeds model, so these tests also guard the regression rule:
// a kind='SEED' row must behave exactly as it did before the Arena existed.
// ---------------------------------------------------------------------------

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

const AUTHOR = "author-1";
const AUTHOR2 = "author-2";
const WRITER = "writer-1";
const WRITER2 = "writer-2";

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

const ROLE_PITCH = "Looking for a sharp editor to shape the second act. We work in two-week passes.";

function roleBody(overrides: Record<string, unknown> = {}) {
  return {
    ...SEED_BODY,
    sourceProjectId: `solo-role-${Math.random().toString(36).slice(2, 8)}`,
    role: "EDITOR",
    rolePitch: ROLE_PITCH,
    ...overrides,
  };
}

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.continuationAnnotationsTable);
  await state.db.delete(t.collaborationMessagesTable);
  await state.db.delete(t.collaborationThreadsTable);
  await state.db.delete(t.collaborationActivityEventsTable);
  await state.db.delete(t.collaborationGenealogyTable);
  await state.db.delete(t.collaborationStoryBibleEntriesTable);
  await state.db.delete(t.collaborationWorkBlocksTable);
  await state.db.delete(t.collaborationNotificationsTable);
  await state.db.delete(t.collaborationProjectsTable);
  await state.db.delete(t.continuationSubmissionsTable);
  await state.db.delete(t.seedApplicationsTable);
  await state.db.delete(t.collaborationArenaWatchesTable);
  await state.db.delete(t.collaborationSeedsTable);
  await state.db.delete(t.nexetVideoFollowsTable);
  state.userId = null;
}

beforeEach(async () => {
  await resetDb();
});

async function publishRole(userId = AUTHOR, overrides: Record<string, unknown> = {}) {
  state.userId = userId;
  const res = await request(API).post("/api/collaborations/arena/posts").send(roleBody(overrides));
  expect(res.status).toBe(201);
  return res.body as any;
}

async function publishSeed(userId = AUTHOR) {
  state.userId = userId;
  const res = await request(API).post("/api/collaborations/seeds").send(SEED_BODY);
  expect(res.status).toBe(201);
  return res.body as any;
}

async function audition(seedId: string, userId = WRITER) {
  state.userId = userId;
  const res = await request(API)
    .post(`/api/collaborations/seeds/${seedId}/applications`)
    .send({ respondentName: userId });
  expect(res.status).toBe(201);
  return res.body as any;
}

async function listBoard(query: Record<string, string | number> = {}, userId = WRITER) {
  state.userId = userId;
  const res = await request(API).get("/api/collaborations/arena/posts").query(query);
  expect(res.status).toBe(200);
  return res.body as any[];
}

async function notificationsFor(recipientId: string) {
  return state.db
    .select()
    .from(state.tables.collaborationNotificationsTable)
    .where(eq(state.tables.collaborationNotificationsTable.recipientId, recipientId));
}

describe("auth", () => {
  it("rejects every Arena route for signed-out callers", async () => {
    state.userId = null;
    expect((await request(API).get("/api/collaborations/arena/posts")).status).toBe(401);
    expect((await request(API).post("/api/collaborations/arena/posts").send(roleBody())).status).toBe(401);
    expect((await request(API).get("/api/collaborations/arena/posts/anything")).status).toBe(401);
    expect((await request(API).patch("/api/collaborations/arena/posts/anything").send({ availability: "CLOSED" })).status).toBe(401);
    expect((await request(API).get("/api/collaborations/arena/auditions/mine")).status).toBe(401);
    expect((await request(API).post("/api/collaborations/arena/auditions/anything/withdraw")).status).toBe(401);
    expect((await request(API).get("/api/collaborations/arena/watches")).status).toBe(401);
    expect((await request(API).post("/api/collaborations/arena/watches").send({ role: "EDITOR" })).status).toBe(401);
  });
});

describe("POST /collaborations/arena/posts — open a writing role", () => {
  it("creates a ROLE post owned by the caller and exposes the role metadata", async () => {
    const post = await publishRole();
    expect(post.kind).toBe("ROLE");
    expect(post.role).toBe("EDITOR");
    expect(post.rolePitch).toBe(ROLE_PITCH);
    expect(post.creatorId).toBe(AUTHOR);
    expect(post.availability).toBe("OPEN");
    expect(post.respondentCount).toBe(0);
    expect(post.myApplicationId).toBeNull();
  });

  it("rejects an unknown writing role", async () => {
    state.userId = AUTHOR;
    const res = await request(API).post("/api/collaborations/arena/posts").send(roleBody({ role: "STUNT_DOUBLE" }));
    expect(res.status).toBe(400);
  });

  it("rejects a role pitch under 10 characters", async () => {
    state.userId = AUTHOR;
    const res = await request(API).post("/api/collaborations/arena/posts").send(roleBody({ rolePitch: "too short" }));
    expect(res.status).toBe(400);
  });

  it("blocks a second OPEN call for the same role on the same project", async () => {
    const projectId = "solo-project-dup";
    await publishRole(AUTHOR, { sourceProjectId: projectId });
    state.userId = AUTHOR;
    const dup = await request(API)
      .post("/api/collaborations/arena/posts")
      .send(roleBody({ sourceProjectId: projectId }));
    expect(dup.status).toBe(409);

    // A different role on the same project is fine.
    const other = await request(API)
      .post("/api/collaborations/arena/posts")
      .send(roleBody({ sourceProjectId: projectId, role: "BETA_READER" }));
    expect(other.status).toBe(201);
  });

  it("notifies matching role watchers once, and never the author", async () => {
    state.userId = WRITER;
    await request(API).post("/api/collaborations/arena/watches").send({ role: "EDITOR" });

    await publishRole(AUTHOR);

    expect((await notificationsFor(WRITER)).filter((n: any) => n.category === "writer_arena_role_opened")).toHaveLength(1);
    expect((await notificationsFor(AUTHOR)).filter((n: any) => n.category === "writer_arena_role_opened")).toHaveLength(0);
  });

  it("only notifies watchers of the role that was posted", async () => {
    state.userId = WRITER;
    await request(API).post("/api/collaborations/arena/watches").send({ role: "PROOFREADER" });

    await publishRole(AUTHOR, { role: "EDITOR" });

    expect(await notificationsFor(WRITER)).toHaveLength(0);
  });
});

describe("regression — the seed rail is untouched", () => {
  it("a published seed is a SEED row with null role fields", async () => {
    const seed = await publishSeed();
    expect(seed.kind).toBe("SEED");
    expect(seed.role).toBeNull();
    expect(seed.rolePitch).toBeNull();
    expect(seed.filledBy).toBeNull();
    expect(seed.filledAt).toBeNull();
  });

  it("existing seed endpoints keep working after the Arena columns landed", async () => {
    const seed = await publishSeed();
    state.userId = WRITER;
    const detail = await request(API).get(`/api/collaborations/seeds/${seed.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.kind).toBe("SEED");
    expect(detail.body.sourceProjectTitle).toBe(SEED_BODY.sourceProjectTitle);
  });
});

describe("GET /collaborations/arena/posts — the board", () => {
  it("splits the two rails and filters by role", async () => {
    await publishSeed(AUTHOR);
    await publishRole(AUTHOR2, { role: "EDITOR" });
    await publishRole(AUTHOR2, { role: "BETA_READER" });

    const seedRail = await listBoard({ rail: "seed" });
    expect(seedRail).toHaveLength(1);
    expect(seedRail[0].kind).toBe("SEED");

    const roleRail = await listBoard({ rail: "role" });
    expect(roleRail).toHaveLength(2);
    expect(roleRail.every((row) => row.kind === "ROLE")).toBe(true);

    const editors = await listBoard({ role: "EDITOR" });
    expect(editors).toHaveLength(1);
    expect(editors[0].role).toBe("EDITOR");
  });

  it("sorts by most auditions", async () => {
    const quiet = await publishRole(AUTHOR, { role: "EDITOR" });
    const busy = await publishRole(AUTHOR, { role: "CO_WRITER" });
    await audition(busy.id, WRITER);
    await audition(busy.id, WRITER2);

    const ordered = await listBoard({ rail: "role", sort: "most_applied" });
    expect(ordered[0].id).toBe(busy.id);
    expect(ordered[0].respondentCount).toBe(2);
    expect(ordered[1].id).toBe(quiet.id);
  });

  it("?mine=1 returns only the caller's own calls, including closed ones", async () => {
    const mine = await publishRole(AUTHOR);
    await publishRole(AUTHOR2);
    state.userId = AUTHOR;
    await request(API).patch(`/api/collaborations/arena/posts/${mine.id}`).send({ availability: "CLOSED" });

    const rows = await listBoard({ mine: 1 }, AUTHOR);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(mine.id);
    expect(rows[0].availability).toBe("CLOSED");
    // The author sees the lifetime total; everyone else sees only the live count.
    expect(rows[0].totalApplications).toBe(0);
  });

  it("hides the lifetime total from non-authors", async () => {
    const post = await publishRole(AUTHOR);
    await audition(post.id, WRITER);
    await audition(post.id, WRITER2);
    const [fromWriter] = await listBoard({ rail: "role" }, WRITER2);
    expect(fromWriter.totalApplications).toBe(fromWriter.respondentCount);
    expect(fromWriter.totalApplications).toBe(2);
  });
});

describe("auditions — count and lifecycle", () => {
  it("counts live auditions up on apply and down on withdraw", async () => {
    const post = await publishRole(AUTHOR);
    await audition(post.id, WRITER);
    await audition(post.id, WRITER2);

    state.userId = AUTHOR;
    const afterApply = await request(API).get(`/api/collaborations/arena/posts/${post.id}`);
    expect(afterApply.body.respondentCount).toBe(2);
    expect(afterApply.body.totalApplications).toBe(2);

    // The applicant's own row is reflected back to them.
    state.userId = WRITER2;
    const withMine = await request(API).get(`/api/collaborations/arena/posts/${post.id}`);
    expect(withMine.body.myApplicationId).toBeTruthy();
    expect(withMine.body.myApplicationStatus).toBe("DRAFT");

    state.userId = WRITER2;
    const withdrawn = await request(API).post(`/api/collaborations/arena/auditions/${withMine.body.myApplicationId}/withdraw`);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe("WITHDRAWN");

    state.userId = AUTHOR;
    const afterWithdraw = await request(API).get(`/api/collaborations/arena/posts/${post.id}`);
    expect(afterWithdraw.body.respondentCount).toBe(1);
    expect(afterWithdraw.body.totalApplications).toBe(2);
  });

  it("lets a writer audition again after withdrawing", async () => {
    const post = await publishRole(AUTHOR);
    const first = await audition(post.id, WRITER);
    state.userId = WRITER;
    await request(API).post(`/api/collaborations/arena/auditions/${first.id}/withdraw`);
    const second = await audition(post.id, WRITER);
    expect(second.id).not.toBe(first.id);
  });

  it("only the applicant can withdraw, and never a decided audition", async () => {
    const post = await publishRole(AUTHOR);
    const application = await audition(post.id, WRITER);

    state.userId = WRITER2;
    expect((await request(API).post(`/api/collaborations/arena/auditions/${application.id}/withdraw`)).status).toBe(403);

    state.userId = AUTHOR;
    await state.db
      .update(state.tables.seedApplicationsTable)
      .set({ status: "DECLINED" })
      .where(eq(state.tables.seedApplicationsTable.id, application.id));

    // The applicant themselves cannot retract an audition that was decided.
    state.userId = WRITER;
    expect((await request(API).post(`/api/collaborations/arena/auditions/${application.id}/withdraw`)).status).toBe(409);
  });

  it("never leaks a draft into Arena responses", async () => {
    const post = await publishRole(AUTHOR);
    const application = await audition(post.id, WRITER);
    state.userId = WRITER;
    await request(API)
      .patch(`/api/collaborations/applications/${application.id}`)
      .send({ draftText: "SECRET PROSE that must not surface", draftComments: "private" });

    state.userId = AUTHOR;
    const detail = await request(API).get(`/api/collaborations/arena/posts/${post.id}`);
    expect(JSON.stringify(detail.body)).not.toContain("SECRET PROSE");

    const board = await listBoard({ rail: "role" }, AUTHOR);
    expect(JSON.stringify(board)).not.toContain("SECRET PROSE");
  });

  it("notifies the author when an audition is withdrawn", async () => {
    const post = await publishRole(AUTHOR);
    const application = await audition(post.id, WRITER);
    state.userId = WRITER;
    await request(API).post(`/api/collaborations/arena/auditions/${application.id}/withdraw`);
    const notes = await notificationsFor(AUTHOR);
    expect(notes.some((n: any) => n.category === "writer_arena_audition_withdrawn")).toBe(true);
  });
});

describe("GET /collaborations/arena/auditions/mine", () => {
  it("returns only the caller's auditions, newest first, with the rail context", async () => {
    const role = await publishRole(AUTHOR);
    const seed = await publishSeed(AUTHOR2);
    await audition(role.id, WRITER);
    await audition(seed.id, WRITER);
    await audition(role.id, WRITER2);

    state.userId = WRITER;
    const res = await request(API).get("/api/collaborations/arena/auditions/mine");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const kinds = res.body.map((row: any) => row.kind).sort();
    expect(kinds).toEqual(["ROLE", "SEED"]);
    const roleRow = res.body.find((row: any) => row.postId === role.id);
    expect(roleRow.role).toBe("EDITOR");
    expect(roleRow.sourceProjectTitle).toBe(SEED_BODY.sourceProjectTitle);
  });
});

describe("PATCH /collaborations/arena/posts/:seedId", () => {
  it("closes a call and notifies everyone still auditioning", async () => {
    const post = await publishRole(AUTHOR);
    await audition(post.id, WRITER);
    await audition(post.id, WRITER2);

    state.userId = AUTHOR;
    const closed = await request(API)
      .patch(`/api/collaborations/arena/posts/${post.id}`)
      .send({ availability: "CLOSED" });
    expect(closed.status).toBe(200);
    expect(closed.body.availability).toBe("CLOSED");

    for (const writer of [WRITER, WRITER2]) {
      const notes = await notificationsFor(writer);
      expect(notes.some((n: any) => n.category === "writer_arena_role_closed")).toBe(true);
    }

    // A closed call drops off the default (open) board but stays on ?mine=1.
    const board = await listBoard({ rail: "role" }, AUTHOR);
    expect(board.map((row) => row.id)).not.toContain(post.id);
  });

  it("is author-only", async () => {
    const post = await publishRole(AUTHOR);
    state.userId = WRITER;
    const res = await request(API).patch(`/api/collaborations/arena/posts/${post.id}`).send({ availability: "CLOSED" });
    expect(res.status).toBe(403);
  });

  it("edits the pitch while open but rejects a seed's role pitch", async () => {
    const post = await publishRole(AUTHOR);
    state.userId = AUTHOR;
    const edited = await request(API)
      .patch(`/api/collaborations/arena/posts/${post.id}`)
      .send({ rolePitch: "A revised and considerably longer brief for the editor role." });
    expect(edited.status).toBe(200);
    expect(edited.body.rolePitch).toBe("A revised and considerably longer brief for the editor role.");

    const seed = await publishSeed(AUTHOR);
    const rejected = await request(API)
      .patch(`/api/collaborations/arena/posts/${seed.id}`)
      .send({ rolePitch: "Seeds do not carry a role pitch at all, ever." });
    expect(rejected.status).toBe(400);
  });
});

describe("watches", () => {
  it("are self-scoped and reject exact duplicates", async () => {
    state.userId = WRITER;
    const created = await request(API).post("/api/collaborations/arena/watches").send({ role: "EDITOR" });
    expect(created.status).toBe(201);

    const dup = await request(API).post("/api/collaborations/arena/watches").send({ role: "EDITOR" });
    expect(dup.status).toBe(409);

    // A global watch and an author-scoped watch on the same role coexist.
    state.userId = WRITER;
    const scoped = await request(API).post("/api/collaborations/arena/watches").send({ role: "EDITOR", creatorId: AUTHOR });
    expect(scoped.status).toBe(201);

    const list = await request(API).get("/api/collaborations/arena/watches");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
  });

  it("refuses watching your own calls", async () => {
    state.userId = AUTHOR;
    const res = await request(API).post("/api/collaborations/arena/watches").send({ role: "EDITOR", creatorId: AUTHOR });
    expect(res.status).toBe(400);
  });

  it("stops delivery once deleted and never touches another user's watch", async () => {
    state.userId = WRITER;
    const created = await request(API).post("/api/collaborations/arena/watches").send({ role: "EDITOR" });

    state.userId = WRITER2;
    expect((await request(API).delete(`/api/collaborations/arena/watches/${created.body.id}`)).status).toBe(404);

    state.userId = WRITER;
    expect((await request(API).delete(`/api/collaborations/arena/watches/${created.body.id}`)).status).toBe(204);

    await publishRole(AUTHOR);
    expect(await notificationsFor(WRITER)).toHaveLength(0);
  });
});
