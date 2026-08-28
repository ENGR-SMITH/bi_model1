import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Uploads + proxies land on disk; demo mode keeps processing deterministic
// (no ffmpeg/faster-whisper required) and off the machine's real tooling.
process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "video-prod-test-"));
process.env.TANDEM_MEDIA_DEMO = "1";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  clerkEmailToUser: {} as Record<string, string | null>,
  clerkIdToName: {} as Record<string, string>,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUserList: async (params: { limit?: number; offset?: number; emailAddress?: string[]; userId?: string[] }) => {
        const all = () => {
          const rows = Object.entries(state.clerkIdToName).map(([id, name]) => {
            const [first, ...rest] = name.split(" ");
            return {
              id,
              firstName: first || null,
              lastName: rest.join(" ") || null,
              username: null,
              emailAddresses: [],
            };
          });
          const known = new Set(Object.keys(state.clerkIdToName));
          for (const id of Object.values(state.clerkEmailToUser)) {
            if (id && !known.has(id)) {
              rows.push({ id, firstName: null, lastName: null, username: null, emailAddresses: [] });
            }
          }
          return rows;
        };
        if (params.userId) {
          return {
            data: params.userId.map((id) => {
              const [first, ...rest] = (state.clerkIdToName[id] ?? "").split(" ");
              return {
                id,
                firstName: first || null,
                lastName: rest.join(" ") || null,
                username: null,
                emailAddresses: [],
              };
            }),
          };
        }
        if (params.emailAddress) {
          const id = state.clerkEmailToUser[params.emailAddress[0] ?? ""] ?? null;
          return { data: id ? all().filter((u) => u.id === id) : [] };
        }
        const users = all();
        const offset = params.offset ?? 0;
        const limit = params.limit ?? users.length;
        return { data: users.slice(offset, offset + limit) };
      },
    },
  },
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import videoRouter from "./video";
import videoProductionRouter from "./video-production";
import { formatEdlTimecode, parseEdlTimecode, parseTimelineEdl, resolveEdlEvents } from "../video/edl";
import { runWorkerCycle } from "../video/worker";
import { listZipEntries, readZipEntry } from "../video/zip";
import { clearUserNameCache } from "../lib/user-names";
import { tandemUid } from "../lib/tandem-uid";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", videoProductionRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoNotificationsTable);
  await state.db.delete(t.tandemVideoGrantsTable);
  await state.db.delete(t.tandemVideoReferencesTable);
  await state.db.delete(t.tandemVideoSyncsTable);
  await state.db.delete(t.tandemVideoJobsTable);
  await state.db.delete(t.tandemVideoCommentsTable);
  await state.db.delete(t.tandemVideoSubmissionsTable);
  await state.db.delete(t.tandemVideoTimelineVersionsTable);
  await state.db.delete(t.tandemVideoTimelinesTable);
  await state.db.delete(t.tandemVideoTranscriptSegmentsTable);
  await state.db.delete(t.tandemVideoTranscriptsTable);
  await state.db.delete(t.tandemVideoAssetFilesTable);
  await state.db.delete(t.tandemVideoAssetsTable);
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
  state.userId = null;
  clearUserNameCache();
  state.clerkEmailToUser = {
    "architect@example.com": "architect-1",
    "editor@example.com": "editor-1",
    "thumb@example.com": "thumb-1",
    "stranger@example.com": "stranger-1",
  };
  state.clerkIdToName = {
    "captain-1": "Ada Captain",
    "architect-1": "Riley Architect",
    "editor-1": "Sam Editor",
    "thumb-1": "Noah Thumb",
  };
}

async function createProject(userId = "captain-1", name = "The Salt Road Vlog") {
  state.userId = userId;
  const res = await request(API).post("/api/video/projects").send({ name, description: "Interview footage." });
  expect(res.status).toBe(201);
  return res.body as any;
}

async function addMember(projectId: string, email: string, role: string) {
  state.userId = "captain-1";
  const res = await request(API)
    .post(`/api/video/projects/${projectId}/members`)
    .send({ uid: tandemUid(state.clerkEmailToUser[email] ?? ""), role });
  expect(res.status).toBe(201);
}

async function uploadAsset(projectId: string, fileName = "interview-cam-a.mp4") {
  const res = await request(API)
    .post(`/api/video/projects/${projectId}/assets`)
    .field("kind", "RAW_VIDEO")
    .attach("file", Buffer.from("fake video bytes"), fileName);
  expect(res.status).toBe(201);
  return res.body as any;
}

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker pipeline (demo mode)", () => {
  it("uploads enqueue PROXY + TRANSCRIBE jobs and the worker processes them", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);

    const queued = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    expect(queued.status).toBe(200);
    const types = queued.body.map((job: any) => job.type).sort();
    expect(types).toEqual(["PROXY", "TRANSCRIBE"]);
    expect(queued.body.every((job: any) => job.status === "QUEUED")).toBe(true);

    await runWorkerCycle();

    const after = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    expect(after.body.every((job: any) => job.status === "SUCCEEDED")).toBe(true);

    const detail = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.files.some((file: any) => file.kind === "PROXY")).toBe(true);
    expect(detail.body.transcript).not.toBeNull();
    expect(detail.body.transcript.status).toBe("DEMO");
    expect(detail.body.transcript.segments.length).toBeGreaterThan(0);
    expect(detail.body.transcript.segments[0].text).toContain("Demo transcript");
  });

  it("marks the asset PROCESSED once both jobs succeed", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);
    await runWorkerCycle();

    const detail = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}`);
    expect(detail.body.status).toBe("PROCESSED");
  });

  it("streams the proxy file to members only", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);
    await runWorkerCycle();

    state.userId = "captain-1";
    const stream = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}/proxy`);
    expect(stream.status).toBe(200);
    expect(stream.body).toBeInstanceOf(Buffer);

    state.userId = "stranger-1";
    const forbidden = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}/proxy`);
    expect(forbidden.status).toBe(403);
  });

  it("returns 404 for a proxy before processing runs", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);
    const res = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}/proxy`);
    expect(res.status).toBe(404);
  });
});

