import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  nexetChannelsTable,
  nexetChannelMembersTable,
  nexetChannelOauthTable,
} from "@workspace/db";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { channelMembership } from "../routes/channels";

// ---------------------------------------------------------------------------
// YouTube channel OAuth (Phase 2). A channel owner connects the workspace to
// their real YouTube channel through Google's OAuth consent screen:
//
//   start()     → PKCE consent URL (self-contained signed state, 10 min TTL)
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

/**
 * Reads an env var and strips a stray surrounding quote or whitespace. Deploy
 * dashboards routinely carry one of those when a value is pasted in, and Google
 * compares the redirect URI byte-for-byte — so `"https://…/callback "` turns a
 * correctly registered URI into redirect_uri_mismatch.
 */
function oauthEnv(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "");
}

/** The registered redirect URI: explicit env override, else derived from the web origin. */
export function oauthRedirectUri(): string {
  const explicit = oauthEnv("YOUTUBE_REDIRECT_URI");
  if (explicit) return explicit;
  // `||`, not `??`: a var that Render set to an empty string must still fall
  // back, or the derived URI becomes a *relative* path Google can never match.
  const origin = (oauthEnv("NEXET_WEB_URL") || "http://localhost:5175").replace(/\/+$/, "");
  return `${origin}/creators-den/channels/oauth/callback`;
}

function oauthClientId(): string {
  return oauthEnv("YOUTUBE_OAUTH_CLIENT_ID");
}

function oauthClientSecret(): string {
  return oauthEnv("YOUTUBE_OAUTH_CLIENT_SECRET");
}

/** True when Google OAuth credentials are configured (the connect flow works). */
export function oauthConfigured(): boolean {
  return Boolean(oauthClientId() && oauthClientSecret());
}

/**
 * True when a redirect URI points at a local dev origin. Google matches the
 * redirect URI byte-for-byte against the Authorized redirect URIs registered on
 * the OAuth client, so a production deploy that still derives the localhost
 * default only ever gets an opaque "Error 400: redirect_uri_mismatch" page
 * from Google — with nothing telling the operator which value to register.
 */
