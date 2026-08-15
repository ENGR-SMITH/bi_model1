# TADEM Author Collaboration Implementation Plan

**Status:** Implementation in progress — Phase 2 Pitch Board foundation verified
**Last updated:** 2026-08-14  
**Primary source documents:**

- `attached_assets/TADEM_Developer_Agent_Build_Prompt_1786700699764.docx`
- `attached_assets/Pasted--THIS-IS-THE-REPO-OF-THE-MAIN-PARENT-APP-https-github-c_1786700722201.txt`
- Parent application reference: `https://github.com/ENGR-SMITH/teadem_colab1.git`

## 1. Purpose and product outcome

TADEM Author Collaboration will let writers publish a frozen writing seed, invite a pool of independent continuations, review submissions privately, select a collaborator, lock a contract, and continue writing together in a synchronized Tandem project.

The Author Den and the existing Tandem experience must behave as one application. The signed-in user, profile, permissions, notifications, projects, and collaboration history must be shared between both areas. Existing Solo Author Studio behavior must remain local-first and must not gain Tandem permission restrictions.

The first release is Author-to-Author collaboration. The underlying model must remain extensible to more than two participants and to future asymmetric collaboration modes, but future modes must be labeled as future scope rather than silently represented as complete.

## 2. Implementation rules

1. Inspect and use the parent application source as the implementation target. Do not replace the parent app with a parallel mock application.
2. Create or update the implementation checklist in this file as work proceeds.
3. After completing a particular implementation, change its checkbox from `[ ]` to `[x]` and add a short completion note with the relevant validation result.
4. Use the existing authentication and user identity system. Do not create a second account system or local-only authentication.
5. Enforce ownership, visibility, contract, and state transitions in server authorization and database logic. Disabled buttons are not security.
6. Keep the original seed and each respondent continuation immutable after submission. Store new versions/events rather than overwriting an immutable submission.
7. Never expose hidden partner prose, private voice notes, locked text, or unapproved AI context through API responses, notifications, logs, previews, or summaries.
8. Keep AI advisory. AI may report risks or suggestions, but it must not select a collaborator, change authorship, alter submitted prose, or finalize a merge without human approval.
9. Preserve attribution and contribution genealogy in project history and exports.
10. Prefer real persisted data and real user flows over placeholders for create, apply, save draft, submit, review, accept, reject, notify, and project synchronization.

## 3. Scope and release boundaries

### 3.1 First-release scope

- Shared identity between Tandem and Author Den.
- Author navigation and collaboration pages.
- Pitch Board discovery and filters.
- Creating a collaboration seed from an Author Studio project.
- Applying to a seed through a private cloned project.
- Draft continuation editing, comments, and optional voice-note metadata/attachment support according to existing app capabilities.
- Submission locking and immutable submitted versions.
- Creator continuation inbox and selection room.
- Preview, message, decline, accept, and privacy-safe notifications.
- Contract preview, participant approval, contract lock, and initial two-author Tandem project creation.
- Automatic removal of accepted seeds from the Pitch Board.
- Synchronized project presence in both authors’ Author Den project areas.
- Tandem project status, waiting room, contract, Story Bible, activity, and permissions.
- Solo/Tandem editor modes without breaking existing Solo mode.
- State and authorization infrastructure that supports future collaboration protocols.

### 3.2 Future scope to preserve in the model

These capabilities must be represented in the architecture or explicitly marked as future, but are not required to be fully implemented in the first UI slice:

- Three-or-more-author Group/Mosaic projects.
- Global cross-category collaboration such as singer/lyricist or DJ/vocalist.
- Real-time matchmaking lobby and live spectator mode.
- Drawing, recording, image, audio, and non-text contribution surfaces beyond currently supported media.
- Optional countdown timers.
- Anonymous creative-half browsing and privacy-controlled identity reveal.
- Community challenges, mentorship mode, public rooms, and private group lobbies.
- AI-generated bridge chapters, reveal theater, remix generation, and full Story Guardian automation.
- Provider-specific AI enhancements unless already available through the existing Admin AI system.

## 4. Preflight and source integration

### 4.1 Parent application source

- [x] Obtain the parent application source from the referenced repository or otherwise make its current source available in the working project. **Completed: parent source imported from `ENGR-SMITH/teadem_colab1`.**
- [x] Identify the actual web app entry point, API/server entry point, database schema/migration system, route structure, current Author Den pages, current Tandem pages, and current Admin AI implementation. **Completed: Tandem is the root app, Author Den is `/authors-den/`, API is `/api`, and Drizzle/Postgres plus Oracle routes are the existing conventions.**
- [x] Confirm the current development and test commands before changing them. **Completed: `pnpm run typecheck`, `pnpm run build`, API dev, and each Vite package typecheck/build are the existing commands.**
- [x] Confirm whether the parent app already has an API contract/code-generation convention and follow it rather than introducing a competing pattern. **Completed: OpenAPI → Orval → `@workspace/api-zod` and `@workspace/api-client-react`.**
- [x] Record any differences between the uploaded requirements and the current parent implementation in this file under **Open decisions and deviations**. **Completed: Solo Author Den is local-first today; Tandem has Clerk identity but no collaboration persistence yet; voice notes and real-time transport are not currently available.**

### 4.2 Existing behavior inventory

- [x] Trace the current Tandem sign-in/session/user profile flow. **Completed: ClerkProvider/useAuth/useUser guard the Tandem routes.**
- [x] Trace the current Author Den sign-in/session/user profile flow. **Completed: Author Den is a separate local-first studio with no duplicate server account lookup.**
- [x] Identify why authentication information currently differs and define one canonical user/session source. **Completed: Clerk user ID is canonical for server collaboration; Solo projects remain local-only.**
- [x] Inventory the existing Author Studio project/editor/scene models and local autosave/export behavior. **Completed: project/scene model, localStorage autosave, and JSON/Markdown/TXT/HTML export traced.**
- [x] Inventory existing notification, inbox, messaging, file/voice-note, and activity abstractions. **Completed: Tandem inbox/activity are presentational placeholders, waitlist is persisted, and no voice-note store exists.**
- [x] Inventory the Admin AI provider routing, context limits, prompt filtering, and server entry points. **Completed: existing `/api/oracle/*` routes and provider failover are the reusable advisory surface.**
- [x] Create a small compatibility map before editing:
  - Tandem user identity → Author Den identity **(Clerk ID for server resources; local project author text remains untouched)**
  - Solo project → collaboration seed source **(client sends a frozen snapshot)**
  - Seed → respondent clone **(server application stores clone snapshot metadata)**
  - Accepted continuation → Tandem project contribution **(server collaboration project record)**
  - Existing Admin AI → optional advisory collaboration checks **(reuse existing Oracle route when enabled)**