describe("timelines (Git-style versions)", () => {
  it("returns an empty timeline state before anything is saved", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const res = await request(API).get(`/api/video/projects/${project.id}/timelines/SELECTS`);
    expect(res.status).toBe(200);
    expect(res.body.leg).toBe("SELECTS");
    expect(res.body.version).toBeNull();
    expect(res.body.versions).toEqual([]);
  });

  it("saves snapshots as versions and lists history newest first", async () => {
    const project = await createProject();
    await addMember(project.id, "architect@example.com", "VIDEO");

    state.userId = "architect-1";
    const first = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: "a1", inMs: 0, outMs: 5000 }] }, message: "Hook and setup" });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(1);
    expect(first.body.versions).toHaveLength(1);

    const second = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: "a1", inMs: 0, outMs: 5000 }, { id: "c2", assetId: "a1", inMs: 5000, outMs: 9000 }] }, message: "Add the payoff" });
    expect(second.status).toBe(200);
    expect(second.body.version).toBe(2);
    expect(second.body.versions).toHaveLength(2);
    expect(second.body.versions[0].version).toBe(2);
    expect(second.body.versions[0].message).toBe("Add the payoff");
  });

  it("reads one version's full snapshot for diffing", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const first = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: "a1", inMs: 0, outMs: 5000 }] }, message: "v1" });
    const v1Id = first.body.versions[0].id;

    const detail = await request(API).get(`/api/video/projects/${project.id}/timelines/SELECTS/versions/${v1Id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.version).toBe(1);
    expect(detail.body.message).toBe("v1");
    expect(detail.body.snapshot.clips[0].id).toBe("c1");
    expect(detail.body.parentVersionId).toBeNull();

    // A version from another timeline (or a bogus id) is not found.
    const missing = await request(API).get(`/api/video/projects/${project.id}/timelines/SELECTS/versions/nope`);
    expect(missing.status).toBe(404);
  });

  it("only the leg role (or Captain) can save a timeline", async () => {
    const project = await createProject();
    await addMember(project.id, "thumb@example.com", "THUMBNAIL");

    // A member with a different role (THUMBNAIL) cannot touch the SELECTS leg.
    state.userId = "thumb-1";
    const forbidden = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [] } });
    expect(forbidden.status).toBe(403);

    state.userId = "architect-1"; // not a member
    const notMember = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [] } });
    expect(notMember.status).toBe(403);
  });

  it("rollback restores a previous snapshot as a new head version", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "v1clip" }] }, message: "v1" });
    const second = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "v2clip" }] }, message: "v2" });
    expect(second.body.snapshot.clips[0].id).toBe("v2clip");

    const targetId = second.body.versions[1].id; // v1
    const rolled = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/SELECTS/rollback`)
      .send({ versionId: targetId });
    expect(rolled.status).toBe(200);
    expect(rolled.body.snapshot.clips[0].id).toBe("v1clip");
    expect(rolled.body.version).toBe(3);
    expect(rolled.body.versions).toHaveLength(3);
  });
});

describe("thumbnail leg (5th leg)", () => {
  it("saves thumbnail documents (chosen design + title + style) as versions", async () => {
    const project = await createProject();
    await addMember(project.id, "thumb@example.com", "THUMBNAIL");

    state.userId = "thumb-1";
    const first = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/THUMBNAIL`)
      .send({ snapshot: { designs: [{ id: "d1", assetId: "design-a", title: "I Tested the $10k Camera", style: "TEXT_OVERLAY" }] }, message: "First cover" });
    expect(first.status).toBe(200);
    expect(first.body.leg).toBe("THUMBNAIL");
    expect(first.body.version).toBe(1);
    expect(first.body.snapshot.designs[0].style).toBe("TEXT_OVERLAY");

    const second = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/THUMBNAIL`)
      .send({ snapshot: { designs: [{ id: "d1", assetId: "design-b", title: "I Tested the $10k Camera", style: "FACE_CLOSEUP" }] }, message: "Swap the image" });
    expect(second.status).toBe(200);
    expect(second.body.version).toBe(2);
    expect(second.body.versions).toHaveLength(2);
  });

  it("only the Thumbnail Designer (or Captain) can edit the THUMBNAIL leg", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");

    state.userId = "editor-1";
    const forbidden = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/THUMBNAIL`)
      .send({ snapshot: { designs: [{ assetId: "design-a" }] } });
    expect(forbidden.status).toBe(403);

    state.userId = "thumb-1"; // not a member
    const notMember = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/THUMBNAIL`)
      .send({ snapshot: { designs: [{ assetId: "design-a" }] } });
    expect(notMember.status).toBe(403);

    state.userId = "captain-1";
    const captain = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/THUMBNAIL`)
      .send({ snapshot: { designs: [{ assetId: "design-a" }] } });
    expect(captain.status).toBe(200);
  });

  it("submits a thumbnail pass for the Captain to review", async () => {
    const project = await createProject();
    await addMember(project.id, "thumb@example.com", "THUMBNAIL");

    state.userId = "thumb-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/THUMBNAIL`)
      .send({ snapshot: { designs: [{ assetId: "design-a", title: "Title", style: "MINIMAL" }] }, message: "v1" });

    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "THUMBNAIL", note: "Cover v1" });
    expect(submitted.status).toBe(201);
    expect(submitted.body.leg).toBe("THUMBNAIL");
    expect(submitted.body.status).toBe("SUBMITTED");

    state.userId = "captain-1";
    const approved = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");
  });
});

