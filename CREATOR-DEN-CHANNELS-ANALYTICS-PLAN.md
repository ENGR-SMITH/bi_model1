# Creator Den — Multi-Channel Workspaces & Channel Analytics Implementation Plan

**Status:** Plan for review — no code changes made yet
**Last updated:** 2026-09-04
**Primary source document:** product brief pasted 2026-09-04 ("WE ARE MAKING SOME RESTRUCTURING AND ADDING THE ANALYTICS FEATURES ON THE CREATOR-DEN TO FIT MCS users")
**Target apps:** `artifacts/creators-den` (frontend), `artifacts/api-server` (routes/realtime), `lib/db` (schema/migrations), `lib/api-spec` → `lib/api-zod` + `lib/api-client-react` (API contract + codegen), plus the Tandem hub entry card (`artifacts/tandem/src/pages/content-creators.tsx`).
**Related docs:** `TADEM_COLLABORATION_IMPLEMENTATION_PLAN.md`, `FEATURES.md`, `artifacts/creators-den/CREATOR-DEN-VCS-DESIGN.md`, `START-APP.md`, `replit.md`, `.env.example`.

---

## 1. Purpose and product outcome

Creator Den becomes a **multi-channel production platform for YouTube agencies and MCNs**:

- **One user, many channels.** A "channel" is a YouTube-linked workspace. The user manages all their channels from a CMS-style landing page (channel grid), and every Creator Den surface (studio, vault, roles, review, preview, timeline) lives **inside a channel**.
- **YouTube identity + branding.** A channel is created on the CMS page and connected to the user's real YouTube channel via Google OAuth. Its banner, logo, and name come from YouTube, and the connection is what powers analytics for that channel.
- **Shared-channel contributor model.** When a Captain adds someone to a project on their channel, that person appears in the channel's editor roster (GitHub-contributor style avatar strip), and the **same channel appears on that person's own CMS page** — mirroring the real channel info, containing only the projects they were added to. Adding them to another project on the same channel reuses the existing card.
- **Live presence surfaces.** The channel home shows everyone currently active on any project in that channel, and each project card in the "recent projects" carousel shows the people actively working on that project.
- **Channel Analytics.** An analytics section (button in the top-nav "notch" row beside the Workspace dropdown, plus a button on the channel home) tracks every published video on the linked YouTube channel — views, watch time, retention, impressions/CTR, traffic sources, demographics, devices, revenue (where monetized), subscriber changes — with frequent refresh, automatic detection of newly published uploads, and v1 anomaly alerts via the existing notification system.

The target user is a YouTube agency/MCN managing several client channels end-to-end — from studio (version-controlled editing) to publishing, then tracking/published-video analytics per channel.

## 2. Product vocabulary

| Brief term | Code meaning |
|---|---|
| CMS page | New Creator Den landing page: the **Channels** grid at `/creators-den/` (owned channels + channels you're an editor on) with a `+` card |
| Channel | `tandem_channels` row — a workspace owned by one user, optionally bound to a real YouTube channel (`youtubeChannelId` + branding) |
| New channel via `+` | Create `tandem_channels` (UNLINKED) → Google OAuth consent → fetch YouTube channel metadata → CONNECTED/ACTIVE |
| Den pages inside the channel | Vault, studios (role pages), review, preview, timeline, notifications — nested under `/creators-den/channels/:channelId/...` |
| Channel editor list / contributor avatars | `tandem_channel_members` (EDITOR rows) rendered as an avatar strip on the channel home + member presence dots |
| Analytics | New YouTube-linked pages: channel video table w/ filters + per-video analytics detail, backed by the YouTube Data API + YouTube Analytics API with DB caching |

## 3. Scope and release boundaries

### 3.1 First-release scope (this plan)

1. Channels data model, channel membership, and channel scoping of projects (legacy unlinked projects handled per §6.4).
2. CMS landing page: grid of channels with YouTube branding, `+` new-channel flow with YouTube OAuth connect, connect/reconnect/disconnect, delete (empty only), and an "Unlinked projects → attach to channel" section for legacy rows.
3. Full route restructure of Creator Den under channels; channel name in the navbar; contributor avatar strip on the channel home; per-project avatar stacks + live presence on the home carousel; Analytics buttons in the nav notch row and channel home.
4. Editor auto-provisioning: adding someone to a project under a channel makes them a channel editor (avatar strip + mirror card on their CMS); removal from the last project on the channel removes the card.
5. YouTube OAuth link + token vault (encrypted refresh tokens, refresh flow, revoke/disconnect) and YouTube channel metadata sync.
6. Analytics ingestion: channel/video catalog sync (detects recently published uploads), daily metric snapshots (video + channel), on-demand report caching (retention/traffic/demographics/devices/revenue), background refresh loop + manual refresh.
7. Analytics UI: channel overview KPIs, video table with filters (date range, sort by views/likes/CTR/retention/revenue, search), and a per-video analytics page (KPIs, day-series charts, retention curve, traffic sources, demographics, devices, revenue/RPM/CPM where monetized, subscriber deltas).
8. v1 anomaly alerts via the existing `notify`/`tandemVideoNotifications` system (§14).
9. Route tests (in-memory SQLite mirrors), typecheck/build, and a live walkthrough against a real connected YouTube channel.

### 3.2 Explicitly future scope (preserved in the model, labeled future, not built in v1)

- Competitive/benchmark analytics for channels you do not own (public-data scraping of peers/competitors, creator-movement alerts, content-gap analysis).
- Brand-deal tracking, white-labeled client reports, goal tracking.
- Comment analysis / demand signals.
- Alert library beyond the three v1 rules (§14).
- Ingesting owned channels you manage under someone else's Google account via CMS partnership tokens (v1 binds each channel to the connecting user's own YouTube account; a "manager mode" with delegated OAuth remains a model hook — `tandem_channel_oauth.linkedByUserId`).

Anything in the brief not listed in §3.1 is treated as future scope unless explicitly added later.

## 4. Implementation rules