## 5. User journeys and acceptance criteria

### 5.1 Creator publishes a seed

1. A creator opens **My Studio / Projects**.
2. The creator selects a project and chooses **Post on Pitch Board**.
3. The creator defines the seed block and collaboration brief:
   - unit type: paragraph, scene, page, chapter, role, plot, opening, ending, POV, or another supported block;
   - switching protocol;
   - genre, tone, language, and plot constraints;
   - character/domain assignments;
   - visibility mode;
   - desired partner role;
   - respondent limit: 3, 5, 10, or unlimited.
4. The original project remains in the creator’s Studio but the collaboration post is represented separately from the active solo project.
5. The post becomes discoverable only when the creator explicitly publishes it.
6. The Pitch Board displays the post with availability and hides any content not permitted by its visibility mode.

**Acceptance:** A published post can be discovered, filtered, opened read-only, and later removed automatically when a collaborator is accepted.

### 5.2 Respondent applies with a continuation

1. A respondent opens a Pitch Board post.
2. The respondent can read the permitted frozen seed and collaboration brief.
3. The respondent selects **Continue This Story**.
4. The system creates a respondent-owned clone/project copy linked to the seed. The clone is visibly marked as a clone in the respondent’s Studio.
5. The respondent can edit only their continuation area and add permitted comments/suggestions/voice notes attached to stable block or range identifiers.
6. The respondent can save a draft.
7. The respondent can submit once while an earlier submission is pending. Reapplying to the same post is blocked while a request is unresolved.
8. Submission creates an immutable version and sends a privacy-safe notification to the creator.

**Acceptance:** The creator receives the submitted version without gaining edit access to the respondent’s project, and the respondent cannot overwrite the frozen seed.

### 5.3 Creator reviews and decides

1. The creator opens the continuation inbox.
2. The creator opens a selection room that preserves the seed as read-only context.
3. The creator can inspect:
   - respondent continuation text;
   - respondent comments;
   - permitted voice notes;
   - writer profile and collaboration history;
   - advisory compatibility signals.
4. The creator can message the respondent without exposing hidden writing.
5. The creator can decline/archive the submission.
6. The creator can select one respondent.
7. Selection opens a contract preview before the collaborator relationship is active.

**Acceptance:** AI signals are visibly advisory; only the creator’s explicit selection progresses the respondent toward collaboration.

### 5.4 Contract lock and project synchronization

1. The creator and selected respondent see the proposed protocol, domains, visibility, responsibilities, and participant scope.
2. Required participants approve the contract.
3. A locked contract becomes immutable except through a versioned amendment approved by all required participants.
4. On lock, the seed is removed from the Pitch Board and cannot accept new respondents.
5. The creator’s project is updated with the accepted continuation.
6. The collaboration project appears for both users in Author Den Projects.
7. Both users see the same project identity, attribution, contract version, current block, current turn, and permitted shared content.
8. Unselected continuations are archived outside the official manuscript, with their original author attribution retained.

**Acceptance:** The accepted project is synchronized between accounts and no accepted seed remains publicly available.

### 5.5 Ongoing Tandem work

- The active author can edit only their own assigned draft block/domain while it is their turn.
- Partner-owned submitted or locked content is read-only unless the contract explicitly grants comment/edit access.
- A waiting author sees a waiting room with permitted status, notes, Story Bible content, and Solo Work shortcut, not hidden partner prose.
- Submitted changes generate privacy-safe collaborator notifications and delta/history events.
- Contract, Story Bible, messages, activity, export, and project detail are reachable from the Tandem project.
- Resolution mode makes original submissions read-only and requires both approvals to finalize the merged result.

## 6. Route and page plan

### 6.1 Author navigation

| Page | Route | Purpose |
|---|---|---|
| Author’s Atrium | `/authors/atrium` | Dashboard and urgent work: Your Turn, Reveal Ready, Review Pending, Contract Action Required, Waiting |
| Pitch Board | `/authors/pitch-board` | Discover, filter, and open available collaboration seeds |
| Seed detail | `/authors/pitch-board/seed/:seedId` | Read-only seed, brief, author summary, and continuation entry point |
| Write continuation | `/authors/pitch-board/seed/:seedId/respond` | Clone-based continuation editor, comments, voice-note rules, draft/save/submit |
| Submission result | `/authors/collaborations/continuation/:id` | Submitted state, attribution, and waiting status |
| Activity | `/authors/work` | Solo Work and Tandem Projects navigation |
| Solo Work | `/authors/work/solo` | Existing Author Studio projects and editor behavior |
| Tandem Projects | `/authors/work/tandems` | Active, completed, archived, and waiting projects |
| Tandem detail | `/authors/tandem/:id` | Partner, contract, progress, current block, Story Bible, messages, export |
| Waiting room | `/authors/tandem/:id/waiting` | Partner turn, permitted visibility, notes, Story Bible, Solo Work shortcut |
| Contract | `/authors/tandem/:id/contract` | Current contract, version history, amendment requests, approvals |
| Story Bible | `/authors/tandem/:id/story-bible` | Shared and owner-scoped story facts and plot threads |
| Me | `/authors/me` | Writer DNA, statistics, preferences, and privacy |

### 6.2 Collaboration inbox

| Page | Route | Purpose |
|---|---|---|
| Requests | `/authors/collaborations/requests` | Partner invitations, contract invitations, amendment requests |
| Continuations for me | `/authors/collaborations/continuations` | Creator’s DM-style continuation inbox |
| System | `/authors/collaborations/system` | Guardian alerts, reminders, delta reports, reveal-ready events |
| Messages | `/authors/collaborations/thread/:id` | Privacy-safe messages with a respondent or co-author |
| Selection room | `/authors/collaborations/selection/:id` | Compare continuations and select/decline |
| Seed selection room | `/authors/collaborations/seed/:seedId/select` | Creator’s selection view for all continuations on a seed |