describe("checkout (external-first EDL bridge)", () => {
  it("formats EDL timecode as HH:MM:SS:FF at 25fps", () => {
    expect(formatEdlTimecode(0)).toBe("00:00:00:00");
    expect(formatEdlTimecode(1000)).toBe("00:00:01:00");
    expect(formatEdlTimecode(60000)).toBe("00:01:00:00");
    expect(formatEdlTimecode(3600000 + 2000)).toBe("01:00:02:00");
  });

  it("downloads a CMX3600 EDL for a saved cut and lists referenced media", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    const camB = await uploadAsset(project.id, "broll-shot.mp4");

    state.userId = "captain-1";
    const empty = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout`);
    expect(empty.status).toBe(400);

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({
        snapshot: {
          clips: [
            { id: "clip-1", assetId: camA.id, inMs: 0, outMs: 5000 },
            { id: "clip-2", assetId: camB.id, inMs: 5000, outMs: 9000 },
          ],
        },
        message: "Rough cut",
      });

    const res = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(".edl");
    expect(res.text).toContain("TITLE:");
    expect(res.text).toContain("FCM: NON-DROP FRAME");
    expect(res.text).toContain("INTERVIEW-CAM-A");
    expect(res.text).toContain("* FROM CLIP NAME: interview-cam-a.mp4");
    expect(res.text).toContain("* MEDIA MANIFEST");
    expect(res.text).toContain("broll-shot.mp4");

    const manifest = await request(API).get(
      `/api/video/projects/${project.id}/timelines/CUT/checkout/manifest`,
    );
    expect(manifest.status).toBe(200);
    expect(manifest.body.media).toHaveLength(2);
    expect(manifest.body.media[0].fileName).toBe("interview-cam-a.mp4");
    expect(manifest.body.media[0].downloadPath).toContain(`/files/${camA.id}/download`);
  });

  it("restricts checkout to project members", async () => {
    const project = await createProject();
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: "a1", inMs: 0, outMs: 1000 }] } });

    state.userId = "stranger-1";
    const forbidden = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout`);
    expect(forbidden.status).toBe(403);

    state.userId = null;
    const unauth = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout`);
    expect(unauth.status).toBe(401);
  });
});

describe("import (external-first EDL round-trip)", () => {
  it("round-trips timecode and parses events with comment metadata", () => {
    expect(parseEdlTimecode(formatEdlTimecode(45240))).toBe(45240);

    const events = parseTimelineEdl(`TITLE: x
FCM: NON-DROP FRAME

001  INTERVIEW-CAM-A  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
* FROM CLIP NAME: interview-cam-a.mp4
* FROM CLIP: asset-1
`);
    expect(events).toHaveLength(1);
    expect(events[0].reel).toBe("INTERVIEW-CAM-A");
    expect(events[0].fromClipName).toBe("interview-cam-a.mp4");
    expect(events[0].fromClipId).toBe("asset-1");
    expect(events[0].recInMs).toBe(0);
    expect(events[0].recOutMs).toBe(5000);

    const { clips, unresolved } = resolveEdlEvents(events, [
      { id: "asset-1", fileName: "interview-cam-a.mp4" },
    ]);
    expect(clips).toHaveLength(1);
    expect(clips[0].assetId).toBe("asset-1");
    expect(unresolved).toEqual([]);
  });

  it("imports an EDL as a new version and submits it for review", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    const camB = await uploadAsset(project.id, "broll-shot.mp4");
    state.userId = "captain-1";

    const edl = `TITLE: imported cut
FCM: NON-DROP FRAME

001  INTERVIEW-CAM-A  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
* FROM CLIP NAME: interview-cam-a.mp4

002  BROLL-SHOT      V     C        00:00:00:00 00:00:03:00 00:00:05:00 00:00:08:00
* FROM CLIP NAME: broll-shot.mp4
`;

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ document: edl, message: "Finished in Premiere" });
    expect(res.status).toBe(201);
    expect(res.body.clips).toBe(2);
    expect(res.body.version).toBe(1);
    expect(res.body.submissionId).toBeTruthy();

    const timeline = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT`);
    expect(timeline.body.version).toBe(1);
    expect(timeline.body.snapshot.clips).toHaveLength(2);
    expect(timeline.body.snapshot.clips[0].assetId).toBe(camA.id);
    expect(timeline.body.snapshot.clips[1].assetId).toBe(camB.id);

    const submissions = await request(API).get(`/api/video/projects/${project.id}/submissions`);
    expect(submissions.body).toHaveLength(1);
    expect(submissions.body[0].status).toBe("SUBMITTED");
    expect(submissions.body[0].note).toBe("Finished in Premiere");
  });

  it("merges imported clips into the existing snapshot so leg-specific fields survive", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    state.userId = "captain-1";

    // A SOUND timeline already carries music/passes — the import must not wipe them.
    const save = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SOUND`)
      .send({
        snapshot: {
          clips: [],
          music: [{ id: "music-1", assetId: camA.id, inMs: 0, outMs: 30000, duckUnderSpeech: true }],
          passes: [{ id: "pass-1", action: "NOISE_REDUCTION", assetId: camA.id }],
          pickups: [],
          sceneBlocks: [],
          markers: [],
        },
        message: "first mix",
      });
    expect(save.status).toBe(200);

    const edl = `TITLE: edited mix
FCM: NON-DROP FRAME

001  INTERVIEW-CAM-A  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
* FROM CLIP NAME: interview-cam-a.mp4
`;

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/SOUND/import`)
      .send({ document: edl, message: "Re-cut from Premiere", submit: false });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(2);

    const timeline = await request(API).get(`/api/video/projects/${project.id}/timelines/SOUND`);
    expect(timeline.body.version).toBe(2);
    expect(timeline.body.snapshot.clips).toHaveLength(1);
    expect(timeline.body.snapshot.clips[0].assetId).toBe(camA.id);
    // Leg-specific fields survive the import.
    expect(timeline.body.snapshot.music).toHaveLength(1);
    expect(timeline.body.snapshot.music[0].id).toBe("music-1");
    expect(timeline.body.snapshot.passes).toHaveLength(1);
  });

  it("rejects an EDL whose sources are not in the vault", async () => {
    const project = await createProject();
    await uploadAsset(project.id, "interview-cam-a.mp4");
    state.userId = "captain-1";

    const edl = `TITLE: x
FCM: NON-DROP FRAME

001  MISSING-CLIP  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
* FROM CLIP NAME: missing-clip.mp4
`;

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ document: edl });
    expect(res.status).toBe(400);
    expect(res.body.unresolved).toEqual(["missing-clip.mp4"]);
  });

  it("requires the leg role and non-empty EDL content", async () => {
    const project = await createProject();

    state.userId = "captain-1";
    const empty = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ document: "   " });
    expect(empty.status).toBe(400);

    state.userId = "stranger-1";
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ document: "TITLE: x\n" });
    expect(forbidden.status).toBe(403);
  });
});

