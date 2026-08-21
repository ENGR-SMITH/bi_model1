# Creator Den — External-First VCS Design ("GitHub for Video")

**Status:** Implemented. The full external-first loop is shipped — checkout
(Phase 1), push with media/stems (Phase 2), review/diff + unified annotations
(Phase 3), merge/history + commit log + genealogy (Phase 4), content-addressed
media with legacy backfill + disk consolidation (Phase 0 copy reframe:
stages/pull requests, marker rail on the player, server-side activity leg
filter). Open decisions remain deferred by design (named branches, AAF import,
parser library, in-browser editing as the primary path).
**Scope:** Creator Den (`artifacts/creators-den`), the video platform behind the
Content Creators door.
**Deployment note:** the shipped schema additions (`tandem_video_assets.content_hash`,
`tandem_video_asset_files.content_hash`, `collaboration_activity_events.leg`)
need pushing to any live database:
`pnpm --filter @workspace/db push` (no checked-in migrations by convention).
After that, run `pnpm --filter @workspace/api-server backfill:hashes` once to
address legacy uploads, and optionally `consolidate:hashes --apply` to reclaim
duplicate disk.
**Related docs:** `WORKSPACE-REFERENCE.md` (per-role reference-app tool
catalogue), `START-APP.md`, `FEATURES.md`,
`TADEM_COLLABORATION_IMPLEMENTATION_PLAN.md`.

---

## 1. Background & problem

The original question: can we drop real editing tools — Avid Media Composer,
Adobe Premiere Pro, Avid Pro Tools, Adobe After Effects, DaVinci Resolve — into
the Creator Den as iframes, instead of building per-role editing workspaces
ourselves?

**Answer: no.** Those five tools are native desktop applications, not web apps.
There is no URL to put in an `<iframe>`. They need an OS, a GPU, licensed media
access, and local storage. "Embedding" one means streaming its screen over
remote desktop (a video stream, not an iframe).

### Alternatives evaluated

| Approach | Verdict |
|---|---|
| **File round-trip interop** (EDL / AAF / FCPXML / OTIO) | ✅ Chosen. The industry-standard way post houses hand work between these exact tools. |
| **Embeddable web editor SDKs** (Editframe, Remotion/Revideo, Shotstack, etc.) | ❌ None is Premiere-class, each has its own data model, none maps onto our role-scoped relay / audit / history model. |
| **Cloud-VM streaming** of the real apps (Avid Edit On Demand, Parsec, NICE DCV, HP Anywhere) | ❌ Enterprise-priced, per-user licensed, operationally heavy. Wrong fit. |

---

## 2. Decision

**Creator Den becomes a "GitHub for social-media video":** an online platform
where creators store, share, and track changes to their video content while
collaborating on projects.

- **All editing happens in external tools** (Premiere, Resolve, Pro Tools,
  Avid, After Effects, etc.) via export → edit → re-import.
- **Creator Den is the version-control + collaboration layer**: it tracks
  submissions, versions, the timeline, review feedback, and approvals.
- **External-first = zero in-browser *editing*.** Review / compare / comment /
  approve stays in-browser (you cannot approve a cut you cannot watch).

This mirrors GitHub precisely: GitHub has no code editor of its own; it is the
store/share/track/collaborate layer. Creator Den plays that role for video.

---

## 3. Core mental model

| Git / GitHub | Creator Den |
|---|---|
| Repository | Project (`tandem_video_projects`) |
| Commit (snapshot + message + parent) | Timeline version (`tandem_video_timeline_versions`) |
| Commit message | `message` field + "what I worked on" description |
| Pull request | Submission (`tandem_video_submissions`) |
| PR review / approve / merge | Submission decide → advance `currentVersionId` |
| Code review comments | Timecode + spatial comments (`tandem_video_comments`) |
| Large files (Git LFS) | Assets (`tandem_video_assets` / `tandem_video_asset_files`) |
| `git clone` / checkout | Export a manifest + media bundle (or timed grant) |
| `git push` | Re-import files + commit message → new version + submission |
| Diff | Timeline text diff + side-by-side A/B of rendered proxies |
| `git blame` / provenance | Genealogy (`collaboration_genealogy` pattern) |
| Contributors / roles | Members (`tandem_video_members`) |

**The diffable artifact is the timeline, not the pixels.** The timeline/EDL is
text; the media is LFS. That single insight is what makes "GitHub for video"
feasible.

---

## 4. What already exists vs. what is new

The codebase already implements most of the VCS skeleton. The table below maps
GitHub concepts to the existing schema (all prefixed `tandem_`).

