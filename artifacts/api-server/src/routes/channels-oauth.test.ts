import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../lib/secrets";

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
  await state.db.delete(t.nexetVideoMembersTable);
  await state.db.delete(t.nexetVideoProjectsTable);
  await state.db.delete(t.nexetChannelOauthTable);
  await state.db.delete(t.nexetChannelMembersTable);
  await state.db.delete(t.nexetChannelsTable);
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
  vi.unstubAllEnvs();
  delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
  delete process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  delete process.env.YOUTUBE_REDIRECT_URI;
  delete process.env.NEXET_WEB_URL;
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

  it("in production, refuses to send Google a redirect URI that is still the localhost default", async () => {
    // YOUTUBE_REDIRECT_URI unset + NEXET_WEB_URL unset → the derived default is
    // http://localhost:5175/…, which Google can only answer with an opaque
    // redirect_uri_mismatch. The route must explain exactly what to configure
    // instead of bouncing the user to Google's error page.
    delete process.env.YOUTUBE_REDIRECT_URI;
    delete process.env.NEXET_WEB_URL;
    vi.stubEnv("NODE_ENV", "production");

    const { id } = await createChannel("Misconfigured");
    const res = await request(API).post(`/api/channels/${id}/oauth/start`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("NEXET_WEB_URL");
    expect(res.body.error).toContain("localhost");
  });

  it("falls back to the localhost default when NEXET_WEB_URL is set to an empty string", async () => {
    // A deploy dashboard can leave the var present but empty; `??` would treat
    // that as authoritative and produce a relative (unmatchable) redirect URI.
    delete process.env.YOUTUBE_REDIRECT_URI;
    vi.stubEnv("NEXET_WEB_URL", "");

    const { id } = await createChannel("Empty origin");
    const res = await request(API).post(`/api/channels/${id}/oauth/start`);
    expect(res.status).toBe(200);
    expect(new URL(res.body.url).searchParams.get("redirect_uri")).toBe(
      "http://localhost:5175/creators-den/channels/oauth/callback",
    );
  });

  it("strips a stray quote/whitespace around the configured redirect URI", async () => {
    vi.stubEnv("YOUTUBE_REDIRECT_URI", ' "https://nexet.co/creators-den/channels/oauth/callback" ');

    const { id } = await createChannel("Quoted");
    const res = await request(API).post(`/api/channels/${id}/oauth/start`);
    expect(res.status).toBe(200);
    expect(new URL(res.body.url).searchParams.get("redirect_uri")).toBe(
      "https://nexet.co/creators-den/channels/oauth/callback",
    );
  });

  it("accepts the derived redirect URI in production when NEXET_WEB_URL is the real origin", async () => {
    delete process.env.YOUTUBE_REDIRECT_URI;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXET_WEB_URL", "https://nexet.co");

    const { id } = await createChannel("Configured");
    const res = await request(API).post(`/api/channels/${id}/oauth/start`);
    expect(res.status).toBe(200);
    expect(new URL(res.body.url).searchParams.get("redirect_uri")).toBe(
      "https://nexet.co/creators-den/channels/oauth/callback",
    );
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
      .from(state.tables.nexetChannelOauthTable)
      .where(eq(state.tables.nexetChannelOauthTable.channelId, id));
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
      .from(state.tables.nexetChannelsTable)
      .where(eq(state.tables.nexetChannelsTable.id, id));
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
      .from(state.tables.nexetChannelsTable)
      .where(eq(state.tables.nexetChannelsTable.id, b.id));
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
      .from(state.tables.nexetChannelOauthTable)
      .where(eq(state.tables.nexetChannelOauthTable.channelId, id));
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
      .from(state.tables.nexetChannelOauthTable)
      .where(eq(state.tables.nexetChannelOauthTable.channelId, id));
    await state.db
      .update(state.tables.nexetChannelOauthTable)
      .set({
        accessTokenCipher: encryptSecret("stale-token"),
        refreshTokenCipher: encryptSecret("expired-refresh"),
        expiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(state.tables.nexetChannelOauthTable.id, oauth.id));

    const { getChannelAccessToken } = await import("../channels/oauth");
    const token = await getChannelAccessToken(id);
    expect(token).toBeNull();

    const [after] = await state.db
      .select()
      .from(state.tables.nexetChannelOauthTable)
      .where(eq(state.tables.nexetChannelOauthTable.channelId, id));
    expect(after.status).toBe("REVOKED");
    const [channel] = await state.db
      .select()
      .from(state.tables.nexetChannelsTable)
      .where(eq(state.tables.nexetChannelsTable.id, id));
    expect(channel.status).toBe("CREATED");
  });

  it("Google-first: start + exchange for a provisional id creates the channel from the picked YouTube channel", async () => {
    // The "+ New channel" flow with no typed name links against a provisional
    // channel id; the workspace row is minted on exchange, named after the
    // real YouTube channel.
    const provisionalId = "b7e91c2a-0f00-4000-8000-000000000001";
    const started = await request(API).post(`/api/channels/${provisionalId}/oauth/start`);
    expect(started.status).toBe(200);
    expect(started.body.channelId).toBe(provisionalId);
    const stateParam = new URL(started.body.url).searchParams.get("state")!;

    const exchanged = await request(API)
      .post(`/api/channels/${provisionalId}/oauth/exchange`)
      .send({ state: stateParam, code: "auth-code-from-google" });
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.status).toBe("CONNECTED");
    expect(exchanged.body.youtubeConnected).toBe(true);
    expect(exchanged.body.myRole).toBe("OWNER");
    // Named from the YouTube channel, and the card shows the branding.
    expect(exchanged.body.name).toBe("Ada Makes Games");
    expect(exchanged.body.youtubeChannelId).toBe("UC-stubbed-youtube-channel");
    expect(exchanged.body.youtubeAvatarUrl).toBe("https://yt3.example/avatar-hi.jpg");

    const [channel] = await state.db
      .select()
      .from(state.tables.nexetChannelsTable)
      .where(eq(state.tables.nexetChannelsTable.id, provisionalId));
    expect(channel).toBeTruthy();
    expect(channel.ownerId).toBe("user-1");
    expect(channel.status).toBe("CONNECTED");

    const [member] = await state.db
      .select()
      .from(state.tables.nexetChannelMembersTable)
      .where(eq(state.tables.nexetChannelMembersTable.channelId, provisionalId));
    expect(member?.role).toBe("OWNER");

    const [oauth] = await state.db
      .select()
      .from(state.tables.nexetChannelOauthTable)
      .where(eq(state.tables.nexetChannelOauthTable.channelId, provisionalId));
    expect(oauth?.status).toBe("ACTIVE");

    // The CMS grid (list endpoint) exposes the minted channel with the real
    // branding so the card shows the actual banner, logo, and name.
    const list = await request(API).get("/api/channels");
    const row = list.body.find((c: { id: string }) => c.id === provisionalId);
    expect(row).toMatchObject({
      youtubeConnected: true,
      name: "Ada Makes Games",
      youtubeTitle: "Ada Makes Games",
      youtubeAvatarUrl: "https://yt3.example/avatar-hi.jpg",
      youtubeBannerUrl: "https://yt3.example/banner.jpg",
    });
  });

  it("exposes the real YouTube branding on the CMS list and channel detail once linked", async () => {
    // The workspace was typed as "My Den", but the card/chrome must show the
    // real channel: name comes from youtubeTitle, images from YouTube.
    const { id } = await createChannel("My Den");
    const exchanged = await linkChannel(id);
    expect(exchanged.status).toBe(200);

    const list = await request(API).get("/api/channels");
    expect(list.status).toBe(200);
    const row = list.body.find((c: { id: string }) => c.id === id);
    expect(row).toMatchObject({
      youtubeConnected: true,
      name: "My Den",
      youtubeTitle: "Ada Makes Games",
      youtubeAvatarUrl: "https://yt3.example/avatar-hi.jpg",
      youtubeBannerUrl: "https://yt3.example/banner.jpg",
    });

    const detail = await request(API).get(`/api/channels/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.youtubeConnected).toBe(true);
    expect(detail.body.youtubeTitle).toBe("Ada Makes Games");
    expect(detail.body.youtubeAvatarUrl).toBe("https://yt3.example/avatar-hi.jpg");
    expect(detail.body.youtubeBannerUrl).toBe("https://yt3.example/banner.jpg");
  });

  it("Google-first exchange refuses a YouTube channel already linked elsewhere and leaves no row behind", async () => {
    const { id } = await createChannel("Already linked");
    await linkChannel(id);

    const provisionalId = "b7e91c2a-0f00-4000-8000-000000000002";
    const started = await request(API).post(`/api/channels/${provisionalId}/oauth/start`);
    expect(started.status).toBe(200);
    const stateParam = new URL(started.body.url).searchParams.get("state")!;

    const exchanged = await request(API)
      .post(`/api/channels/${provisionalId}/oauth/exchange`)
      .send({ state: stateParam, code: "auth-code-from-google" });
    expect(exchanged.status).toBe(400);
    expect(exchanged.body.error).toContain("already linked");

    const [channel] = await state.db
      .select()
      .from(state.tables.nexetChannelsTable)
      .where(eq(state.tables.nexetChannelsTable.id, provisionalId));
    expect(channel).toBeUndefined();
  });

  it("only the account that started a Google-first link can exchange it", async () => {
    const provisionalId = "b7e91c2a-0f00-4000-8000-000000000003";
    const started = await request(API).post(`/api/channels/${provisionalId}/oauth/start`);
    const stateParam = new URL(started.body.url).searchParams.get("state")!;

    state.userId = "user-2";
    const exchanged = await request(API)
      .post(`/api/channels/${provisionalId}/oauth/exchange`)
      .send({ state: stateParam, code: "auth-code-from-google" });
    expect(exchanged.status).toBe(400);
    expect(exchanged.body.error).toContain("another account");

    const [channel] = await state.db
      .select()
      .from(state.tables.nexetChannelsTable)
      .where(eq(state.tables.nexetChannelsTable.id, provisionalId));
    expect(channel).toBeUndefined();
  });

  it("reports Google's own reason when the token exchange is rejected", async () => {
    const { id } = await createChannel("Ada Makes Games");
    const started = await request(API).post(`/api/channels/${id}/oauth/start`);
    const stateParam = new URL(started.body.url).searchParams.get("state")!;

    // A rejected exchange: Google answers with a JSON error body. Reporting
    // just "Google rejected the link" leaves the operator guessing between a
    // used code, a wrong client secret, and an unregistered redirect URI.
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "Bad Request" }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected Google URL: ${url}`);
    });

    const res = await request(API)
      .post(`/api/channels/${id}/oauth/exchange`)
      .send({ state: stateParam, code: "already-used-code" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("invalid_grant");
    expect(res.body.error).toContain("Bad Request");
  });
});