describe("import with attached media (phase 2 tail)", () => {
  it("lands the attached master in the vault and resolves the EDL against it", async () => {
    const project = await createProject();
    state.userId = "captain-1";

    const edl = `TITLE: pushed cut
FCM: NON-DROP FRAME

001  MASTER  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
* FROM CLIP NAME: master.mov
`;

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .field("format", "EDL")
      .field("document", edl)
      .field("message", "Pushed the master")
      .attach("media", Buffer.from("rendered master from premiere"), "master.mov");
    expect(res.status).toBe(201);
    expect(res.body.clips).toBe(1);
    expect(res.body.version).toBe(1);
    expect(res.body.submissionId).toBeTruthy();
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].fileName).toBe("master.mov");
    expect(res.body.media[0].kind).toBe("RAW_VIDEO");
    expect(res.body.media[0].deduplicated).toBe(false);

    // The attached file landed as a vault asset and the EDL relinked to it.
    const timeline = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT`);
    expect(timeline.body.snapshot.clips).toHaveLength(1);
    expect(timeline.body.snapshot.clips[0].assetId).toBe(res.body.media[0].id);

    // It enqueues the usual preview jobs (no dedupe hit on a fresh file). A
    // CUT import also auto-queues a PICTURE_LOCK render.
    const jobs = await state.db
      .select()
      .from(state.tables.tandemVideoJobsTable)
      .where(eq(state.tables.tandemVideoJobsTable.assetId, res.body.media[0].id));
    expect(jobs.map((job: any) => job.type).sort()).toEqual(["PROXY", "RENDER", "TRANSCRIBE"]);
  });

  it("dedupes attached media against existing vault content (no re-upload)", async () => {
    const project = await createProject();
    const existing = await uploadAsset(project.id, "master.mov");
    state.userId = "captain-1";

    const edl = `TITLE: re-push
FCM: NON-DROP FRAME

001  MASTER  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
* FROM CLIP NAME: master.mov
`;

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .field("format", "EDL")
      .field("document", edl)
      .attach("media", Buffer.from("fake video bytes"), "master.mov");
    expect(res.status).toBe(201);
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].deduplicated).toBe(true);
    expect(res.body.media[0].id).not.toBe(existing.id);

    // The new asset is a pointer to the existing blob — no second copy.
    const [existingRow] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, existing.id));
    const [attachedRow] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, res.body.media[0].id));
    expect(attachedRow.storageKey).toBe(existingRow.storageKey);
  });

  it("attaches multiple files and infers master vs stem kinds", async () => {
    const project = await createProject();
    state.userId = "captain-1";

    const edl = `TITLE: x
FCM: NON-DROP FRAME

001  CAM-A  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
* FROM CLIP NAME: cam-a.mp4
`;

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .field("format", "EDL")
      .field("document", edl)
      .attach("media", Buffer.from("cam bytes"), "cam-a.mp4")
      .attach("media", Buffer.from("stem bytes"), "dialogue-stem.wav");
    expect(res.status).toBe(201);
    expect(res.body.media).toHaveLength(2);
    expect(res.body.clips).toBe(1);

    const video = res.body.media.find((m: any) => m.fileName === "cam-a.mp4");
    const audio = res.body.media.find((m: any) => m.fileName === "dialogue-stem.wav");
    expect(video.kind).toBe("RAW_VIDEO");
    expect(audio.kind).toBe("RAW_AUDIO");
  });
});

describe("activity feed + version genealogy", () => {
  it("records and lists activity events across the relay, members only", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    state.userId = "captain-1";

    const edl = `TITLE: cut\nFCM: NON-DROP FRAME\n\n001  INTERVIEW-CAM-A  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00\n* FROM CLIP NAME: interview-cam-a.mp4\n`;
    const imported = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ document: edl });
    expect(imported.status).toBe(201);

    // A save lands a version_saved line too.
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({ snapshot: { clips: [], sceneBlocks: [], markers: [] }, message: "tighter ending" });

    const feed = await request(API).get(`/api/video/projects/${project.id}/activity`);
    expect(feed.status).toBe(200);
    // (sqlite stores timestamps at second precision, so within one test the
    // newest-first order can tie — assert the set and per-event content.)
    const types = feed.body.map((event: any) => event.eventType);
    expect(types).toEqual(
      expect.arrayContaining(["asset_uploaded", "version_imported", "submission_created", "version_saved"]),
    );
    const saved = feed.body.find((event: any) => event.eventType === "version_saved");
    expect(saved.summary).toContain("Saved CUT v2");
    expect(saved.summary).toContain("tighter ending");
    expect(saved.actorId).toBe("captain-1");
    // Actor ids resolve to Clerk display names (falling back to short ids).
    expect(saved.actorName).toBe("Ada Captain");
    // Leg-scoped events carry their leg; vault-wide events (uploads) carry none.
    expect(saved.leg).toBe("CUT");
    const importEvent = feed.body.find((event: any) => event.eventType === "version_imported");
    expect(importEvent.summary).toContain("Imported CUT v1 from EDL");
    expect(importEvent.resourceId).toBeTruthy();
    expect(importEvent.actorName).toBe("Ada Captain");
    expect(importEvent.leg).toBe("CUT");
    const uploaded = feed.body.find((event: any) => event.eventType === "asset_uploaded");
    expect(uploaded.leg).toBeNull();

    // The Captain's decision lands on the feed.
    const submissions = await request(API).get(`/api/video/projects/${project.id}/submissions`);
    await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submissions.body[0].id}/approve`,
    );
    const after = await request(API).get(`/api/video/projects/${project.id}/activity`);
    const approved = after.body.find((event: any) => event.eventType === "submission_approved");
    expect(approved.summary).toContain("Approved CUT v1");
    expect(approved.leg).toBe("CUT");

    // The ?leg= query scopes the feed server-side to one stage's events.
    const cutOnly = await request(API).get(`/api/video/projects/${project.id}/activity?leg=CUT`);
    expect(cutOnly.status).toBe(200);
    expect(cutOnly.body.length).toBeGreaterThan(0);
    expect(cutOnly.body.every((event: any) => event.leg === "CUT")).toBe(true);
    // Vault-wide events (uploads) are not CUT-scoped and must not appear.
    expect(cutOnly.body.some((event: any) => event.eventType === "asset_uploaded")).toBe(false);

    // Strangers cannot read the feed.
    state.userId = "stranger-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/activity`)).status).toBe(403);
  });

  it("reports version genealogy chained to parents with review decisions", async () => {
    const project = await createProject();
    await uploadAsset(project.id, "interview-cam-a.mp4");
    state.userId = "captain-1";

    const edl = `TITLE: cut\nFCM: NON-DROP FRAME\n\n001  INTERVIEW-CAM-A  V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00\n* FROM CLIP NAME: interview-cam-a.mp4\n`;
    await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ document: edl });
    await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ document: edl.replace("00:00:05:00 00:00:00:00", "00:00:06:00 00:00:00:00") });

    const genealogy = await request(API).get(`/api/video/projects/${project.id}/genealogy`);
    expect(genealogy.status).toBe(200);
    const cut = genealogy.body.filter((entry: any) => entry.leg === "CUT");
    expect(cut).toHaveLength(2);
    expect(cut[0].version).toBe(1);
    expect(cut[0].parentVersion).toBeNull();
    expect(cut[1].version).toBe(2);
    expect(cut[1].parentVersionId).toBe(cut[0].id);
    expect(cut[1].parentVersion).toBe(1);

    // The first import auto-submitted v1, so the approval attaches to v1 —
    // the exact version the submission pinned. v2 has no review of its own.
    const submissions = await request(API).get(`/api/video/projects/${project.id}/submissions`);
    const pending = submissions.body.find((s: any) => s.leg === "CUT");
    await request(API).post(
      `/api/video/projects/${project.id}/submissions/${pending.id}/approve`,
    );
    const after = await request(API).get(`/api/video/projects/${project.id}/genealogy`);
    const v1 = after.body.find((entry: any) => entry.leg === "CUT" && entry.version === 1);
    const v2 = after.body.find((entry: any) => entry.leg === "CUT" && entry.version === 2);
    expect(v1.submission.status).toBe("APPROVED");
    expect(v1.submission.decidedById).toBe("captain-1");
    expect(v1.submission.decidedAt).toBeTruthy();
    expect(v2.submission).toBeNull();

    state.userId = "stranger-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/genealogy`)).status).toBe(403);
  });
});