| GitHub concept | Existing table / field | Status |
|---|---|---|
| Commit | `tandem_video_timeline_versions` (`version`, `snapshot` jsonb, `message`, `parentVersionId`) | ✅ exists |
| PR | `tandem_video_submissions` (`note`, `SUBMITTED → APPROVED / REJECTED`) | ✅ exists |
| Review comments | `tandem_video_comments` (`timecodeMs`, `assetId`, `leg`, `parentId`, `resolvedAt`) | ✅ exists |
| LFS | `tandem_video_assets` (`version`) + `tandem_video_asset_files` (ORIGINAL / PROXY / TRANSCRIPT / AUDIO_STEM / THUMBNAIL / RENDER) | ✅ exists |
| External hand-off | `tandem_video_grants` (timed download "for external DAW repair") + `tandem_video_downloads` (audit) | ✅ exists |
| Roles | `tandem_video_members` + `tandemVideoRoleSchema` | ✅ exists |
| Provenance | `collaboration_genealogy` (Author Den already ships fork → PR → merge) | ✅ exists (writing side) |
| Activity feed | `collaboration_activity_events` | ✅ exists |
| **Checkout (export bundle)** | new job type + `asset_files` kind `INTERCHANGE` | ⬜ new |
| **Push (import + parse)** | new endpoint: EDL/FCPXML/OTIO → snapshot | ⬜ new |
| **Timeline diff / A-B compare** | UI on top of two snapshots + proxies | ⬜ new |
| **Project-level commit log** | elevate `HistoryPanel` to project scope | ⬜ new |
| **Spatial annotations** | extend `tandem_video_comments` with geometry/kind/color/label | ⬜ new |
| **Thumbnail role / leg** | 5th leg + new role + annotation canvas | ⬜ new |

---

## 5. The interchange layer (formats)

The single most important technical decision. Formats are the contract between
Creator Den and every external tool.

### Canonical: OTIO (OpenTimelineIO)

- JSON, open-source (Academy Software Foundation), built for NLE interchange.
- **Text → diffs and versions cleanly.** OTIO is the "code" of the video repo.

### Practical exports

| Format | Use | Parse-ability |
|---|---|---|
| **EDL** | Universal fallback; selects/cut. CMX3600, simple. | Trivial (text) — build first |
| **FCPXML** | Premiere, Resolve, Final Cut. Richer than EDL. | XML — second |
| **OTIO** | Canonical timeline. | JSON — third |
| **AAF** | Avid + Pro Tools audio (carries media/stems). Binary. | Export-only initially |

**Import parsing order:** EDL → FCPXML → OTIO → (AAF later, via a library).
De-risk by proving the loop end-to-end with EDL first.

---

## 6. Media = Git LFS

- A "version" is mostly **pointer changes + new stems/renders**, never a
  re-upload of unchanged footage.
- Store media **content-addressed** (dedupe by hash), reuse
  `tandem_video_asset_files`, and let the existing PROXY / TRANSCRIBE jobs
  rebuild previews.
- `tandem_video_grants` ("stem for external DAW repair") is the existing
  hand-off primitive; extend it into full checkout.

---

## 7. External-first boundaries

In-browser (stays): view proxies, compare/diff, comment at timecode/spatially,
approve/reject, history/log.

External (moves out): anything that changes media or timeline — edits, grades,
mixes, motion, thumbnail design (Photoshop/Figma/Canva).

The browser keeps `AssetPlayer` + the timeline's read-only review mode; it
loses the in-browser editing tools as the primary path (they may remain as a
secondary convenience later — **hybrid was explicitly not chosen**).

---

## 8. Phased implementation plan

| Phase | What | Maps to |
|---|---|---|
| **0. Reframe UI** | Rename legs → stages, `HistoryPanel` → commit log, submissions → pull requests | labels/copy only |
| **1. Checkout (clone)** | Render OTIO/EDL/FCPXML manifest + zip referenced media (or timed grants) → download | new `jobs` type + `asset_files` kind `INTERCHANGE` |
| **2. Commit / PR (push)** | Upload new EDL/FCPXML/OTIO + optional master/stems + commit message → parse into snapshot → `timeline_version` + `submission` | `timeline_versions` + `submissions` (fields already exist) |
| **3. Review / diff** | Timeline text diff (clips added/moved, in/out changes) + side-by-side A/B proxy wipe + pins | `comments` + WORKSPACE-REFERENCE §5.3 wipe |
| **4. Merge / history** | Approve = advance `currentVersionId`, lock snapshot; project commit graph/log; (optional) branches | `submissions` decide + `HistoryPanel` |

**Branch model for free:** PR = submission; branch history = `parentVersionId`
chain; merge = a human approving one version as the new baseline. No auto-merge
(video does not 3-way merge).

---

## 9. Hard problems & mitigations

| Problem | Mitigation |
|---|---|
| Video can't be diffed like text | Diff the timeline/EDL (text); A/B the render. Never pixel-diff. |
| Merge conflicts aren't automatic | Merge = human approve one version as baseline (already the model). |
| Storage growth | Content-addressed media; versions = pointers + new stems/renders. |
| External round-trip friction | Accepted trade-off of external-first; mitigated by timed grants + bundled checkout. |
| AAF parsing complexity | Export-only initially; EDL/FCPXML/OTIO first. |