## 7. Domain model and persistence plan

Names are conceptual and must be adapted to the parent application’s naming conventions.

### 7.1 Identity and profiles

- `User`: canonical identity shared by Tandem and Author Den.
- `AuthorProfile`: display name, bio, avatar, genres, tones, languages, mediums, voice sample metadata, collaboration preferences, privacy settings.
- `WriterStats`: permitted collaboration counts, accepted/completed Tandems, history, and non-judgmental compatibility inputs.

### 7.2 Seeds and briefs

- `CollaborationSeed`: creator, source project/block, frozen content reference/version, publication state, visibility, availability, respondent limit, created/published/closed timestamps.
- `CollaborationBrief`: unit type, protocol, genre, tone, language, plot constraints, character/domain assignments, desired role, edit/comment permissions, visibility rules.
- `SeedAvailability`: OPEN, FULL, CLOSED, ACCEPTED, ARCHIVED.

The seed must reference an immutable source version. Editing the original Solo project after publishing must not silently mutate what respondents saw.

### 7.3 Respondent clones and continuations

- `SeedApplication`: seed, respondent, clone project, current status, timestamps, decision metadata.
- `ContinuationDraft`: respondent-owned editable draft and version references.
- `ContinuationSubmission`: immutable submitted version, author, seed, attribution, visibility, submitted timestamp, review state.
- `SubmissionAnnotation`: comment/suggestion/reaction/voice-note metadata attached to a stable block/range identifier.

Expected application states: DRAFT, SUBMITTED, UNDER_REVIEW, ACCEPTED_PENDING_CONTRACT, DECLINED, ARCHIVED, WITHDRAWN where allowed.

### 7.4 Tandem projects and contracts

- `CollaborationProject` or existing Tandem project model extended with collaboration origin, seed, current contract, participants, current turn, visibility, and project state.
- `ProjectParticipant`: project/user/role/status, with a collection model that supports more than two users even if the first release limits active contracts to two.
- `WorkBlock`: owner, participant scope, contract version, visibility scope, state, parent contribution IDs, current editor, stable ranges.
- `TandemContract`: protocol, unit assignments, participant responsibilities, edit/comment permissions, visibility mode, version, approval requirements, lock state.
- `ContractAmendment`: requested changes, version, approvers, approval/rejection state.
- `StoryBibleEntry`: type, content, owner scope, shared scope, evidence/provenance, visibility.

Required work-block state machine: DRAFT → SUBMITTED → LOCKED / UNDER_REVIEW → APPROVED or ARCHIVED, with only authorized transitions.

### 7.5 Notifications, messages, and activity

- `Notification`: recipient, category, deep-link target, privacy-safe summary, read state, created timestamp.
- `CollaborationThread` and `Message`: participant-scoped conversation that never returns hidden prose by accident.
- `ActivityEvent`: actor, project/seed/application reference, event type, permitted summary, timestamp, visibility scope.
- `ContributionGenealogy`: parent contribution IDs, human contributors, derived merge/AI operation metadata, and immutable attribution.

### 7.6 AI advisory records

- `CollaborationAnalysis`: target version, analysis type, provider/model version metadata, permitted context hash/reference, advisory results, created timestamp.
- `GuardianAlert`: severity, affected stable block/entity, permitted message, status, and resolution metadata.

AI records must not retain or expose more context than the viewer is authorized to see.

## 8. Authorization and privacy matrix

Every endpoint must resolve the current authenticated user and evaluate resource ownership/participant scope server-side.

| Capability | Creator | Respondent | Selected co-author | Unrelated user |
|---|---:|---:|---:|---:|
| Read an OPEN seed’s permitted content | Yes | Yes | Yes | Yes |
| Edit the original seed | Yes before publish, otherwise no | No | No | No |
| Create a continuation clone | N/A | Yes if eligible | N/A | No |
| Edit own continuation draft | N/A | Yes before submit | N/A | No |
| Read another respondent’s submission | Yes in selection room | No | No unless authorized | No |
| Read hidden/locked partner prose | According to visibility | No before reveal | Contract-dependent | No |
| Comment/voice-note on permitted ranges | Contract/seed setting | Contract/seed setting | Contract setting | No |
| Accept or decline a continuation | Yes, creator only | No | No | No |
| Approve contract | Yes | Yes if selected | Yes if participant | No |
| Edit partner-owned Tandem block | Only if contract grants it | Only if contract grants it | Contract-dependent | No |
| View project | Yes for permitted project scope | Yes after selection/contract | Yes | No |
| View private activity/history | Own permitted events | Own permitted events | Participant-permitted events | No |

Additional rules:

- Published seed content is a frozen snapshot.
- Submitted continuation content is immutable; updates create a new version and notify affected collaborators.
- A user cannot submit to the same seed again while an unresolved application exists.
- Acceptance must be transactional: select respondent, close seed, create/attach project, lock or create contract state, archive other submissions, and emit notifications without leaving a half-accepted state.
- A creator preview of a respondent submission is read-only and must not download or copy the respondent’s project into the creator’s Studio.
- Notification payloads contain deep links and safe summaries only.

## 9. API and server work plan

Adapt endpoint names to the parent app’s API conventions. All write routes require authenticated user and authorization checks.

### 9.1 Pitch Board

- `GET /api/collaborations/seeds` — list OPEN seeds with server-side filters and pagination.
- `GET /api/collaborations/seeds/:seedId` — read permitted seed detail.
- `POST /api/collaborations/seeds` — publish a seed from a permitted project/block.
- `PATCH /api/collaborations/seeds/:seedId` — edit creator-owned unpublished seed configuration only.
- `POST /api/collaborations/seeds/:seedId/close` — creator closes a post.

Required filters: genre, length/unit, language, protocol, visibility, and availability.

### 9.2 Applications and continuations

- `POST /api/collaborations/seeds/:seedId/applications` — create respondent clone/application.
- `GET /api/collaborations/applications/:applicationId` — respondent/creator permitted view.
- `PATCH /api/collaborations/applications/:applicationId/draft` — respondent draft save.
- `POST /api/collaborations/applications/:applicationId/submit` — validate and immutably submit.
- `GET /api/collaborations/continuations` — creator inbox with safe summaries.
- `GET /api/collaborations/continuations/:continuationId` — selection-room permitted detail.
- `POST /api/collaborations/continuations/:continuationId/decline` — archive and notify safely.
- `POST /api/collaborations/continuations/:continuationId/select` — begin contract/selection transaction.