describe("import (FCPXML round-trip)", () => {
  it("exports an FCPXML 1.9 project and re-imports it, relinking by uid", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    const camB = await uploadAsset(project.id, "broll-shot.mp4");
    state.userId = "captain-1";

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({
        snapshot: {
          clips: [
            { id: "clip-1", assetId: camA.id, inMs: 0, outMs: 5000 },
            { id: "clip-2", assetId: camB.id, inMs: 5000, outMs: 9000 },
          ],
        },
        message: "Rough cut",
      });

    const res = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout/fcpxml`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.headers["content-disposition"]).toContain(".fcpxml");
    expect(res.text).toContain(`<fcpxml version="1.9"`);
    expect(res.text).toContain(`<spine>`);
    expect(res.text).toContain(`ref="${camA.id}"`);
    expect(res.text).toContain(`uid="${camB.id}"`);

    // The push half: the exported document comes back, relinked by uid/ref.
    const imported = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ format: "FCPXML", document: res.text, message: "Back from Final Cut" });
    expect(imported.status).toBe(201);
    expect(imported.body.clips).toBe(2);
    expect(imported.body.version).toBe(2);
    expect(imported.body.submissionId).toBeTruthy();

    const timeline = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT`);
    expect(timeline.body.snapshot.clips).toHaveLength(2);
    expect(timeline.body.snapshot.clips[0].assetId).toBe(camA.id);
    expect(timeline.body.snapshot.clips[0].outMs).toBe(5000);
  });

  it("relinks FCPXML sources by file name for documents exported by an NLE", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    state.userId = "captain-1";

    const doc = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>
    <asset id="r2" name="interview-cam-a.mp4" src="file:///Volumes/Media/interview-cam-a.mp4" start="0s" duration="12000/25s" hasVideo="1" hasAudio="1" format="r1"/>
  </resources>
  <library>
    <event name="E"><project name="P"><sequence format="r1" duration="125/25s"><spine>
      <clip name="interview-cam-a.mp4" ref="r2" offset="0s" duration="125/25s" start="0s" format="r1" tcFormat="NDF"/>
    </spine></sequence></project></event>
  </library>
</fcpxml>`;

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ format: "FCPXML", document: doc });
    expect(res.status).toBe(201);
    expect(res.body.clips).toBe(1);

    const timeline = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT`);
    expect(timeline.body.snapshot.clips[0].assetId).toBe(camA.id);
    expect(timeline.body.snapshot.clips[0].inMs).toBe(0);
    expect(timeline.body.snapshot.clips[0].outMs).toBe(5000);
    expect(timeline.body.snapshot.clips[0].srcInMs).toBe(0);
  });

  it("rejects an FCPXML whose sources are not in the vault", async () => {
    const project = await createProject();
    state.userId = "captain-1";

    const doc = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>
    <asset id="r2" name="missing-clip.mp4" src="file:///vault/missing-clip.mp4" start="0s" duration="125/25s" format="r1"/>
  </resources>
  <library><event name="E"><project name="P"><sequence format="r1" duration="125/25s"><spine>
    <clip name="missing-clip.mp4" ref="r2" offset="0s" duration="125/25s" start="0s" format="r1"/>
  </spine></sequence></project></event></library>
</fcpxml>`;

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ format: "FCPXML", document: doc });
    expect(res.status).toBe(400);
    expect(res.body.unresolved).toEqual(["missing-clip.mp4"]);
  });
});

describe("import (OTIO round-trip)", () => {
  it("exports an OTIO Timeline and re-imports it, relinking by metadata.assetId", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    const camB = await uploadAsset(project.id, "broll-shot.mp4");
    state.userId = "captain-1";

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({
        snapshot: {
          clips: [
            { id: "clip-1", assetId: camA.id, inMs: 0, outMs: 5000 },
            { id: "clip-2", assetId: camB.id, inMs: 5000, outMs: 9000 },
          ],
        },
        message: "Rough cut",
      });

    const res = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout/otio`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toContain(".otio");
    expect(res.text).toContain('"OTIO_SCHEMA": "Timeline.1"');
    expect(res.text).toContain('"kind": "Video"');
    expect(res.text).toContain(`"assetId": "${camB.id}"`);

    // The push half: the exported document comes back, relinked by assetId.
    const imported = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ format: "OTIO", document: res.text, message: "Back through OTIO" });
    expect(imported.status).toBe(201);
    expect(imported.body.clips).toBe(2);
    expect(imported.body.version).toBe(2);
    expect(imported.body.submissionId).toBeTruthy();

    const timeline = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT`);
    expect(timeline.body.snapshot.clips).toHaveLength(2);
    expect(timeline.body.snapshot.clips[0].assetId).toBe(camA.id);
    expect(timeline.body.snapshot.clips[0].inMs).toBe(0);
    expect(timeline.body.snapshot.clips[0].outMs).toBe(5000);
    expect(timeline.body.snapshot.clips[1].assetId).toBe(camB.id);
    expect(timeline.body.snapshot.clips[1].outMs).toBe(9000);
  });

  it("rejects an OTIO whose sources are not in the vault", async () => {
    const project = await createProject();
    state.userId = "captain-1";

    const doc = JSON.stringify({
      OTIO_SCHEMA: "Timeline.1",
      name: "P",
      tracks: {
        children: [
          {
            kind: "Video",
            children: [
              {
                OTIO_SCHEMA: "Clip.1",
                name: "missing-clip.mp4",
                source_range: { start_time: { value: 0, rate: 25 }, duration: { value: 125, rate: 25 } },
                media_references: { target_url: "file:///vault/missing-clip.mp4" },
              },
            ],
          },
        ],
      },
    });

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/import`)
      .send({ format: "OTIO", document: doc });
    expect(res.status).toBe(400);
    expect(res.body.unresolved).toEqual(["file:///vault/missing-clip.mp4"]);
  });
});

