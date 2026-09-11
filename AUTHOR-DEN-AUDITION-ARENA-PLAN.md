# Author Den — Writers' Audition Arena Implementation Plan

**Status:** Plan for review — no code changes made yet
**Last updated:** 2026-09-11
**Primary source:** product request 2026-09-11 — "we are to have a similar audition arena on the author-den like we do for the creator-den … writers audition inside the author-den … properly structured and organized like how the creator-den is, while still maintaining the … seed collaboration logic system."
**Target apps:** `artifacts/authors-den` (frontend — Arena board, role post, My Auditions, composer, sidebar/Home doorways), `artifacts/api-server` (arena listing + role metadata + watches on the collaboration route module), `lib/db` (seed-model extension + support tables + migration), `lib/api-spec` → `lib/api-zod` + `lib/api-client-react` (contract + codegen), plus the Nexet writers-category doorway (`artifacts/nexet/src/pages/authors.tsx`) and shared notice metadata (`artifacts/nexet/src/lib/notice-meta.ts`).
**Related docs:** `CREATOR-DEN-AUDITION-ARENA-PLAN.md` (the structure this mirrors), `NEXET_COLLABORATION_IMPLEMENTATION_PLAN.md` (the seed collaboration system this must preserve).

---

## 1. Purpose and product outcome

The Author Den gets a **Writers' Audition Arena**: one board where an author can call for a second voice, and any signed-in writer can answer the call.

The Arena carries **two rails over one system**:

1. **Open Roles** — an author opens a *writing role* on a project (Co-writer, Editor, Beta reader, Ghostwriter, Proofreader) with a public pitch and a frozen brief. Writers browse the call, read the frozen brief, and audition.
2. **Seed Pitches** — the existing Pitch Board (frozen seeds, continuations, selection), unchanged in behaviour, listed on the same board so the whole "find a collaborator" surface lives in one place.

Both rails converge on the **existing seed → application → continuation → selection → contract → shared project pipeline** (`collaboration_seeds` → `seed_applications` → `continuation_submissions` → `collaboration_projects`). An accepted audition on either rail becomes a locked contract and a synchronised shared project exactly as an accepted seed continuation does today. **The Arena adds a discovery/organisation layer; it does not fork the collaboration logic.**

The discovery surface is a new den-level page set in the Author Den shell — the board, a role post detail, and My Auditions — entered from a new **STUDIO** sidebar entry and an **Arena doorway card on the Home page**, and advertised from the Nexet writers category page (`/categories/authors`) so the category doorway points at the Arena the way it points at the den.

### 1.1 A deliberate departure from the Creator Den mechanic

The Creator Den Arena can let outsiders preview the project because Creator Den projects are server-side rows (`nexet_video_projects`) behind `resolveProjectAccess`. **Author Den projects are local-first browser documents** (`localStorage["authors-den-projects"]`, `App.tsx`), so there is no server project to open read-only.

The Author Den already solves this: a seed **freezes the project into `collaboration_seeds.project_document` (jsonb) at publish time**, and respondents fork that frozen snapshot. The Arena reuses that exact mechanic. An Open Role therefore publishes a frozen brief the same way a Seed does — the anti-preview requirement is met by *freezing*, not by a read window. This is the single most important structural difference from the Creator Den plan and it is what "maintain the seed collaboration logic" means in practice.

## 2. Product vocabulary

| Term | Meaning |
|---|---|
| Arena / Writers' Audition Arena | The new Author Den board with two rails: Open Roles and Seed Pitches |
| Rail | One of the board's two tabs — **Open Roles** (`kind = 'ROLE'`) or **Seed Pitches** (`kind = 'SEED'`) |
| Open role / Call | A seed-like row with `kind = 'ROLE'`, a `role`, and a `rolePitch` — an author asking for a specific writing role on a project |
| Frozen brief | The `project_document` snapshot published with a role (or seed); the immutable thing an audition answers |
| Audition | A writer's answer to an open role — carried by the existing `seed_applications` → `continuation_submissions` pipeline |
| Selector / Creator | The author who opened the role; the only person who can decide on auditions |
| Auditioner / Applicant | A signed-in writer auditioning for a role |
| My Auditions | The applicant-side list of their own auditions across every rail, with status |
| Role watch | A subscription: notify me when an Open Role matching a role (optionally one author) is posted |
| Shared project | The `collaboration_projects` row created when an audition or seed continuation is accepted — unchanged |

## 3. Scope and release boundaries

### 3.1 First-release scope (this plan)