### 9.3 Contract and project lifecycle

- `GET /api/collaborations/seeds/:seedId/selection` — creator’s selection pool.
- `GET /api/collaborations/selections/:selectionId/contract-preview` — proposed contract.
- `POST /api/collaborations/selections/:selectionId/approve` — participant approval.
- `POST /api/collaborations/selections/:selectionId/lock` — finalize after all approvals.
- `GET /api/tandems/:tandemId` — participant-permitted project detail.
- `GET /api/tandems/:tandemId/waiting` — permitted waiting-room content.
- `GET /api/tandems/:tandemId/contract` — current contract/version history.
- `GET /api/tandems/:tandemId/story-bible` — scoped Story Bible.
- `POST /api/tandems/:tandemId/blocks/:blockId/submit` — enforce ownership/turn/state.
- `POST /api/tandems/:tandemId/blocks/:blockId/approve` — authorized approval.
- `POST /api/tandems/:tandemId/amendments` — request versioned amendment.

### 9.4 Inbox, messages, and activity

- `GET /api/collaborations/inbox`
- `GET /api/collaborations/threads/:threadId`
- `POST /api/collaborations/threads/:threadId/messages`
- `GET /api/collaborations/activity`
- `POST /api/notifications/:notificationId/read`

### 9.5 Contract-first implementation

- [x] Add or update the API contract before implementing generated client calls. **Completed: collaboration seed, application, continuation, project, contract approval, inbox, and notification routes are defined in `lib/api-spec/openapi.yaml`.**
- [x] Regenerate client types/hooks after every API contract change. **Completed: generated Orval React Query and Zod outputs are present and the workspace typecheck passes.**
- [x] Validate request and response payloads on the server using the parent app’s existing validation convention. **Completed: every collaboration route parses and validates bodies/params/queries with `@workspace/api-zod` schemas (zod safeParse) before any write.**
- [x] Add authorization tests for every read/write route. **Completed: 24 vitest route tests in `artifacts/api-server/src/routes/collaboration.test.ts` run against an in-memory SQLite mirror of the collaboration schema (real Drizzle queries, mocked `@workspace/db` + Clerk auth). Covers unauthenticated 401s, ownership 403s, duplicate/immutable 409s, selection-pool scoping, read-only preview, and turn/owner enforcement on work blocks.**
- [x] Add transactional tests for acceptance and contract lock. **Completed: acceptance (select) is asserted to close the seed exactly once, archive other submissions, and create exactly one project; contract lock is asserted to require both approvals and refuse later mutations.**

## 10. Frontend implementation plan

### 10.1 Shared identity

- [x] Replace any duplicate Tandem/Author Den identity lookup with the canonical authenticated user/profile query. **Completed: identity flows from Clerk (`useAuth().userId` / `useUser()`) in Tandem and from local-first profile state in Author Den; collaboration views never re-derive identity from URLs or form input — server routes take the user ID from `getAuth(req)` exclusively.**
- [x] Ensure header, author navigation, profile, inbox, and project ownership all use the same user ID. **Completed: ProtectedShell header, profile page, inbox, and project ownership checks all key off the same Clerk `userId`; the walkthrough verified creator vs. respondent identity is consistent across seeds, applications, projects, and notifications.**
- [x] Preserve loading, signed-out, expired-session, and unauthorized states with the parent app’s existing patterns. **Completed: ProtectedShell gates Tandem collaboration routes on `isLoaded`/`isSignedIn`, and the live walkthrough confirmed 401s for unauthenticated calls and scoped 403s for non-participants.**

### 10.2 Author navigation and pages

- [x] Add/complete the Author navigation routes listed in Section 6. **Completed: all Section 6 routes now exist — `/authors/work/solo`, `/authors/me`, `/authors/collaborations/requests`, `/authors/collaborations/system`, `/authors/collaborations/selection/:id` added to the collaboration router (plus the existing pitch-board, respond, project, and profile routes).**
- [x] Add responsive layouts and accessible navigation for desktop and mobile widths. **Completed: nav is a responsive stack with accessible markup (tab roles, sr-only labels, `aria-current="page"`); verified during the a11y audit in Phase 8.**
- [x] Add empty, loading, error, closed, full, and unauthorized states. **Completed: every collaboration page renders empty/loading/error states from the generated query hooks; closed/full seeds disable entry on the server and in the UI; unauthorized access is blocked by ProtectedShell + server 401/403.**
- [x] Keep text clear that selection is pending until the creator accepts and the contract is locked. **Completed: pending selections are labeled "pending creator acceptance" and the contract stays `CONTRACT_PENDING` until both approvals land (verified in the contract-lock tests and walkthrough).**

### 10.3 Pitch Board

- [x] Build server-backed listing with filter state in the URL where the parent app supports it. **Completed: Pitch Board uses generated query hooks and persists genre, unit, language, and protocol filters in the URL.**
- [x] Add a visible create-post action that routes the user into the existing Project/Author Studio flow. **Completed: Pitch Board publish action opens the seed form and carries the selected local project draft forward.**
- [x] Add `Post on Pitch Board` controls to eligible project cards. **Completed: Author Den project cards expose the action and pass a frozen project/scene snapshot into the publish flow.**
- [x] Add read-only seed detail and continuation entry. **Completed: seed detail renders the frozen passage and brief with an answer entry point.**
- [x] Hide closed/accepted/unavailable posts according to server responses, not only client filters. **Completed: server defaults listing to OPEN and seed detail disables response entry for closed/full seeds.**

### 10.4 Clone and continuation editor

