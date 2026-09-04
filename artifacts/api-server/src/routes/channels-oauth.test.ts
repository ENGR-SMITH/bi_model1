import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { decryptSecret } from "../lib/secrets";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  clerkIdToName: {} as Record<string, string>,
  // Captured Google calls so tests can assert on the request shape.
  googleCalls: [] as Array<{ url: string; body?: string }>,
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

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", channelsRouter);
  return app;
}

const API = createApp();

/** Stub the Google endpoints the OAuth flow calls (token, channels, revoke). */
function stubGoogle() {
  state.googleCalls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : undefined;
    state.googleCalls.push({ url, body });

    // Token endpoint (exchange + refresh): grant an access token.
    if (url.includes("oauth2.googleapis.com/token")) {
      const params = new URLSearchParams(body ?? "");
      if (params.get("grant_type") === "refresh_token" && params.get("refresh_token") === "expired-refresh") {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(
        JSON.stringify({
          access_token: "ya29.stubbed-access",
          refresh_token: params.get("grant_type") === "refresh_token" ? undefined : "1//stubbed-refresh",
          expires_in: 3600,
          scope: "openid email youtube.readonly yt-analytics.readonly",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // YouTube channel lookup (mine=true) — the linking identity + branding.
    if (url.includes("youtube/v3/channels")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "UC-stubbed-youtube-channel",
              snippet: {
                title: "Ada Makes Games",
                description: "Let's plays and game dev logs",
                country: "US",
                thumbnails: { default: { url: "https://yt3.example/avatar.jpg" }, high: { url: "https://yt3.example/avatar-hi.jpg" } },
              },
              brandingSettings: { image: { bannerExternalUrl: "https://yt3.example/banner.jpg" } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Revoke endpoint.
    if (url.includes("oauth2.googleapis.com/revoke")) {
      return new Response(null, { status: 200 });
    }

    throw new Error(`Unexpected Google URL in stub: ${url}`);
  });
}

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
  await state.db.delete(t.tandemChannelOauthTable);
  await state.db.delete(t.tandemChannelMembersTable);
  await state.db.delete(t.tandemChannelsTable);
  state.userId = null;
  state.clerkIdToName = {};
}

beforeEach(async () => {
  await resetDb();
  state.userId = "user-1";
  state.clerkIdToName = { "user-1": "Ada Lovelace", "user-2": "Grace Hopper" };
  process.env.YOUTUBE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.YOUTUBE_REDIRECT_URI = "http://localhost:5175/creators-den/channels/oauth/callback";
  process.env.SESSION_SECRET = "test-session-secret";
  stubGoogle();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
  delete process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  delete process.env.YOUTUBE_REDIRECT_URI;
});

async function createChannel(name: string) {
  const res = await request(API).post("/api/channels").send({ name });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

/** Full happy-path link: start → consent URL → exchange → CONNECTED. */
async function linkChannel(channelId: string) {
  const started = await request(API).post(`/api/channels/${channelId}/oauth/start`);
  expect(started.status).toBe(200);
  const url = new URL(started.body.url);
  const stateParam = url.searchParams.get("state")!;
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();

  const exchanged = await request(API)
    .post(`/api/channels/${channelId}/oauth/exchange`)
    .send({ state: stateParam, code: "auth-code-from-google" });
  return exchanged;
}

describe("channel YouTube OAuth", () => {
  it("start returns a PKCE consent URL with the channelId", async () => {
    const { id } = await createChannel("Ada Makes Games");
    const res = await request(API).post(`/api/channels/${id}/oauth/start`);
    expect(res.status).toBe(200);
    expect(res.body.channelId).toBe(id);
    const url = new URL(res.body.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toContain("/creators-den/channels/oauth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("youtube.readonly");
    expect(url.searchParams.get("scope")).toContain("yt-analytics.readonly");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("refuses to start when YouTube OAuth credentials are not configured", async () => {
    delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
    const { id } = await createChannel("Unconfigured");
    const res = await request(API).post(`/api/channels/${id}/oauth/start`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not configured");
  });

  it("only the channel owner can start the link", async () => {
    const { id } = await createChannel("Private");
    state.userId = "user-2";
    const res = await request(API).post(`/api/channels/${id}/oauth/start`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("owner");
  });

  it("exchanges the code, stores encrypted tokens, and flips the channel to CONNECTED with branding", async () => {
    const { id } = await createChannel("Ada Makes Games");
    const exchanged = await linkChannel(id);
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.status).toBe("CONNECTED");
    expect(exchanged.body.youtubeConnected).toBe(true);
    expect(exchanged.body.youtubeChannelId).toBe("UC-stubbed-youtube-channel");
    expect(exchanged.body.youtubeTitle).toBe("Ada Makes Games");
    expect(exchanged.body.youtubeBannerUrl).toBe("https://yt3.example/banner.jpg");

    // The vault row holds ciphertext, never the plaintext token.
    const [oauth] = await state.db
      .select()
      .from(state.tables.tandemChannelOauthTable)
      .where(eq(state.tables.tandemChannelOauthTable.channelId, id));
    expect(oauth).toBeTruthy();
    expect(oauth.status).toBe("ACTIVE");
    expect(oauth.accessTokenCipher).not.toContain("ya29.stubbed-access");
    expect(decryptSecret(oauth.accessTokenCipher)).toBe("ya29.stubbed-access");
    expect(decryptSecret(oauth.refreshTokenCipher)).toBe("1//stubbed-refresh");

    // The token exchange sent the PKCE verifier to Google.
    const tokenCall = state.googleCalls.find((call) => call.url.includes("oauth2.googleapis.com/token"));
    const params = new URLSearchParams(tokenCall?.body ?? "");
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code-from-google");
    expect(params.get("code_verifier")).toBeTruthy();
    expect(params.get("redirect_uri")).toContain("/creators-den/channels/oauth/callback");
  });

  it("rejects a stale or forged state token", async () => {
    const { id } = await createChannel("Ada Makes Games");
    const res = await request(API)
      .post(`/api/channels/${id}/oauth/exchange`)
      .send({ state: "forged.invalid", code: "code" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("expired");

    const [channel] = await state.db
      .select()
      .from(state.tables.tandemChannelsTable)
      .where(eq(state.tables.tandemChannelsTable.id, id));
    expect(channel.status).toBe("CREATED");
  });

  it("refuses to bind a YouTube channel already linked to another workspace", async () => {
    const a = await createChannel("First");
    await linkChannel(a.id);

    // A second channel links to the same (stubbed) YouTube channel — rejected.
    const b = await createChannel("Second");
    const exchanged = await linkChannel(b.id);
    expect(exchanged.status).toBe(400);
    expect(exchanged.body.error).toContain("already linked");

    const [channelB] = await state.db
      .select()
      .from(state.tables.tandemChannelsTable)
      .where(eq(state.tables.tandemChannelsTable.id, b.id));
    expect(channelB.status).toBe("CREATED");
  });

  it("disconnect revokes the token, clears the vault, and keeps the channel", async () => {
    const { id } = await createChannel("Ada Makes Games");
    await linkChannel(id);

    const disconnected = await request(API).post(`/api/channels/${id}/oauth/disconnect`);
    expect(disconnected.status).toBe(200);
    expect(disconnected.body.status).toBe("CREATED");
    expect(disconnected.body.youtubeConnected).toBe(false);
    expect(disconnected.body.youtubeTitle).toBeNull();

    const vault = await state.db
      .select()
      .from(state.tables.tandemChannelOauthTable)
      .where(eq(state.tables.tandemChannelOauthTable.channelId, id));
    expect(vault).toEqual([]);

    // Google's revoke endpoint was called with the access token.
    const revokeCall = state.googleCalls.find((call) => call.url.includes("oauth2.googleapis.com/revoke"));
    expect(revokeCall).toBeTruthy();
    expect(new URLSearchParams(revokeCall?.body ?? "").get("token")).toBe("ya29.stubbed-access");
  });

  it("only the owner can disconnect", async () => {
    const { id } = await createChannel("Ada Makes Games");
    await linkChannel(id);
    state.userId = "user-2";
    const res = await request(API).post(`/api/channels/${id}/oauth/disconnect`);
    expect(res.status).toBe(403);
  });

  it("refresh marks the link REVOKED on invalid_grant", async () => {
    const { id } = await createChannel("Ada Makes Games");
    await linkChannel(id);

    // Force an expired access token + a dead refresh token, then request a
    // fresh token — the refresh path marks the link REVOKED and the channel
    // back to CREATED so the UI can offer reconnect.
    const [oauth] = await state.db
      .select()
      .from(state.tables.tandemChannelOauthTable)
      .where(eq(state.tables.tandemChannelOauthTable.channelId, id));
    await state.db
      .update(state.tables.tandemChannelOauthTable)
      .set({ accessTokenCipher: "stale", refreshTokenCipher: "expired-refresh", expiresAt: new Date(Date.now() - 1000) })
      .where(eq(state.tables.tandemChannelOauthTable.id, oauth.id));

    const { getChannelAccessToken } = await import("../channels/oauth");
    const token = await getChannelAccessToken(id);
    expect(token).toBeNull();

    const [after] = await state.db
      .select()
      .from(state.tables.tandemChannelOauthTable)
      .where(eq(state.tables.tandemChannelOauthTable.channelId, id));
    expect(after.status).toBe("REVOKED");
    const [channel] = await state.db
      .select()
      .from(state.tables.tandemChannelsTable)
      .where(eq(state.tables.tandemChannelsTable.id, id));
    expect(channel.status).toBe("CREATED");
  });
});