1. Follow the repo's contract-first convention: update `lib/api-spec/openapi.yaml`, regenerate with `pnpm --filter @workspace/api-spec codegen`, then implement the routes against the generated `@workspace/api-zod` schemas. Client UI consumes the generated `@workspace/api-client-react` hooks.
2. Keep using Clerk as the single identity source; derive the acting user only from `getAuth(req).userId` server-side.
3. Enforce channel/project ownership and membership in server authorization and DB logic (§10), not just in disabled UI buttons.
4. Use the existing schema/migration conventions: Drizzle tables in `lib/db/src/schema/*`, guarded idempotent SQL migration `lib/db/migrations/0004_*.sql` (0003 precedent), applied to live DBs via `pnpm --filter db run push-force` (post-merge convention). Mirror every new table in the in-memory SQLite test schema (`artifacts/api-server/src/test/in-memory-db.ts`).
5. Reuse existing server helpers rather than duplicating: `notify()` (video-platform), `resolveUserProfiles`/`resolveUserNames`, `emitToProject`/`emitToUser` + realtime presence, `encryptSecret`/`decryptSecret` (`artifacts/api-server/src/lib/oracle.ts`, SESSION_SECRET AES — the same helper that protects provider API keys), `tandemUid`/`normalizeTandemUid`, `recordVideoActivity`.
6. Store YouTube analytics as periodic snapshots in Postgres; never proxy live YouTube API responses through every page view. Report caches have TTLs and are re-fetched on sync/manual refresh (§9).
7. Reuse the existing `recharts` catalog dependency (already in `tandem`, `authors-den`, `oracle-admin`, `mockup-sandbox`; port `components/ui/chart.tsx` if needed) — do not introduce a second charting library.
8. Keep existing den surfaces working: flat legacy project deep links (`/creators-den/projects/:id`, stored in old notification rows and generated by existing server call sites) keep working via a one-hop client redirect into the channel-scoped URL (§12.3). No schema/data migration rewrites old rows.
9. Update this checklist as work proceeds: `[ ]` → `[x]` with a short completion note and the validation result.
10. Progress-check-in doc style follows `TADEM_COLLABORATION_IMPLEMENTATION_PLAN.md`.

## 5. Preflight and source integration

Completed during plan review:

- [x] Trace the current Creator Den entry from Tandem. **Completed: the Content Creators hub card (`artifacts/tandem/src/pages/content-creators.tsx`) links to `/creators-den/`; creators-den is served under the `/creators-den` base (wouter `Router base="/creators-den"`, `App.tsx`); Tandem's vite proxy forwards `/creators-den` → port 5175.**
- [x] Identify the existing "channel-like" concepts. **Completed: none exist. Projects (`tandem_video_projects`), members (`tandem_video_members`), assets, timelines, submissions, notifications, jobs, chat all exist with no channel dimension. There is no CMS page anywhere in the repo (search for `CMS` returns nothing).**
- [x] Confirm the API conventions. **Completed: OpenAPI (`lib/api-spec/openapi.yaml`, 5k lines) → Orval → `@workspace/api-zod` (server validation) + `@workspace/api-client-react` (React Query hooks, `custom-fetch.ts` mutator). Route files under `artifacts/api-server/src/routes/`, registered in `routes/index.ts`.** Video routes are under `/api/video/*`; notifications deep-link to `/creators-den/projects/:id` in many places (`video.ts`, `video-production.ts`, `video-platform.ts`).
- [x] Confirm schema/migration conventions. **Completed: drizzle schema in `lib/db/src/schema/*`; idempotent checked-in SQL migrations `0001`–`0003` (0003 `tandem_tours` precedent); live DB applies via `pnpm --filter db run push-force` (`scripts/post-merge.sh`).**
- [x] Confirm charting + styling capabilities in Creator Den. **Completed: creators-den currently has no chart library; `recharts ^2.15.x` is a catalog dependency already used by tandem/authors-den/oracle-admin.**
- [x] Confirm realtime presence shape. **Completed: `artifacts/api-server/src/realtime.ts` keeps in-memory `presenceByProject` (projectId → userId → {name, leg, joinedAt}); clients join with `presence:join {projectId, leg?, name?}`; `emitToUser` drives notification badges. Channel-level presence is an extension (§12.5).**
- [x] Confirm YouTube/Google credentials status. **Completed: none configured yet. The user will paste Google Cloud OAuth client credentials (web app) + a YouTube Data API key; see §8 for exact values needed.**
- [x] Confirm how legacy projects should behave after the channel layer lands. **User decision: existing projects (no channel) stay hidden from channel pages until their owner attaches them to a channel — never auto-migrate. Handled by §6.4.**

## 6. Domain model and persistence plan

All new tables use the `tandem_` prefix and follow existing conventions (text PK `uid`-style ids, `created_at`/`updated_at` timestamps, snake_case columns).

### 6.1 `tandem_channels` — the workspace (new)

| Column | Type | Notes |
|---|---|---|
| id | text PK | `chan_…` (randomUUID like other tandem rows) |
| owner_id | text NOT NULL | Clerk user id of the creator of the channel |
| name | text NOT NULL | Workspace name; pre-connect it's the user's chosen name, after connect it mirrors the YouTube channel title |
| status | text NOT NULL default `'UNLINKED'` | `UNLINKED` (created, not connected) → `CONNECTED` (OAuth bound + metadata fetched). Channel cannot host projects or analytics until CONNECTED |
| youtube_channel_id | text | Set on OAuth connect; unique among rows where non-null |
| youtube_title / youtube_description | text | From YouTube channel snippet |
| youtube_avatar_url / youtube_banner_url | text | `snippet.thumbnails` / `brandingSettings.image.bannerImageUrl` |
| youtube_country | text | Optional, from snippet |
| created_at / updated_at | timestamptz | |

`tandem_channel_members` — who is on the channel (new):

| Column | Notes |
|---|---|
| id text PK, channel_id text NOT NULL, user_id text NOT NULL | unique(channel_id, user_id) |
| role | `OWNER` (creator; exactly one) or `EDITOR` (added via project membership) |
| created_at | |
| UNIQUE (channel_id, user_id) | |

Invariant: an OWNER row exists from channel creation. An EDITOR row is ensured (or removed) whenever a project member in that channel is added to / removed from / loses the last membership in the channel's projects (§6.5). Channel membership is global — the same `EDITOR` row is what renders on the owner's contributor strip **and** on the editor's own CMS grid; there are no per-user mirror rows.

### 6.2 Project changes (altered)

- `tandem_video_projects` gains `channel_id` (text, nullable). New project creation requires a channel (and the creator must own it). Legacy rows keep `channel_id = NULL` and are handled per §6.4.
- `tandem_video_members` unchanged (project-scoped roles stay as today).

### 6.3 `tandem_channel_oauth` — encrypted YouTube tokens (new)

| Column | Notes |
|---|---|
| id text PK; channel_id text NOT NULL UNIQUE | one token row per channel |
| youtube_channel_id text NOT NULL | channel bound at connect time |
| access_token_cipher text NOT NULL | `encryptSecret(...)` from `lib/oracle.ts` (SESSION_SECRET AES) |
| refresh_token_cipher text NOT NULL | same helper |
| scope text | the granted scopes (youtube.readonly, yt-analytics.readonly) |
| expires_at timestamptz | access-token expiry |
| linked_by_user_id text NOT NULL | Clerk id of the user who connected (future CMS-partnership hook) |
| status text default `'ACTIVE'` | `ACTIVE` / `REVOKED` |
| last_refreshed_at / created_at / updated_at | |