1. **Seed-model extension**: `collaboration_seeds` gains `kind` (`SEED` \| `ROLE`, default `SEED`), `role` (nullable, from `WRITER_ROLES`), and `role_pitch` (nullable). Existing rows are `SEED` and behave exactly as today.
2. **Arena board** (`Open Roles` + `Seed Pitches` rails): role filter chips, author/project cards, live applicant count, posted time, "already auditioned" state, sort (`Newest`, `Most auditions`).
3. **Role post detail**: pitch, frozen brief preview, current audition count, and the audition actions — plus the author's own management view (audition list with Accept / Decline).
4. **"Post an open role"** flow from inside a project (`postProject` path, beside the existing "Post on Pitch Board" action) and from the Arena board, restricted to the author's own projects.
5. **Audition join**: entering the Arena from a role with `?answer=<seedId>` reuses today's fork → edit → submit flow, so the applicant lands in the frozen brief with a private clone exactly as a seed respondent does.
6. **My Auditions** page: the caller's own auditions across both rails, newest first, with status tabs and links back to the post.
7. **Role watch alerts**: subscribe to a role (optional author scope); notify once per matching new role, excluding the poster and existing auditionees. Self-scoped create/list/delete.
8. **Notifications + realtime**: new `writer_arena_*` categories in the Author Den `CATEGORY_META` and Nexet `AUTHORS_META`; rows written through the existing `collaboration_notifications` + inbox polling.
9. **Doorways**: sidebar STUDIO entry, Home Arena card, and the Nexet `/categories/authors` category card.
10. **Deep links** via the existing query-intent pattern (`?arena=1`, `?arenaPost=<seedId>`, `?arenaMine=1`), which is how the Author Den navigates from outside.
11. Route tests (in-memory SQLite mirror), typecheck/build, and a two-account walkthrough.

### 3.2 Explicitly future scope (preserved in the model, labeled future, not built in v1)

- Multiple hires per open role (v1: one accepted audition fills the role).
- Compensation, bids, or contracts beyond the existing contract-lock flow.
- Per-role *document* uploads on the audition (v1 auditions are text + the fork, like continuations today).
- Mutual work reviews after a writer hire (Creator Den has this; Author Den v1 leaves it out — see §13).
- Live spectator mode, editable brief versions after publish, three-or-more-author group projects (already future scope in `NEXET_COLLABORATION_IMPLEMENTATION_PLAN.md`).
- Browsing/auditioning outside the den pass/tour gate (`DenTourGate`).

## 4. Implementation rules

1. Follow the repo's contract-first convention: update `lib/api-spec/openapi.yaml`, regenerate with `pnpm --filter @workspace/api-spec codegen`, implement routes against `@workspace/api-zod`, and consume the generated `@workspace/api-client-react` hooks.
2. **Do not change existing seed behaviour.** Every added column is nullable/defaulted; every existing seed route keeps its current semantics; a row with `kind = 'SEED'` must be byte-for-byte indistinguishable from today through the existing endpoints.
3. Keep the seed/continuation rows immutable after submission (`NEXET_COLLABORATION_IMPLEMENTATION_PLAN.md` rule 6).
4. Never expose hidden partner prose, locked text, or unapproved AI context through Arena listings, notifications, or previews (rule 7).
5. Enforce ownership and state transitions in server authorization, never only in disabled UI (rule 5).
6. Reuse the collaboration notification/inbox plumbing (`collaboration_notifications`, `useGetCollaborationInbox`) instead of a parallel system.
7. Mirror every schema change in the in-memory SQLite test schema (`artifacts/api-server/src/test/in-memory-db.ts`).
8. Update this checklist as work proceeds: `[ ]` → `[x]` with a short note and validation result.

## 5. Preflight and source integration

Findings confirmed against the working tree during plan review:

