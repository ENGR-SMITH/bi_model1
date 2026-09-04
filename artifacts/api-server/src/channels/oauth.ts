import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  tandemChannelsTable,
  tandemChannelOauthTable,
} from "@workspace/db";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { channelMembership } from "../routes/channels";

// ---------------------------------------------------------------------------
// YouTube channel OAuth (Phase 2). A channel owner connects the workspace to
// their real YouTube channel through Google's OAuth consent screen:
//
//   start()     → PKCE consent URL (state stored in memory, 10 min TTL)
//   exchange()  → code → Google token endpoint → YouTube channel lookup
//                 (mine=true) → encrypted token vault + CONNECTED branding
//   getToken()  → decrypts the vault, refreshes the access token when near
//                 expiry (marks REVOKED on invalid_grant)
//   disconnect()→ Google revoke + clears the vault (channel stays)
//
// Only the channel OWNER may start/disconnect. Tokens never leave the server;
// editors only ever see the shared branding metadata on the channel row.
// ---------------------------------------------------------------------------

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

export const OAUTH_SCOPE = SCOPES;

/** The registered redirect URI: explicit env override, else derived from the web origin. */
export function oauthRedirectUri(): string {
  if (process.env.YOUTUBE_REDIRECT_URI) return process.env.YOUTUBE_REDIRECT_URI;
  const origin = (process.env.TANDEM_WEB_URL ?? "http://localhost:5175").replace(/\/+$/, "");
  return `${origin}/creators-den/channels/oauth/callback`;
}

function oauthClientId(): string {
  return process.env.YOUTUBE_OAUTH_CLIENT_ID ?? "";
}

function oauthClientSecret(): string {
  return process.env.YOUTUBE_OAUTH_CLIENT_SECRET ?? "";
}

/** True when Google OAuth credentials are configured (the connect flow works). */
export function oauthConfigured(): boolean {
  return Boolean(oauthClientId() && oauthClientSecret());
}

// ---------------------------------------------------------------------------
// Pending connect state: `state` is a signed token bound to {channelId,
// verifier}; the verifier itself never leaves the server (PKCE best practice
// with a client-exchange flow — the callback page only ever sees `state`).
// ---------------------------------------------------------------------------

interface PendingConnect {
  channelId: string;
  codeVerifier: string;
  expiresAt: number;
}

const pending = new Map<string, PendingConnect>();
const PENDING_TTL_MS = 10 * 60 * 1000;

function signState(channelId: string): string {
  const payload = Buffer.from(JSON.stringify({ channelId, exp: Date.now() + PENDING_TTL_MS })).toString("base64url");
  const secret = process.env.SESSION_SECRET ?? "manuskript-development-key";
  const digest = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${digest}`;
}

function verifyState(state: string): { channelId: string } | null {
  const [payload, digest] = state.split(".");
  if (!payload || !digest) return null;
  const secret = process.env.SESSION_SECRET ?? "manuskript-development-key";
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { channelId?: string; exp?: number };
    if (typeof parsed.channelId !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Date.now()) return null;
    return { channelId: parsed.channelId };
  } catch {
    return null;
  }
}

function newCodeVerifier(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function codeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** Google branding payload from the youtube/v3/channels?mine=true response. */
export interface YoutubeChannelBranding {
  id: string;
  title: string;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  country: string | null;
}

interface YoutubeChannelItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    country?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  brandingSettings?: {
    image?: { bannerExternalUrl?: string };
  };
}

export function parseYoutubeChannelBranding(items: YoutubeChannelItem[]): YoutubeChannelBranding | null {
  const item = items[0];
  if (!item?.id) return null;
  return {
    id: item.id,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? null,
    avatarUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
    bannerUrl: item.brandingSettings?.image?.bannerExternalUrl ?? null,
    country: item.snippet?.country ?? null,
  };
}

/**
 * Build the Google consent URL for a channel. Only the channel owner can
 * start; a channel that is already connected must disconnect first.
 * Returns null when Google OAuth credentials are not configured.
 */
export async function startChannelOauth(
  channelId: string,
  userId: string,
): Promise<{ url: string } | { error: string }> {
  if (!oauthConfigured()) {
    return { error: "YouTube OAuth is not configured on this server yet (missing YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET)." };
  }

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, channelId))
    .limit(1);
  if (!channel) return { error: "Channel not found" };
  if (channel.ownerId !== userId) return { error: "Only the channel owner can link a YouTube channel" };

  const [existing] = await db
    .select()
    .from(tandemChannelOauthTable)
    .where(eq(tandemChannelOauthTable.channelId, channelId))
    .limit(1);
  if (existing && existing.status === "ACTIVE") {
    return { error: "This channel is already connected — disconnect it before re-linking" };
  }

  const codeVerifier = newCodeVerifier();
  const state = signState(channelId);
  pending.set(state, {
    channelId,
    codeVerifier,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });

  const params = new URLSearchParams({
    client_id: oauthClientId(),
    redirect_uri: oauthRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge(codeVerifier),
    code_challenge_method: "S256",
  });

  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` };
}