A channel is CONNECTED only when it has an ACTIVE oauth row whose `youtube_channel_id` matches `tandem_channels.youtube_channel_id`.

### 6.4 Legacy projects (user decision: require linking before old projects show)

- Existing projects keep `channel_id = NULL`. They do **not** appear on any channel home or on the CMS grid.
- The CMS page shows an **"Unlinked projects"** section (owner only) listing the owner's channel-less projects with an **Attach to channel** action (`PATCH /video/projects/:projectId/channel`). Attaching is Captain-only, requires the target channel to be CONNECTED, and the project's owner must own that channel.
- No automatic migration. New projects are created channel-scoped from the start.
- Deep links into an unlinked project (stale notifications) still open: the flat `/creators-den/projects/:id` route renders a notice with the project name and an "Attach this project to a channel" prompt when the project has no channel (§12.3).

### 6.5 Channel membership lifecycle (editor auto-provisioning)

Trigger points (all server-side, in the member add/patch/remove routes of `routes/video.ts`):

- **Member added** to a project whose channel is owned by the project's Captain (project owner == channel owner): ensure `tandem_channel_members` EDITOR row for that user+channel (idempotent — adding them to a second project on the same channel reuses the row), then their CMS card exists / persists.
- **Member removed or role-scoped off** and left with no ACTIVE membership on any project in that channel: delete the EDITOR row (the CMS card disappears).
- A member's project roles change (e.g. role merge) never touches channel membership; only membership existence matters for the avatar strip.

The Captain's OWNER row is never removed by these rules.

### 6.6 Analytics tables (new)

- `tandem_channel_videos` — catalog of videos published on the linked channel (upserted by sync):
  - `id text PK` (`chanvid_…`), `channel_id`, `youtube_video_id`, UNIQUE (channel_id, youtube_video_id)
  - `title`, `description`, `thumbnails jsonb`, `published_at`, `duration_seconds int`, `privacy_status text`, `category_id text`, `default_language text`, `content_kind text` (`LONG_FORM` | `SHORT` | `LIVE` derived), `last_synced_at`
- `tandem_channel_daily_metrics` — channel-level daily snapshots: `channel_id`, `day date`, `metrics jsonb`, `source text` (`youtube`), UNIQUE (channel_id, day).
  - `metrics` shape (zod-validated): `{ views, watchTimeMinutes, averageViewDurationSeconds, subscribersGained, subscribersLost, estimatedRevenueUsd, estimatedAdRevenueUsd, likes, comments, shares }` (absent keys allowed — YouTube returns nulls for non-monetized rows).
- `tandem_video_daily_metrics` — per-video daily snapshots: `video_row_id` (→ catalog), `day`, `metrics jsonb` (same shape + `impressions`, `impressionsClickThroughRate`, `averageViewPercentage`), UNIQUE (video_row_id, day).
- `tandem_analytics_reports` — on-demand analytics report cache: `channel_id`, `video_row_id` (nullable for channel-level), `kind text` (`RETENTION` | `TRAFFIC` | `PLAYBACK_LOCATION` | `DEMOGRAPHICS` | `DEVICES` | `REVENUE` | `SUBS`), `period_start date`, `period_end date`, `payload jsonb`, `fetched_at`. Fetched lazily, considered fresh for `YT_REPORT_TTL_MINUTES` (default 360), re-fetched by sync/manual refresh beyond the TTL.
- `tandem_channel_syncs` — per-channel sync state: `channel_id` UNIQUE, `last_video_sync_at`, `last_metrics_sync_at`, `status text` (`IDLE` | `SYNCING` | `ERROR`), `error`, `new_videos_seen int` (count of uploads discovered on the most recent sync), `updated_at`.

View refresh uses these tables (upserts), never deletes history.

## 7. Database changes summary

- Add the tables above to `lib/db/src/schema/` (one new file `channels.ts` + one `channel-analytics.ts`), export from `schema/index.ts`.
- Migration: `lib/db/migrations/0004_creator_channels.sql` mirroring `0003_tandem_tours.sql`'s guarded, idempotent `DO $$ … IF NOT EXISTS` style (create tables + unique indexes). Apply via `pnpm --filter db run push-force` against dev DBs.
- `tandem_video_projects` gains `channel_id` via the same migration.
- Mirror every new table in `artifacts/api-server/src/test/in-memory-db.ts` (drizzle sqlite definitions + `CREATE TABLE` SQL + the `tables` map), mirroring column-for-column like the existing video tables.
- New env keys (see §8 for values to paste).
- Note in `.env.example` under a "YouTube Channel Analytics" section.

## 8. YouTube OAuth and credential configuration

### 8.1 Credentials to collect from the user (not yet provided)

The user selected "I'll paste Google credentials now". Needed before Phase 2 implementation can be exercised end-to-end:

1. **Google OAuth 2.0 Client ID + Client Secret** of type *Web application* (Google Cloud Console → APIs & Services → Credentials). Must have these enabled APIs on the project: **YouTube Data API v3** and **YouTube Analytics API**.
2. **Authorized redirect URI** registered in the console: `${TANDEM_WEB_URL}/creators-den/channels/oauth/callback` (per-environment; local dev = `http://localhost:5175/creators-den/channels/oauth/callback`, prod = the deployed origin) plus the authorized JavaScript origin.
3. **YouTube Data API v3 key** (optional fallback for public stats; analytics still requires OAuth).

### 8.2 Env vars

```
YOUTUBE_OAUTH_CLIENT_ID=
YOUTUBE_OAUTH_CLIENT_SECRET=
YOUTUBE_DATA_API_KEY=
YOUTUBE_REDIRECT_URI=            # default derived from TANDEM_WEB_URL + /creators-den/channels/oauth/callback
YT_SYNC_INTERVAL_MINUTES=60      # background analytics refresh cadence
YT_REPORT_TTL_MINUTES=360        # on-demand report cache freshness
YT_ANALYTICS_DAYS=90             # metric snapshot horizon (days back)
YT_SYNC_MAX_VIDEO_QUERIES=100    # per-sync cap on per-video report queries (quota guard)
```

No credentials are hard-coded. Missing credentials degrade gracefully: the CMS still works, connect shows a clear "YouTube integration is not configured" state, and analytics pages render empty-with-explanation states.

