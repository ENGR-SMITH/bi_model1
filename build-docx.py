# -*- coding: utf-8 -*-
"""Generate Tandem Content Creators guide as a .docx (pure OOXML, no deps)."""
import zipfile
import os
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Tandem_Content_Creators_Guide.docx")

# ---------------------------------------------------------------------------
# Document model helpers
# ---------------------------------------------------------------------------

body = []  # list of XML strings

def para(text, style=None, bold=False, italic=False, color=None, size=None, keep_next=False):
    props = []
    if style:
        props.append(f'<w:pStyle w:val="{style}"/>')
    if keep_next:
        props.append('<w:keepNext/>')
    rpr = ""
    if bold or italic or color or size:
        bits = []
        if bold:
            bits.append("<w:b/>")
        if italic:
            bits.append("<w:i/>")
        if color:
            bits.append(f'<w:color w:val="{color}"/>')
        if size:
            bits.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
        rpr = f"<w:rPr>{''.join(bits)}</w:rPr>"
    body.append(
        f'<w:p>{"".join(props)}<w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'
    )

def rich_para(parts, style=None):
    """parts: list of (text, bold, italic, color)"""
    props = f'<w:pStyle w:val="{style}"/>' if style else ""
    runs = []
    for text, bold, italic, color in parts:
        bits = []
        if bold:
            bits.append("<w:b/>")
        if italic:
            bits.append("<w:i/>")
        if color:
            bits.append(f'<w:color w:val="{color}"/>')
        rpr = f"<w:rPr>{''.join(bits)}</w:rPr>" if bits else ""
        runs.append(f"<w:r>{rpr}<w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r>")
    body.append(f'<w:p>{props}{"".join(runs)}</w:p>')

def h1(text):
    para(text, style="Heading1", keep_next=True)

def h2(text):
    para(text, style="Heading2", keep_next=True)

def h3(text):
    para(text, style="Heading3", keep_next=True)

def bullet(text, level=0):
    props = f'<w:pStyle w:val="ListBullet"/>' if level == 0 else f'<w:pStyle w:val="ListBullet2"/>'
    body.append(
        f'<w:p>{props}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'
    )

def numbered(text):
    body.append(
        f'<w:p><w:pStyle w:val="ListNumber"/><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'
    )

