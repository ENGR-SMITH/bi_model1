import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { encryptSecret } from "../lib/secrets";
import { resetAnalyticsSyncThrottle } from "./channel-analytics";
import { runChannelSync } from "../youtube/sync";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  clerkIdToName: {} as Record<string, string>,
  googleCalls: [] as Array<{ url: string }>,
  failReports: false,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUserList: async (params: { limit?: number; offset?: number; userId?: string[] }) => {
        const all = () =>
          Object.entries(state.clerkIdToName).map(([id, name]) => {
            const [first, ...rest] = name.split(" ");
            return { id, firstName: first || null, lastName: rest.join(" ") || null, username: null, emailAddresses: [], imageUrl: `https://img.example/${id}.png` };
          });
        if (params.userId) {
          return { data: params.userId.map((id) => ({ id, firstName: state.clerkIdToName[id]?.split(" ")[0] ?? null, lastName: state.clerkIdToName[id]?.split(" ").slice(1).join(" ") || null, username: null, emailAddresses: [], imageUrl: `https://img.example/${id}.png` })) };
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
import channelsRouter from "./channels";
import channelAnalyticsRouter from "./channel-analytics";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", channelsRouter);
  app.use("/api", channelAnalyticsRouter);
  return app;
}

const API = createApp();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const UPLOADS_PLAYLIST = "UU-stubbed-uploads";

/** Stub the Google endpoints the sync engine calls with canned payloads. */
function stubGoogle() {
  state.googleCalls = [];
  state.failReports = false;
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);
    state.googleCalls.push({ url });

    // Catalog: the linked channel's uploads playlist id.
    if (url.includes("youtube/v3/channels") && url.includes("mine=true")) {
      return new Response(
        JSON.stringify({ items: [{ contentDetails: { relatedPlaylists: { uploads: UPLOADS_PLAYLIST } } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Catalog: two uploads on the playlist.
    if (url.includes("youtube/v3/playlistItems")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              contentDetails: { videoId: "vid-1" },
              snippet: { title: "First video", description: "desc 1", publishedAt: "2026-08-20T10:00:00Z", thumbnails: { high: { url: "https://img/v1.jpg" } } },
            },
            {
              contentDetails: { videoId: "vid-2" },
              snippet: { title: "Second video", description: "desc 2", publishedAt: "2026-08-25T10:00:00Z", thumbnails: { high: { url: "https://img/v2.jpg" } } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Catalog: batch duration/live enrichment.
    if (url.includes("youtube/v3/videos")) {
      return new Response(
        JSON.stringify({
          items: [
            { id: "vid-1", snippet: { liveBroadcastContent: "none" }, contentDetails: { duration: "PT4M12S" } },
            { id: "vid-2", snippet: { liveBroadcastContent: "none" }, contentDetails: { duration: "PT45S" } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Analytics reports.
    if (url.includes("youtubeAnalytics/v2/reports")) {
      if (state.failReports) {
        return new Response(JSON.stringify({ error: { code: 403, message: "quotaExceeded" } }), { status: 403, headers: { "content-type": "application/json" } });
      }
      const params = new URL(url).searchParams;
      const dimensions = params.get("dimensions") ?? "";
      const filters = params.get("filters") ?? "";
      const start = params.get("startDate") ?? addDays(todayStr(), -6);
      const end = params.get("endDate") ?? todayStr();

      if (dimensions === "elapsedVideoTimeRatio") {
        return new Response(
          JSON.stringify({
            columnHeaders: [{ name: "elapsedVideoTimeRatio" }, { name: "averageViewPercentage" }],
            rows: [[0.0, 82.5], [0.1, 70.0], [0.5, 30.0]],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (dimensions === "insightTrafficSourceType") {
        return new Response(
          JSON.stringify({
            columnHeaders: [{ name: "insightTrafficSourceType" }, { name: "views" }],
            rows: [["EXT_URL", 40], ["YT_SEARCH", 120]],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (dimensions === "insightPlaybackLocationType") {
        return new Response(
          JSON.stringify({ columnHeaders: [{ name: "insightPlaybackLocationType" }, { name: "views" }], rows: [["WATCH", 150]] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (dimensions === "ageGroup,gender") {
        return new Response(
          JSON.stringify({ columnHeaders: [{ name: "ageGroup" }, { name: "gender" }, { name: "viewerPercentage" }], rows: [["age18-24", "female", 12.0]] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (dimensions === "deviceType") {
        return new Response(
          JSON.stringify({ columnHeaders: [{ name: "deviceType" }, { name: "views" }], rows: [["MOBILE", 130]] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (dimensions === "day") {
        if (filters.startsWith("video==")) {
          // Per-video daily metrics over the requested window (full range —
          // the incremental sync must find nothing new on the second run).
          const rows: Array<Array<string | number | null>> = [];
          let day = start;
          let i = 0;
          while (day <= end && i < 92) {
            rows.push([day, 10 + i, 5, 60, 1, 0, 0, 0.5, 0.05, 100, 4.5]);
            day = addDays(day, 1);
            i += 1;
          }
          return new Response(
            JSON.stringify({
              columnHeaders: [
                { name: "day" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" },
                { name: "likes" }, { name: "comments" }, { name: "shares" }, { name: "estimatedRevenue" },
                { name: "estimatedAdRevenue" }, { name: "impressions" }, { name: "impressionsClickThroughRate" },
              ],
              rows,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        // Channel daily (+ SUBS — same shape, subscribers columns included).
        const rows: Array<Array<string | number | null>> = [];
        let day = start;
        let i = 0;
        while (day <= end && i < 92) {
          rows.push([day, 100 + i, 50, 30, 2, 1, 0, 0.5, 0.25, 5, 1]);
          day = addDays(day, 1);
          i += 1;
        }
        return new Response(
          JSON.stringify({
            columnHeaders: [
              { name: "day" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" },
              { name: "likes" }, { name: "comments" }, { name: "shares" }, { name: "subscribersGained" },
              { name: "subscribersLost" }, { name: "estimatedRevenue" }, { name: "estimatedAdRevenue" },
            ],
            rows,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected analytics report dimensions: ${dimensions}`);
    }

    throw new Error(`Unexpected Google URL in stub: ${url}`);
  });
}

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoDailyMetricsTable);
  await state.db.delete(t.tandemChannelDailyMetricsTable);
  await state.db.delete(t.tandemChannelAlertsTable);
  await state.db.delete(t.tandemAnalyticsReportsTable);
  await state.db.delete(t.tandemChannelSyncsTable);
  await state.db.delete(t.tandemChannelVideosTable);
  await state.db.delete(t.tandemVideoNotificationsTable);
  await state.db.delete(t.tandemChannelOauthTable);
  await state.db.delete(t.tandemChannelMembersTable);
  await state.db.delete(t.tandemChannelsTable);
  state.userId = null;
  state.clerkIdToName = {};
  resetAnalyticsSyncThrottle();
}

beforeEach(async () => {
  await resetDb();
  state.userId = "user-1";
  state.clerkIdToName = { "user-1": "Ada Lovelace", "user-2": "Grace Hopper" };
  stubGoogle();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function createChannel(name = "Ada Makes Games"): Promise<string> {
  const res = await request(API).post("/api/channels").send({ name });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

/** Directly mark a channel CONNECTED with an ACTIVE (encrypted) token vault. */
async function connectChannel(channelId: string) {
  const t = state.tables;
  await state.db.insert(t.tandemChannelOauthTable).values({
    id: "oauth-1",
    channelId,
    youtubeChannelId: "UC-stubbed-youtube-channel",
    accessTokenCipher: encryptSecret("ya29.stubbed-access"),
    refreshTokenCipher: encryptSecret("1//stubbed-refresh"),
    scope: "youtube.readonly yt-analytics.readonly",
    status: "ACTIVE",
    expiresAt: new Date(Date.now() + 3600_000),
    linkedByUserId: "user-1",
  });
  await state.db
    .update(t.tandemChannelsTable)
    .set({ status: "CONNECTED", youtubeChannelId: "UC-stubbed-youtube-channel", youtubeTitle: "Ada Makes Games" })
    .where(eq(t.tandemChannelsTable.id, channelId));
}

async function addEditor(channelId: string, userId: string) {
  await state.db.insert(state.tables.tandemChannelMembersTable).values({ id: `mem-${userId}`, channelId, userId, role: "EDITOR" });
}

function settle(ms = 80) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("channel analytics — auth and membership", () => {
  it("requires authentication on every analytics surface", async () => {
    const channelId = await createChannel();
    state.userId = null;
    expect((await request(API).get(`/api/channels/${channelId}/analytics/overview`)).status).toBe(401);
    expect((await request(API).get(`/api/channels/${channelId}/analytics/videos`)).status).toBe(401);
    expect((await request(API).post(`/api/channels/${channelId}/analytics/sync`)).status).toBe(401);
  });

  it("404s for a non-member and lets a member read", async () => {
    const channelId = await createChannel();
    state.userId = "user-2";
    expect((await request(API).get(`/api/channels/${channelId}/analytics/overview`)).status).toBe(404);
    await addEditor(channelId, "user-2");
    expect((await request(API).get(`/api/channels/${channelId}/analytics/overview`)).status).toBe(200);
    // Editors read but cannot sync.
    expect((await request(API).post(`/api/channels/${channelId}/analytics/sync`)).status).toBe(403);
  });

  it("only the owner can run a sync; repeated calls are throttled", async () => {
    const channelId = await createChannel();
    await connectChannel(channelId);
    const res = await request(API).post(`/api/channels/${channelId}/analytics/sync`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IDLE");
    const again = await request(API).post(`/api/channels/${channelId}/analytics/sync`);
    expect(again.status).toBe(429);
    await settle();
  });
});

describe("channel analytics — sync engine", () => {
  it("first sync backfills the catalog + daily metrics and records new uploads", async () => {
    const channelId = await createChannel();
    await connectChannel(channelId);

    const res = await request(API).post(`/api/channels/${channelId}/analytics/sync`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IDLE");
    expect(res.body.newVideosSeen).toBe(2);
    expect(res.body.lastVideoSyncAt).toBeTruthy();
    expect(res.body.lastMetricsSyncAt).toBeTruthy();

    const t = state.tables;
    const videos = await state.db.select().from(t.tandemChannelVideosTable).where(eq(t.tandemChannelVideosTable.channelId, channelId));
    expect(videos).toHaveLength(2);
    const byId = Object.fromEntries(videos.map((v: any) => [v.youtubeVideoId, v]));
    expect(byId["vid-1"].contentKind).toBe("LONG_FORM");
    expect(byId["vid-2"].contentKind).toBe("SHORT"); // 45s → SHORT

    const channelMetrics = await state.db.select().from(t.tandemChannelDailyMetricsTable).where(eq(t.tandemChannelDailyMetricsTable.channelId, channelId));
    expect(channelMetrics.length).toBeGreaterThan(0);
    const videoMetrics = await state.db.select().from(t.tandemVideoDailyMetricsTable);
    expect(videoMetrics.length).toBeGreaterThan(0);
  });

  it("second sync is incremental — no duplicate day rows, zero new uploads", async () => {
    const channelId = await createChannel();
    await connectChannel(channelId);
    await request(API).post(`/api/channels/${channelId}/analytics/sync`);
    await settle();

    const t = state.tables;
    const channelBefore = await state.db.select().from(t.tandemChannelDailyMetricsTable);
    const videoBefore = await state.db.select().from(t.tandemVideoDailyMetricsTable);

    // Second run direct (the manual-sync route throttles to 1/min): the engine
    // must be incremental — no duplicate day rows, zero new uploads.
    const result = await runChannelSync(channelId);
    expect(result.status).toBe("IDLE");
    expect(result.newVideosSeen).toBe(0);

    const channelAfter = await state.db.select().from(t.tandemChannelDailyMetricsTable);
    const videoAfter = await state.db.select().from(t.tandemVideoDailyMetricsTable);
    expect(channelAfter).toHaveLength(channelBefore.length);
    expect(videoAfter).toHaveLength(videoBefore.length);
    await settle();
  });

  it("a YouTube failure degrades to stored partials + ERROR state instead of a 500", async () => {
    const channelId = await createChannel();
    await connectChannel(channelId);
    state.failReports = true;

    const res = await request(API).post(`/api/channels/${channelId}/analytics/sync`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ERROR");
    expect(res.body.error).toBeTruthy();

    // Catalog rows were stored before the metrics failure.
    const videos = await state.db.select().from(state.tables.tandemChannelVideosTable).where(eq(state.tables.tandemChannelVideosTable.channelId, channelId));
    expect(videos).toHaveLength(2);
  });

  it("runs a sync when the channel is not linked and reports it honestly", async () => {
    const channelId = await createChannel(); // CREATED, no oauth row
    const res = await request(API).post(`/api/channels/${channelId}/analytics/sync`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ERROR");
    expect(res.body.error).toContain("not linked");
  });
});

describe("channel analytics — DB-backed reads", () => {
  it("serves overview KPIs + series from the snapshots without calling YouTube", async () => {
    const channelId = await createChannel();
    const t = state.tables;
    const day = addDays(todayStr(), -1);
    await state.db.insert(t.tandemChannelDailyMetricsTable).values({ channelId, day, metrics: { views: 100, watchTimeMinutes: 50, subscribersGained: 5 }, source: "youtube" });
    await state.db.insert(t.tandemChannelDailyMetricsTable).values({ channelId, day: todayStr(), metrics: { views: 200, watchTimeMinutes: 80, subscribersGained: 7 }, source: "youtube" });

    const res = await request(API).get(`/api/channels/${channelId}/analytics/overview`);
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({ views: 300, watchTimeMinutes: 130, subscribersGained: 12 });
    expect(res.body.series).toHaveLength(2);
    expect(res.body.status).toBeNull();
    // Reads never hit YouTube.
    expect(state.googleCalls).toHaveLength(0);
  });

  it("filters and sorts the video table, with cursor pagination", async () => {
    const channelId = await createChannel();
    const t = state.tables;
    await state.db.insert(t.tandemChannelVideosTable).values({
      id: "chanvid-1", channelId, youtubeVideoId: "vid-1", title: "Alpha video", description: "", thumbnails: { high: { url: "https://img/1.jpg" } },
      publishedAt: new Date("2026-08-20T10:00:00Z"), durationSeconds: 252, contentKind: "LONG_FORM",
    });
    await state.db.insert(t.tandemChannelVideosTable).values({
      id: "chanvid-2", channelId, youtubeVideoId: "vid-2", title: "Beta video", description: "", thumbnails: null,
      publishedAt: new Date("2026-08-25T10:00:00Z"), durationSeconds: 45, contentKind: "SHORT",
    });
    await state.db.insert(t.tandemVideoDailyMetricsTable).values({ videoRowId: "chanvid-1", day: todayStr(), metrics: { views: 500, impressions: 1000, impressionsClickThroughRate: 5 } });
    await state.db.insert(t.tandemVideoDailyMetricsTable).values({ videoRowId: "chanvid-2", day: todayStr(), metrics: { views: 50, impressions: 200, impressionsClickThroughRate: 2 } });

    // Search narrows.
    const search = await request(API).get(`/api/channels/${channelId}/analytics/videos?q=alpha`);
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].title).toBe("Alpha video");

    // Sort by views desc → Alpha first.
    const sorted = await request(API).get(`/api/channels/${channelId}/analytics/videos?sort=views`);
    expect(sorted.body.items.map((i: any) => i.videoRowId)).toEqual(["chanvid-1", "chanvid-2"]);

    // Cursor pagination.
    const page1 = await request(API).get(`/api/channels/${channelId}/analytics/videos?sort=views&limit=1`);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await request(API).get(`/api/channels/${channelId}/analytics/videos?sort=views&limit=1&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].videoRowId).toBe("chanvid-2");
  });

  it("serves video detail with totals, series, and channel medians", async () => {
    const channelId = await createChannel();
    const t = state.tables;
    await state.db.insert(t.tandemChannelVideosTable).values({
      id: "chanvid-1", channelId, youtubeVideoId: "vid-1", title: "Alpha video", description: "d", thumbnails: null,
      publishedAt: new Date("2026-08-20T10:00:00Z"), durationSeconds: 252, contentKind: "LONG_FORM",
    });
    await state.db.insert(t.tandemChannelVideosTable).values({
      id: "chanvid-2", channelId, youtubeVideoId: "vid-2", title: "Beta video", description: "d", thumbnails: null,
      publishedAt: new Date("2026-08-25T10:00:00Z"), durationSeconds: 45, contentKind: "SHORT",
    });
    const day = addDays(todayStr(), -1);
    await state.db.insert(t.tandemVideoDailyMetricsTable).values({ videoRowId: "chanvid-1", day, metrics: { views: 100, impressionsClickThroughRate: 4, averageViewDurationSeconds: 60 } });
    await state.db.insert(t.tandemVideoDailyMetricsTable).values({ videoRowId: "chanvid-1", day: todayStr(), metrics: { views: 200, impressionsClickThroughRate: 6, averageViewDurationSeconds: 90 } });
    await state.db.insert(t.tandemVideoDailyMetricsTable).values({ videoRowId: "chanvid-2", day: todayStr(), metrics: { views: 50, impressionsClickThroughRate: 2, averageViewDurationSeconds: 30 } });

    const res = await request(API).get(`/api/channels/${channelId}/analytics/videos/chanvid-1`);
    expect(res.status).toBe(200);
    expect(res.body.totals.views).toBe(300);
    expect(res.body.series).toHaveLength(2);
    // Median CTR across both videos' latest days: [6, 2] → 4.
    expect(res.body.channelMedians.impressionsClickThroughRate).toBe(4);
    expect((await request(API).get(`/api/channels/${channelId}/analytics/videos/nope`)).status).toBe(404);
  });

  it("serves a fresh report from the cache and returns stale=true with a kicked sync otherwise", async () => {
    const channelId = await createChannel();
    const t = state.tables;
    await state.db.insert(t.tandemChannelVideosTable).values({
      id: "chanvid-1", channelId, youtubeVideoId: "vid-1", title: "Alpha video", description: "", thumbnails: null,
      publishedAt: new Date("2026-08-20T10:00:00Z"), durationSeconds: 252, contentKind: "LONG_FORM",
    });

    // Fresh cache → served without any YouTube call.
    const today = todayStr();
    const periodStart = addDays(today, -27);
    await state.db.insert(t.tandemAnalyticsReportsTable).values({
      id: "report-1", channelId, videoRowId: "chanvid-1", kind: "RETENTION", periodStart, periodEnd: today,
      payload: [{ elapsedVideoTimeRatio: 0.0, averageViewPercentage: 80 }], fetchedAt: new Date(),
    });
    const fresh = await request(API).get(`/api/channels/${channelId}/analytics/videos/chanvid-1/report?kind=RETENTION`);
    expect(fresh.status).toBe(200);
    expect(fresh.body.stale).toBe(false);
    expect(fresh.body.rows).toHaveLength(1);
    expect(state.googleCalls).toHaveLength(0);

    // Stale cache → stale=true and a sync is kicked.
    await state.db
      .update(t.tandemAnalyticsReportsTable)
      .set({ fetchedAt: new Date(Date.now() - 2 * 360 * 60 * 1000) })
      .where(eq(t.tandemAnalyticsReportsTable.id, "report-1"));
    const stale = await request(API).get(`/api/channels/${channelId}/analytics/videos/chanvid-1/report?kind=RETENTION`);
    expect(stale.status).toBe(200);
    expect(stale.body.stale).toBe(true);
    // The kicked sync hits Google; let it settle so it can't race the next test.
    await settle();
  });
});

describe("channel analytics — anomaly alerts", () => {
  it("fires the weekly watch-time drop rule once and notifies the owner", async () => {
    const channelId = await createChannel();
    await connectChannel(channelId);
    const t = state.tables;

    // Seed 14 days: 1000 min/day last week, 100 min/day this week → 90% drop.
    const today = todayStr();
    for (let i = 13; i >= 0; i -= 1) {
      const day = addDays(today, -i);
      const minutes = i >= 7 ? 1000 : 100; // i=13..7 → previous week (high), i=6..0 → current week (low)
      await state.db.insert(t.tandemChannelDailyMetricsTable).values({ channelId, day, metrics: { watchTimeMinutes: minutes }, source: "youtube" });
    }

    const res = await request(API).post(`/api/channels/${channelId}/analytics/sync`);
    expect(res.status).toBe(200);
    await settle();

    const alerts = await state.db.select().from(t.tandemChannelAlertsTable);
    expect(alerts.some((a: any) => a.rule === "WATCH_TIME_DROP")).toBe(true);

    const notifications = await state.db.select().from(t.tandemVideoNotificationsTable);
    const alert = alerts.find((a: any) => a.rule === "WATCH_TIME_DROP");
    expect(notifications.some((n: any) => n.deepLink === `/creators-den/channels/${channelId}/analytics`)).toBe(true);
    expect(alert?.periodStart).toBe(addDays(today, -6));

    // Dedupe: a second sync (direct — the manual route throttles to 1/min)
    // does not fire the same window again.
    const result2 = await runChannelSync(channelId);
    expect(result2.status).toBe("IDLE");
    await settle();
    const alertsAfter = await state.db.select().from(t.tandemChannelAlertsTable);
    expect(alertsAfter.filter((a: any) => a.rule === "WATCH_TIME_DROP")).toHaveLength(1);
  });
});