### 8.3 OAuth flow (server-side code exchange, PKCE)

1. `POST /api/channels/:channelId/oauth/start` (channel member owner only) — validates the channel is UNLINKED, generates `code_verifier`/`code_challenge` (S256) + `state` (HMAC over `{channelId, verifier, exp}`, `SESSION_SECRET`), stores a short-lived pending connect in memory, returns `{ url }` = Google authorization URL: `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=${YOUTUBE_REDIRECT_URI}&response_type=code&scope=openid email https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly&access_type=offline&prompt=consent&state=…&code_challenge=…&code_challenge_method=S256`.
2. User consents; Google redirects to `/creators-den/channels/oauth/callback?code=…&state=…` (a creators-den route; the client reads the query params and calls the exchange endpoint — no server-side web page needed).
3. `POST /api/channels/:channelId/oauth/exchange` `{ code, codeVerifier }` — verifies `state`, exchanges at `https://oauth2.googleapis.com/token`, calls `GET https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics,brandingSettings&mine=true` with the access token, validates the returned channel id is not already bound to a different `tandem_channels` row, upserts `tandem_channel_oauth` (encrypted), writes branding metadata + status `CONNECTED` on the channel, and kicks an initial analytics sync (§9).
4. Token refresh: before any YouTube call, if `expires_at` is near/over, refresh with the stored refresh token (`POST https://oauth2.googleapis.com/token`, `grant_type=refresh_token`), re-encrypt + store, mark `REVOKED` + channel `status` on `invalid_grant` (UI shows "Reconnect").
5. `POST /api/channels/:channelId/oauth/disconnect` (owner only) — calls `https://oauth2.googleapis.com/revoke`, clears the oauth row (keeps the channel + projects), sets status `UNLINKED`.

All outbound calls go through one small module `artifacts/api-server/src/youtube/client.ts` (`fetchYoutubeJson(path, { accessToken })` + `exchangeCode` + `refreshToken` + `revokeToken`), so route tests can stub it (vitest `vi.mock`) or stub `global.fetch`.

## 9. Analytics data flow and sync engine

### 9.1 Sync engine (`artifacts/api-server/src/youtube/sync.ts` + channel-scoped job loop)

Triggered by: manual `POST /api/channels/:channelId/analytics/sync` (owner, throttled ~1/min in memory), on successful connect, and on a background interval `YT_SYNC_INTERVAL_MINUTES` (mirrors the existing storage-meter/retention loop pattern in the API server — no new worker process in v1).

Per CONNECTED channel, in order:

1. **Catalog sync (detect newly published uploads):** `channels.list?part=contentDetails&mine=true` → uploads playlist id → `playlistItems.list?part=snippet,contentDetails&maxResults=50` paged up to `YT_SYNC_MAX_VIDEO_QUERIES`-bounded pages. Upsert `tandem_channel_videos`; count new `youtube_video_id`s into `new_videos_seen` (UI banner: "N new uploads detected and now tracked"). Store per-video `durationSeconds` (ISO 8601 parse) → `content_kind`.
2. **Metrics backfill/snapshot:** for the channel and each catalog video, `youtubeAnalytics.reports.query` per day (or day-range rows) over `[today - YT_ANALYTICS_DAYS, today]`, **incrementally** — only days missing from `tandem_*_daily_metrics` are fetched after the first backfill.
   - Channel report: `ids=channel==<id>`, `dimensions=day`, metrics `views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost,estimatedRevenue,estimatedAdRevenue`.
   - Video reports: `dimensions=day`, `filters=video==<videoId>`, same metrics + `impressions,impressionsClickThroughRate`.
   - (Subscriber deltas on videos are not supported by the Analytics API; the channel daily rows carry them and the video page shows channel-level sub movement alongside.)
3. **Report cache refresh (beyond TTL):** on-demand kinds are only re-fetched when a sync runs and the cached report is stale:
   - `RETENTION`: `metrics=averageViewPercentage&dimensions=elapsedVideoTimeRatio` (28 days).
   - `TRAFFIC`: `dimensions=insightTrafficSourceType`; `PLAYBACK_LOCATION`: `dimensions=insightPlaybackLocationType`.
   - `DEMOGRAPHICS`: `dimensions=viewerPercentage` (ageGroup/gender breakdowns).
   - `DEVICES`: `dimensions=deviceType`.
   - `REVENUE`: metrics `estimatedRevenue,estimatedAdRevenue,estimatedCpm,estimatedRpm` + ad-type dimensions (`adType`) where monetized.
   - `SUBS`: channel `dimensions=day` subs gained/lost for charting.
   Responses are the Analytics API `{ columnHeaders, rows }` shape; the client normalizes into zod-validated row arrays before `payload` is stored.
4. Update `tandem_channel_syncs` status/timestamps; on failure store `ERROR` + message (surface "Last sync failed — retry" on the analytics pages).

Quota guard: report queries for individual videos are capped per sync by `YT_SYNC_MAX_VIDEO_QUERIES` and only for videos with data newer than the last metric day; catalog sync is one playlist crawl. Sync never blocks auth or project routes.

### 9.2 Read paths (all DB-backed)

- Overview + video table + video detail + report sections are served **from the snapshot tables** (§11.3 endpoints), so page loads never call YouTube.
- Freshness surfaced honestly: each response/UI carries `lastSyncedAt` + `status` from `tandem_channel_syncs`, plus a "Refresh now" action (owner) that runs the sync and invalidates the React Query keys.
- No channel data yet (UNLINKED / never synced / sync error) renders an explainer + connect/refresh CTA — no fake numbers. (A `demo` source column exists on the metric tables for future seeded fixtures but v1 ships without demo data, per the credentials decision.)

## 10. Authorization matrix