/**
 * Exchange the consent code for tokens, bind the returned YouTube channel to
 * this workspace channel (CONNECTED + branding), and store the tokens
 * encrypted. Throws with a user-presentable message on failure.
 */
export async function exchangeChannelOauth(
  channelId: string,
  state: string,
  code: string,
): Promise<void> {
  const signed = verifyState(state);
  if (!signed || signed.channelId !== channelId) {
    throw new Error("This link request expired — start over from the channel card");
  }
  const entry = pending.get(state);
  if (!entry || entry.channelId !== channelId || entry.expiresAt < Date.now()) {
    throw new Error("This link request expired — start over from the channel card");
  }
  pending.delete(state);

  if (!oauthConfigured()) {
    throw new Error("YouTube OAuth is not configured on this server yet");
  }

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, channelId))
    .limit(1);
  if (!channel) throw new Error("Channel not found");

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthClientId(),
      client_secret: oauthClientSecret(),
      code,
      code_verifier: entry.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: oauthRedirectUri(),
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error("Google rejected the link — the request may have expired, try again");
  }
  const token = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!token.access_token) {
    throw new Error("Google did not return a token — try again");
  }
  const accessToken = token.access_token;

  // The Analytics API only serves the OAuth account's own channels, so the
  // link is bound to `mine=true` — the channel row must reflect that identity.
  const channelResponse = await fetch(
    `${GOOGLE_YOUTUBE_CHANNELS_URL}?part=snippet,contentDetails,statistics,brandingSettings&mine=true`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!channelResponse.ok) {
    throw new Error("Google could not identify your YouTube channel — make sure the channel exists and YouTube Data API v3 is enabled");
  }
  const channelPayload = (await channelResponse.json()) as { items?: YoutubeChannelItem[] };
  const branding = parseYoutubeChannelBranding(channelPayload.items ?? []);
  if (!branding) {
    throw new Error("No YouTube channel found on that Google account");
  }

  // One YouTube channel per workspace: refuse a binding already used elsewhere.
  const [bound] = await db
    .select({ id: tandemChannelsTable.id })
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.youtubeChannelId, branding.id))
    .limit(1);
  if (bound && bound.id !== channelId) {
    throw new Error("That YouTube channel is already linked to another workspace");
  }

  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000);
  await db.transaction(async (tx) => {
    await tx
      .delete(tandemChannelOauthTable)
      .where(eq(tandemChannelOauthTable.channelId, channelId));
    await tx.insert(tandemChannelOauthTable).values({
      id: crypto.randomUUID(),
      channelId,
      youtubeChannelId: branding.id,
      accessTokenCipher: encryptSecret(accessToken),
      refreshTokenCipher: token.refresh_token ? encryptSecret(token.refresh_token) : "",
      scope: token.scope ?? "",
      status: "ACTIVE",
      expiresAt,
      linkedByUserId: channel.ownerId,
      lastRefreshedAt: new Date(),
    });
    await tx
      .update(tandemChannelsTable)
      .set({
        status: "CONNECTED",
        youtubeChannelId: branding.id,
        youtubeTitle: branding.title || null,
        youtubeDescription: branding.description,
        youtubeAvatarUrl: branding.avatarUrl,
        youtubeBannerUrl: branding.bannerUrl,
        youtubeCountry: branding.country,
        updatedAt: new Date(),
      })
      .where(eq(tandemChannelsTable.id, channelId));
  });
}