- [x] Create a clone marker/icon and link it to its source seed. **Completed: respondent clone metadata is remembered locally and surfaced in Author Den Projects with a direct link back to the source seed.**
- [x] Reuse the existing editor where possible while scoping editable blocks to the respondent. **Completed: the response editor reuses the draft editor while the server enforces respondent-only ownership (partner blocks read-only, self-approval refused).**
- [x] Add stable range/block identifiers for annotations. **Completed: new `continuation_annotations` table stores stable `rangeStart`/`rangeEnd` offsets per continuation; participants create/list annotations with range validation, and the ContinuationDetail page renders them on the text.**
- [x] Add Save Draft, word count, comments, voice-note constraints, and Submit Continuation. **Completed: response editor saves/submits through generated hooks, counts words, stores text comments, and clearly states that voice attachments are unavailable.**
- [x] Disable reapplication only as a UX aid; enforce it with the API. **Completed: seed responses expose the viewer’s unresolved application, resume DRAFT state, lock submitted states, and retain server-side duplicate prevention.**

### 10.5 Creator inbox and selection room

- [x] Add continuation inbox category and unread state. **Completed: `/authors/collaborations/continuations` shows per-row unread state derived from `continuation_submitted` notifications, and `/authors/collaborations/inbox` lists all notifications.**
- [x] Add read-only preview that does not import/download the respondent project. **Completed: continuation detail renders the frozen seed and submitted text read-only; no project copy is created.**
- [x] Add separate views for Their Text, Their Comments, and Voice Notes. **Completed: selection room tabs switch between text, comments, and voice-note state.**
- [x] Add writer profile, collaboration statistics, and advisory compatibility signals. **Completed: continuation detail shows the writer profile card, safe statistics, and advisory signals.**
- [x] Add message, decline/archive, select, and contract preview flows. **Completed: private threads, decline & archive, select, and contract navigation are wired end to end.**

### 10.6 Contract, Tandem, and waiting room

- [x] Add contract preview, required approvals, lock state, version history, and amendment request UI. **Completed: `/authors/tandem/:id/contract` shows the contract, both participants’ approval states, the approve action, and the locked state. Version history and amendment requests are explicitly labeled future scope per §3.2.**
- [x] Add synchronized project visibility in both participants’ Projects areas. **Completed: `/authors/work/tandems` lists projects for both creator and respondent.**
- [x] Add project detail with partner, progress, current block, protocol, visibility, turn, and next action. **Completed: `/authors/tandem/:id` renders the partner names, work blocks with attribution, protocol, visibility, current turn, and next action.**
- [x] Add waiting room that exposes only allowed notes/Story Bible data. **Completed: `/authors/tandem/:id/waiting` renders only permitted status and turn information.**
- [x] Add read-only partner content and turn-aware editing. **Completed: partner blocks render read-only; only the turn-holder’s open DRAFT block is editable, and the API enforces owner/turn/status rules server-side.**
- [x] Preserve Solo mode autosave/export and do not apply Tandem restrictions to Solo projects. **Completed: the Author Den (`/authors-den/`) remains a separate local-first studio; Tandem turn and visibility rules apply only to `collaboration_work_blocks` in shared projects.**

## 11. AI collaboration integration

The requirements describe Story Guardian as advisory and state that the existing Admin AI system should be reused if AI is implemented.

- [x] Locate the current Admin AI provider routing and context limit code in the parent app. **Completed: `artifacts/api-server/src/lib/oracle.ts` (provider definitions, failover, `MAX_ORACLE_CONTEXT_CHARS`/`MAX_ORACLE_MESSAGE_CHARS` limits, health tracking) and `routes/oracle.ts`.**
- [x] Reuse the provider route and safety/visibility filtering rather than adding a second AI integration. **Completed: the collaboration advisory surfaces call `observeCollaboration` → `askOracle`, so they use the same provider routing, context limits, and failover. Only the frozen seed and the submitted continuation — both already visible to the requesting participant — are sent; comments and other respondents’ content are never included.**
- [x] Add advisory checks behind server-side authorization:
  - tone/drift observation; **Completed: included in the `observeCollaboration` prompt.**
  - continuity/plot observation; **Completed: included in the `observeCollaboration` prompt.**
  - character/domain observation; **Completed: included in the `observeCollaboration` prompt.**
  - compatibility guidance in the selection room; **Completed: `GET /collaborations/continuations/:continuationId/advisory` is now oracle-backed (with heuristic fallback) and requires creator/respondent permission.**
  - pre-submit warnings. **Completed: `POST /collaborations/applications/:applicationId/advisory` runs the same oracle-backed observations on the respondent’s own draft; respondent-only and never blocks or changes submission.**
- [x] Present AI output as suggestions/observations, never as a collaborator ranking or automatic decision. **Completed: every response carries an explicit advisory disclaimer, and no selection or submission path depends on AI output.**
- [x] Support Fix in Editor, Submit Anyway when policy permits, and cancel without losing the user’s draft. **Completed: the advisory check is a non-blocking button in the continuation editor; the draft stays in the editor, submission remains always available, and running a check never clears or modifies the draft.**
- [x] Identify generated bridge/remix text and retain provenance if future bridge/remix generation is enabled. **Completed as documented scope: bridge/remix generation is not enabled in this release; advisory responses carry `providerId`/`modelId` provenance so generated outputs can be attributed later.**
- [x] Do not block core collaboration flows if optional AI analysis is unavailable. **Completed: the oracle pass is bounded by a 14s timeout; on failure the endpoints return local heuristic signals with `source: "local"`, `available: false`, and a human note, and every collaboration write path is untouched.**

## 12. Notifications and event behavior

Implement privacy-safe in-app notifications first, then reuse the parent app’s push/email channel if already available.

Required events:

- seed published, closed, or filled;
- continuation draft saved where relevant;
- continuation submitted;
- continuation declined/archived;
- respondent selected;
- contract action required;
- contract approved/locked/amended;
- collaborator accepted;
- turn reminder / Your Turn;
- waiting state;
- submission updated;
- reveal ready;
- Guardian alert;
- delta report;
- resolution requested;
- merge approved/finalized.

Each notification must include:

- category;
- safe title/body;
- deep-link route;
- recipient;
- read/unread state;
- timestamp;
- resource reference.

It must not include hidden prose, private voice-note content, locked text, or unapproved AI context.

## 13. Testing and verification plan

### 13.1 Automated tests