Acting user comes only from `getAuth(req).userId`. `channelRole(channelId, userId)` resolves `OWNER` / `EDITOR` / none from `tandem_channel_members` (owner status of the channel's projects follows the channel OWNER in v1).

| Capability | Channel owner | Channel editor | Others |
|---|---:|---:|---:|
| See the channel on their CMS grid | Yes (owned card) | Yes (editor mirror card) | No |
| Open channel home + project pages of their own projects in the channel | Yes (all channel projects) | Yes — **only projects they are an ACTIVE member of** | No |
| Create a project in the channel | Yes | No | No |
| See the channel editor roster + live presence | Yes | Yes | No |
| Connect/disconnect/reconnect YouTube OAuth | Yes | No | No |
| Rename the channel / delete (empty only) | Yes | No | No |
| Attach a legacy unlinked project to the channel | Yes (own project, own channel) | No | No |
| Run analytics sync / see analytics | Yes | View-only (data comes from owner's token server-side) | No |
| Add/remove project members (existing rules) | Project Captain (owner) | No | No |

Rules:

- Editors reach the channel through their mirror card; the channel home lists only projects they're members of (§6.5). A removed editor loses the card and access the moment their last project membership in the channel ends.
- Project creation `POST /video/projects` now requires `channelId` and that the creator is that channel's OWNER; project pages additionally require (channel access AND project access) — project access keeps today's member / public-readonly semantics.
- All new write routes return 401 unauthenticated / 403 unauthorized consistently with existing video routes.

## 11. API and server work plan

Contract-first. All additions go into `lib/api-spec/openapi.yaml` under new tags `channels` and `channel-analytics` (naming consistent with the existing `video*` tags), then `pnpm --filter @workspace/api-spec codegen` regenerates `@workspace/api-zod` + `@workspace/api-client-react`.

### 11.1 Channel routes — new router `artifacts/api-server/src/routes/channels.ts`

- `GET /api/channels` — CMS grid: channels where the user is OWNER or EDITOR, each with `{ …channel, myRole, youtubeConnected, projectCount, memberCount, editorCount }` (editor viewers see the shared branding metadata; no oauth fields ever leave the server).
- `POST /api/channels` `{ name }` — create UNLINKED channel + OWNER membership row.
- `GET /api/channels/:channelId` — channel detail + `myRole` + recent activity counts (channel context for the shell/nav).
- `PATCH /api/channels/:channelId` `{ name? }` — owner rename (YouTube title wins after connect; manual rename only while UNLINKED or via an explicit "custom label" field if desired later).
- `DELETE /api/channels/:channelId` — owner; 409 while the channel still has projects or a CONNECTED oauth row (disconnect first, empty first); then delete channel + members + analytics rows.
- `GET /api/channels/:channelId/people` — contributor roster: channel members (owner + editors) with resolved `name`/`imageUrl` + their project roles across the channel (drives the avatar strip).
- `GET /api/channels/:channelId/projects` — project cards for the channel home: owner sees all channel projects; editors see only their memberships (returns the same `VideoProject`-shaped rows the existing list consumers expect, including member avatars for the carousel).

### 11.2 Existing video routes — channel integration (`routes/video.ts`, `routes/video-platform.ts`, `routes/video-production.ts` as needed)

- `POST /video/projects` body gains `channelId` (required); validates ownership (project owner == channel owner). Response unchanged otherwise.
- `GET /video/projects?channelId=…` — optional channel filter that also applies the §10 editor scoping (used by the channel home + workspace menu).
- `POST /video/projects/:projectId/members`, role patch, and member remove — after the existing member transaction, ensure/remove the `tandem_channel_members` EDITOR row per §6.5, and emit a notification whose deep link targets the channel project URL.
- New `PATCH /video/projects/:projectId/channel` `{ channelId }` — attach a legacy unlinked project (owner + own CONNECTED channel only).
- Existing `GET /video/projects` (no filter) keeps returning the user's projects (owned + memberships) with `channelId` included in each row so the client can route/redirect correctly.

### 11.3 Analytics routes — `artifacts/api-server/src/routes/channel-analytics.ts`

- `GET /api/channels/:channelId/analytics/overview?from&to` — channel KPI cards + daily series (views, watch time, subs, revenue), `lastSyncedAt`, `newVideosSeen`.
- `GET /api/channels/:channelId/analytics/videos?q&sort=views|watchTime|likes|ctr|retention|revenue|publishedAt&dir&from&to&limit&cursor` — video table rows merging catalog + latest daily metrics; filters are date-range + search (title) + sort; pagination simple cursor.
- `GET /api/channels/:channelId/analytics/videos/:videoRowId` — video KPIs + day series (views/watch time/AVD/likes/impressions/CTR), lifetime totals, published date, `contentKind`, channel-median CTR/AVD context for anomaly banners.
- `GET /api/channels/:channelId/analytics/videos/:videoRowId/report?kind=RETENTION|TRAFFIC|PLAYBACK_LOCATION|DEMOGRAPHICS|DEVICES|REVENUE|SUBS&period=…` — from the report cache; if stale and a sync is allowed, kicks a sync and returns `{ stale: true }` so the UI can show "refreshing…" and re-query.
- `POST /api/channels/:channelId/analytics/sync` — owner-only manual sync (throttled); returns new sync state.
- All analytics reads additionally require the caller to be a channel member (§10) — but all data retrieval uses the **owner's** stored token server-side; editors never see tokens.

Registered in `routes/index.ts`; token refresh + `invalid_grant` handling lives in the youtube client module (§8.3) so routes stay thin.

### 11.4 Route tests (see §15 for matrix)

`artifacts/api-server/src/routes/channels.test.ts` + `channel-analytics.test.ts` against the extended in-memory SQLite mirror; the youtube module is stubbed (`vi.mock`) with canned API payloads (channel, uploads playlist, reports) and canned failures (403/`invalid_grant`, quota exhaustion, non-monetized nulls).

## 12. Route and page plan (Creator Den frontend)

### 12.1 Entry and top-level structure (`artifacts/creators-den/src/App.tsx`)

The Tandem hub card still opens `/creators-den/`; the root is no longer the room but the **Channels (CMS) grid**.

| Route | Page | Purpose |
|---|---|---|
| `/` | `pages/cms.tsx` | Channel grid (owned + editor mirror cards), `+` new channel card, connect CTAs, unlinked-projects section, notifications panel |
| `/channels/:channelId` | `pages/channel-home.tsx` (evolved from `pages/room.tsx`) | The den for that channel: billboard w/ YouTube banner, channel avatar/name, owner/status, **Analytics** + New project actions, editor contributor strip, "recent projects" carousel (avatar stacks + live presence), "the five stages", notifications |
| `/channels/:channelId/analytics` | `pages/analytics/index.tsx` | Channel analytics — overview KPIs + video table with filters |
| `/channels/:channelId/analytics/videos/:videoRowId` | `pages/analytics/video.tsx` | Video analytics detail + charts |
| `/channels/:channelId/oauth/callback` | `pages/oauth-callback.tsx` | Handles the Google redirect (`code`/`state`) and exchanges it; navigates back to the CMS |
| `/channels/:channelId/projects/:projectId` + all current subpages (`/vault` content, `/activity`, `/preview`, `/preview/*`, `/review`, `/role/*`, `/notifications`) | existing pages | Today's pages **move under the channel** (identical sub-URLs as today, now nested). Channel context comes from the URL; the shell renders the channel name |
| `/projects/:projectId` (+ subpaths) | redirect shim (new tiny component) | Legacy flat deep links → resolve project → redirect to `/channels/:channelId/projects/:projectId` (or the "attach unlinked project" notice) |
| `/profile`, `/profile/:userId`, `/explore`, `/notifications` (global) | unchanged pages | Kept den-level by design (§17 open decision) |

Project-level notifications remain at `/channels/:channelId/projects/:projectId/notifications`; global inbox moves under the channel where it's project-scoped today — the existing relative-link logic is preserved by nesting.

### 12.2 CMS grid (`pages/cms.tsx`)

- Grid of channel cards: banner image, avatar, name (YouTube title when connected), status chip (`Connected` / `Not connected`), project count; editor mirror cards read the shared branding and show "You're an editor" instead of owner menus.
- `+ New channel` card → modal (name) → `POST /channels` → **connect modal immediately opens** (OAuth start → Google consent → callback → exchange) → card updates with real branding. Cards that stay UNLINKED show a "Connect your YouTube channel" action.
- Card menu: owner → Open, Connect/Reconnect, Disconnect, Delete (blocked with tooltip when projects remain); editor → Open, (no owner actions).
- **Unlinked projects** section (owner-only list of `channel_id = NULL` projects) with "Attach to channel…" picker.
- Empty state: no channels yet → headline + `+` CTA (first-run flow).

### 12.3 Legacy flat deep-link shim

In `App.tsx`, before the `Switch`, a `Route path="/projects/:projectId/*?"` component resolves the project via `useGetVideoProject`:
- has `channelId` → `location.replace('/channels/' + channelId + '/projects/' + projectId + rest)` (keeps old inbox rows + every existing server-emitted notification deep link working with zero server churn),
- no `channelId` (legacy) → render "This project isn't attached to a channel yet" with an Attach action for its owner,
- not found/forbidden → the existing not-found page.

### 12.4 Shell + nav (`components/shell.tsx`)

- Brand block in the top nav: mark + "Creators Den" small caps; inside a channel the brand copy/second line shows the **actual channel name** (YouTube title, with its avatar) — `Creators Den · {channel name}`, per the brief ("every particular channel home page should now display the actual channel name on the navbar").
- **Analytics notch**: in the top-nav secondary row (the "notch" chips beside the home notch and the WORKSPACE dropdown) add an `Analytics` chip (bar-chart icon), lit while on any `/channels/:channelId/analytics` route — the brief's "notch beside the workshop dropdown".
- **Workspace dropdown** rework: top level lists the user's channels (avatar + name + role); expanding a channel lists that channel's projects; "New project" creates inside the current channel; "All channels" returns to the CMS.
- Project tabs (Vault/Review/Timeline/Preview + stage tabs), presence strip, and the project chat all continue working as today but are rendered only when a channel is in scope; the nav carries the channel id into every project link.
- "Home" notch links to the current channel home (`/channels/:channelId`); from the CMS it links back to the CMS. Keep `data-testid`s stable and add new ones (`nav-analytics`, `channel-brand`, `cms-*`, `card-channel-*`, `avatar-editor-*`, …).

### 12.5 Channel home (`pages/channel-home.tsx`) — brief bullets

- **Billboard**: YouTube banner as the hero (falls back to a gradient), channel avatar + name, "owned by you" vs "you're an editor on", connect status; actions: **Analytics** (primary CTA alongside New project when owner; editors see the projects they're on + the roster), Continue-project shortcut.
- **Contributor avatar strip** (GitHub-style): fetched from `/channels/:channelId/people` — owner + editors with avatar images and names; avatars show a **live dot** when that person is currently present on any project in the channel; clicking opens their profile. Renders the brief's "avatar of everyone currently present for any project" + "list of editors… like GitHub contributors".
- **Recent projects carousel** ("Continue where you left off"): each card shows the member avatar stack of people working on the project (from the project's `members`) **plus live presence** — the card highlights and overlays the avatars of members currently active on that project (presence entries carry `projectId`, so one channel subscription drives both the strip dots and per-card stacks). New-project card at the end (owner).
- Stage/leg education rail + notifications panel carried over from today's room page.

**Channel presence plumbing** (server `realtime.ts` + client `lib/realtime.tsx`): extend `presence:join` to accept optional `channelId`; the server keeps a second in-memory map `presenceByChannel` (channelId → userId → {projectId, name, joinedAt}), joins sockets to `channel:{id}` rooms, and broadcasts `channel.presence` (roster with projectIds) whenever a project roster in that channel changes. The channel home + CMS use a new `useChannelPresence(channelId)` hook (the existing `useProjectPresence`/`useProjectRealtime` calls gain `channelId` so studio pages feed the channel map without extra work).

### 12.6 Analytics UI (new)

Shared layout under the channel shell; charts via `recharts` (port the shadcn `chart.tsx` wrapper used in tandem if wanted; creators-den already has `creators.css` primitives to restyle with).

- **`/channels/:channelId/analytics`** — toolbar ("last 7 / 28 / 90 days", From/To, search, sort chips: Most views, Most likes, Watch time, CTR, Retention, Revenue, Newest/oldest) — brief's "filter by date, most views, most likes and so on". Stat cards row (views, watch time, AVD, subs gained, impressions, CTR, est. revenue) + a views/watch-time day chart + the **video table in rows**: thumbnail, title, published, views, watch time, AVD, likes/comments, CTR, retention %, revenue; row click → video page. "N new uploads detected" banner + "Last synced <time> · Refresh now". Unconnected channel → connect CTA instead.
- **`/channels/:channelId/analytics/videos/:videoRowId`** — header (thumbnail/title/date/shorts-vs-long-form), KPI cards (views, watch time, AVD, likes, comments, shares, impressions, CTR, est. revenue + RPM/CPM where monetized, subscribers +/- channel context), charts: views & watch time by day; **audience retention curve** (elapsed-time ratio vs average view percentage); traffic sources; playback locations; demographics (age/gender); devices; revenue day series. Anomaly banners comparing to channel medians (e.g. "CTR is 42% below this channel's median").
- Empty/error/loading + freshness states on every surface; all data from the snapshot endpoints (§11.3).

## 13. Frontend component plan (new/changed, creators-den)

| Piece | Notes |
|---|---|
| `pages/cms.tsx` (+ `components/channel-card.tsx`, `components/new-channel-modal.tsx`, `components/connect-channel-modal.tsx`) | CMS grid, create + OAuth connect |
| `pages/oauth-callback.tsx` | Exchanges code → navigates home |
| `pages/channel-home.tsx` | Evolves `pages/room.tsx` (channel scope, contributor strip, live carousel) |
| `components/contributor-strip.tsx`, `components/project-card-presence.tsx` | Roster avatars + per-project presence |
| `components/shell.tsx` | Channel-aware brand, Analytics notch, channel workspace menu, nested project tabs |
| `lib/realtime.tsx` + `components/shell.tsx` | `useChannelPresence`, channel join payloads |
| `pages/analytics/*` + `components/analytics/*` (stat cards, filters, charts, video table, report sections) | Analytics UI |
| `App.tsx` | New route tree + legacy redirect shim |
| `components/ui/chart.tsx` (port) + `recharts` dependency added to `artifacts/creators-den/package.json` (catalog version) | Charting |

Copy/visual language stays in the existing Netflix/YouTube dark-cinematic system (`creators.css`, `index.css`).

## 14. Alerts, notifications, and anomaly rules

Reuse the existing `tandemVideoNotificationsTable` + `notify()` + inbox surfaces. v1 rules run inside the sync engine after each metrics update and only fire once per (channel/rule/window) via a dedupe column-free approach — store a small `alerts` array on `tandem_channel_syncs` metadata or a dedicated `tandem_channel_alerts` table (id, channel_id, rule, message, period_start, created_at; unique on (channel_id, rule, period_start)):

1. **Watch-time drop** — channel watch time down ≥ 15% vs the previous 7-day window (brief's "weekly watch-time drop of 15%").
2. **Underperforming new video** — a video published ≤ 7 days ago sitting ≥ 40% below the channel's median CTR or median AVD at 72h (brief's "new video far below median CTR").
3. **Upload gap** — no new published upload for ≥ 14 days (brief's "a channel going too long without uploads").

Deep links target the video analytics page (rules 1–2) or the channel analytics page (rule 3). Alerts also surface as a banner on the channel analytics page (latest per rule). Everything else in the brief's monitoring/alerts list (brand deals, competitor movement, comment analysis, white-label reports, goal tracking) is future scope (§3.2).

## 15. Testing and verification plan

### 15.1 Automated tests

- **Schema**: typecheck (`pnpm run typecheck`), `pnpm --filter db push-force` applied against dev Postgres; new migration is idempotent (re-run safe).
- **Route tests** (`channels.test.ts`, `channel-analytics.test.ts` on the SQLite mirror with stubbed youtube client):
  - 401 when unauthenticated; 403 for non-owners on channel admin + sync + connect; 403 for a non-member opening a channel/project.
  - CMS list includes owned + editor-mirror channels with branding and no oauth fields; editor sees only their member projects on the channel.
  - Project creation requires `channelId` + ownership; legacy attach moves an unlinked project and only for its owner on their own channel.
  - Adding a member to a project on a channel creates exactly one EDITOR row; a second project on the same channel reuses it; removing the last membership removes the card.
  - OAuth: start returns a consent URL with state/PKCE; exchange (stubbed Google) stores encrypted tokens + CONNECTED status + branding; refresh on `invalid_grant` marks REVOKED and UI prompts reconnect; disconnect clears the row but keeps the channel.
  - Sync: first sync backfills catalog + daily rows; second sync is incremental (no duplicate day rows); new uploads detected → `newVideosSeen`; YouTube 403/quota/non-monetized nulls degrade to stored partials + `ERROR` status instead of 500s.
  - Report endpoints: serve from cache; stale → `{ stale: true }` + trigger sync.
  - Anomaly rules fire once per (rule, window) with correct deep links.
  - Analytics reads are DB-backed only (no outbound youtube calls on GET).
- **Frontend**: vitest for the legacy deep-link redirect helper (pure function resolving `/projects/:id` → channel URL vs unlinked notice) and any analytics format helpers (number/date/currency formatting, sort descriptors); keep existing creators-den tests green (`pnpm --filter @workspace/creators-den test`).
- **Contract**: `pnpm --filter @workspace/api-spec codegen` then full workspace `pnpm run typecheck` + `pnpm run build`.

### 15.2 Manual acceptance walkthrough (live, needs the real Google credentials)

1. Sign in; land on the CMS grid (empty state).
2. `+ New channel` → name it → Google consent appears → pick the test YouTube channel → returns with banner/logo/name + Connected.
3. Create a project inside the channel, upload footage, walk the vault/studio/review/preview as today; confirm the navbar shows the channel name and Analytics notch is present.
4. Second test account: add them as an editor to the project. Confirm they appear in the channel's contributor strip and that the same channel card (real branding, only that project) appears on their CMS. Add them to a second project in the same channel and confirm the card is reused; remove them and confirm the card disappears.
5. Two browsers in the same channel + project: channel home contributor dots and per-project carousel avatars update live.
6. Analytics: run a sync; confirm the video table populates with the test channel's real uploads, filters/sorts work, and a video's analytics page shows KPIs + retention/traffic/demographics/devices/revenue sections (revenue shows "not monetized" on non-monetized channels). Confirm "Refresh now" and the freshness line.
7. Old inbox notification deep links (`/creators-den/projects/:id`) still open the right project inside its channel.
8. Regression: legacy unlinked project hidden from channels; attach flow works; explore/profile pages still function.

### 15.3 Verification commands

`pnpm run typecheck`, `pnpm run build`, `pnpm --filter db push-force`, `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/creators-den test`, then the live walkthrough at `http://localhost:5173` (see `START-APP.md`/`replit.md` for boot steps).

## 16. Delivery sequence

### Phase 0 — Credentials + preflight

- [ ] User provides Google OAuth web client id/secret + enabled YouTube Data v3 and YouTube Analytics APIs + YouTube Data API key + confirms the redirect URI (`{origin}/creators-den/channels/oauth/callback`) is registered (see §8.1 for the exact list).
- [ ] Add env keys to `.env.example` (§8.2) and to the user's `.env`.
- [ ] Confirm `pnpm --filter @workspace/api-spec codegen` runs cleanly on the current spec (baseline).

### Phase 1 — Channel foundation (data + API + restructure)

- [ ] Schema + migration + sqlite mirror (§6, §7).
- [ ] `channels.ts` router (§11.1), project route integration + legacy attach (§11.2), membership lifecycle (§6.5), openapi spec additions + codegen.
- [ ] CMS grid + `+` flow (UNLINKED state), unlinked-projects section.
- [ ] Route restructure: channel-scoped pages, shell channel branding + Workspace menu, legacy deep-link shim (§12.3–12.5 incl. presence extension).
- [ ] Channel home: contributor strip, presence-aware carousel (§12.5).
- [ ] Route tests (§15.1) green; typecheck + build green.

### Phase 2 — YouTube OAuth linking

- [ ] OAuth module + routes (§8.3): start/exchange/disconnect/refresh; encrypted token store; branding fetch; connect UI in the CMS modal + card actions.
- [ ] OAuth route tests with the stubbed youtube client.
- [ ] Live connect walkthrough with the user's test channel (requires Phase 0 credentials).

### Phase 3 — Analytics ingestion + APIs

- [x] `youtube/client.ts` + `youtube/sync.ts` (§8.3, §9.1): catalog sync, incremental daily metrics, report caches, background interval + manual sync endpoint, sync-state rows. **Completed: `artifacts/api-server/src/youtube/client.ts` (fetchYoutubeJson + report normalization), `youtube/sync.ts` (catalog crawl w/ videos.list enrichment, incremental channel+video daily metrics, report TTL refresh, anomaly rules, per-channel sync-state upserts), `youtube/analytics-runner.ts` (YT_SYNC_INTERVAL_MINUTES loop, wired in `index.ts`), manual sync endpoint with ~1/min throttle. Schema: `tandem_channel_videos` / `_daily_metrics` / `_reports` / `tandem_channel_syncs` / `tandem_channel_alerts` + migration `0005_channel_analytics.sql` + sqlite mirror. Verified: sync tests green.**
- [x] Analytics GET routes + overview/videos/detail/report endpoints (§11.3) + spec/codegen. **Completed: `artifacts/api-server/src/routes/channel-analytics.ts` (overview, video table w/ search/sort/cursor, video detail w/ channel medians, report cache w/ stale→sync, owner sync POST), openapi `channel-analytics` tag + codegen regenerated.**
- [x] Anomaly rules + notifications (§14). **Completed: WATCH_TIME_DROP / VIDEO_UNDERPERFORMING / UPLOAD_GAP rules run inside the sync, deduped via `tandem_channel_alerts` (channel, rule, period_start) and delivered through `notify()`-style `tandemVideoNotifications` + `emitToUser`; deep links target the channel/video analytics pages.**
- [x] Analytics route tests with canned YouTube payloads (§15.1). **Completed: `channels-analytics.test.ts` (12 tests): auth/membership, first-sync backfill, incremental second sync, 403 degradation → ERROR state + stored partials, DB-backed reads with zero YouTube calls, report freshness/stale, owner-only sync + throttle, anomaly dedupe.**

### Phase 4 — Analytics UI

- [x] Channel analytics page: stat cards, filters, video table (§12.6) + Analytics notch + home CTA wiring. **Completed: `pages/analytics/index.tsx` (KPI stat cards, 7/28/90-day range chips, search + sort toolbar, views/watch-time recharts day chart, video table w/ thumbnail/title/kind/duration + published/views/watch-time/AVD/likes/CTR/retention/revenue, cursor "Load more"). Analytics notch (`nav-analytics`) and channel-home CTA (`link-channel-analytics`) were already wired in Phase 1 and kept.**
- [x] Video analytics page + report sections with recharts. **Completed: `pages/analytics/video.tsx` (header w/ thumbnail + kind/duration/date + channel-level sub movement, 9 KPI cards, views/watch-time day chart, report sections — audience retention curve, traffic sources, playback locations, age/gender demographics, devices, revenue w/ RPM/CPM chips; anomaly banner vs channel medians). recharts ^2.15.2 added + `components/ui/chart.tsx` ported (shadcn wrapper) with `lib/utils.ts` `cn`.**
- [x] Freshness/refresh states + "new uploads detected" banner. **Completed: freshness bar (Last synced / Never synced), owner-only "Refresh now" + SYNCING spinner, ERROR banner w/ message, "N new uploads detected" tag, per-report "Refreshing…" auto-refetch when the cache is stale.**
- [x] Frontend helper tests; visual pass at desktop/mobile widths. **Completed: `lib/analytics-format.ts` + 10 unit tests (number/watch-time/percent/currency/date/duration formatting, below-median anomaly math, thumbnail picker) — creators-den suite 84/84 green. Visual pass pending live credentials (§15.2 walkthrough).**

### Phase 5 — Verification and handoff

- [ ] Full §15.2 manual walkthrough with the real channel.
- [ ] Regression pass on existing den flows, den tour gate, and the desktop-agent sign-in path.
- [ ] Docs updated: this checklist, `.env.example`, `FEATURES.md`-style summary, `START-APP.md`/`replit.md` additions (analytics dev notes), completion log.

## 17. Open decisions and deviations

Recorded explicitly instead of silently choosing behavior:

- **Legacy projects are not auto-migrated** (user decision): unlinked projects stay hidden from channel surfaces until their owner attaches them (§6.4).
- **Creator Den root becomes the Channels/CMS grid** — the Tandem "Open Creators Den" entry still points at `/creators-den/` (§12.1).
- **Profile / Explore stay den-level** rather than nested under a channel (a GitHub-style account surface). Channels scope the production surfaces (projects/studios/analytics). Flag for veto if the brief's "move the current creator-den pages into a channel" was intended to include profile/explore.
- **One YouTube channel per channel row**, bound to the connecting user's own Google account. YouTube Analytics API only serves channels the OAuth account owns. Managing third-party channels under someone else's Google identity (CMS partnership / delegated access) is a future model hook (`tandem_channel_oauth.linkedByUserId`) rather than a v1 claim — the brief lists it under techniques to consider, not as a first-release requirement.
- **Deep links stay flat** (`/creators-den/projects/:id`) and redirect client-side into the channel URL, so old notifications and existing server call sites keep working without rewriting every `notify()` invocation (§12.3).
- **Analytics is a snapshot/cache layer over the YouTube APIs** (§9): pages never call YouTube on load; freshness + "Refresh now" is explicit. Competitive/benchmark analytics for non-owned channels is future scope and would need a separate public-data source.
- **Revenue data appears only where YouTube reports it** (monetized channels, `estimatedRevenue`); RPM/CPM shown where the API provides them; otherwise explicit "not monetized / unavailable" states.
- **Channel delete is empty-only in v1** (no soft-delete/archive): a channel with projects must be emptied first; editors cannot delete; disconnect clears tokens but keeps the channel.
- **No seeded demo analytics** in v1 — the user will provide real credentials; the `source` column on metric tables leaves room for a later demo mode.
- **Tour gate scope**: the existing one-time 10-minute den tour (`DenTourGate category="content-creators"`) wraps the whole app and stays as-is for v1; whether the tour should begin at the CMS grid or per channel is audited in Phase 1 and revisited with the product owner if the gate copy needs channel awareness.