describe("checkout AAF (export-only)", () => {
  it("downloads a binary .aaf with a valid CFB container and MasterMob", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    const camB = await uploadAsset(project.id, "broll-shot.mp4");
    state.userId = "captain-1";

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({
        snapshot: {
          clips: [
            { id: "clip-1", assetId: camA.id, inMs: 0, outMs: 5000 },
            { id: "clip-2", assetId: camB.id, inMs: 5000, outMs: 9000 },
          ],
        },
        message: "Rough cut",
      });

    const res = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout/aaf`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/octet-stream");
    expect(res.headers["content-disposition"]).toContain(".aaf");

    const buf = res.body as Buffer;
    // CFB magic + little-endian sector shift 12 (4096-byte sectors)
    expect(buf.subarray(0, 8).toString("hex")).toBe("d0cf11e0a1b11ae1");
    expect(buf.readUInt16LE(28)).toBe(0xfffe);
    expect(buf.readUInt16LE(30)).toBe(12);
    // The project title + source names appear as UTF-16LE in the directory tree.
    const utf16le = (s: string) => Buffer.from(`${s}\u0000`, "utf16le");
    expect(buf.indexOf(utf16le("The Salt Road Vlog — CUT"))).toBeGreaterThan(-1);
    expect(buf.indexOf(utf16le("interview-cam-a.mp4"))).toBeGreaterThan(-1);
    expect(buf.indexOf(utf16le("broll-shot.mp4"))).toBeGreaterThan(-1);
    // AAF properties streams begin with the little-endian marker 0x4c.
    expect(buf.indexOf(Buffer.from([0x4c, 0x20]))).toBeGreaterThan(-1);
  });

  it("rejects AAF checkout when no snapshot exists", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const res = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout/aaf`);
    expect(res.status).toBe(400);
  });
});