- [x] **Host shell.** `artifacts/authors-den/src/App.tsx` is a **View-state SPA, not a router**: `type View` (App.tsx §52), a `Sidebar` with `nav`/`aux` item lists and a `go(id)` dispatcher, a central render switch (`view === "profile" | "explore" | "notifications" | "home" | else Workspace`), and outside-state deep links parsed once from `window.location.search` into the `intent` object (`publish`, `answer`, `preview`, `project`, `chat`, `notifications`). **The Arena's "pages" are new `View` members plus new intents, not wouter routes.** The Creator Den structure is mirrored as a View set, not copied as URLs.
- [x] **Projects are local.** Projects live in `localStorage["authors-den-projects"]`; only seeds/applications/continuations/contracts touch the server. An open role must carry a frozen `project_document`, exactly like a seed.
- [x] **Seed pipeline.** `lib/db/src/schema/collaborations.ts` holds `collaboration_seeds`, `seed_applications`, `continuation_submissions`, `collaboration_projects`, `collaboration_notifications`; `collaboration-work.ts`/`collaboration-threads.ts` hold blocks, story bible, genealogy, activity, threads, messages, annotations. Existing endpoints live in `artifacts/api-server/src/routes/collaboration.ts` (`POST/GET /collaborations/seeds`, `…/:seedId/applications`, `…/applications/:id/submit`, `…/continuations/:id/select|accept`, `…/projects/*`).
- [x] **Seeds already model "what kind of collaborator".** `collaboration_seeds.desiredRole`, `protocol`, `genre`, `tone`, `language`, `plotConstraints`, `respondentLimit`, `availability` — an Open Role is these fields plus a typed `role` and a `rolePitch`, so no new pipeline is needed.
- [x] **Structural reference.** Creator Den's Arena is the template: schema `lib/db/src/schema/arena.ts`, routes `artifacts/api-server/src/routes/arena.ts`, tests `arena.test.ts`, pages `arena.tsx` / `arena-post.tsx` / `arena-mine.tsx`, components `arena-apply-modal.tsx`, `arena-post-composer.tsx`, `arena-watch.tsx`, `work-reviews-card.tsx`, CSS section in `artifacts/creators-den/src/creators.css`.
- [x] **Notifications metadata.** Author Den categories live in `artifacts/authors-den/src/components/notifications.tsx` (`CATEGORY_META`), the Nexet mirror in `artifacts/nexet/src/lib/notice-meta.ts` (`AUTHORS_META`).
- [x] **Migration convention.** `lib/db/migrations/` is sequential; the highest is `0014_whop_payments.sql`, so the new file is `0015_author_arena.sql` (guarded, idempotent, per `0006_creator_arena.sql` precedent).
- [x] **Test convention.** `artifacts/api-server/src/routes/collaboration.test.ts` + `arena.test.ts` run against the in-memory SQLite mirror with mocked Clerk auth.

## 6. Domain model and persistence plan

### 6.1 Extend `collaboration_seeds` — the one model both rails share (migration `0015_author_arena.sql`)

| Column | Type | Notes |
|---|---|---|
| `kind` | text NOT NULL default `'SEED'` | `SEED` \| `ROLE`. Existing rows become `SEED`; they are unchanged everywhere else. |
| `role` | text NULL | One of `WRITER_ROLES`; required when `kind = 'ROLE'`, null for seeds |
| `role_pitch` | text NULL | The author's ask for the role (zod 10–2000 chars when `kind = 'ROLE'`) |
| `filled_by` | text NULL | Applicant id of the accepted audition; set when the role fills |
| `filled_at` | timestamptz NULL | |

A **partial unique index** `(source_project_id, role) WHERE kind = 'ROLE' AND availability = 'OPEN'` keeps one open call per role per project, mirroring the Creator Den convention.

Why extend rather than create parallel tables: the entire audition lifecycle (application → private fork → submission → selection → contract → shared project) already exists for seeds and is subject to the immutability/privacy rules in §4. Reusing it means the Arena ships a listing surface, role metadata, and watches — not a second collaboration engine.

### 6.2 `collaboration_arena_watches` — role watch alerts (new)

| Column | Type | Notes |
|---|---|---|
| id | text PK | `wawatch_…` |
| user_id | text NOT NULL | the watcher |
| role | text NOT NULL | watched `WRITER_ROLES` value |
| creator_id | text NULL | null = any author; set = only this author's calls |
| created_at / updated_at | timestamptz | |

One active watch per (user, role, creator-or-global); exact duplicate → 409.

### 6.3 Applicant count (derived, no column)

A role card/post shows the number of **currently open auditions** — `COUNT(*)` over `seed_applications` for that seed where `status in ('DRAFT','SUBMITTED','UNDER_REVIEW','ACCEPTED_PENDING_CONTRACT')`, i.e. the same "active application" set the existing partial unique index already uses. It goes up when new auditions land and down when they are declined or withdrawn, and it is replaced by the accepted writer's name once `filled_by` is set. Computed in the same query as the listing so cards and detail never drift.