/**
 * Decrypt the ACTIVE oauth row for a channel, refreshing the access token
 * when it is near expiry (or any time the stored access token is unusable).
 * Marks the row REVOKED + the channel back to CREATED on invalid_grant so the
 * UI can offer reconnect. Returns null when there is no ACTIVE link.
 */
export async function getChannelAccessToken(channelId: string): Promise<string | null> {
  const [oauth] = await db
    .select()
    .from(tandemChannelOauthTable)
    .where(eq(tandemChannelOauthTable.channelId, channelId))
    .limit(1);
  if (!oauth || oauth.status !== "ACTIVE") return null;

  const needsRefresh =
    !oauth.expiresAt || oauth.expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!needsRefresh && oauth.accessTokenCipher) {
    try {
      return decryptSecret(oauth.accessTokenCipher);
    } catch {
      // ciphertext unreadable (key rotation?) — refresh below
    }
  }

  if (!oauth.refreshTokenCipher || !oauthConfigured()) return null;

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(oauth.refreshTokenCipher);
  } catch {
    return null;
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthClientId(),
      client_secret: oauthClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (response.status === 400) {
    // invalid_grant — the link is dead; surface it so the owner can reconnect.
    await db.transaction(async (tx) => {
      await tx
        .update(tandemChannelOauthTable)
        .set({ status: "REVOKED", updatedAt: new Date() })
        .where(eq(tandemChannelOauthTable.id, oauth.id));
      await tx
        .update(tandemChannelsTable)
        .set({ status: "CREATED", updatedAt: new Date() })
        .where(eq(tandemChannelsTable.id, channelId));
    });
    return null;
  }
  if (!response.ok) return null;

  const token = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!token.access_token) return null;
  const refreshedAccessToken = token.access_token;

  await db
    .update(tandemChannelOauthTable)
    .set({
      accessTokenCipher: encryptSecret(refreshedAccessToken),
      expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
      lastRefreshedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tandemChannelOauthTable.id, oauth.id));

  return token.access_token;
}

/**
 * Disconnect the YouTube link (owner only): call Google's revoke endpoint with
 * the current access token (best-effort), clear the vault, and set the channel
 * back to CREATED — projects, roster, and editors all stay.
 */
export async function disconnectChannelOauth(channelId: string, userId: string): Promise<{ error?: string }> {
  const membership = await channelMembership(channelId, userId);
  if (!membership) return { error: "You are not on this channel" };
  if (membership.role !== "OWNER") return { error: "Only the channel owner can disconnect YouTube" };

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, channelId))
    .limit(1);
  if (!channel) return { error: "Channel not found" };

  const [oauth] = await db
    .select()
    .from(tandemChannelOauthTable)
    .where(eq(tandemChannelOauthTable.channelId, channelId))
    .limit(1);
  if (oauth && oauth.status === "ACTIVE" && oauth.accessTokenCipher) {
    try {
      const accessToken = decryptSecret(oauth.accessTokenCipher);
      await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: accessToken }),
      });
    } catch {
      // Best-effort revoke — the local vault clear below is the source of truth.
    }
  }

  await db.transaction(async (tx) => {
    if (oauth) {
      await tx
        .delete(tandemChannelOauthTable)
        .where(eq(tandemChannelOauthTable.channelId, channelId));
    }
    await tx
      .update(tandemChannelsTable)
      .set({
        status: "CREATED",
        youtubeChannelId: null,
        youtubeTitle: null,
        youtubeDescription: null,
        youtubeAvatarUrl: null,
        youtubeBannerUrl: null,
        youtubeCountry: null,
        updatedAt: new Date(),
      })
      .where(eq(tandemChannelsTable.id, channelId));
  });

  return {};
}