describe("checkout export bundle (EXPORT_BUNDLE job)", () => {
  it("enqueues, processes, and downloads a zip of all interchange docs", async () => {
    const project = await createProject();
    const camA = await uploadAsset(project.id, "interview-cam-a.mp4");
    const camB = await uploadAsset(project.id, "broll-shot.mp4");
    state.userId = "captain-1";

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({
        snapshot: {
          clips: [
            { id: "clip-1", assetId: camA.id, inMs: 0, outMs: 5000 },
            { id: "clip-2", assetId: camB.id, inMs: 5000, outMs: 9000 },
          ],
        },
        message: "Rough cut",
      });

    // No bundle yet → 404 on state + download.
    const none = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout/bundle`);
    expect(none.status).toBe(404);
    const noDownload = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout/bundle/download`);
    expect(noDownload.status).toBe(404);

    // Enqueue — with includeMedia so the originals ride along.
    const enqueued = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/checkout/export`)
      .send({ includeMedia: true });
    expect(enqueued.status).toBe(201);
    expect(enqueued.body.type).toBe("EXPORT_BUNDLE");
    expect(enqueued.body.status).toBe("QUEUED");
    expect(enqueued.body.assetId).toBeNull(); // project-scoped, no anchor asset

    // Dedupe while one is already queued/running.
    const dup = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/checkout/export`)
      .send({});
    expect(dup.status).toBe(409);

    // The bundle state endpoint reports the queued job.
    const bundleState = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout/bundle`);
    expect(bundleState.status).toBe(200);
    expect(bundleState.body.type).toBe("EXPORT_BUNDLE");
    expect(bundleState.body.params.leg).toBe("CUT");

    // Process it through the real worker pipeline.
    await runWorkerCycle();
    const done = await request(API).get(`/api/video/projects/${project.id}/timelines/CUT/checkout/bundle`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("SUCCEEDED");
    expect(done.body.result.storageKey).toContain(".zip");

    // Download is a valid store ZIP with every interchange doc + media.
    // superagent parses unknown content types as text, so grab the raw bytes.
    const dl = await request(API)
      .get(`/api/video/projects/${project.id}/timelines/CUT/checkout/bundle/download`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toContain("application/zip");
    const zip = dl.body as Buffer;
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local file header magic
    const names = listZipEntries(zip);
    expect(names.some((n) => n.endsWith(".edl"))).toBe(true);
    expect(names.some((n) => n.endsWith(".fcpxml"))).toBe(true);
    expect(names.some((n) => n.endsWith(".otio"))).toBe(true);
    expect(names.some((n) => n.endsWith(".aaf"))).toBe(true);
    expect(names.some((n) => n.endsWith(".manifest.json"))).toBe(true);
    expect(names.some((n) => n.startsWith("media/"))).toBe(true);

    // Manifest lists both referenced sources; the EDL contains both clips.
    const manifest = JSON.parse(
      readZipEntry(zip, names.find((n) => n.endsWith(".manifest.json"))!)!.toString("utf8"),
    );
    expect(manifest.leg).toBe("CUT");
    expect(manifest.media).toHaveLength(2);
    const edl = readZipEntry(zip, names.find((n) => n.endsWith(".edl"))!)!.toString("utf8");
    expect(edl).toContain("INTERVIEW-CAM-A");
    expect(edl).toContain("BROLL-SHOT");
  });

  it("rejects an export when no snapshot exists", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/checkout/export`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("submissions (Captain review)", () => {
  it("submits the current snapshot, then the Captain approves", async () => {
    const project = await createProject();
    await addMember(project.id, "architect@example.com", "VIDEO");

    state.userId = "architect-1";
    const noSnapshot = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS", note: "nothing saved" });
    expect(noSnapshot.status).toBe(400);

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "c1" }] }, message: "The selects" });

    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS", note: "Ready for review" });
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe("SUBMITTED");

    const duplicate = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS" });
    expect(duplicate.status).toBe(409);

    state.userId = "captain-1";
    const approved = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");
    expect(approved.body.decidedById).toBe("captain-1");
    expect(approved.body.decidedAt).not.toBeNull();
  });

  it("only the Captain can approve or reject", async () => {
    const project = await createProject();
    await addMember(project.id, "architect@example.com", "VIDEO");
    state.userId = "architect-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [] } });
    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS" });

    state.userId = "architect-1";
    const forbidden = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/reject`,
    );
    expect(forbidden.status).toBe(403);

    state.userId = "captain-1";
    const rejected = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/reject`,
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("REJECTED");

    const redecide = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/approve`,
    );
    expect(redecide.status).toBe(409);
  });
});

describe("timecode comments", () => {
  it("creates, lists, and resolves comments", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const created = await request(API)
      .post(`/api/video/projects/${project.id}/comments`)
      .send({ leg: "SELECTS", timecodeMs: 134000, body: "The lighting shift at 02:14 is jarring." });
    expect(created.status).toBe(201);
    expect(created.body.timecodeMs).toBe(134000);

    const list = await request(API).get(`/api/video/projects/${project.id}/comments`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const patch = await request(API)
      .patch(`/api/video/projects/${project.id}/comments/${created.body.id}`)
      .send({ resolved: true });
    expect(patch.status).toBe(200);
    expect(patch.body.resolvedAt).not.toBeNull();

    const reopened = await request(API)
      .patch(`/api/video/projects/${project.id}/comments/${created.body.id}`)
      .send({ resolved: false });
    expect(reopened.body.resolvedAt).toBeNull();
  });

  it("only the author or Captain can resolve", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    state.userId = "captain-1";
    const created = await request(API)
      .post(`/api/video/projects/${project.id}/comments`)
      .send({ body: "Check this beat." });

    state.userId = "editor-1";
    const forbidden = await request(API)
      .patch(`/api/video/projects/${project.id}/comments/${created.body.id}`)
      .send({ resolved: true });
    expect(forbidden.status).toBe(403);
  });

  it("stores spatial annotations (geometry/kind/color/label) with review scoping", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const asset = await uploadAsset(project.id);

    const pin = await request(API)
      .post(`/api/video/projects/${project.id}/comments`)
      .send({
        leg: "SELECTS",
        assetId: asset.id,
        timecodeMs: 42000,
        body: "The mic boom dips into frame here.",
        kind: "PIN",
        geometry: { x: 0.62, y: 0.3 },
        color: "#e05252",
        label: "A",
        submissionId: "sub-1",
        timelineVersionId: "ver-9",
      });
    expect(pin.status).toBe(201);
    expect(pin.body.kind).toBe("PIN");
    expect(pin.body.geometry).toEqual({ x: 0.62, y: 0.3 });
    expect(pin.body.color).toBe("#e05252");
    expect(pin.body.label).toBe("A");
    expect(pin.body.submissionId).toBe("sub-1");
    expect(pin.body.timelineVersionId).toBe("ver-9");

    // Plain timecode notes default to kind TIMECODE with no geometry.
    const note = await request(API)
      .post(`/api/video/projects/${project.id}/comments`)
      .send({ leg: "SELECTS", body: "Project-level note." });
    expect(note.status).toBe(201);
    expect(note.body.kind).toBe("TIMECODE");
    expect(note.body.geometry).toBeNull();

    const list = await request(API).get(`/api/video/projects/${project.id}/comments`);
    expect(list.body).toHaveLength(2);
    expect(list.body.find((c: any) => c.kind === "PIN").timelineVersionId).toBe("ver-9");
  });

  it("rejects comments pinned to an asset from another project", async () => {
    const projectA = await createProject();
    const projectB = await createProject("captain-2", "Other Vlog");
    const asset = await uploadAsset(projectB.id); // uploads as captain-2 (owner of B)

    state.userId = "captain-1";
    const res = await request(API)
      .post(`/api/video/projects/${projectA.id}/comments`)
      .send({ assetId: asset.id, body: "Wrong project" });
    expect(res.status).toBe(400);
  });
});

describe("M2 — multi-cam sync (Visual Editor)", () => {
  it("queues a sync job (CUT role only) and the worker writes a sync pair", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    const camA = await uploadAsset(project.id, "cam-a.mp4");
    const camB = await uploadAsset(project.id, "cam-b.mp4");

    state.userId = "architect-1"; // not a member
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/assets/${camA.id}/sync`)
      .send({ targetAssetId: camB.id });
    expect(forbidden.status).toBe(403);

    state.userId = "editor-1";
    const queued = await request(API)
      .post(`/api/video/projects/${project.id}/assets/${camA.id}/sync`)
      .send({ targetAssetId: camB.id });
    expect(queued.status).toBe(201);
    expect(queued.body.type).toBe("SYNC");
    expect(queued.body.status).toBe("QUEUED");
    expect(queued.body.params.targetAssetId).toBe(camB.id);

    await runWorkerCycle();

    const syncs = await request(API).get(`/api/video/projects/${project.id}/syncs`);
    expect(syncs.status).toBe(200);
    expect(syncs.body).toHaveLength(1);
    expect(syncs.body[0].primaryAssetId).toBe(camA.id);
    expect(syncs.body[0].targetAssetId).toBe(camB.id);
    expect(syncs.body[0].method).toBe("DEMO");
    expect(syncs.body[0].status).toBe("SYNCED");
  });

  it("rejects self-sync and cross-project sync targets", async () => {
    const projectA = await createProject();
    const projectB = await createProject("captain-2", "Other Vlog");
    await addMember(projectA.id, "editor@example.com", "VIDEO");
    const camA = await uploadAsset(projectA.id, "cam-a.mp4");
    state.userId = "captain-2";
    const otherCam = await uploadAsset(projectB.id, "other.mp4");

    state.userId = "editor-1";
    const selfSync = await request(API)
      .post(`/api/video/projects/${projectA.id}/assets/${camA.id}/sync`)
      .send({ targetAssetId: camA.id });
    expect(selfSync.status).toBe(400);

    const crossProject = await request(API)
      .post(`/api/video/projects/${projectA.id}/assets/${camA.id}/sync`)
      .send({ targetAssetId: otherCam.id });
    expect(crossProject.status).toBe(400);
  });

  it("requires membership to list syncs", async () => {
    const project = await createProject();
    state.userId = "stranger-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/syncs`)).status).toBe(403);
    state.userId = null;
    expect((await request(API).get(`/api/video/projects/${project.id}/syncs`)).status).toBe(401);
  });
});