**Implemented as the existing `respondentCount`.** `seedView`/`seedCount()` already compute exactly this set, so the Arena reuses that field on `CollaborationSeed` and `WriterArenaPostSummary` rather than adding a parallel `applicantCount`; the post detail adds `totalApplications` (every audition ever received, author-only) on top. No new column and no second count query.

### 6.4 Not re-created

Applications, submissions, contracts, shared-project documents, work blocks, story bible, genealogy, activity, threads, messages, and annotations are **not** duplicated. The Arena reads and writes them through the existing tables and routes.

## 7. Page and route plan

### 7.1 Author Den views (App.tsx)

| View | Purpose | Entry |
|---|---|---|
| `arena` | The board: rail tabs (Open Roles / Seed Pitches), role chips, sort, cards with live applicant count and already-auditioned state | Sidebar STUDIO "Audition Arena"; Home card; `?arena=1` |
| `arena-post` | Role detail: pitch, frozen brief, applicant count, audition CTA; author sees the audition list with Accept / Decline | `?arenaPost=<seedId>`; card click |
| `arena-mine` | My Auditions across both rails: status tabs (Open / In review / Accepted / Declined), links back to posts | `?arenaMine=1`; board header link |

Deep-link intents extend the existing parser next to `publish`/`answer`/`preview`:

| Intent | Effect |
|---|---|
| `?arena=1` | `setView("arena")` |
| `?arenaPost=<seedId>` | load the role and `setView("arena-post")` |
| `?arenaMine=1` | `setView("arena-mine")` |

Navigation inside the Author Den stays View-state (matching `explore`/`notifications`); external links from Nexet use these query intents on the den base path, exactly as `?answer=` does today.

### 7.2 Doorways

1. **Sidebar STUDIO list** — a new "Audition Arena" item beside Explore/Notifications (`Sidebar` `aux` array + `go()` allowance, which already lets Explore/Notifications bypass the project gate — the Arena joins that list).
2. **Home page** — an Arena card beside the existing Pitch Board affordances, with live open-call count.
3. **Nexet `/categories/authors`** (`artifacts/nexet/src/pages/authors.tsx`) — a second doorway card next to "Open Author Den": "Writers' Audition Arena — open roles and pitch board", linking into the den's Arena.

### 7.3 Arena UI states