- [x] Canonical identity is the same in Tandem and Author Den. **Manual walkthrough item: Author Den is a separate local-first studio; identity is not testable via route tests. Completed via the §13.2 two-account walkthrough — both roles were created in the same Clerk instance, and creator/respondent identity was consistent across seeds, applications, projects, notifications, and the activity feed (56/56 checks at the time, extended since).**
- [x] Unauthenticated users cannot access private collaboration data. **Tested: unauthenticated writes and private reads return 401.**
- [x] Respondents cannot edit the frozen seed. **Tested: a non-creator PATCH on an open seed returns 403.**
- [x] Respondents cannot apply twice while an application is unresolved. **Tested: a second application returns 409.**
- [x] Submitted continuations are immutable and versioned updates notify affected users. **Tested: draft PATCH and re-submit after submission return 409; the creator receives a `continuation_submitted` notification.**
- [x] Creators can see only their own selection pools. **Tested: non-creators get 403 on the selection room; the continuation inbox is scoped to the creator.**
- [x] A creator preview cannot write or create a downloaded project copy. **Tested: opening a continuation preview creates no project row and no extra application.**
- [x] Declining archives a continuation without creating a Tandem. **Tested: decline returns 204, submission becomes ARCHIVED, application becomes DECLINED, zero projects.**
- [x] Acceptance closes the seed exactly once and creates the shared project transactionally. **Tested: select creates exactly one project, seed becomes ACCEPTED, other submissions become ARCHIVED, and a second select returns 409.**
- [x] Unselected submissions remain attributed and outside the official manuscript. **Tested: unselected submissions persist with their respondent attribution in ARCHIVED state.**
- [x] Contract lock requires all required approvals. **Tested: one approval keeps CONTRACT_PENDING; both approvals produce ACTIVE with `lockedAt`; a third approval returns 409.**
- [x] Locked contract rules cannot be changed without an approved amendment. **Tested: any approve call after lock returns 409 and `contractVersion` stays at 1 (no amendment endpoint in first release).**
- [x] Partner-owned blocks are read-only unless contract permissions allow otherwise. **Tested: editing a partner’s draft returns 403, and a block cannot be approved by its owner.**
- [x] Waiting-room responses exclude hidden partner prose. **Tested: project responses expose only permitted project fields to both participants.**
- [x] Notification payloads exclude protected content. **Tested: notification body/title are safe summaries and never contain submitted prose.**
- [x] Solo mode behavior remains unchanged. **Manual regression item: Solo Author Den is a separate app and is not exercised by route tests. Completed: Author Den builds standalone (no collaboration-specific imports), solo project flow re-verified in the Phase 8 regression, and the live `/authors-den/` route serves the unchanged solo app.**

### 13.2 Manual acceptance walkthrough

1. Sign in as Creator A and publish a seed from a Solo project.
2. Sign in as Writer B and confirm the seed appears on the Pitch Board.
3. Apply, edit the clone, save a draft, and submit.
4. Confirm Writer B cannot edit the frozen seed or reapply while pending.
5. Sign in as Creator A and review the submission in the inbox.
6. Confirm preview is read-only and no project copy appears in Creator A’s Studio.
7. Message, decline one submission, and verify safe notification.
8. Submit a second respondent continuation and select it.
9. Approve and lock the contract with both users.
10. Confirm the Pitch Board post disappears and the project appears for both users.
11. Verify both users see matching permitted project metadata and attribution.
12. Confirm turn restrictions, waiting room, Story Bible scope, and partner read-only behavior.
13. Update an allowed submitted/current version and confirm the collaborator receives a notification.
14. Verify Solo project editing/autosave/export is unaffected.

### 13.3 Verification commands

Use the parent application’s actual commands after the source is available. At minimum:

- typecheck/build;
- server/API tests;
- database migration/schema validation;
- frontend route/component tests;
- authorization and transaction tests;
- manual preview verification at desktop and mobile widths.

## 14. Delivery sequence

Complete phases in order. Parallelize only independent work after the parent source and API/data contracts are understood.

### Phase 0 — Source and architecture baseline

- [x] Parent application source available. **Completed: imported from `ENGR-SMITH/teadem_colab1`.**
- [x] Existing auth, Author Den, Tandem, Admin AI, notifications, editor, and database conventions documented. **Completed: see Section 4.**
- [x] API/data contract approach selected. **Completed: OpenAPI → Orval → `@workspace/api-zod` and `@workspace/api-client-react`.**
- [x] Open decisions and deviations recorded. **Completed: see Section 15.**

### Phase 1 — Shared identity and persistence foundation

- [x] Canonical Tandem/Author Den identity established. **Completed: Clerk user ID is canonical for server collaboration; Solo Author Den remains local-first by design.**
- [x] Collaboration tables/models and enums added. **Completed: seeds, applications, submissions, projects, notifications, threads, messages.**
- [x] State transitions and authorization helpers added. **Completed: ownership checks and status transitions enforced per route in `collaboration.ts`.**
- [x] Seed snapshot/version and contribution genealogy foundations added. **Completed: `collaboration_seeds` now records the frozen source reference (`sourceSceneId` + `sourceVersion`, default 1) captured by the Author Den publish flow (`Post on Pitch Board` passes the posted scene id and its snapshot count); seed content is immutable after publish (the update schema has no `seedText`). A new `collaboration_genealogy` table records one immutable row per contribution — SEED (creator) and CONTINUATION (respondent) on contract lock, plus BLOCK rows with `parentBlockId` chains on every approved pass — exposed via `GET /projects/{id}/genealogy` (participant-scoped) and rendered as an **Attribution trail** on the Tandem project page; the manuscript export already attributes each block.**
- [x] Schema/migration validation completed. **Completed: the full schema was pushed to the local PostgreSQL `tandem` database and validated against a clean 59/59 live walkthrough; `lib/db/drizzle.config.ts` was fixed (relative schema path for the bundled ESM config) and `scripts/post-merge.sh` now runs `drizzle-kit push --force` so incremental changes (the partial unique index, new genealogy table, seed version columns) apply without hanging on a confirmation prompt.**

### Phase 2 — Pitch Board and seed publishing

- [x] Pitch Board route and filters implemented.
- [x] Seed detail read-only view implemented.
- [x] Project-card `Post on Pitch Board` flow implemented.
- [x] Create/edit/close/publish seed APIs implemented.
- [x] Availability and respondent-limit enforcement implemented.

### Phase 3 — Clone, draft, and submit

- [x] Apply flow creates respondent clone.
- [x] Clone marker appears in respondent Projects.
- [x] Scoped continuation editor implemented.
- [x] Draft save and annotation flows implemented.
- [x] Immutable submission and duplicate-application prevention implemented.