---

## 10. Review system — timeline & spatial annotations

Review feedback must pinpoint the exact place under discussion.

### Timeline pin (time)

- `tandem_video_comments` already stores `timecodeMs`, `assetId`, `leg`,
  `parentId` (threads), `resolvedAt`; `CommentsPanel` already pins at a
  timestamp.
- Add: **scope pins to a submission/version** (`submissionId` /
  `timelineVersionId`) so each comment belongs to a specific review (PR).

### Spatial pin (frame)

- Add normalized `x, y` (0–1) so a pin renders as a clickable dot **over the
  video at that timecode** (Frame.io-style).
- **Unique color / identifier per reviewer** so multiple reviewers' pins are
  distinguishable.
- Marker rail + clickable pins in the player (click seeks/jumps).

---

## 11. Thumbnail role & 5th leg

Add a **Thumbnail Designer** role and a **THUMBNAIL** leg.

**Key move:** make the thumbnail a **5th leg** (alongside SELECTS / CUT / SOUND /
FINISH — `WORKSPACE-REFERENCE.md` already anticipates splitting Finish). The
thumbnail's "document" (chosen image + annotations + title/style) is just a
`timeline_versions.snapshot` jsonb under `leg: 'THUMBNAIL'`, inheriting
**versioning, submissions, commit log, and review comments for free**.

- **Thumbnail *design* happens externally** (Photoshop/Figma/Canva → upload the
  PNG/JPG).
- **Marking / highlighting is review annotation** (in-browser, same category as
  comments — not editing).
- New `asset_files` kind `THUMBNAIL_DESIGN`, distinct from the auto-extracted
  frame thumbnail.

---

## 12. Unified annotation data model

One annotation primitive serves both video-frame pins (video review) and image
annotations (thumbnail review).

### Extend `tandem_video_comments`

```ts
geometry:    jsonb("geometry"),         // { x, y, w, h } normalized 0..1; null = timecode-only note
kind:        text("kind").notNull().default("TIMECODE"), // TIMECODE | PIN | HIGHLIGHT | MARK
color:       text("color"),             // reviewer's unique color / swatch
label:       text("label"),             // short identifier, e.g. "A", "1", "FIX"
submissionId: text("submission_id"),    // scope the pin to a review/PR
timelineVersionId: text("timeline_version_id"), // optional scope to a version
```

Existing `timecodeMs` + `assetId` stay; `timecodeMs` is null for static-image
(thumbnail) annotations.

### Extend roles & legs

```ts
// roles
tandemVideoRoleSchema = z.enum([
  "CAPTAIN", "UPLOADER", "ARCHITECT", "VISUAL_EDITOR",
  "SOUND_DESIGNER", "MOTION_COLOR", "THUMBNAIL_DESIGNER", "VIEWER",
]);

// legs
VIDEO_LEGS = ["SELECTS", "CUT", "SOUND", "FINISH", "THUMBNAIL"];
```

Also add `THUMBNAIL_DESIGNER` to the invite list (`INVITE_ROLES` in
`vault.tsx`) and the relay shell tabs (`RELAY_LEGS` in `shell.tsx`).

### New asset/job kinds

- `asset_files.kind`: `THUMBNAIL_DESIGN` (designed thumbnail image).
- `job.type`: `INTERCHANGE` / `EXPORT_BUNDLE` (checkout manifest generation).

---

## 13. New components

| Component | Purpose |
|---|---|
| `AnnotationCanvas` | Shared: render image/video frame + SVG overlay of pins/highlights with reviewer color + label; click-to-drop; per-pin thread list. |
| `CheckoutPanel` | Export OTIO/EDL/FCPXML manifest + media bundle (or timed grants). |
| `ImportFlow` | Upload EDL/FCPXML/OTIO + media + commit message → new version + submission. |
| `DiffView` | Timeline text diff + side-by-side A/B proxy wipe. |
| `CommitLog` | Project-level history (version → author → message → parent). |

---

## 14. Open decisions

1. **Thumbnail as 5th leg vs. sub-tab under Finish** — **recommended: 5th leg**
   (free versioning inheritance; everything is keyed by `leg`).
2. **Branches** — current `parentVersionId` chain + submission-as-PR is
   sufficient for v1; explicit named branches are a later enhancement.
3. **AAF import timing** — defer; EDL/FCPXML/OTIO cover the first loop.
4. **Import parser library** — evaluate per-format parsers vs. a shared
   OTIO-based normalizer once EDL is proven.

---

## 15. Next steps

1. **Phase 0 + 1 — checkout bridge:** emit an EDL manifest + media bundle from
   the current CUT timeline to prove the export half of the loop.
2. **Phase 2 — EDL import:** parse an uploaded EDL back into the timeline
   snapshot to close the round-trip.
3. **Phase 3 — review/diff + annotation model** (geometry/kind/color/label).
4. **Thumbnail leg + role + `AnnotationCanvas`.**