- **Board**: rail tabs; role chips (`All`, Co-writer, Editor, Beta reader, Ghostwriter, Proofreader) each with a **watch bell**; sort control; loading/empty/error; per-card author avatar/name, project title, role tag, pitch excerpt, live applicant chip ("N open auditions", zero state "Be the first to audition"), posted-ago, and the caller's own state ("Audition sent · in review").
- **Role post**: frozen-brief panel (read-only, reuses the seed detail's brief rendering), pitch, author summary, actions **Audition** (disabled for the poster, existing applicants, and past the cap), **Watch &lt;role&gt;**, **Share** (copy link), and **Withdraw** for an open audition.
- **Author view of a role**: status controls (Close / Reopen), stats row ("N open · M received"), and the audition list with applicant name, submitted continuation preview link, **Accept** / **Decline** — reusing the existing selection-room actions (`…/continuations/:id/select|accept`, `useSelectContinuation`, `useAcceptContinuation`).
- **My Auditions**: status tabs, per-row post/role/author/date, link to the post and to the applicant's own clone.

## 8. User journeys and acceptance criteria

### 8.1 An author opens a writing role
1. From a project, the author chooses "Call for a role", picks a role, writes the pitch, confirms the frozen brief, publishes.
2. The call appears on the Arena board under Open Roles, and the project's frozen snapshot is stored in `project_document`.

**Acceptance:** only the author of the project can post; one open call per (project, role); the row is a valid seed for every existing endpoint (`kind='SEED'` behaviour unaffected); the board lists it with applicant count 0.

### 8.2 A writer auditions
1. A signed-in writer opens the Arena, filters by role, opens a call, reads the frozen brief.
2. "Audition" forks the frozen brief into their studio (the existing `?answer=<seedId>` path), they respond, and submit.
3. The application is `SUBMITTED`; the card flips to "in review"; the author is notified.

**Acceptance:** duplicate active audition on the same call is blocked (existing partial index); the applicant count increments; the submitted continuation is immutable; nothing from an unsubmitted draft is visible to the author.

### 8.3 The author decides
1. The author opens the call's audition list, previews each submission.
2. **Decline** archives the submission and notifies the writer; **Accept** locks the contract and creates the shared project.

**Acceptance:** Accept is atomic and lands the pair in the existing `collaboration_projects` contract flow; the role shows "Filled by &lt;name&gt;"; remaining active auditions behave per the existing selection rules; no new contract code path is introduced.

### 8.4 Role watches
1. A writer toggles the bell on a role chip (or on a call for "this role from this author").
2. A matching new open call notifies them once — unless they posted it or already auditioned.

**Acceptance:** watches are self-scoped (create/list/delete own only); one notice per new call; toggling off stops delivery.

## 9. API and server work plan

Extend the collaboration route module (`artifacts/api-server/src/routes/collaboration.ts`) with an `/collaborations/arena/*` surface that reuses the seed engine. New operationIds go in `lib/api-spec/openapi.yaml` and are codegen'd.

### 9.1 Board and role metadata
- `GET /collaborations/arena/posts` — zod query `rail=role|seed`, `role?`, `sort=newest|most_applied`, `mine=1`, `followed=1` (over the existing `nexet_video_follows` follow model already used by the Author Den explore page). Each row: seed fields + `kind`, `role`, `rolePitch`, `applicantCount`, and the caller's own `myAuditionStatus`.
- `GET /collaborations/arena/posts/:seedId` — the role/seed detail with `applicantCount` (and `totalApplications` for the poster).
- `POST /collaborations/arena/posts` — body `{ projectDocument, sourceProjectId, sourceProjectTitle, role, rolePitch, protocol, genre, tone, language, plotConstraints, respondentLimit }`; creates a `collaboration_seeds` row with `kind='ROLE'`; 409 on an open duplicate (project, role).
- `PATCH /collaborations/arena/posts/:seedId` — author only: `{ availability: 'OPEN' | 'CLOSED' }` (close/reopen) and pitch edits while open. **Wraps the existing `PATCH /collaborations/seeds/:seedId` semantics rather than replacing them.**

### 9.2 Auditions (thin wrappers over the existing engine)
- Apply/submit/withdraw/select/accept/decline all reuse the existing endpoints (`POST /collaborations/seeds/:seedId/applications`, `…/applications/:id`, `…/submit`, `…/continuations/:id/select|accept|decline`). The Arena adds only the **`GET /collaborations/arena/auditions/mine`** aggregate — the caller's own applications across both rails, newest first, resolving each to its seed's rail/role — because the existing `…/continuations` endpoint is creator-scoped.
- `POST /collaborations/arena/auditions/:applicationId/withdraw` — applicant-only wrapper that archives an open application (reuses `DELETE /collaborations/continuations/:continuationId` semantics; 409 once decided).

### 9.3 Watches
- `GET /collaborations/arena/watches` · `POST` (`{ role, creatorId? }`) · `DELETE /collaborations/arena/watches/:watchId` — self-scoped; duplicate → 409. `POST /collaborations/arena/posts` fans out to matching watchers (excluding the poster and existing auditionees).

### 9.4 Notifications, activity, realtime
New `collaboration_notifications` categories (added to Author Den `CATEGORY_META` and Nexet `AUTHORS_META`):

| Category | Recipient | Label / tone | Deep link |
|---|---|---|---|
| `writer_arena_role_opened` | watch owners | "New writing role" / accent | `?arenaPost=<seedId>` |
| `writer_arena_audition_received` | author | "New audition" / gold | `?arenaPost=<seedId>` |
| `writer_arena_audition_withdrawn` | author | "Audition withdrawn" / muted | `?arenaPost=<seedId>` |
| `writer_arena_role_closed` | active auditionees | "Role closed" / muted | `?arenaPost=<seedId>` |
| `writer_arena_accepted` | applicant | "Audition accepted" / teal | `?project=<collaborationProjectId>` |
| `writer_arena_declined` | applicant | "Audition declined" / danger | `?arenaPost=<seedId>` |

Existing `continuation_submitted`, `respondent_accepted`, `continue_declined` notices continue to fire from the shared pipeline; the new categories only name the Arena context. Realtime rides the existing inbox polling + `NotificationCenter`; no new socket channel.

## 10. Authorization and privacy matrix

Every endpoint resolves the actor server-side from `getAuth(req).userId`.

| Capability | Author (poster) | Auditioner (active) | Signed-in writer | Existing member | Unrelated |
|---|---:|---:|---:|---:|---:|
| Browse the Arena board | Yes | Yes | Yes | Yes | Yes |
| Open a role / read the frozen brief | Yes | Yes | Yes | Yes | Yes |
| Audition (fork → submit) | No (own call) | No (already active) | Yes | No | No |
| See the audition list + decide | Yes | No | No | No | No |
| Withdraw own active audition | No | Yes | — | No | No |
| Manage own role watches | Self | Self | Self | Self | — |
| Read hidden partner prose / locked text through the Arena | No | No | No | Role-gated | No |
| Accept → contract + shared project | Yes | — | — | — | — |

Additional rules:
- The Arena never widens read access to a continuation. It exposes the **frozen brief** (already publishable through the seed) and the audition *count*, never another respondent's draft text, comments, or voice notes.
- Notifications carry safe summaries only — no draft prose, no private brief text.
- `kind`, `role`, and `rolePitch` are additive; a `SEED` row must satisfy every existing seed route unchanged.

## 11. Frontend implementation plan

### 11.1 Contract and data layer
Regenerate `@workspace/api-zod` / `@workspace/api-client-react` after the OpenAPI additions and use the generated hooks (`useListWriterArenaPosts`, `useGetWriterArenaPost`, `useCreateWriterArenaPost`, `useUpdateWriterArenaPost`, `useListMyWriterArenaAuditions`, `useWithdrawWriterArenaAudition`, `useListWriterArenaWatches` / `useCreateWriterArenaWatch` / `useDeleteWriterArenaWatch`), plus the existing seed/continuation hooks for apply, submit, select, accept, and decline. Add the `writer_arena_*` rows to `CATEGORY_META` (authors-den) and `AUTHORS_META` (nexet).

### 11.2 Pages and components
- `components/arena.tsx` — board with rails, role chips + watch bells, sort, cards, empty/loading/error, already-auditioned state.
- `components/arena-post.tsx` — role detail with the frozen-brief panel and the author's audition management view.
- `components/arena-mine.tsx` — My Auditions with status tabs and withdraw.
- `components/arena-role-modal.tsx` — the "Call for a role" composer, extending the existing `BriefModal` (project snapshot + protocol fields) with a role select and pitch field.
- `App.tsx` — add the three `View` members, the render switch branches, the sidebar STUDIO entry, the `go()` allowance, the Home Arena card, and the `intent` parser entries (`arena`, `arenaPost`, `arenaMine`).
- `index.css` — an Arena CSS section following the existing `den-*` / `list-row` / `paper-card` vocabulary (the Creator Den's `.arena-*` block is the visual reference, adapted to the Author Den's paper theme).
- `artifacts/nexet/src/pages/authors.tsx` — the category doorway card.

### 11.3 States and accessibility
Loading, empty, error, closed, filled, already-auditioned, own-post, and unauthorized states on every surface; `role="tablist"` rails and chips; labelled controls; keyboard-reachable watch bells; `aria-live` on the unread/notification surfaces that already exist.

## 12. Testing and verification plan

### 12.1 Automated route tests (`routes/author-arena.test.ts`, in-memory SQLite mirror)
- [ ] Unauthenticated reads/writes → 401.
- [ ] Only the project's author can create a role; duplicate open (project, role) → 409.
- [ ] `role` must be in `WRITER_ROLES`; pitch length validated.
- [ ] **Regression:** existing seed routes return identical shapes/behaviour for `kind='SEED'` rows, and a seed created before the migration reads back as `kind='SEED'`.
- [ ] Board listing filters by rail and role; sorts by newest and most auditions; `mine=1` returns only the caller's calls.
- [ ] Applicant count is derived and live: 0 on publish; increments per audition; decrements on decline/withdraw; replaced by the filled author on accept.
- [ ] Audition wrappers keep the existing pipeline invariants: duplicate active audition → 409; submitted continuations immutable; hidden prose never appears in any Arena response.
- [ ] Accept on a role lands in `collaboration_projects` with the same contract semantics as a seed accept (no second code path).
- [ ] `GET /arena/auditions/mine` returns only the caller's rows.
- [ ] Watches are self-scoped; a new matching role notifies watchers exactly once, excluding the poster and existing auditionees; deleting stops delivery.
- [ ] Notification payloads never include draft text or private brief content.

### 12.2 Manual acceptance walkthrough (two accounts)
1. Author A publishes a Co-writer role from a project; the call shows on the Arena board with "Be the first to audition".
2. Writer B filters by Co-writer, opens the call, reads the frozen brief, auditions through the fork → submit path.
3. A's notification arrives; A opens the audition list, previews B's submission, accepts.
4. Verify the pair is in the existing contract flow, the role reads "Filled by B", and no seed pitch-board behaviour changed.
5. B watches "Editor" roles; A posts an Editor call; B is notified once; A closes the call and active auditionees are notified.
6. B opens My Auditions and sees both the accepted and any declined rows with correct statuses.

### 12.3 Verification commands
- `pnpm --filter @workspace/api-server test`
- `pnpm run typecheck` and the per-package Vite builds
- `pnpm --filter @workspace/api-spec codegen` after contract edits

## 13. Open decisions and deviations

- **Reuse vs. parallel model (recommended: reuse).** This plan extends `collaboration_seeds` with `kind`/`role` so both rails share one engine. The alternative — new `author_arena_posts` + `author_arena_applications` tables mirroring Creator Den — would duplicate the fork/submit/select/contract pipeline and risk divergence from the seed logic the request says to preserve. Flagging for confirmation before Phase 0.
- **Writing roles list.** Proposed `WRITER_ROLES = CO_WRITER | EDITOR | BETA_READER | GHOSTWRITER | PROOFREADER`. Confirm the exact set and labels.
- **"Managed inside the creator-den" wording.** This plan reads that phrase as a slip and builds the Arena in **`artifacts/authors-den`**, per the explicit "inside the author-den app" instruction. If the intent was to surface writer auditions *inside the Creator Den app* (a cross-den doorway), that is a small follow-on slice, not this plan.
- **Frozen brief instead of read-only preview.** Because Author Den projects are local-first, there is no server project to preview; the seed-freeze mechanic is reused deliberately (§1.1). No Creator-Den-style `viewerAccess` work.
- **Reviews.** Mutual work reviews are omitted from v1 (Creator Den has them). Adding them later reuses `collaboration_projects` completion state rather than a new table.
- **Applicant cap and blocks.** A per-week audition cap and per-author blocks are Creator Den anti-spam features. v1 inherits the existing seed rate/one-active-application rules; a cap/blocks slice is future scope.
- **Navigation model.** The Author Den has no router; the Arena is a View set with query intents. If the den later adopts real routes, `arena` / `arena-post` / `arena-mine` map cleanly to `/arena`, `/arena/posts/:seedId`, `/arena/mine`.
- **Count field name (Phase 0 deviation).** The plan originally called the live count `applicantCount`; Phase 0 reuses the existing `respondentCount` instead, because `seedCount()` already computes the identical active-application set. `WriterArenaPostSummary` adds `totalApplications` for the author view. See §6.3.
- **Withdraw introduces a `WITHDRAWN` application status (Phase 1).** `seed_applications` previously had no applicant-initiated terminal state. Withdraw now sets `WITHDRAWN`, which the partial unique index deliberately does not cover — so the slot frees and the writer can audition again, while `DECLINED`/`ACCEPTED_PENDING_CONTRACT` remain final (409). The linked `UNDER_REVIEW` submission is archived with it.

## 14. Delivery sequence

### Phase 0 — Contract and schema
- [x] Migration `0015_author_arena.sql`: `collaboration_seeds` additive columns + partial unique index + `collaboration_arena_watches`; mirror in the in-memory test schema. **Completed:** schema in `lib/db/src/schema/collaborations.ts` (`kind`/`role`/`role_pitch`/`filled_by`/`filled_at` + partial unique index) and new `lib/db/src/schema/author-arena.ts` (writing roles + `collaboration_arena_watches`); guarded migration `lib/db/migrations/0015_author_arena.sql`; in-memory SQLite mirror updated in `artifacts/api-server/src/test/in-memory-db.ts` (columns + partial index + watches table + `tables` map). Validation: workspace `pnpm run typecheck` clean, api-server suite 433/433.
- [x] OpenAPI definitions for §9 endpoints and fields; regenerate clients. **Completed:** `lib/api-spec/openapi.yaml` gains the `CollaborationSeed` Arena fields (`kind`/`role`/`rolePitch`/`filledBy`/`filledAt`) and the `WriterArena*` schemas + `/collaborations/arena/*` paths (board, post detail/patch, auditions/mine, withdraw, watches); `pnpm --filter @workspace/api-spec codegen` regenerated `@workspace/api-zod` + `@workspace/api-client-react` (`useListWriterArenaPosts`, `useCreateWriterArenaPost`, `useGetWriterArenaPost`, `useUpdateWriterArenaPost`, `useListMyWriterArenaAuditions`, `useWithdrawWriterArenaAudition`, `useListWriterArenaWatches`, `useCreateWriterArenaWatch`, `useDeleteWriterArenaWatch`). `seedView` (`routes/collaboration.ts`) now emits the new seed fields so the existing contract stays honest.

### Phase 1 — Server: board, roles, watches
- [x] Arena listing (rails, role filter, sort, `mine`) + role create/patch with authorization tests. **Completed:** `artifacts/api-server/src/routes/collaboration.ts` gains the `/collaborations/arena/posts` GET (rails via `kind`, role filter, `newest`/`most_applied` sort, follow-first via `nexet_video_follows`, `?mine=1`), POST (creates a `kind='ROLE'` seed, 409 on an open duplicate per project+role), and `GET`/`PATCH /:seedId` (author-only close/reopen + pitch edit; closing notifies everyone still auditioning). Counts are derived in one batched pass; `totalApplications` is the author's lifetime figure and the live count for everyone else.
- [x] Watch endpoints + notify-on-publish fan-out with tests. **Completed:** `GET`/`POST /collaborations/arena/watches` and `DELETE /watches/:watchId`, self-scoped with 409 on an exact duplicate (global vs author-scoped watches on the same role coexist). On publish, matching watchers are notified once — excluding the poster and anyone who already auditioned.
- [x] `GET /arena/auditions/mine` + withdraw wrapper with tests. **Completed:** `GET /collaborations/arena/auditions/mine` (caller's rows only, both rails, newest first) and `POST /collaborations/arena/auditions/:applicationId/withdraw` (applicant-only; 403 otherwise, 409 once decided). Withdrawing drops the live count, archives an `UNDER_REVIEW` submission, notifies the author, and frees the applicant to audition again.
- [x] **Regression pass:** the existing collaboration test suite stays green. **Completed:** new `routes/author-arena.test.ts` (25 tests) covers auth, role create/patch, rails/sort/mine, live-count lifecycle, withdraw rules, no-draft-leak, and watches; full api-server suite **458/458 across 28 files**, workspace `pnpm run typecheck` clean. The suite also pins the regression rule: a published seed still reads back as `kind='SEED'` with null role fields through the untouched seed endpoints.

### Phase 2 — Frontend: Arena views
- [x] Board, role detail (audition + author views), My Auditions. **Completed:** new `artifacts/authors-den/src/components/arena.tsx` (two rails over one table via `kind`, role chips with watch bells, search, `newest`/`most_applied` sort, live counts derived from an unfiltered parallel query, empty/loading/error/already-auditioned states), `arena-post.tsx` (frozen-brief panel, author's live/total stats + close/reopen, everyone else's audition/withdraw/status view), and `arena-mine.tsx` (status tabs All/In review/Accepted/Declined over `GET /collaborations/arena/auditions/mine`, withdraw for unresolved rows). Shared labels/status helpers in `src/lib/arena.ts`.
- [x] "Call for a role" composer from a project and from the board. **Completed:** `arena-role-modal.tsx` composes the same frozen-brief publish as `BriefModal` plus a role select and pitch field; reachable from the board header, the board's empty state, the Home Arena card, and a new per-project "Call for a role" button. Publishing calls `useCreateWriterArenaPost` and lands on the new call's detail page.
- [x] `View` additions, sidebar STUDIO entry, Home card, intent parser, CSS section. **Completed:** `App.tsx` gains `arena`/`arena-post`/`arena-mine` views and render branches, an "Audition Arena" sidebar entry opened as a den-level room (like Explore, no project gate), a Home "The Writers' Room" card, and `?arena=1` / `?arenaPost=<id>` / `?arenaMine=1` intents. Auditioning reuses the established `?answer=<seedId>` fork flow, and the author's "Review auditions" link reuses `/authors/pitch-board/seed/<seedId>`. New `.arena-*` CSS section in `index.css` following the Author Den paper theme.
- [x] **Verification:** `pnpm --filter @workspace/authors-den run typecheck` clean, full workspace `pnpm run typecheck` clean, and `PORT=5173 BASE_PATH=/authors-den pnpm --filter @workspace/authors-den run build` succeeds (2064 modules, no errors). Confirmed the reused pipeline resolves role seeds: `GET /collaborations/seeds/:seedId`, `…/project`, and `POST …/applications` do not filter by `kind`, so a role call forks and submits exactly like a seed pitch.

### Phase 3 — Doorways, notifications, verification
- [ ] Nexet `/categories/authors` doorway card.
- [ ] `writer_arena_*` categories in both notice metadata maps; inbox/realtime keep-fresh.
- [ ] Full route-test pass, workspace typecheck/build, two-account walkthrough (§12.2); checklist updated in this file.