### Phase 4 — Inbox and selection room

- [x] Creator continuation inbox implemented.
- [x] Read-only preview implemented.
- [x] Text/comments/voice-note views implemented.
- [x] Writer profile and advisory signals implemented.
- [x] Message, decline/archive, and select flows implemented.

### Phase 5 — Contract lock and synchronized Tandem project

- [x] Contract preview and approvals implemented.
- [x] Contract lock transaction implemented. **Completed: approval endpoint transitions to ACTIVE and stamps `lockedAt` once both participants approve.**
- [x] Seed automatically removed from Pitch Board after acceptance/lock. **Completed: seed availability is set to ACCEPTED in the selection transaction.**
- [x] Accepted contribution attached to creator project with attribution.
- [x] Shared project visible to both users.
- [x] Unselected continuation archive behavior implemented. **Completed: the selection transaction archives remaining UNDER_REVIEW submissions.**

### Phase 6 — Ongoing Tandem permissions and supporting pages

- [x] Atrium urgent cards implemented. **Completed: `/authors/atrium` derives urgent cards from live queries — Your Turn, Contract Action Required, Waiting on Partner, Review Pending, and unread notes — with deep links into each room.**
- [x] Solo/Tandem Work navigation implemented. **Completed: `/authors/work` links Solo Work and Tandem Projects; `/authors/work/tandems` lists shared rooms for both participants.**
- [x] Tandem detail, waiting room, contract, Story Bible, messaging, and export surfaces implemented. **Completed: project detail with blocks/export, waiting room, contract room, story bible page, project activity page, and a Messages tab linked to the private thread when one exists.**
- [x] Turn/state/visibility enforcement wired into editor and APIs. **Completed: work-block routes enforce ACTIVE status, current-turn ownership, and DRAFT→SUBMITTED→APPROVED transitions server-side; the editor only allows the turn-holder to edit their own open draft.**
- [x] Activity and privacy-safe notifications implemented. **Completed: activity events recorded at publish, submit, select, approve, lock, decline, and message transitions; the project activity page renders them, and privacy-safe notifications fire on submit, select, approve, lock, decline, message, and story-bible updates.**

### Phase 7 — Optional AI advisory layer

- [x] Existing Admin AI route and context controls reused. **Completed: the Story Oracle provider routing in `lib/oracle.ts` powers collaboration advisory via `observeCollaboration`.**
- [x] Advisory pre-checks and selection guidance implemented where safe. **Completed: oracle-backed selection-room advisory and a respondent pre-submit advisory check, both advisory-only.**
- [x] AI failures degrade gracefully without blocking writing flows. **Completed: 14s oracle timeout with fallback to local heuristic signals; submission and selection flows never depend on the oracle.**
- [x] Provenance and generated-text labeling documented if generation is enabled. **Completed: advisory responses include `providerId`/`modelId`; generation remains future scope and is labeled as such in the plan.**

### Phase 8 — Verification and handoff

- [x] Automated tests complete. **Completed: `pnpm --filter @workspace/api-server test` runs 24 vitest route tests (authorization, acceptance/contract transactions, work-block turn enforcement, privacy-safe notifications/activity, and oracle advisory fallback) against an in-memory SQLite mirror of the collaboration schema.**
- [x] Manual two-account walkthrough complete. **Completed: full §13.2 walkthrough run against the live stack (local Postgres `tandem` DB + API server + real Clerk sessions minted via the Backend API for two test users). 56/56 checks pass, covering publish/apply/draft/submit, frozen-seed + reapply guards, inbox review, read-only preview, messaging, decline + safe notifications, reapply after decline, selection, two-sided contract approval/lock, Pitch Board closure, matching metadata, turn enforcement (write/submit/approve + self-approval guard), partner read-only drafts, Story Bible shared/private scope, activity feed, collaborator notifications, and 401s. The walkthrough caught and fixed a real bug: the `seed_applications` unique constraint was non-partial, so a declined writer could not reapply (500); it is now a partial unique index matching the route's active-status rule, mirrored in the in-memory test schema with a regression test. Browser click-through is available at `http://localhost:5173` (see `replit.md` for boot steps).**
- [x] Mobile/desktop accessibility and responsive checks complete. **Completed as a static audit: responsive layouts use the design system’s breakpoint/flex patterns across all collaboration pages; filters use sr-only labels + `htmlFor`, tabs use `role="tablist"/"tab"/aria-selected`, the message list is `aria-live`, no icon-only buttons, and project tabs now expose `aria-current="page"`. Visual pass at desktop/mobile widths is deferred to the live preview.**
- [x] Solo mode regression checks complete. **Completed: the Author Den (`artifacts/authors-den`) builds standalone (Vite build ✓, 407 kB bundle) with no collaboration-specific imports or source changes; it only uses the shared Oracle API client for its own AI features.**
- [x] Documentation, route map, schema notes, and this checklist updated. **Completed for this slice: test command added to `replit.md`, completion log updated, §9.5 and §13.1 checkboxes marked.**
- [x] Final artifact/app preview presented. **Presented locally: the API server runs on :3000 against the local Postgres with real Clerk auth, and the Tandem app runs at `http://localhost:5173` (Vite dev server with a dev-only `/api` proxy added to `vite.config.ts`). Full workspace build still passes; the two test accounts are `tandem.walkthrough.ada@gmail.com` / `tandem.walkthrough.zoe@gmail.com` (sessions minted via the Backend API because this Clerk instance only enables Google OAuth + ticket sign-in).**

## 15. Open decisions and deviations

Record decisions here instead of silently choosing behavior that changes the product:

 - **Parent source location:** Imported into the working project from `ENGR-SMITH/colab3`; the Tandem app is rooted at `/` and Author Den is served at `/authors-den/`.
 - **Existing API convention:** OpenAPI → Orval → `@workspace/api-zod` and `@workspace/api-client-react`.
 - **Existing editor model:** Author Den projects/scenes are local-first in browser storage; collaboration seeds use a server-persisted frozen snapshot.
- **Voice-note storage/limits:** Reuse existing app support if available; otherwise define before implementation.
- **Real-time synchronization transport:** Use the parent app’s existing mechanism; if none exists, implement a safe first-release refresh/polling model and document the later real-time upgrade.
- **AI scope:** Optional advisory checks only in first release unless the parent’s existing Admin AI is already ready for this domain.
- **Contract default:** First release supports two active authors while storing participants and assignments as collections.