def table(rows, widths=None, header=True):
    """rows: list of list of str. widths: list of ints (twips-ish, total 10000)."""
    if widths is None:
        widths = [10000 // len(rows[0])] * len(rows[0])
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    trs = []
    for r_idx, row in enumerate(rows):
        tcs = []
        for c_idx, cell in enumerate(row):
            shade = '<w:shd w:val="clear" w:color="auto" w:fill="F2E7D8"/>' if (header and r_idx == 0) else ""
            bold = header and r_idx == 0
            rpr = "<w:rPr><w:b/></w:rPr>" if bold else ""
            tcs.append(
                f'<w:tc><w:tcPr><w:tcW w:w="{widths[c_idx]}" w:type="dxa"/>{shade}'
                f'<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>'
                f'<w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>'
                f'<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
                f'<w:r>{rpr}<w:t xml:space="preserve">{escape(cell)}</w:t></w:r></w:p></w:tc>'
            )
        trs.append(f"<w:tr>{''.join(tcs)}</w:tr>")
    body.append(
        f'<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10000" w:type="pct"/>'
        f'<w:tblBorders><w:top w:val="single" w:sz="4" w:color="C9BCA6"/><w:left w:val="single" w:sz="4" w:color="C9BCA6"/>'
        f'<w:bottom w:val="single" w:sz="4" w:color="C9BCA6"/><w:right w:val="single" w:sz="4" w:color="C9BCA6"/>'
        f'<w:insideH w:val="single" w:sz="4" w:color="C9BCA6"/><w:insideV w:val="single" w:sz="4" w:color="C9BCA6"/>'
        f'</w:tblBorders></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{"".join(trs)}</w:tbl>'
    )
    body.append('<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>')

def spacer():
    body.append('<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>')

# ---------------------------------------------------------------------------
# Cover / title
# ---------------------------------------------------------------------------

rich_para([("TANDEM", False, True, "E55B4C")], style="Subtitle")
rich_para([("Content Creators — the video room", True, False, None)], style="Title")
para(
    "A complete guide to the pre-recorded content workflow inside Tandem: the four-leg "
    "production relay, every studio, the vault and its Lock, the processing pipeline, "
    "and the realtime layer — how it works and what each feature does.",
    style="Subtitle",
)
spacer()

# ---------------------------------------------------------------------------
# 1. Overview
# ---------------------------------------------------------------------------

h1("1. What Content Creators is")
para(
    "Content Creators is Tandem's dedicated platform for pre-recorded video production. It lives in its own "
    "app called Creators Den, served at /creators-den/ and reached from the Tandem atrium through the "
    "Content Creators category door — the same pattern that sends the writers category to Author Den."
)
para(
    "It turns a raw footage pile into a finished, multi-format master through a four-leg relay: "
    "Selects → Cut → Sound → Finish. Each leg is owned by a role, all of them working the same locked "
    "footage inside one private project room, with a Captain overseeing the whole pipeline. Everything is "
    "realtime: job progress streams into the vault, comments appear live across open studios, and you can "
    "see who is currently editing which leg."
)
rich_para(
    [
        ("The design idea: ", True, False, None),
        ("the original footage never leaves the server. Teams review low-resolution proxies, leave timecode "
         "notes, approve work, and only the Captain's approval releases the master for download.", False, False, None),
    ]
)

h2("1.1 Where it lives")
table(
    [
        ["Layer", "What it is", "URL / path"],
        ["Creators Den app", "The video platform UI (Vite + React)", "/creators-den/"],
        ["The Room", "Project list, create project, notices, relay overview", "/creators-den/"],
        ["The Vault", "One screen per project: assets, team, jobs, grants, audit", "/creators-den/projects/:id"],
        ["Studios", "Selects, Cut, Sound, Finish — one per relay leg", "/creators-den/projects/:id/<studio>"],
        ["API server", "REST endpoints under /api", "/api/video/…"],
        ["Database", "PostgreSQL tables prefixed tandem_", "shared DB with the parent app"],
    ],
    widths=[2400, 5200, 2400],
)

h2("1.2 Who uses it")
table(
    [
        ["Role", "Relay leg", "What they own"],
        ["Captain", "—", "The project owner. Creates the room, invites the team, approves/rejects submissions, grants downloads, releases the Lock."],
        ["Story Architect", "01 · Selects", "Marks golden takes, builds the narrative spine (Hook → Setup → Core → Payoff → CTA), imports reference pacing."],
        ["Visual Editor", "02 · Cut", "Syncs cameras, builds the cut from the selects, adds overlays, renders previews, locks the picture."],
        ["Sound Designer", "03 · Sound", "Runs audio passes, records pickup voiceover, places music with automatic ducking."],
        ["Motion & Color", "04 · Finish", "Grades clips into one look, burns captions, adds lower thirds, queues multi-format exports."],
        ["Uploader / Viewer", "—", "Can view the room and (for uploaders) add footage; cannot edit timelines."],
    ],
    widths=[2200, 1600, 6200],
)

# ---------------------------------------------------------------------------
# 2. Navigation
# ---------------------------------------------------------------------------

h1("2. Getting around")
para(
    "Sign in on Tandem with your Clerk account. From the atrium (dashboard), open the Content Creators "
    "category — it presents an \u201cOpen Creators Den\u201d doorway card. Clicking it lands on the Creators Den "
    "home (The Room), which shares the same identity and the same API, so no second sign-in is needed."
)
para("Inside a project, a relay rail across the top of every screen keeps the five stops one click apart:")
numbered("The Vault — the locked asset room and control centre")
numbered("Selects (01) — Story Architect")
numbered("Cut (02) — Visual Editor")
numbered("Sound (03) — Sound Designer")
numbered("Finish (04) — Motion & Color")
para(
    "A live presence strip sits under the rail: it shows which teammates are in the room and which leg they "
    "are currently editing, updating in realtime over Socket.IO.",
)

# ---------------------------------------------------------------------------
# 3. The Room
# ---------------------------------------------------------------------------

h1("3. The Room (home)")
para("The Room is the landing page after the doorway. It has four parts:")
bullet("The relay overview — four cards, one per leg, summarising the role and its studio.")
bullet("Notices — the notification inbox. Submissions, approvals, grants and releases land here as cards; unread items show a count and are marked read when opened. New ones arrive live without a refresh.")
bullet("New locked room — create a project: name it, add an optional description, and you are dropped straight into its vault.")
bullet("Your rooms — every project you belong to, showing status (e.g. VAULT), creation date, and description.")
para(
    "Projects are private by design. Only invited members can see a room, and the Lock keeps raw footage "
    "viewable-but-not-downloadable until the Captain approves the final master.",
)

# ---------------------------------------------------------------------------
# 4. The Vault
# ---------------------------------------------------------------------------

h1("4. The Vault (per project)")
para(
    "Every project opens on the vault: the locked asset room and the Captain's control centre. The header "
    "shows the project and the Lock banner — while it is on, footage is viewable by the team and downloadable "
    "by no one.",
)

h2("4.1 Assets & upload")
bullet("Upload raw footage, audio, music, or reference material. Each asset records its kind, size, version, and processing status (UPLOADED → PROCESSING → READY → FAILED).")
bullet("Uploads immediately enqueue background jobs: a PROXY (streamable low-res copy) and a TRANSCRIBE (speech-to-text) job. Job status streams into the vault in realtime.")
bullet("When an asset finishes processing, an \u201cOpen the selects studio\u201d link appears on its card.")
bullet("Files are stored server-side; today on local disk, with the data model ready for object storage. The degraded proxy streams to the player — the original never leaves the server.")

h2("4.2 Team & roles")
bullet("The Captain can invite teammates by email (must be a Tandem account) and assign a role: Architect, Visual Editor, Sound Designer, Motion & Color, or uploader.")
bullet("Members see the roster on the vault; each member card shows the role label.")

h2("4.3 Background jobs")
bullet("The job progress panel lists the recent jobs for the project (PROXY, TRANSCRIBE, SYNC, RENDER, AUDIO, EXPORT, THUMBNAIL, REFERENCE_ANALYZE) with live status dots and a running count.")
bullet("Progress arrives over the realtime socket — the panel updates without a page reload.")

h2("4.4 Submissions & approvals")
bullet("Each leg hands its work to the Captain as a submission (pins the current timeline snapshot plus an optional note).")
bullet("The Captain approves or rejects each submission from the vault; the decision streams to the submitting studio and sends the submitter a notification.")

h2("4.5 Temporary download grants")
bullet("While the Lock is on, the Captain can grant a specific member temporary download access to a specific file — with a reason and an expiry (1–168 hours).")
bullet("Grants are revoked instantly, and every download is written to the audit trail (who, what, when) for accountability.")

h2("4.6 Download audit")
bullet("A running log of every file download in the project, used to trace who took what after a release.")

# ---------------------------------------------------------------------------
# 5. Selects studio
# ---------------------------------------------------------------------------

h1("5. Studio 01 — Selects (Story Architect)")
para(
    "The selects studio builds the paper edit. The Architect works from the transcript and the proxy player "
    "to mark the golden takes and shape the story."
)
h2("Features")
bullet("Transcript panel — the auto-generated transcript of each asset, searchable; click a line to seek the proxy player, mark it as a select, or comment at that exact timecode.")
bullet("Proxy player — streams the degraded proxy; the playhead drives the transcript and comment pinning.")
bullet("Selects builder — every marked line becomes a clip (with in/out timecodes) in the paper edit; remove any pick.")
bullet("Scene blocks — organise the selects into the narrative spine: HOOK, SETUP, CORE, PAYOFF, CTA.")
bullet("Reference guide — analyse a reference asset to extract its pacing structure (scene changes + transcript sections) and view its beats side-by-side while cutting.")
bullet("Timeline snapshots — save the working document with a message; every save creates a version (Git-style), and any version can be rolled back to.")
bullet("Submit — pin the current head snapshot and hand the leg to the Captain with a note.")
bullet("Timecode notes — the shared comment stream, pinned to timecodes, resolvable by anyone. New notes appear live in every open studio.")

# ---------------------------------------------------------------------------
# 6. Cut studio
# ---------------------------------------------------------------------------

h1("6. Studio 02 — Cut (Visual Editor)")
para("The cut studio tightens the picture. It inherits the Architect's beat markers and adds precision cutting.")
h2("Features")
bullet("Beat markers — the scene blocks from the selects pass, shown as clickable markers over the timeline.")
bullet("Multi-cam sync — align two angles by waveform. Pick a primary and a target; the sync worker cross-correlates the audio and reports the offset (how the second camera sits against the first) so switches land on the same moment.")
bullet("Cut builder — a main track of clips with trim controls (nudge in/out), plus overlay clips (B-roll, inserts) layered on top.")
bullet("Proxy player — review the cut in the browser; the locked original never leaves the server.")
bullet("Render preview — render the current cut so the Captain reviews the picture, not the JSON. Submitting this leg also queues a picture-lock render automatically.")
bullet("Timeline snapshots, versions, rollback, comments, and submission — the same shared mechanics as Selects.")

# ---------------------------------------------------------------------------
# 7. Sound studio
# ---------------------------------------------------------------------------

h1("7. Studio 03 — Sound (Sound Designer)")
para("The sound studio restores and scores the audio track.")
h2("Features")
bullet("Audio passes — one-click background passes (e.g. denoise, de-ess, compression, limiting) that run in the worker; applied passes are marked on the panel.")
bullet("Pickup voiceover — flag a bad take, record a replacement line straight in the browser (mic → upload), and it lands as a VO_PICKUP asset pinned to a timecode in the timeline.")
bullet("Music & score — add music or SFX tracks from the vault assets; every track is placed with automatic duck-under-speech, toggleable per track.")
bullet("Timeline snapshots, versions, rollback, comments, and submission — shared with every studio.")

# ---------------------------------------------------------------------------
# 8. Finish studio
# ---------------------------------------------------------------------------

h1("8. Studio 04 — Finish (Motion & Color)")
para("The finish studio polishes the locked picture and produces the deliverables.")
h2("Features")
bullet("Per-clip grade nodes — match every clip into one look with exposure, warmth, and a LUT per clip, so footage shot at different times sits together.")
bullet("Captions — burned in from the Leg 1 transcript (never re-transcribed), with style presets and an enable toggle.")
bullet("Lower thirds — add name/title cards (e.g. Ada Lovelace / Software Pioneer) to the timeline.")
bullet("Thumbnail frame — mark a frame and extract a thumbnail via the worker.")
bullet("Multi-format export — pick the delivery formats, queue the exports, and watch their status stream in. The export panel also shows the latest export's result.")
bullet("Timeline snapshots, versions, rollback, comments, and submission — shared with every studio.")
para(
    "When the Captain approves the Finish submission, the Lock releases: the room moves toward LOCK_RELEASED "
    "→ COMPLETE and the final masters become downloadable, with every download written to the audit trail.",
)

# ---------------------------------------------------------------------------
# 9. The processing pipeline
# ---------------------------------------------------------------------------

h1("9. How the processing pipeline works")
para(
    "Every heavy operation — proxy creation, transcription, camera sync, renders, audio passes, exports, "
    "thumbnails, reference analysis — is a background job. The API writes a row into the tandem_video_jobs "
    "table (the source of truth the UI reads) and claims the work through a Redis-backed BullMQ queue."
)
h2("9.1 Job types and queues")
table(
    [
        ["Job type", "Queue", "What it produces"],
        ["PROXY", "tandem-video-proxy", "Streamable low-res proxy for the player"],
        ["TRANSCRIBE", "tandem-video-transcribe", "Transcript + segments for Selects/Captions"],
        ["SYNC", "tandem-video-sync", "Waveform-based camera sync offset"],
        ["RENDER", "tandem-video-render", "Preview / picture-lock renders"],
        ["AUDIO", "tandem-video-audio", "Applied audio passes"],
        ["EXPORT", "tandem-video-export", "Delivery-format masters"],
        ["THUMBNAIL", "tandem-video-thumbnail", "Poster frame extraction"],
        ["REFERENCE_ANALYZE", "tandem-video-reference-analyze", "Reference pacing structure"],
    ],
    widths=[2600, 3300, 4100],
)
para(
    "Each job type has its own queue and its own worker process — the worker fleet can be scaled per "
    "capability (proxy/transcribe/sync/render/audio/finish/reference), matching the blueprint's architecture. "
    "Jobs get up to 3 attempts with exponential backoff; a job that still fails is marked FAILED with its error "
    "surfaced in the vault."
)
para(
    "When REDIS_URL is set, the API runs in BullMQ mode: it attaches a progress bridge that forwards worker "
    "progress to Socket.IO, and the worker processes (dist/workers/*) pick jobs off Redis. Without Redis, the "
    "API falls back to an in-process polling loop, so local development and tests run with zero extra services."
)

# ---------------------------------------------------------------------------
# 10. The realtime layer
# ---------------------------------------------------------------------------

h1("10. The realtime layer (Socket.IO)")
para(
    "A Socket.IO server rides on the API's HTTP server, authenticated with the same Clerk JWT the REST "
    "middleware trusts. The frontend opens one authenticated connection per app; each project page joins its "
    "project room with presence (which leg the user is in)."
)
h2("10.1 Events the UI listens to")
table(
    [
        ["Event", "What it does"],
        ["job.progress", "Streams job state changes (QUEUED/RUNNING/SUCCEEDED/FAILED) into the vault"],
        ["asset.uploaded / asset.processed", "Refreshes the asset cards as files flip to PROCESSED"],
        ["comment.new / comment.updated", "Live timecode notes in every open studio"],
        ["submission.new / submission.decided", "Live submission state and project refresh"],
        ["timeline.saved", "Refreshes timelines/syncs when someone saves a snapshot"],
        ["grant.created / grant.revoked", "Live grants and download-audit updates"],
        ["notification.new", "Streams the signed-in user's notices to the Room inbox"],
        ["presence.roster / presence.updated", "The live \u201cwho is editing which leg\u201d strip"],
    ],
    widths=[3300, 6700],
)
para(
    "Realtime events invalidate the right React Query caches, so studios update without manual refreshes — "
    "verified end-to-end in the browser with two signed-in accounts: a teammate's note appears in an open "
    "studio over the socket with no reload.",
)

# ---------------------------------------------------------------------------
# 11. Data model
# ---------------------------------------------------------------------------

h1("11. The data model")
para("All tables are prefixed tandem_ so they never collide with the parent app's tables. The core ones:")
table(
    [
        ["Table", "Purpose"],
        ["tandem_video_projects", "One row per room: name, description, status (VAULT → IN_PRODUCTION → LOCK_RELEASED → COMPLETE), owner"],
        ["tandem_video_members", "Who is in the room and their role; the Captain is the owner"],
        ["tandem_video_assets", "Raw assets in the vault: kind, file name, size, storage key, status, version"],
        ["tandem_video_asset_files", "Every physical artifact per asset: ORIGINAL, PROXY, TRANSCRIPT, AUDIO_STEM, THUMBNAIL, RENDER…"],
        ["tandem_video_transcripts / _segments", "Speech-to-text output with per-line timecodes, speakers, and search"],
        ["tandem_video_timelines / _versions", "Per-leg working document with Git-style snapshots; every save is a version"],
        ["tandem_video_submissions", "Leg deliverables: DRAFT → SUBMITTED → APPROVED / REJECTED, with note and decision trail"],
        ["tandem_video_comments", "Timecode notes pinned to a leg and/or asset, resolvable"],
        ["tandem_video_syncs", "Camera sync pairs with the computed waveform offset and method"],
        ["tandem_video_references", "Reference analysis: status and extracted pacing structure"],
        ["tandem_video_grants", "Temporary download grants: file, member, reason, expiry, revoke timestamp"],
        ["tandem_video_downloads", "The download audit trail — who took what, when"],
        ["tandem_video_notifications", "The notices inbox (mirrors the parent's notification conventions)"],
        ["tandem_video_jobs", "The background job queue rows — the contract between API, worker, and UI"],
    ],
    widths=[3600, 6400],
)

# ---------------------------------------------------------------------------
# 12. API surface
# ---------------------------------------------------------------------------

h1("12. The API surface")
para("The video API lives under /api/video and is grouped into four routers:")
bullet("video.ts — projects, members, assets, upload, proxy streaming, sync, reference analyze.")
bullet("video-production.ts — timelines (save/versions/rollback), submissions (create/approve/reject), comments (create/resolve), jobs.")
bullet("video-finish.ts — audio passes, renders, exports, thumbnails.")
bullet("video-platform.ts — grants (create/revoke), downloads (audit + gated file download), notifications.")
para("Selected endpoints:")
table(
    [
        ["Method", "Path", "Purpose"],
        ["GET/POST", "/api/video/projects", "List / create rooms"],
        ["GET", "/api/video/projects/:projectId", "Room detail: members, assets, my role"],
        ["POST", "/api/video/projects/:projectId/assets", "Upload footage (enqueues PROXY + TRANSCRIBE)"],
        ["GET", "/api/video/projects/:projectId/assets/:assetId/proxy", "Stream the degraded proxy"],
        ["POST", "/api/video/projects/:projectId/members", "Invite a teammate (Captain only)"],
        ["GET/PUT", "/api/video/projects/:projectId/timelines/:leg", "Read / save a leg's timeline"],
        ["GET", "/api/video/projects/:projectId/timelines/:leg/versions", "Snapshot history"],
        ["POST", "/api/video/projects/:projectId/timelines/:leg/rollback", "Roll back to a version"],
        ["POST", "/api/video/projects/:projectId/submissions", "Submit a leg for review"],
        ["POST", "/api/video/projects/:projectId/submissions/:id/approve|reject", "Captain's decision"],
        ["GET/POST", "/api/video/projects/:projectId/comments", "List / create timecode notes"],
        ["POST", "/api/video/projects/:projectId/assets/:assetId/sync", "Queue camera sync"],
        ["POST", "/api/video/projects/:projectId/audio", "Queue an audio pass"],
        ["POST", "/api/video/projects/:projectId/exports", "Queue multi-format exports"],
        ["POST", "/api/video/projects/:projectId/thumbnail", "Extract a thumbnail"],
        ["GET", "/api/video/projects/:projectId/jobs", "Background job states"],
        ["GET/POST", "/api/video/projects/:projectId/grants", "List / create download grants"],
        ["POST", "/api/video/projects/:projectId/grants/:id/revoke", "Revoke a grant instantly"],
        ["GET", "/api/video/projects/:projectId/downloads", "Download audit trail"],
        ["GET", "/api/video/notifications", "The signed-in user's notices"],
    ],
    widths=[1800, 4600, 3600],
)

# ---------------------------------------------------------------------------
# 13. Security & permissions
# ---------------------------------------------------------------------------

h1("13. Security and permissions")
bullet("Identity is Clerk — the same accounts as the rest of Tandem; every route and socket handshake verifies the session token.")
bullet("Every video route checks membership: you can only read a room you belong to.")
bullet("Captain-only actions are enforced server-side: inviting members, approving/rejecting submissions, creating and revoking grants.")
bullet("The Lock is enforced at download time: only files with an active grant (or a released Lock) can be downloaded, and every download is audited.")
bullet("Edits are role-scoped in the UI (each leg's timeline is editable by its role), and the original footage is never streamed — only the degraded proxy.")

# ---------------------------------------------------------------------------
# 14. Running it
# ---------------------------------------------------------------------------

h1("14. Running the platform locally")
para("The stack is three services plus a database:")
table(
    [
        ["Service", "Command (from parent-app)"],
        ["API server (port 3000)", "cd artifacts/api-server && node dist/index.mjs  (needs .env with DATABASE_URL + Clerk keys)"],
        ["Tandem app (port 5173)", "cd artifacts/tandem && MSYS_NO_PATHCONV=1 PORT=5173 BASE_PATH=/ npx vite"],
        ["Creators Den (port 5175)", "cd artifacts/creators-den && MSYS_NO_PATHCONV=1 PORT=5175 BASE_PATH=/creators-den/ npx vite"],
        ["BullMQ worker fleet (optional)", "export REDIS_URL=redis://localhost:6379 && pnpm --filter @workspace/api-server run workers"],
    ],
    widths=[3200, 6800],
)
para(
    "Without REDIS_URL the API falls back to its in-process worker, so the platform runs with just Postgres. "
    "Each Vite app needs a .env with VITE_CLERK_PUBLISHABLE_KEY (copied from the root .env). The doorway is "
    "reached at http://localhost:5173/categories/content-creators → \u201cOpen Creators Den\u201d.",
)

h2("14.1 Testing")
bullet("101 automated tests cover the collaboration and video API surfaces, plus the realtime layer (socket auth + safe emits) and the BullMQ queue wiring.")
bullet("An end-to-end browser walkthrough (e2e-bullmq.py) signs in two real accounts and drives the full pipeline: create → upload → jobs SUCCEEDED live → invite → cross-account live comment over Socket.IO.")

# ---------------------------------------------------------------------------
# 15. Status
# ---------------------------------------------------------------------------

h1("15. Feature status at a glance")
table(
    [
        ["Feature", "Status"],
        ["Four-leg relay (Selects, Cut, Sound, Finish)", "Implemented"],
        ["Vault, Lock, uploads, proxy streaming", "Implemented"],
        ["Transcript + search + selects + scene blocks", "Implemented"],
        ["Timeline snapshots, versions, rollback", "Implemented"],
        ["Submissions + approve/reject", "Implemented"],
        ["Timecode comments (live)", "Implemented"],
        ["Multi-cam sync (waveform)", "Implemented"],
        ["Render preview + picture lock", "Implemented"],
        ["Audio passes + pickup VO + music ducking", "Implemented"],
        ["Grade, captions, lower thirds, multi-format export", "Implemented"],
        ["Download grants + audit trail", "Implemented"],
        ["Notifications inbox (live)", "Implemented"],
        ["Realtime presence + progress (Socket.IO)", "Implemented"],
        ["BullMQ worker fleet (Redis)", "Implemented"],
        ["Chunked/resumable uploads", "Blueprint — not yet built"],
        ["MinIO / S3 object storage", "Blueprint — not yet built"],
    ],
    widths=[7200, 2800],
)

# ---------------------------------------------------------------------------
# Assemble the package
# ---------------------------------------------------------------------------

def esc_attr(s):
    return escape(s, {'"': "&quot;"})

doc_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    {''.join(body)}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"""

content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""

rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""

document_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""

styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>
    <w:pPr><w:spacing w:before="240" w:after="240"/><w:keepNext/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/><w:color w:val="292B45"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/>
    <w:pPr><w:spacing w:after="240"/><w:keepNext/></w:pPr>
    <w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="625F6D"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
    <w:pPr><w:spacing w:before="360" w:after="120"/><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="E55B4C"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
    <w:pPr><w:spacing w:before="280" w:after="100"/><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="286254"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
    <w:pPr><w:spacing w:before="220" w:after="80"/><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="23"/><w:szCs w:val="23"/><w:color w:val="292B45"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="360" w:hanging="180"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet2"><w:name w:val="List Bullet 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720" w:hanging="180"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>
    <w:tblPr><w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="C9BCA6"/><w:left w:val="single" w:sz="4" w:color="C9BCA6"/>
      <w:bottom w:val="single" w:sz="4" w:color="C9BCA6"/><w:right w:val="single" w:sz="4" w:color="C9BCA6"/>
      <w:insideH w:val="single" w:sz="4" w:color="C9BCA6"/><w:insideV w:val="single" w:sz="4" w:color="C9BCA6"/>
    </w:tblBorders></w:tblPr>
  </w:style>
</w:styles>"""

core = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Tandem Content Creators — the video room</dc:title>
  <dc:subject>Content Creators platform guide</dc:subject>
  <dc:creator>Tandem</dc:creator>
  <cp:lastModifiedBy>Tandem</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-08-17T00:00:00Z</dcterms:created>
</cp:coreProperties>"""

app = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Tandem</Application>
</Properties>"""

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("_rels/.rels", rels)
    z.writestr("word/document.xml", doc_xml)
    z.writestr("word/styles.xml", styles)
    z.writestr("word/_rels/document.xml.rels", document_rels)
    z.writestr("docProps/core.xml", core)
    z.writestr("docProps/app.xml", app)

print("Wrote", OUT, os.path.getsize(OUT), "bytes")