// The consent screen can take minutes, and the callback can land on another
// instance or on this one after a restart. The state token has to carry
// everything the exchange needs on its own — it used to live in a module-level
// Map, so any of those routine events failed the link.
describe("connect state token", () => {
  it("carries the channel, the starting account, and the PKCE verifier", async () => {
    const { createConnectState, readConnectState } = await import("../channels/oauth");
    const token = createConnectState("chan-1", "user-1", "verifier-abc");

    expect(readConnectState(token)).toMatchObject({
      channelId: "chan-1",
      userId: "user-1",
      codeVerifier: "verifier-abc",
    });
    // The readable half is only for choosing the landing channel, and the
    // callback page relies on it being the first dot-separated segment.
    const visible = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    expect(visible.channelId).toBe("chan-1");
  });

  it("rejects a forged or malformed token", async () => {
    const { readConnectState } = await import("../channels/oauth");
    expect(readConnectState("forged.invalid")).toBeNull();
    expect(readConnectState("no-dot-at-all")).toBeNull();
    expect(readConnectState("")).toBeNull();
  });

  it("rejects a token whose readable channel was edited", async () => {
    const { createConnectState, readConnectState } = await import("../channels/oauth");
    const token = createConnectState("chan-1", "user-1", "verifier-abc");
    const sealed = token.slice(token.indexOf(".") + 1);
    const edited = Buffer.from(JSON.stringify({ channelId: "chan-2", exp: Date.now() + 60_000 })).toString("base64url");
    expect(readConnectState(`${edited}.${sealed}`)).toBeNull();
  });

  it("rejects a token whose sealed half was altered", async () => {
    const { createConnectState, readConnectState } = await import("../channels/oauth");
    const token = createConnectState("chan-1", "user-1", "verifier-abc");
    const [payload, ...rest] = token.split(".");
    const sealed = rest.join(".");
    const flipped = sealed.slice(0, -1) + (sealed.endsWith("A") ? "B" : "A");
    expect(readConnectState(`${payload}.${flipped}`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { readConnectState } = await import("../channels/oauth");
    const exp = Date.now() - 1000;
    const payload = Buffer.from(JSON.stringify({ channelId: "chan-1", exp })).toString("base64url");
    const sealed = encryptSecret(JSON.stringify({ channelId: "chan-1", userId: "user-1", codeVerifier: "v", exp }));
    expect(readConnectState(`${payload}.${sealed}`)).toBeNull();
  });
});