describe("M2 — renders (preview + picture-lock)", () => {
  it("queues a preview render from the CUT snapshot", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    const camA = await uploadAsset(project.id, "cam-a.mp4");

    state.userId = "editor-1";
    const noClips = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/render`)
      .send({ format: "PREVIEW" });
    expect(noClips.status).toBe(400);

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: camA.id, inMs: 0, outMs: 8000 }] }, message: "First cut" });

    const queued = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/render`)
      .send({ format: "PREVIEW" });
    expect(queued.status).toBe(201);
    expect(queued.body.type).toBe("RENDER");
    expect(queued.body.params.format).toBe("PREVIEW");
    expect(queued.body.params.leg).toBe("CUT");

    // Dedupe: a second render while one is queued → 409.
    const duplicate = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/render`)
      .send({ format: "PREVIEW" });
    expect(duplicate.status).toBe(409);

    await runWorkerCycle();

    const jobs = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    const render = jobs.body.find((job: any) => job.type === "RENDER");
    expect(render.status).toBe("SUCCEEDED");
    expect(render.result.demo).toBe(true);
    expect(render.result.format).toBe("PREVIEW");
  });

  it("auto-queues a picture-lock render when the CUT leg is submitted", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    const camA = await uploadAsset(project.id, "cam-a.mp4");

    state.userId = "editor-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: camA.id, inMs: 0, outMs: 8000 }] } });
    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "CUT", note: "Picture locked" });
    expect(submitted.status).toBe(201);

    await runWorkerCycle();

    const jobs = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    const renders = jobs.body.filter((job: any) => job.type === "RENDER");
    expect(renders.length).toBe(1);
    expect(renders[0].params.format).toBe("PICTURE_LOCK");
    expect(renders[0].status).toBe("SUCCEEDED");
  });

  it("only the leg role (or Captain) can queue a render", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    await addMember(project.id, "thumb@example.com", "THUMBNAIL");
    const camA = await uploadAsset(project.id, "cam-a.mp4");
    state.userId = "captain-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: camA.id, inMs: 0, outMs: 8000 }] } });

    state.userId = "thumb-1"; // wrong leg role
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/render`)
      .send({ format: "PREVIEW" });
    expect(forbidden.status).toBe(403);
  });
});

describe("authorization on M1 routes", () => {
  it("rejects unauthenticated M1 requests", async () => {
    state.userId = null;
    expect((await request(API).get("/api/video/projects/x/assets/y")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/assets/y/proxy")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/timelines/SELECTS")).status).toBe(401);
    expect((await request(API).put("/api/video/projects/x/timelines/SELECTS").send({ snapshot: {} })).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/submissions")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/comments")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/jobs")).status).toBe(401);
  });

  it("non-members are blocked from M1 reads", async () => {
    const project = await createProject();
    state.userId = "stranger-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/assets/whatever`)).status).toBe(403);
    expect((await request(API).get(`/api/video/projects/${project.id}/timelines/SELECTS`)).status).toBe(403);
    expect((await request(API).get(`/api/video/projects/${project.id}/comments`)).status).toBe(403);
    expect((await request(API).get(`/api/video/projects/${project.id}/jobs`)).status).toBe(403);
  });
});