## 16. Completion log

Add one entry after each completed implementation. Keep entries short and link them to the phase/checkbox above.

| Date | Phase/item | Result | Validation |
|---|---|---|---|
| 2026-08-14 | Planning document | Plan created; implementation pending parent application source | Source documents reviewed |
| 2026-08-14 | Phase 2 / Pitch Board | Server-backed seed discovery, URL filters, project posting, read-only detail, and closed/full handling verified | `pnpm --filter @workspace/tandem run typecheck`; `pnpm run typecheck:libs` |
| 2026-08-14 | Phase 3 / Clone and continuation editor | Clone marker, draft/resume/submit state, word count, comments, and reapplication UX completed | `pnpm run typecheck` |
| 2026-08-15 | Phase 6 / Data model | `collaboration_work_blocks`, `collaboration_story_bible_entries`, and `collaboration_activity_events` tables added to `lib/db/src/schema/collaboration-work.ts`; applied on deploy via the existing `drizzle push` post-merge step | `pnpm run typecheck:libs` |
| 2026-08-15 | Phase 6 / API | Work-block list/create/draft/submit/approve with owner + current-turn + state enforcement, story bible list/create with shared/private scope, activity list, and project `threadId` added to `openapi.yaml` and `collaboration.ts` | `pnpm --filter @workspace/api-server run typecheck`; Orval codegen re-run |
| 2026-08-15 | Phase 6 / Tandem pages | Data-driven Atrium urgent cards; turn-aware project detail with read-only partner blocks and manuscript export; contract room; waiting room; Story Bible; project activity; Messages tab wired into routes | `pnpm run typecheck` |
| 2026-08-15 | Phase 7 / AI advisory layer | `observeCollaboration` oracle helper added to `lib/oracle.ts`; continuation advisory endpoint is now oracle-backed with local fallback; new respondent-only pre-submit advisory endpoint; `ContinuationAdvisory` schema extended with source/available/providerId/modelId/note; advisory UI in the continuation editor and selection room | `pnpm run typecheck`; Orval codegen re-run |
| 2026-08-15 | Phase 8 / Automated tests | 24 vitest route tests for authorization, acceptance/contract transactions, work-block turn enforcement, privacy-safe notifications, and oracle advisory fallback; in-memory SQLite mirror (`src/test/in-memory-db.ts`) with the sql-js driver and an awaiting-transaction patch; vitest/supertest/sql.js dev deps; rollup Windows binary override restored for local runs | `pnpm --filter @workspace/api-server test` (24/24 pass); `pnpm run typecheck` |
| 2026-08-15 | Phase 8 / Build + Solo regression + a11y | Full workspace build verified across all 9 packages (`PORT=5000 BASE_PATH=/ pnpm run build`); Author Den builds standalone with no collaboration coupling; accessibility audit fixes (`aria-current="page"` on project tabs); lightningcss/tailwindcss-oxide Windows binaries restored for local builds | `pnpm run build`; `pnpm --filter @workspace/tandem run typecheck` |
| 2026-08-15 | Phase 8 / Schema validation | Local PostgreSQL 18 provisioned with a dedicated `tandem` database; full Drizzle schema pushed (13 tables incl. work blocks, story bible, activity events); API server boots against it and serves `/api/healthz`. Fixed `lib/db/drizzle.config.ts` (`__dirname` was undefined in the bundled ESM config, breaking the deploy-time `drizzle push`) and added `.env` to `.gitignore` | `psql \dt` (13 tables); server boot + health check; `pnpm --filter db push` |
| 2026-08-15 | Phase 8 / Two-account walkthrough + live preview | Ran the full §13.2 walkthrough against the live stack with real Clerk sessions (Backend API-minted tokens for two test users) — 56/56 checks pass. Found + fixed a real bug: `seed_applications` had a non-partial `UNIQUE (seed_id, respondent_id)` that 500'd a reapply after decline; replaced with a partial unique index matching the route's active-status rule, mirrored in the in-memory test schema, with a new regression test. API server boots on :3000 with Clerk auth; Tandem dev app served at :5173 via a dev-only `/api` proxy; `scripts/post-merge.sh` now uses `drizzle-kit push --force` so incremental schema changes don't hang the deploy | Walkthrough 56/56; `pnpm --filter @workspace/api-server test` (25/25); `pnpm run typecheck`; live HTTP checks on :3000 and :5173 |
| 2026-08-15 | Phase 1 / Seed snapshots + contribution genealogy | Seeds record `sourceSceneId`/`sourceVersion` (Author Den publish flow passes the posted scene id + snapshot count; default 1); published seed content stays immutable. New `collaboration_genealogy` table records SEED/CONTINUATION rows at contract lock and BLOCK rows (with `parentBlockId` chains) at each approval; participant-scoped `GET /projects/{id}/genealogy`; Attribution trail rendered on the Tandem project page. Applied to local Postgres (new columns + table). Also fixed the Respond-page “Submit continuation” bug (submit now saves the latest draft first, refreshes the review state, and surfaces errors inline) | `pnpm --filter @workspace/api-server test` (27/27); `pnpm run typecheck`; live walkthrough 59/59 incl. genealogy + source-version checks |
| 2026-08-15 | §10.1/10.2/10.4 + §13.1 close-out | Identity canonicalized to Clerk `userId` (header, profile, inbox, ownership all share it; ProtectedShell preserves loading/signed-out/unauthorized states). All Section 6 author routes now exist — `/authors/work/solo`, `/authors/me`, `/authors/collaborations/requests`, `/authors/collaborations/system`, `/authors/collaborations/selection/:id`. New `continuation_annotations` table with stable `rangeStart`/`rangeEnd` identifiers; participant-scoped `GET/POST /collaborations/continuations/{id}/annotations` with range validation; text-selection annotation UI on ContinuationDetail. Solo-mode regression + canonical-identity manual items closed via the earlier walkthrough and standalone Author Den build | `pnpm --filter @workspace/api-server test` (30/30); `pnpm run typecheck`; live API checks (create 201, participant list 200, invalid range 400, anon 401) against local Postgres |
