# Creator Den — Collaboration / Audition Arena (Public Contribution System) Implementation Plan

**Status:** Plan for review — no code changes made yet
**Last updated:** 2026-09-05
**Primary source:** product brief pasted 2026-09-05 — "public contribution system for the creator-den on the category page" (integrate the collaboration system into Creators Den so people can post an open role in their channel project and others can audition for it).
**Target apps:** `artifacts/creators-den` (frontend — CMS card row, Arena pages, read-only project surface, notifications), `artifacts/api-server` (new arena route module + `video/access.ts` widening, notifications, activity/realtime), `lib/db` (schema/migrations), `lib/api-spec` → `lib/api-zod` + `lib/api-client-react` (API contract + codegen), plus the Tandem content-creators category doorway (`artifacts/tandem/src/pages/content-creators.tsx`) and shared notice metadata (`artifacts/tandem/src/lib/notice-meta.ts`).
**Related docs:** `CREATOR-DEN-CHANNELS-ANALYTICS-PLAN.md` (channel/CMS/analytics restructure this builds on), `TADEM_COLLABORATION_IMPLEMENTATION_PLAN.md` (the Author Den collaboration pattern to mirror in spirit), `FEATURES.md`, `START-APP.md`, `replit.md`, `.env.example`.

---

## 1. Purpose and product outcome

Creators Den gets a **public contribution / audition system**: a Captain who runs projects under their channel can post an open role — **Video, Audio, Script, or Thumbnail** — for a specific project, and any signed-in creator can browse those open roles, **preview the project read-only (PREVIEW + TIMELINE tabs only)** while the role is open, and **apply with a message and supporting documents**. Applications land in the Captain's notification center with the applicant's name, avatar, message, and uploaded files, plus **Accept** / **Reject** controls and a **View portfolio** link into the applicant's public profile (their public track history — projects they created or participated in — CV, contributions). Accepting adds the applicant to the project as a member holding that role and auto-fills the post; rejecting notifies the applicant.

Beyond the core apply/decide loop, v1 ships the applicant lifecycle (**My Auditions** history + **withdraw**), sharing and discovery (**share links**, board **sort**, a **follow-first feed** over the existing user-follow model), **role watch alerts**, **mutual work reviews** (public, on profiles, after a hire), and **anti-spam** (per-week application cap + per-Captain blocks). See §3.1.

The discovery surface is a new cross-channel den page named the **Collaboration / Audition Arena** (`/creators-den/arena`), entered from a **new card row at the bottom of the MCNs grid page `/creators-den/`** (per product decision 2026-09-05) and advertised from the Content Creators category page in the Tandem hub (`/categories/content-creators`) so the category doorway points into the Arena like it points into the den today.

Design intent: reuse every existing Creator Den primitive instead of building a parallel universe — the four content roles and member model, the existing **PUBLIC read-only experience** (non-member viewers already get only the PREVIEW + TIMELINE nav bars), the notification/inbox + realtime system, the profile/track-history/portfolio surface, and the file-upload conventions. We mirror the *pattern* of the Author Den pitch board (post → apply → creator decides), but implement with Creator Den's own tables, roles, and read-gates. We do **not** reuse the author collaboration tables/routes.

## 2. Product vocabulary