export function isLoopbackRedirectUri(uri: string): boolean {
  try {
    const { hostname } = new URL(uri);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Best-effort read of Google's OAuth error body (`{"error":"invalid_grant",
 * "error_description":"…"}`). Google answers a failed token exchange with JSON,
 * but other paths can return HTML, so this never throws — a missing detail
 * degrades to the status code rather than masking the failure.
 */
async function googleErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: unknown; error_description?: unknown };
      const code = typeof parsed.error === "string" ? parsed.error : null;
      const description = typeof parsed.error_description === "string" ? parsed.error_description : null;
      if (code && description) return `${code} (${description})`;
      if (code) return code;
    } catch {
      // Not JSON — fall through to a snippet of whatever came back.
    }
    return text.slice(0, 200);
  } catch {
    return `HTTP ${response.status}`;
  }
}

// ---------------------------------------------------------------------------
// Connect state.
//
// `state` carries everything the exchange needs — the channel, the account
// that started the link, and the PKCE verifier — sealed with AES-256-GCM. It
// is deliberately NOT held in this process's memory: the consent screen can
// take minutes, and the callback may land on a different instance, or on this
// one after a deploy or a spin-down. An in-memory Map made every one of those
// routine events fail with "this link request expired" and no way to tell why.
//
// The shape is `<readable payload>.<sealed>`: the payload is the base64url
// JSON the callback page decodes to learn which channel to land on, and the
// sealed half is what the server trusts. The two must agree on the channel or
// the state is rejected, so the readable half can't be tampered with.
// ---------------------------------------------------------------------------

const PENDING_TTL_MS = 10 * 60 * 1000;

interface ConnectState {
  channelId: string;
  // Who started the link (the pending owner). A channel-less Google-first
  // start is bound to the starter, and only they may complete the exchange.
  userId: string;
  codeVerifier: string;
  exp: number;
}

/** Seal {channelId, userId, verifier, exp} into a state token. */
export function createConnectState(channelId: string, userId: string, codeVerifier: string): string {
  const exp = Date.now() + PENDING_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ channelId, exp })).toString("base64url");
  const sealed = encryptSecret(JSON.stringify({ channelId, userId, codeVerifier, exp } satisfies ConnectState));
  return `${payload}.${sealed}`;
}

/** Read a state token back, or null when it is forged, tampered with, or stale. */
export function readConnectState(state: string): ConnectState | null {
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  // AES-GCM authenticates the ciphertext, so a forged or truncated token
  // throws here rather than yielding attacker-controlled fields.
  let parsed: ConnectState;
  try {
    parsed = JSON.parse(decryptSecret(state.slice(dot + 1))) as ConnectState;
  } catch {
    return null;
  }
  const { channelId, userId, codeVerifier, exp } = parsed ?? {};
  if (typeof channelId !== "string" || typeof userId !== "string" || typeof codeVerifier !== "string") {
    return null;
  }
  if (typeof exp !== "number" || exp < Date.now()) return null;
  // The readable half only chooses where the user lands; it must match the
  // sealed copy or the link was edited in the address bar.
  try {
    const visible = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { channelId?: unknown };
    if (visible.channelId !== channelId) return null;
  } catch {
    return null;
  }
  return { channelId, userId, codeVerifier, exp };
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
    avatarUrl:
      item.snippet?.thumbnails?.high?.url ??
      item.snippet?.thumbnails?.medium?.url ??
      item.snippet?.thumbnails?.default?.url ??
      null,
    bannerUrl: item.brandingSettings?.image?.bannerExternalUrl ?? null,
    country: item.snippet?.country ?? null,
  };
}

/**
 * Build the Google consent URL for a channel. Only the channel owner can
 * start; a channel that is already connected must disconnect first. A
 * channel id with no row yet is a Google-first creation ("+ New channel"
 * with no name typed): the consent runs against the provisional id and the
 * workspace is created on exchange, named from the real YouTube channel.
 * Returns null when Google OAuth credentials are not configured.
 */
export async function startChannelOauth(
  channelId: string,
  userId: string,
): Promise<{ url: string } | { error: string }> {
  if (!oauthConfigured()) {
    return { error: "YouTube OAuth is not configured on this server yet (missing YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET)." };
  }

  const redirectUri = oauthRedirectUri();
  // Refuse to send Google a redirect URI it can never have registered. The
  // default is derived from NEXET_WEB_URL; when that is unset on a production
  // host it silently falls back to the localhost dev origin, and Google answers
  // with "Error 400: redirect_uri_mismatch" before the user can consent.
  if (process.env.NODE_ENV === "production" && isLoopbackRedirectUri(redirectUri)) {
    return {
      error:
        `YouTube linking is misconfigured on this server: the OAuth redirect URI resolves to ${redirectUri}. ` +
        "Set NEXET_WEB_URL to this deployment's public origin (or set YOUTUBE_REDIRECT_URI directly), " +
        "then register that exact URI as an Authorized redirect URI on the Google OAuth client.",
    };
  }

  const [channel] = await db
    .select()
    .from(nexetChannelsTable)
    .where(eq(nexetChannelsTable.id, channelId))
    .limit(1);
  // An existing row must belong to the caller and not already be connected;
  // a missing row is fine — that is the Google-first creation path above.
  if (channel) {
    if (channel.ownerId !== userId) {
      return { error: "Only the channel owner can link a YouTube channel" };
    }
    const [existing] = await db
      .select()
      .from(nexetChannelOauthTable)
      .where(eq(nexetChannelOauthTable.channelId, channelId))
      .limit(1);
    if (existing && existing.status === "ACTIVE") {
      return { error: "This channel is already connected — disconnect it before re-linking" };
    }
  }

  const codeVerifier = newCodeVerifier();
  const state = createConnectState(channelId, userId, codeVerifier);

  const params = new URLSearchParams({
    client_id: oauthClientId(),
    redirect_uri: redirectUri,
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
 * encrypted. When the channel row does not exist yet (a Google-first start
 * with no typed name) the workspace is created here, named after the real
 * YouTube channel. Throws with a user-presentable message on failure.
 */
export async function exchangeChannelOauth(
  channelId: string,
  state: string,
  code: string,
  userId: string,
): Promise<void> {
  const signed = readConnectState(state);
  if (!signed || signed.channelId !== channelId) {
    throw new Error("This link request expired — start over from the channel card");
  }
  if (signed.userId !== userId) {
    throw new Error("This link request belongs to another account — start it again from your channels");
  }
  const codeVerifier = signed.codeVerifier;

  if (!oauthConfigured()) {
    throw new Error("YouTube OAuth is not configured on this server yet");
  }

  const [channel] = await db
    .select()
    .from(nexetChannelsTable)
    .where(eq(nexetChannelsTable.id, channelId))
    .limit(1);
  // No row yet = Google-first creation: the workspace is created below from
  // the picked YouTube channel's branding (name, logo, banner).
  const creating = !channel;

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthClientId(),
      client_secret: oauthClientSecret(),
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: oauthRedirectUri(),
    }),
  });
  if (!tokenResponse.ok) {
    // Google's own reason (invalid_grant, redirect_uri_mismatch,
    // invalid_client, …) is the single most useful thing to report here —
    // without it every failure reads the same.
    const detail = await googleErrorDetail(tokenResponse);
    throw new Error(
      `Google rejected the link${detail ? ` — ${detail}` : ""}. ` +
        "The authorization code may have expired or already been used; start again from the channel card.",
    );
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
    .select({ id: nexetChannelsTable.id })
    .from(nexetChannelsTable)
    .where(eq(nexetChannelsTable.youtubeChannelId, branding.id))
    .limit(1);
  if (bound && bound.id !== channelId) {
    throw new Error("That YouTube channel is already linked to another workspace");
  }

  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000);
  await db.transaction(async (tx) => {
    if (creating) {
      // Google-first: mint the workspace + OWNER membership now, connected
      // and branded, with the real channel's title as its name.
      await tx.insert(nexetChannelsTable).values({
        id: channelId,
        ownerId: userId,
        status: "CONNECTED",
        name: branding.title.trim() || "My YouTube channel",
        youtubeChannelId: branding.id,
        youtubeTitle: branding.title || null,
        youtubeDescription: branding.description,
        youtubeAvatarUrl: branding.avatarUrl,
        youtubeBannerUrl: branding.bannerUrl,
        youtubeCountry: branding.country,
        updatedAt: new Date(),
      });
      await tx.insert(nexetChannelMembersTable).values({
        id: crypto.randomUUID(),
        channelId,
        userId,
        role: "OWNER",
      });
    } else {
      await tx
        .delete(nexetChannelOauthTable)
        .where(eq(nexetChannelOauthTable.channelId, channelId));
    }
    await tx.insert(nexetChannelOauthTable).values({
      id: crypto.randomUUID(),
      channelId,
      youtubeChannelId: branding.id,
      accessTokenCipher: encryptSecret(accessToken),
      refreshTokenCipher: token.refresh_token ? encryptSecret(token.refresh_token) : "",
      scope: token.scope ?? "",
      status: "ACTIVE",
      expiresAt,
      linkedByUserId: creating ? userId : (channel?.ownerId ?? userId),
      lastRefreshedAt: new Date(),
    });
    if (!creating) {
      await tx
        .update(nexetChannelsTable)
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
        .where(eq(nexetChannelsTable.id, channelId));
    }
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
    .from(nexetChannelOauthTable)
    .where(eq(nexetChannelOauthTable.channelId, channelId))
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
        .update(nexetChannelOauthTable)
        .set({ status: "REVOKED", updatedAt: new Date() })
        .where(eq(nexetChannelOauthTable.id, oauth.id));
      await tx
        .update(nexetChannelsTable)
        .set({ status: "CREATED", updatedAt: new Date() })
        .where(eq(nexetChannelsTable.id, channelId));
    });
    return null;
  }
  if (!response.ok) return null;

  const token = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!token.access_token) return null;
  const refreshedAccessToken = token.access_token;

  await db
    .update(nexetChannelOauthTable)
    .set({
      accessTokenCipher: encryptSecret(refreshedAccessToken),
      expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
      lastRefreshedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(nexetChannelOauthTable.id, oauth.id));

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
    .from(nexetChannelsTable)
    .where(eq(nexetChannelsTable.id, channelId))
    .limit(1);
  if (!channel) return { error: "Channel not found" };

  const [oauth] = await db
    .select()
    .from(nexetChannelOauthTable)
    .where(eq(nexetChannelOauthTable.channelId, channelId))
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
        .delete(nexetChannelOauthTable)
        .where(eq(nexetChannelOauthTable.channelId, channelId));
    }
    await tx
      .update(nexetChannelsTable)
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
      .where(eq(nexetChannelsTable.id, channelId));
  });

  return {};
}