| Term | Meaning |
|---|---|
| Audition Arena / the Arena | New cross-channel Creator Den page: browse + post open roles. Route `/creators-den/arena` |
| Role post / open role | `tandem_arena_posts` row: one of the four content roles wanted on one channel project |
| Audition / application | `tandem_arena_applications` row: a creator's application (message + documents) to one post |
| Applicant count | Live number of people currently auditioning for the post's role on that project — `PENDING` applications on the post; shown on the board card and the post itself and kept fresh (see §6.5) |
| Preview window | The read-only project surface a signed-in creator gets while a post on that project is OPEN — PREVIEW + TIMELINE only (same as today's PUBLIC read-only) |
| Captain | Project owner (`tandem_video_projects.ownerId`), the only person who can post roles and accept/reject auditions |
| Portfolio | The applicant's existing public profile page (`/creators-den/profile/:userId`): public track history, CV, contributions, followers |
| Content role | `VIDEO` \| `AUDIO` \| `SCRIPT` \| `THUMBNAIL` — the postable roles (`CONTENT_ROLES` in `artifacts/creators-den/src/lib/roles.ts`) |
| My Auditions | Applicant-side history of their own applications (all statuses) with links back to the posts — `/creators-den/arena/mine` |
| Withdraw | Applicant retracts a PENDING application → `WITHDRAWN`; the live count drops and the Captain is notified |
| Role watch | An alert subscription (`tandem_arena_watches`): notify me when a new open role matches a role (+ optional channel) |
| Work review | Post-hire mutual rating: Captain ↔ hired applicant leave one short public review each (on the hire) |
| Captain block | Per-Captain blocklist (`tandem_arena_blocks`): a blocked applicant cannot apply to that Captain's posts |

## 3. Scope and release boundaries

### 3.1 First-release scope (this plan)

1. Arena data model (posts, applications, application files) + migration.
2. Arena board page (open roles across the platform, role filter, poster/channel/project cards) and post detail page (audition view + Captain management view).
3. "Post an open role" flow for Captains — from the Arena CTA **and** from inside a channel project (Vault), restricted to projects inside a channel the Captain owns.
4. Read-only **preview window**: while a post on a project is OPEN, every signed-in creator can open that project with only the PREVIEW + TIMELINE nav bars (even when the project is PRIVATE). Reuses/extents the PUBLIC read-only access path and UI.
5. Apply modal: required application message + optional document uploads (reusable upload/multer conventions), one pending application per user per post.
6. Captain notifications: application arrives with applicant name/avatar/message/documents; Accept and Reject buttons; applicant is notified on accept (becomes a member with that role, channel editor row provisioned, post auto-fills) and on reject.
7. **Live applicant count on every post**: the board card and the post header show how many people have already applied for that role on that project, updated in real time as applications land (see §6.5).
8. View-portfolio affordance on every application (links to the existing public profile page).
9. Notification metadata for the new categories in both notice surfaces; activity events; realtime keep-fresh.
10. **My Auditions** — applicant history page listing every application they have made with its status and a link back to the post.
11. **Withdraw** — an applicant can retract a PENDING application (count drops, Captain notified, `WITHDRAWN`).
12. **Share links** — copy/share affordance on every post.
13. **Board sorting + follow-first feed** — sort by newest or most auditions; an option to surface posts from Captains the viewer follows first (existing `tandem_video_follows`).
14. **Role watch alerts** — subscribe to a role (optionally scoped to one channel) and get notified when a matching open role is posted.
15. **Mutual work reviews** — after a hire, the Captain and the hired applicant each leave one short public review (rating + line) that renders on profiles.
16. **Anti-spam** — server-enforced per-week application cap (429) and per-Captain applicant blocks (403); no moderator UI in v1.
17. Route tests (in-memory SQLite mirrors), typecheck/build, and a two-account live walkthrough.

### 3.2 Explicitly future scope (preserved in the model, labeled future, not built in v1)

- Multiple open seats per post (v1: one hire per post, other pending auditions are auto-declined on fill).
- Bids/compensation, contracts, or onboarding beyond the existing member+role grant.
- Direct messaging between Captain and applicants inside the Arena (existing project chat / threads do not apply to non-members; a private thread surface is a later slice).
- An applicant-score / compatibility / AI layer (Author Den has this; explicitly out of Creator Den v1).
- Letting tour/pass-less visitors browse or apply from outside the den gate (see §13 open decisions).
- Posting roles from legacy channel-less (unlinked) projects — Captain must attach the project to a channel first.

Anything else in the brief not listed in §3.1 is treated as future scope unless added later.

## 4. Implementation rules

1. Follow the repo's contract-first convention: update `lib/api-spec/openapi.yaml`, regenerate with `pnpm --filter @workspace/api-spec codegen`, then implement routes against the generated `@workspace/api-zod` schemas. UI consumes the generated `@workspace/api-client-react` hooks.
2. Keep Clerk as the single identity source; derive the acting user only from `getAuth(req).userId` server-side.
3. Enforce posting/decision rights and read access in server authorization and DB logic (§9, §10), never just in disabled UI buttons.
4. Use existing schema/migration conventions: Drizzle tables in `lib/db/src/schema/*`, guarded idempotent SQL migration `lib/db/migrations/0006_creator_arena.sql` (0004/0005 precedent), applied to live DBs via `pnpm --filter db run push-force`. Mirror every new table in the in-memory SQLite test schema (`artifacts/api-server/src/test/in-memory-db.ts`).
5. Reuse existing helpers instead of duplicating: `resolveProjectAccess` (`artifacts/api-server/src/video/access.ts`) widened for the Arena, `notify()` + `projectDeepLink` (`routes/video-platform.ts`), `recordVideoActivity`, `ensureChannelEditor`, `resolveUserProfiles`, `uploadDir` + multer (CV precedent in `routes/account.ts`), realtime `emitToUser`/`emitToProject`.
6. The read-only **preview window reuses the exact PUBLIC read-only surface**: a viewer granted Arena access gets the same responses, endpoints, and UI behavior a non-member PUBLIC viewer gets today (no writes, no crew chat, no member management; nav shows only Timeline + Preview). Do not invent a second read-only mode.
7. Keep existing den surfaces working — Arena never changes member/visibility/upload semantics.
8. Update this checklist as work proceeds: `[ ]` → `[x]` with a short completion note and validation result.
9. Progress-check-in doc style follows `CREATOR-DEN-CHANNELS-ANALYTICS-PLAN.md` / `TADEM_COLLABORATION_IMPLEMENTATION_PLAN.md`.

## 5. Preflight and source integration

Completed during plan review:

- [x] Confirm the Arena's host page. **Completed: `App.tsx` (creators-den) is a single router under base `/creators-den` with CMS → channel → project nesting plus den-level pages (`/profile`, `/explore`, `/notifications`). The Arena becomes another den-level page set (`/arena`, `/arena/posts/:postId`) rendered inside `CreatorsShell`; route chrome derives from `denRouteInfo` (`lib/den-urls.ts`), which already returns `other` for unknown top-level paths — Arena pages get CMS-like chrome and must not render project tabs.**
- [x] Confirm the CMS "card row at the bottom" insertion point. **Completed: `CmsPage` renders the channel grid + `UnlinkedProjects` under a `.cms-split`; the Arena doorway card goes in a new "more rooms" card row below that section (§7.2), consistent with the existing `.cms-head`/card vocabulary.**
- [x] Confirm the read-only preview surface. **Completed: `LegacyProjectGate` + `CreatorsShell` already implement the PUBLIC read-only experience — non-members on the flat `/projects/:projectId` path get only Timeline + Preview tabs (`readOnly` when `myRoles.length === 0`); server-side all reads funnel through `resolveProjectAccess` (member | public | null). This is the exact surface the Arena needs, extended to PRIVATE projects that carry an OPEN post.**
- [x] Confirm who can post / decide. **Completed: project owner (`CAPTAIN`) is authoritative (`tandem_video_projects.ownerId`); channel projects require the Captain to own the channel (`channels.ts`/`video.ts` rules). Posting requires `project.channelId != null` and channel ownership by the Captain.**
- [x] Confirm applicant identity/portfolio surface. **Completed: `ProfilePage` at `/creators-den/profile/:userId` already shows public track history (created or participated), CV card, contributions, and follow model — this IS the "view portfolio" destination. Application cards only need a deep link + resolved profile (name/avatar) from `resolveUserProfiles`.**
- [x] Confirm file upload conventions for application documents. **Completed: multer disk storage + `uploadDir()` exists (`routes/account.ts` CV upload: single file ≤15 MB into `uploads/<dir>/`), and browser uploads go through direct multipart POSTs. Arena docs follow the same shape (per-application folder, allowlist, size/file caps).**
- [x] Confirm notification plumbing. **Completed: `notify()` writes `tandem_video_notifications` and streams `notification.new` with `source: "creators"`; category metadata lives in `artifacts/creators-den/src/pages/notifications.tsx` (CATEGORY_META) and `artifacts/tandem/src/lib/notice-meta.ts` (CREATORS_META). New Arena categories are added to both maps.**
- [x] Confirm test conventions. **Completed: vitest route tests in `artifacts/api-server/src/routes/*.test.ts` run against the in-memory SQLite mirror with mocked Clerk auth; schema mirror lives in `artifacts/api-server/src/test/in-memory-db.ts`.**

## 6. Domain model and persistence plan

All new tables use the `tandem_` prefix and existing conventions (text PK `arena_…`, snake_case, timestamps).

### 6.1 `tandem_arena_posts` — an open role on one channel project (new)

| Column | Type | Notes |
|---|---|---|
| id | text PK | `arena_…` |
| channel_id | text NOT NULL | → `tandem_channels.id`; role posts exist under a channel |
| project_id | text NOT NULL | → `tandem_video_projects.id` |
| role | text NOT NULL | `VIDEO` \| `AUDIO` \| `SCRIPT` \| `THUMBNAIL` |
| pitch | text NOT NULL | Captain's description of the role/ask (zod: 10–2000 chars) |
| status | text NOT NULL default `'OPEN'` | `OPEN` → `FILLED` (hire landed) or `CLOSED` (Captain closed; may reopen) |
| posted_by | text NOT NULL | Captain's Clerk user id |
| created_at / updated_at | timestamptz | |
| UNIQUE partial | | `(project_id, role)` where `status = 'OPEN'` — one open post per role per project |

On fill, other OPEN posts on the same project for the same role are impossible by the partial index; other roles' posts may remain OPEN.

### 6.2 `tandem_arena_applications` — one audition (new)

| Column | Type | Notes |
|---|---|---|
| id | text PK | `arenaapp_…` |
| post_id | text NOT NULL | → `tandem_arena_posts.id` |
| project_id | text NOT NULL | denormalized from post (read-gate + member add need it) |
| role | text NOT NULL | denormalized snapshot of the post's role |
| applicant_id | text NOT NULL | Clerk user id |
| message | text NOT NULL | zod min length (e.g. 20) / max 2000 |
| status | text NOT NULL default `'PENDING'` | `PENDING` \| `ACCEPTED` \| `REJECTED` \| `WITHDRAWN` (withdraw, §8.5) |
| decided_by | text | Captain's user id when decided |
| decided_at | timestamptz | |
| created_at / updated_at | timestamptz | |
| UNIQUE partial | | `(post_id, applicant_id)` where `status = 'PENDING'` — one pending audition per user per post (409 on dupes) |

### 6.3 `tandem_arena_application_files` — uploaded supporting documents (new)

| Column | Type | Notes |
|---|---|---|
| id | text PK | `arenafile_…` |
| application_id | text NOT NULL | → `tandem_arena_applications.id` |
| file_name / mime_type / size_bytes | | metadata for the list UI |
| storage_key | text NOT NULL | multer file name inside `uploadDir()/arena/<application_id>/` |
| created_at | timestamptz | |

Caps (v1): up to **3 files per application**, each ≤ **15 MB** (CV precedent), allowlisted MIME types (pdf, images, common office docs, zip, text; extend list in the zod schema). Files are stored server-side; GET streams are authorization-checked (§10). No processing pipeline — these are reference documents.

### 6.4 Access (no new table)

Arena read access is **derived**: a signed-in creator may open a project in the Arena read-only window while that project has at least one `OPEN` `tandem_arena_posts` row. Implemented in `resolveProjectAccess` (`video/access.ts`) as a new `applicant` kind — it broadens the existing *read* paths for the same endpoints PUBLIC viewers already use (project detail, assets list/proxy, preview/timeline/activity). Writes keep using `requireMember`-style checks, so an Arena viewer can never mutate anything. Membership/ownership semantics are unchanged.

### 6.5 Live applicant count (derived, no new column)

Every post surfaces how many people have already applied for that role on that project. The count is **derived, never stored**: `COUNT(*)` over `tandem_arena_applications` for the post filtered to `status = 'PENDING'` (the people currently auditioning). Semantics:

- While the post is OPEN it shows the number of PENDING auditions — it goes **up the moment a new application lands** and **down when an audition is rejected or withdrawn** (that person is no longer auditioning). It is deliberately not "total applications ever", so the number always means *competing right now*.
- When the post is FILLED the count is replaced by the accepted hire's name ("Role filled by …"); when it is CLOSED it is not shown as a live figure.
- The Captain's management view additionally shows the full breakdown (`N pending · M total received`) since they need the history, not just the live number.

The list/detail endpoints compute it in the same query (correlated count), so board cards, the post header, and the Captain view never drift. Realtime/refetch keep it fresh (§9.4).

### 6.6 `tandem_arena_watches` — role watch alerts (new)

| Column | Type | Notes |
|---|---|---|
| id | text PK | `arenawatch_…` |
| user_id | text NOT NULL | the watcher |
| role | text NOT NULL | the watched role (`VIDEO` \| `AUDIO` \| `SCRIPT` \| `THUMBNAIL`) |
| channel_id | text | nullable — set = watch that role on one channel only; NULL = that role across the whole Arena |
| created_at / updated_at | timestamptz | |

At most one active watch per (user, role, channel-or-global) — enforced in the route (lookup first, 409 on exact duplicate). When an OPEN post is created, matching watchers are notified once per post (excluding the poster and anyone already applied to that post).

### 6.7 `tandem_arena_reviews` — mutual work reviews after a hire (new)

| Column | Type | Notes |
|---|---|---|
| id | text PK | `arenareview_…` |
| application_id | text NOT NULL | → the ACCEPTED application the review belongs to |
| project_id / role | | snapshot from the application |
| reviewer_id / reviewee_id | text NOT NULL | derived from who acts: Captain → hired applicant, or hired applicant → Captain |
| rating | int NOT NULL | 1–5 |
| note | text NOT NULL | short public line (zod: max 500) |
| created_at | timestamptz | |
| UNIQUE | | `(application_id, reviewer_id)` — each participant reviews the other at most once per hire |

Reviews exist only once the application is ACCEPTED (the hire happened); the Captain may review the hired applicant and the applicant may review the Captain. Received reviews are public on the profile page with project + role context.

### 6.8 `tandem_arena_blocks` — per-Captain applicant blocks (new)

| Column | Type | Notes |
|---|---|---|
| id | text PK | `arenablock_…` |
| captain_id | text NOT NULL | the project/post owner who blocks |
| applicant_id | text NOT NULL | the blocked user |
| created_at | timestamptz | |
| UNIQUE | | `(captain_id, applicant_id)` |

Blocking does not change any existing application status — it only stops the blocked user from applying to any post by that Captain (403 at apply). No global moderation in v1.

## 7. Page and route plan

### 7.1 New Creator Den routes (`App.tsx`, den-level pages)

| Page | Route | Purpose |
|---|---|---|
| Arena — board | `/creators-den/arena` | Browse OPEN role posts (role filter chips, project/channel/poster cards, live applicant count, posted time); "Post an open role" CTA (Captains); link out to read-only previews and post detail |
| Role post detail | `/creators-den/arena/posts/:postId` | **Audition view** (project summary, channel/poster, pitch, role, live applicant count, "Preview project", "Apply" → modal) **or Captain view** (the same page renders the application list with Accept/Reject/View portfolio when the viewer is the Captain) |
| Apply modal | on post detail | Message textarea + document upload; posts a multipart application |
| Read-only preview | `/creators-den/projects/:projectId…` | Reuses the existing flat read-only project path/gate (members still bounce into their channel URL) |
| My Auditions | `/creators-den/arena/mine` | The signed-in applicant's own applications (all statuses), newest first, with per-row status, document access, withdraw (PENDING only), and links back to the post |

`den-urls.ts` needs a small extension/test so `/arena`, `/arena/mine`, and `/arena/posts/:postId` resolve to `mode: 'other'` (no channel/project chrome; the shell keeps the CMS-style header and can show an "Arena" notch).

### 7.2 Discovery doorways

1. **CMS bottom card row (`/creators-den/`)** — a new section below the channel grid/unlinked projects, e.g. a "More rooms" card row whose first card is **Collaboration / Audition Arena**: "Post an open role on your channel's project, or audition for one. Preview the project, apply with your message and docs — the Captain decides." Opens `/creators-den/arena`.
2. **Channel project (Vault) "Post an open role" action** — Captain-only card/action on the project (next to Members & roles) that opens the post composer pre-bound to that project/channel, then jumps to the Arena post.
3. **Tandem category page `/categories/content-creators`** — a second doorway card beside "Open Creators Den" (e.g. "Audition Arena — open roles across Creator Den") linking to `/creators-den/arena`, so the category page surfaces the collaboration system.

### 7.3 Arena UI states

- Board: loading / empty (no open roles) / error; role filter chips (`All`, Video, Audio, Script, Thumbnail) each with a **watch bell** toggle; each card shows channel avatar + name, project name, role tag, Captain name, pitch excerpt, a **live applicant count chip** ("N already applied" — zero-state copy: "Be the first to audition"), posted-ago, and an **already-applied** state (CTA turns into "Application sent · pending" and the count chip reads "You + N"). Controls above the list: **sort** (`Newest`, `Most auditions`) and a **"From people you follow first"** toggle (orders posts whose Captain the viewer follows via `tandem_video_follows`).
- Post detail (audition view): sticky role header with the **live applicant count** under the role ("N creators have already applied for this role" / "Be the first to audition for this role"), pitch, project + channel summary (read-only info already public on the post), and actions: **Preview project** (opens the read-only window — anyone, while OPEN), **Apply for this role** (opens the modal; hidden/locked once applied, once the user is already a member of that project, or if it's the user's own post), **Share** (copies the post link), and **Watch <role> auditions** (per-role or per-role-on-this-channel bell). The count increments live when a new application lands and after this user's own submit ("You + N"); an applied user sees a **Withdraw** action.
- Post detail (Captain view): status controls (Close / Reopen), a **stats row** ("N auditioning now · M total applications"), and the application list — each card shows applicant avatar + name + Tandem ID, message, uploaded document chips (open/download), **View portfolio** (→ `/profile/:userId`), and **Accept** / **Reject** with confirm; decided cards show their outcome + timestamp; PENDING cards offer a quiet **Block applicant** action; withdrawn applications render as "Withdrawn"; post fill state banner ("Role filled by <name> — remaining auditions were declined").
- My Auditions (applicant): grouped status tabs (Pending / Accepted / Declined / Withdrawn), each row shows the post, role, project/channel, date, documents, and **Withdraw** for PENDING rows with confirm.
- Read-only preview window: identical to today's PUBLIC read-only (shell shows Timeline + Preview only, "Read only" tag), plus a slim "Audition preview — apply for the <role> role" banner linking back to the post when the viewer got in through an OPEN post. The shell `readOnly` computation and `LegacyProjectGate` switch on the access kind returned by the project detail endpoint rather than on `visibility` alone (§10).

## 8. User journeys and acceptance criteria

### 8.1 Captain posts an open role

1. Captain opens a project inside their channel (or the Arena → "Post an open role" picker).
2. Captain picks the role (Video/Audio/Script/Thumbnail), writes the pitch, publishes.
3. The post appears on the Arena board; the project now carries the Arena preview window for signed-in creators.

**Acceptance:** Only the Captain of a channel-owned project can post; only one OPEN post per (project, role); post is visible on the board and via its deep link; opening the project while the post is OPEN shows only PREVIEW + TIMELINE to non-members.

### 8.2 A creator auditions

1. A signed-in creator opens the Arena, filters to a role, opens a post — the post shows how many creators have already applied for that role on that project.
2. They may **Preview project** (read-only, PREVIEW + TIMELINE only) to judge fit.
3. **Apply** opens the modal: message (required) + supporting documents (optional, ≤3 × 15 MB).
4. Submit creates a PENDING application; the applicant count on the post increments immediately ("You + N"); the Captain is notified; the board/post mark the user as applied; a duplicate PENDING application is blocked (409).

**Acceptance:** The applicant can preview the private project only while the post is OPEN; the live applicant count on the board card and post header matches the number of PENDING auditions and updates when applications land or are rejected; the Captain receives a notification with applicant name/avatar/message/documents; re-applying while PENDING is blocked.

### 8.3 Captain reviews and decides

1. The Captain opens the notification → the post's Captain view (application list).
2. Each application shows the applicant avatar/name, message, uploaded documents, and a **View portfolio** button → the applicant's public profile (track history of projects they created/participated in, CV, contributions).
3. **Reject** notifies the applicant; **Accept** transactionally makes the applicant a project member with that role (channel editor row provisioned), fills the post, and auto-declines remaining PENDING auditions with notifications.

**Acceptance:** Accept is atomic (application ACCEPTED + post FILLED + exactly one member row + one notification); other pending auditions become REJECTED and the live applicant count drops to zero as they are declined; the post header switches from the count to "Role filled by <name>"; the applicant loses the preview window once the post is filled/closed (unless the project is PUBLIC, which is unchanged).

### 8.4 Captain closes a role without hiring

Closing sets the post to CLOSED and notifies PENDING applicants; their applications stay PENDING (post may reopen). The preview window closes with the post.

### 8.5 Applicant lifecycle: My Auditions and withdrawal

1. Any applicant opens **My Auditions** and sees every application they have made with its live status.
2. From a PENDING row (or the applied state on a post) they choose **Withdraw**; the application becomes WITHDRAWN, the post's live applicant count drops, and the Captain is notified.

**Acceptance:** My Auditions only ever shows the caller's own applications; withdrawing a PENDING application is atomic (status + count + Captain notification) and a decided application cannot be withdrawn (409).

### 8.6 Role watch alerts

1. A creator toggles a watch bell for a role (globally) or for a role on one channel.
2. When a Captain posts a matching OPEN role, the watcher gets a notification with the post deep link — unless they are the poster or already applied to that post.

**Acceptance:** Watches are self-managed (create/list/delete own only); one notification per new matching post; toggling off stops delivery; the Captain never gets their own watch notification.

### 8.7 Mutual work reviews after a hire

1. After an Accept fills a post, the Captain can review the hired applicant, and the hired applicant can review the Captain — rating (1–5) + one short line each.
2. Received reviews render publicly on the reviewee's Creator Den profile with the project + role context.

**Acceptance:** Reviews exist only for ACCEPTED applications; each participant may review the other exactly once per hire (409 on duplicates); ratings are bounded; review rows surface on profiles through the existing public profile read path.

### 8.8 Anti-spam: weekly cap and Captain blocks

1. A per-week application cap (default 10 applications per user per rolling 7 days) is enforced server-side on every apply (429 past the cap).
2. A Captain can quietly **Block applicant** on a PENDING audition — that user can no longer apply to any post by that Captain (403), while still being able to browse and audition elsewhere.

**Acceptance:** The cap counts every application created in the window (including later-withdrawn/rejected ones, so it cannot be gamed); blocking never mutates existing application statuses or notifications; the blocked user receives a clear, non-revealing error on apply.

## 9. API and server work plan

New module `artifacts/api-server/src/routes/arena.ts` (registered in `routes/index.ts`), endpoints under `/api/video/arena/*` so they inherit the video auth conventions. Contract additions go in `lib/api-spec/openapi.yaml` and are regenerated. Every write route parses `@workspace/api-zod` schemas and resolves the actor from `getAuth(req).userId`.

### 9.1 Posts

- `GET /video/arena/posts` — OPEN posts across the platform; zod-validated query: `role?`, `channelId?`, `projectId?`, `sort=newest|most_applied`, `followed=1` (order posts from Captains the caller follows first — JOIN `tandem_video_follows` on `followingId = posted_by`), pagination. Each row: post + role + pitch excerpt + project name/status + channel branding + poster profile + **`applicantCount` (live count of PENDING auditions on the post — §6.5)** + caller's own application state (`myApplication: 'none' | 'pending' | 'accepted' | 'rejected'`). `?mine=1` → the caller's own posts (Captain) with `applicantCount` plus `totalApplications` for the stats row.
- `GET /video/arena/posts/:postId` — full post, including **`applicantCount`** (and, for the Captain, `totalApplications`) computed in the same query. Public fields always; if caller is the Captain, includes the application list payload (§9.2) shape or a flag + the Captain view fetches applications separately.
- `POST /video/arena/posts` — body `{ projectId, role, pitch }`. Authorization: project exists, `project.channelId != null`, `project.ownerId === caller`, channel `ownerId === caller`; role ∈ CONTENT_ROLES; duplicate OPEN post → 409. Writes an activity event.
- `PATCH /video/arena/posts/:postId` — Captain only: `{ status: 'CLOSED' | 'OPEN' }` (close/reopen) and/or pitch edits while OPEN.

### 9.2 Applications

- `POST /video/arena/posts/:postId/applications` — **multipart** (`multer`): field `message` + up to 3 `files`. Authorization: post OPEN; caller not the Captain of the project; caller not an ACTIVE member of the project; no existing PENDING application (409); caller under the per-week cap (429, §8.8); caller not blocked by this Captain (403). Writes the application + file rows, `notify()`s the Captain (`video_arena_applied`, deep link to the post's Captain view), streams `notification.new`, records activity.
- `GET /video/arena/posts/:postId/applications` — Captain only; returns applications (any status, newest first) with `resolveUserProfiles` name/avatar, message, file metadata, decision metadata.
- `GET /video/arena/applications/:applicationId` — the applicant themself or the Captain.
- `POST /video/arena/applications/:applicationId/accept` — Captain only, PENDING only (409 otherwise). Transaction: application → ACCEPTED (+decidedBy/decidedAt) → post → FILLED → remaining PENDING on the post → REJECTED → insert/merge `tandem_video_members` with `roles: [role]` (ACTIVE) → `ensureChannelEditor(channelId, applicant)` → `recordVideoActivity` → notify applicant (`video_arena_accepted`, deep link to the now-member channel-scoped project) + notify auto-declined applicants (`video_arena_rejected`, "This audition was filled") → realtime. Returns the accepted application + member summary.
- `POST /video/arena/applications/:applicationId/reject` — Captain only, PENDING only → REJECTED + notify applicant (`video_arena_rejected`).
- `GET /video/arena/applications/:applicationId/files/:fileId` — stream a stored document (applicant or Captain only; mimetype + content-disposition from the row).
- `GET /video/arena/applications/mine` — the caller's own applications across every post (any status, newest first) for **My Auditions**; never another user's rows.
- `POST /video/arena/applications/:applicationId/withdraw` — applicant only, PENDING only (409 otherwise) → WITHDRAWN; live count drops; Captain notified (`video_arena_withdrawn`).
- `GET /video/arena/watches` · `POST /video/arena/watches` (`{ role, channelId? }`) · `DELETE /video/arena/watches/:watchId` — self-scoped watch management; duplicate watch → 409.
- `POST /video/arena/posts` additionally fans out: after insert, notify every matching watch owner (`video_arena_watch`) except the poster and anyone who already applied to that post.
- `POST /video/arena/applications/:applicationId/review` — body `{ rating: 1..5, note }`; only the two participants of an ACCEPTED application, once each per application (409 on duplicates). Reviewer/reviewee derived from actor vs applicant (Captain → hired applicant, or hired applicant → Captain).
- `POST /video/arena/applications/:applicationId/block` — Captain only: creates a `tandem_arena_blocks` row; application status is untouched; the blocked user gets 403 on future applies to this Captain's posts.

### 9.3 Access widening (`video/access.ts`)

- Add `kind: 'applicant'` to `ProjectAccess` when the caller is signed-in, not a member, and the project has ≥1 `OPEN` arena post — regardless of project `visibility`. (PUBLIC projects already resolve as `public`; unchanged.)
- `GET /video/projects/:projectId` response gains an explicit access field, e.g. `viewerAccess: 'member' | 'public' | 'applicant' | 'none'` (add to `GetVideoProjectResponse` zod + generated client). `myRoles` stays `[]` for applicant/public so the existing read-only UI triggers.
- Read endpoints already gated by `resolveProjectAccess` (project detail, assets, preview/proxy, timeline/activity, finish downloads-as-served-for-public) automatically cover the applicant window. Auditor pass: confirm no non-read endpoint uses `resolveProjectAccess` for authorization (writes must stay `requireMember`-based).

### 9.4 Events, notifications, realtime

New `tandem_video_notifications` categories (added to `CATEGORY_META` in creators-den and `CREATORS_META` in tandem `notice-meta.ts`):

| Category | Recipient | Label / tone | Deep link |
|---|---|---|---|
| `video_arena_applied` | Captain | "New audition" / gold | `/creators-den/arena/posts/:postId` |
| `video_arena_accepted` | applicant | "Audition accepted" / teal | channel-scoped project URL |
| `video_arena_rejected` | applicant | "Audition declined" / danger | `/creators-den/arena/posts/:postId` |
| `video_arena_closed` | PENDING applicants | "Audition closed" / muted | `/creators-den/arena/posts/:postId` |
| `video_arena_withdrawn` | Captain | "Audition withdrawn" / muted | `/creators-den/arena/posts/:postId` (Captain view) |
| `video_arena_watch` | watch owner | "New <role> audition" / accent | `/creators-den/arena/posts/:postId` |
| `video_arena_reviewed` | reviewee | "New work review" / teal | `/creators-den/profile/:userId` |

Activity events (`recordVideoActivity`, collaboration_activity_events table used by the project timeline): `arena_post_opened`, `arena_post_closed`, `arena_post_filled` ("<Name> joined as <role> via audition"), `arena_application_rejected`. Realtime: reuse `notify()`'s `emitToUser` stream for live badges/toasts; project members see fill events via `emitToProject`. The **live applicant count** on board cards and post headers refreshes from the same event stream (application created/rejected) plus query invalidation and refetch-on-focus, so the number a browser is looking at matches the DB within moments of an apply or a decision.

## 10. Authorization and privacy matrix

Every endpoint resolves the actor server-side. New row = Arena.

| Capability | Captain (post owner) | Applicant (PENDING) | Signed-in creator (not applied) | Project member | Unrelated user |
|---|---:|---:|---:|---:|---:|
| Browse the Arena board | Yes | Yes | Yes | Yes | Yes |
| Open an OPEN post | Yes | Yes | Yes | Yes | Yes |
| Preview project read-only (PREVIEW + TIMELINE) while post OPEN | Yes | Yes | Yes (if not a member; members use their own view) | Member view | No |
| Apply to an OPEN post | No (own post) | No (already PENDING) | Yes | No (already a member) | No |
| See application list + decide (accept/reject) | Yes | No | No | No | No |
| Read an application's documents | Captain + applicant only | | | No | No |
| View portfolio of an applicant | Yes (link to public profile) | — | — | — | — |
| Read private vault/chat/write anything through the preview window | No | No | No | Role-gated | No |
| See the live applicant count on a post | Yes | Yes | Yes | Yes | Yes |
| Withdraw own PENDING application | No | Yes (PENDING only) | — | No | No |
| Manage own role watches | Self | Self | Self | Self | — |
| Leave one work review per filled hire (either direction) | Yes (Captain side) | Yes (after accept) | — | — | — |
| Read public work reviews on a profile | Yes | Yes | Yes | Yes | Yes |
| Block an applicant (per-Captain) | Yes | No | No | No | No |
| Accept-created member rights | — | Role member after accept | — | — | — |

Additional rules:

- Application documents are never exposed in list endpoints to anyone except the Captain and the applicant (metadata yes; streams gated).
- Notification bodies/titles carry safe summaries only — no message text, no file names of private docs beyond the applicant's name/role/project.
- Posting/accepting requires the caller to be the Captain of a **channel-owned** project (channel membership/ownership verified); no disabled-button-only security.
- Accept is a single transaction — no half state (application ACCEPTED but no member, or post FILLED with an unfilled role).
- Preview-window access ends when the last OPEN post on the project closes/fills — verified live (not cached) so revocation is immediate.
- Withdrawing or rejecting an audition decrements the live applicant count (§6.5); a decided application can never be withdrawn.
- The per-week apply cap counts every application created in the rolling window — withdrawals and later rejections do not refund the slot.
- A block is per-Captain only: it stops future applies by that user to that Captain's posts and never changes existing application statuses or the preview window; there is no global moderation surface in v1.
- Reviews exist only after a hire (ACCEPTED application), once per direction; they are public profile data (rating + line + project + role), so note content is subject to the same public-profile visibility as track history.

## 11. Frontend implementation plan

### 11.1 Contract and data layer

- Regenerate `@workspace/api-zod` / `@workspace/api-client-react` after the OpenAPI additions; use the generated hooks (`useListArenaPosts`, `useCreateArenaPost`, `useGetArenaPost`, `useApplyArenaPost` (multipart), `useListArenaApplications`, `useAcceptArenaApplication`, `useRejectArenaApplication`, `useGetArenaApplicationFile`, `useListMyArenaApplications`, `useWithdrawArenaApplication`, `useListArenaWatches`/`useCreateArenaWatch`/`useDeleteArenaWatch`, `useCreateArenaReview`, `useBlockArenaApplicant`, and a `useListArenaReviews(userId)` for profiles). No hand-rolled fetch except where the codebase already does it.
- Add arena rows to the creators-den notifications `CATEGORY_META` and tandem `CREATORS_META`.

### 11.2 Pages and components

- `pages/arena.tsx` — board (filters, cards, empty/loading/error, already-applied state).
- `pages/arena-post.tsx` — detail with Captain vs audition branching.
- `components/arena-apply-modal.tsx` — message textarea (char count), multi-file picker with client-side size/type/count validation, submit as `FormData`, success/error states, duplicate-application guard surfaced from 409s.
- `components/arena-post-composer.tsx` — Captain post flow (project picker scoped to owned channels/projects, role select, pitch).
- `pages/arena-mine.tsx` — My Auditions (status tabs, withdraw with confirm, document access, links back to posts).
- Board controls on `pages/arena.tsx`: sort (newest / most auditions), follow-first toggle, role watch bells.
- Share (copy-link) affordance and watch toggle on `pages/arena-post.tsx`; watch bell states on role chips.
- `components/work-reviews-card.tsx` — renders received reviews (rating, note, project, role, reviewer) on the public profile page (`pages/profile.tsx`), with an empty state.
- CMS "More rooms" card row on `pages/cms.tsx`; Vault "Post an open role" action on `pages/vault.tsx` (Captain only); Arena notch in the shell when on `/arena…`.
- `content-creators.tsx` (Tandem) — second doorway card to the Arena.
- Read-only window: update `LegacyProjectGate` + `CreatorsShell` to key the read-only/allow path off `project.viewerAccess` (`public` or `applicant`) instead of `visibility === 'PUBLIC'` alone; applicant banner linking back to the post; the flat path already renders the correct read-only tab set.
- Role/status labels reuse `ROLE_LABELS`/`rolesLabel`; empty states copy follows existing tone.

### 11.3 States and accessibility

Loading, empty, error, closed/filled, already-applied, own-post, already-member, and unauthorized states everywhere; modal focus management + `role="dialog"`/`aria-modal`, labelled form fields, accessible confirm on Accept/Reject, `aria-live` for the notifications/unread badge and socket toasts.

## 12. Testing and verification plan

### 12.1 Automated route tests (`routes/arena.test.ts`, in-memory SQLite mirror)

- [ ] Unauthenticated reads/writes → 401.
- [ ] Only the Captain of a channel-owned project can create a post (403 otherwise); duplicate OPEN (project, role) → 409.
- [ ] Posting validates role ∈ CONTENT_ROLES and pitch length; unlinked (channel-less) projects rejected.
- [ ] Open role posts grant a non-member signed-in creator read access (project detail + assets + preview endpoints) **only while OPEN**; closing/filling the post revokes it (403).
- [ ] Writes stay member-gated: an Arena viewer cannot add members/assets/upload through the preview window.
- [ ] Apply requires OPEN post, non-owner, non-member; duplicate PENDING → 409; message/file caps enforced; documents stored and streamable only to applicant/Captain.
- [ ] Captain notification fires on apply with safe summary; deep link points at the post's Captain view.
- [ ] Applicant count is derived and live: posting returns `applicantCount: 0`; each accepted apply increments it; rejecting an audition decrements it; filling the post clears it to the filled state (asserted through the posts list and detail responses).
- [ ] Accept transaction: application ACCEPTED + post FILLED + exactly one member row with the role + channel editor row exists; other PENDING applications auto-REJECTED; applicant notified; second accept → 409.
- [ ] Reject: PENDING → REJECTED, applicant notified, member count unchanged.
- [ ] Close: post CLOSED, PENDING applicants notified, preview window revoked.
- [ ] Notification payloads never include application message text or private file content.
- [ ] `GET /applications/mine` returns only the caller's applications; withdrawing a PENDING application → WITHDRAWN (409 once decided), Captain notified, live count decrements.
- [ ] Per-week cap returns 429 past the limit (counts withdrawn/rejected applications in the window); a Captain block makes the blocked user's applies return 403 without altering existing applications or their documents.
- [ ] Watch endpoints are self-scoped (403 on another user's watch); creating an OPEN post notifies matching watchers (role + channel or global) exactly once, excluding the poster and existing applicants; deleting the watch stops delivery.
- [ ] Reviews: only the two participants of an ACCEPTED application can create one, once each per application (409 duplicates), rating 1–5 enforced; review rows are readable through the public profile read path.
- [ ] Follow-first ordering puts posts from followed Captains first; `sort=newest|most_applied` is stable.

### 12.2 Manual acceptance walkthrough (two accounts)

1. Captain A creates channel + project, opens Vault, posts a "Video" open role; sees it on the Arena board ("Be the first to audition") and via deep link.
2. Creator B (signed in, not a member) opens the post — confirms the live applicant count shows 0 — then opens the project and confirms only PREVIEW + TIMELINE nav bars appear, no Vault/Review/chat/write affordances, then returns.
3. B applies with a message + a PDF document; the post count flips to "You + 0" / "1 already applied" while B waits; duplicate apply is blocked; A's notification arrives with B's name/avatar/message/document.
4. A opens the application, opens B's portfolio (`/profile/B` — public track history/CV). A second creator C applies and the count flips to 2. A rejects C (notified, count back to 1), then accepts B.
5. Verify B is now a member with the Video role, appears on the channel roster, the post shows FILLED (count replaced by "Role filled by B"), C's audition is declined, and the preview window no longer opens for a third user.
6. Captain posts a "Thumbnail" role and closes it without hiring — pending applicants notified, preview window revoked.
7. Repeat spot-checks for Script/Audio roles and confirm Solo/unlinked-project/legacy flows are untouched.
8. Lifecycle: B applies to a second post, then withdraws it from My Auditions — Captain notified, count drops, decided applications cannot be withdrawn; B watches "Video" auditions and A's next Video post generates a `video_arena_watch` notification for B.
9. Reviews: after A's hire of B (step 5), A reviews B and B reviews A — both render on the corresponding profiles with project + role; a second review by either side is refused.
10. Safety: A blocks a spam applicant (their next apply to A's posts is 403 while they can still browse and audition elsewhere); the weekly cap is covered by the automated tests in §12.1.

### 12.3 Verification commands

- `pnpm --filter @workspace/api-server test` (route tests),
- workspace typecheck/build (`pnpm run typecheck`, `pnpm run build`, per-package Vite typecheck/build),
- live walkthrough at `http://localhost:5173` / creators-den dev port (see `replit.md` boot steps).

## 13. Open decisions and deviations

- **Arena access gating:** v1 keeps the Arena inside the Creator Den pass/tour gate (like every den page). Note for later: because the Arena is a *recruiting* surface, a future slice may make browse+apply available pre-pass while keeping post/compose Captain-only. Documented as future scope in §3.2.
- **Auto-decline on fill:** v1 fills one seat per post and auto-declines remaining PENDING auditions (each applicant notified). Multiple-seat posts are future scope (§3.2).
- **Application documents:** stored on server disk under the upload dir (CV pattern), ≤3 files × 15 MB, allowlisted types. Object storage (R2) for these small docs is not needed in v1.
- **Reopen semantics:** a CLOSED post may be reopened by its Captain; applications that were PENDING when it closed remain PENDING (no silent auto-decline on close, only on fill). Confirmed in §8.4.
- **Where the preview window starts/stops:** any signed-in creator while the post is OPEN (product decision 2026-09-05), not tied to having applied.
- **Arena naming:** "Collaboration / Audition Arena" is the product name on the CMS doorway card and board; internal/code name is the Arena (`arena_…` prefixes). Category-page copy on `/categories/content-creators` uses "Audition Arena".
- **No reuse of author collaboration tables/routes:** the Author Den pitch-board domain (seeds, continuations, contracts) stays separate; Creator Den implements its own post/application model on the video domain so role semantics, member grants, and read-only access stay native.
- **Per-week apply cap:** default constant of 10 applications per user per rolling 7 days (429), configurable server-side. The cap counts all applications created in the window — withdrawals and rejections do not refund a slot (§8.8).
- **Reviews scope:** only after the hire (ACCEPTED/FILLED), once per direction per application, public on profiles. Tying reviews to project completion/wrap status is a later refinement (future scope).
- **Blocks are per-Captain** — a self-serve safety valve with no global moderator in v1; a shared moderation queue is future scope.
- **Watch semantics:** a watch is per (user, role) with an optional channel scope; watchers are notified once per new matching post and never for their own posts or their own applications.

## 14. Delivery sequence

### Phase 0 — Contract and schema
- [x] Add arena schema tables + migration `0006_creator_arena.sql`; mirror in in-memory test schema.
- [x] Add OpenAPI definitions for §9 endpoints/fields (`viewerAccess` on the project detail response); regenerate clients.

### Phase 1 — Server: access + posts
- [x] Widen `resolveProjectAccess` with `applicant`; audit read vs write gating.
- [x] Post create/list/detail/close/reopen routes (sort + follow-first listing) with authorization tests.
- [x] Role-watch endpoints (`GET/POST/DELETE /watches`) and notify-on-publish fan-out with tests.

### Phase 2 — Server: applications
- [x] Apply (multipart + files), applications list/detail, file stream, accept (transaction), reject, close notifications — with tests.
- [x] `GET /applications/mine`, withdraw, per-week cap, per-Captain blocks — with tests.
- [x] Mutual work review endpoint (`POST /applications/:applicationId/review`) — with tests.

### Phase 3 — Frontend: Arena pages + apply modal
- [x] Arena board + post detail (audition & Captain views) with the apply modal and live applicant-count chips.
- [x] Post composer modal (`PostArenaRoleModal`) wired to the Vault post action.
- [x] CMS doorway card row, Vault post action, Tandem category doorway card.
- [x] Board "Post an open role" CTA (channel + project picker → composer).
- [x] My Auditions page (`/arena/mine`) with status tabs and withdraw, linked from the board.
- [x] Share links (copy-link on the post page), role watch bells (board role chips + post-page two-scope watch menu), Arena notch in the shell on `/arena…`.

### Phase 4 — Read-only preview window + notification meta
- [x] `viewerAccess`-driven gate/shell changes + applicant banner. **Completed: `LegacyProjectGate` admits `viewerAccess` `'public'`/`'applicant'` to the flat read-only pages (PUBLIC visibility as fallback when the field is absent); `CreatorsShell` keys read-only off `viewerAccess !== 'member'` (member-role fallback), renders the accent “Audition preview” tag (vs “Read only”) and a slim `ArenaPreviewBanner` strip inside the window linking back to the open role post (self-hiding once no OPEN post remains); new `components/arena-preview-banner.tsx` + CSS. Server tests for `applicant` access pre-date this (Phases 1/2).**
- [x] Work-reviews card on the public profile page (`pages/profile.tsx`). **Completed: new `components/work-reviews-card.tsx` renders received reviews (stars, note, role tag, project, reviewer link, date) with an empty state on the own/other profile rail; also implemented the missing `GET /video/arena/reviews` route (spec'd + codegen'd but never server-side) with tests, and fixed a latent 500 in the review POST (its zod response had grown required `reviewerImageUrl`/`projectName` that the route never hydrated). Composer included: `components/arena-review-modal.tsx` (star picker + note modal, `ReviewCta` with already-reviewed state) shown to the Captain on the FILLED post's accepted row and to the hired creator on the post page — mutual reviews are now creatable end-to-end (per §12.2 step 9).**
- [x] Arena categories (`video_arena_withdrawn/watch/reviewed` included) in both notification metadata maps; activity events; realtime keep-fresh. **Completed: all seven `video_arena_*` categories added to creators-den `CATEGORY_META` and tandem `CREATORS_META` with the §9.4 tones/labels. Activity events (`arena_post_opened/closed/filled`, `arena_application_rejected`) were already recorded server-side (§12.1 covers them). Realtime keep-fresh: `useRealtimeNotifications` now invalidates the board posts list + My Auditions on every `notification.new` (arena events stream as per-user notifications); refetch-on-focus covers non-participant browsers.**

### Phase 5 — Verification and handoff
- [x] Full route-test pass, workspace typecheck/build, §12.2 two-account walkthrough, checklist updated in this file. **Completed (automated): full api-server suite `pnpm test` → 357/357 across 25 files (arena 54/54); workspace `pnpm run typecheck` clean across libs + all 8 artifacts/scripts packages; workspace `pnpm run build` green (exit 0) for every package — note `mockup-sandbox`'s vite config requires `PORT` + `BASE_PATH` env vars, so run it as `PORT=5199 BASE_PATH=/ pnpm run build` in a bare shell. Still open: the interactive §12.2 two-account walkthrough against a running dev server (steps 1–10 above) — cannot be executed headlessly.**
