// ---------------------------------------------------------------------------
// EDL checkout — turn a leg's timeline snapshot into a CMX3600 EDL (and a
// media manifest) so the editor can open the cut in an external NLE (Premiere,
// Resolve, Avid…), finish it there, and re-import it (the push half of the
// round-trip).
//
// CMX3600 is single-track, so the EDL carries the main `clips` rail only;
// overlays / scene blocks / markers are out of scope for this format (they
// arrive with FCPXML / OTIO later). Source clips are referenced by a
// sanitised "reel" name derived from the file name, with the full asset id
// preserved in `* FROM CLIP` comments so a human (or the re-import parser)
// can relink media exactly.
// ---------------------------------------------------------------------------

/** Frame rate used for EDL timecode. PAL default; overridable per call. */
export const EDL_FPS = 25;

/** A timeline clip with the fields the CUT (and SELECTS) snapshot exposes. */
export interface EdlClip {
  id: string;
  assetId: string;
  /** Record (timeline) in/out. */
  inMs: number;
  outMs: number;
  /** Source-window in/out; defaults to inMs/outMs when absent. */
  srcInMs?: number;
  srcOutMs?: number;
}

export interface EdlAssetRef {
  fileName: string;
  kind: string;
}

export interface CheckoutMediaItem {
  assetId: string;
  fileName: string;
  kind: string;
  reel: string;
  clipIds: string[];
  firstInMs: number;
  lastOutMs: number;
}

/** `123456` ms → `HH:MM:SS:FF` (non-drop frame). */
export function formatEdlTimecode(ms: number, fps: number = EDL_FPS): string {
  const totalFrames = Math.max(0, Math.round((ms / 1000) * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** Turn a file name into a safe CMX3600 reel label. */
export function sanitizeReel(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, "");
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_");
  return (cleaned || "CLIP").slice(0, 32).toUpperCase();
}

function cleanTitle(title: string): string {
  return title.replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Untitled";
}

/**
 * Build a CMX3600 EDL string for a timeline snapshot. `clips` are emitted in
 * record (timeline) order; each event carries a `* FROM CLIP` comment with the
 * source file name + asset id, and the trailer lists the full media manifest
 * as comments so the single `.edl` file is self-describing.
 */
export function buildTimelineEdl(args: {
  title: string;
  version?: number | null;
  clips: EdlClip[];
  assetById: Map<string, EdlAssetRef>;
  fps?: number;
}): string {
  const fps = args.fps ?? EDL_FPS;
  const lines: string[] = [];

  lines.push(`TITLE: ${cleanTitle(args.title)}`);
  lines.push("FCM: NON-DROP FRAME");
  lines.push("");

  const clips = [...args.clips].sort((a, b) => (a.inMs ?? 0) - (b.inMs ?? 0));

  clips.forEach((clip, index) => {
    const asset = args.assetById.get(clip.assetId ?? "");
    const reel = asset ? sanitizeReel(asset.fileName) : sanitizeReel(clip.assetId ?? "clip");

    const srcIn = formatEdlTimecode(clip.srcInMs ?? clip.inMs ?? 0, fps);
    const srcOut = formatEdlTimecode(clip.srcOutMs ?? clip.outMs ?? 0, fps);
    const recIn = formatEdlTimecode(clip.inMs ?? 0, fps);
    const recOut = formatEdlTimecode(clip.outMs ?? 0, fps);

    const eventNo = String(index + 1).padStart(3, "0");
    lines.push(
      `${eventNo}  ${reel.padEnd(12, " ")} V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`,
    );
    lines.push(`* FROM CLIP NAME: ${asset?.fileName ?? clip.assetId ?? clip.id}`);
    lines.push(`* FROM CLIP: ${clip.assetId ?? clip.id}`);
    lines.push("");
  });

  lines.push(`* MEDIA MANIFEST (v${args.version ?? 0})`);
  const manifest = buildCheckoutManifest(clips, args.assetById);
  manifest.forEach((item, index) => {
    lines.push(
      `* ${String(index + 1).padStart(3, "0")} ${item.fileName} [${item.kind}] assetId=${item.assetId}`,
    );
  });

  return lines.join("\n");
}

/** The referenced source media for a checkout (deduped, in first-use order). */
export function buildCheckoutManifest(
  clips: EdlClip[],
  assetById: Map<string, EdlAssetRef>,
): CheckoutMediaItem[] {
  const byAsset = new Map<string, CheckoutMediaItem>();

  for (const clip of clips) {
    const assetId = clip.assetId ?? "";
    if (!assetId) continue;
    const asset = assetById.get(assetId);
    const existing = byAsset.get(assetId);
    if (existing) {
      existing.clipIds.push(clip.id);
      existing.firstInMs = Math.min(existing.firstInMs, clip.inMs ?? 0);
      existing.lastOutMs = Math.max(existing.lastOutMs, clip.outMs ?? 0);
    } else {
      byAsset.set(assetId, {
        assetId,
        fileName: asset?.fileName ?? assetId,
        kind: asset?.kind ?? "RAW_VIDEO",
        reel: sanitizeReel(asset?.fileName ?? assetId),
        clipIds: [clip.id],
        firstInMs: clip.inMs ?? 0,
        lastOutMs: clip.outMs ?? 0,
      });
    }
  }

  return [...byAsset.values()];
}

// ---------------------------------------------------------------------------
// EDL import — parse an external CMX3600 EDL back into timeline clips and
// relink its sources to vault assets (the push half of the round-trip).
// ---------------------------------------------------------------------------

export interface ParsedEdlEvent {
  eventNumber: number;
  reel: string;
  srcInMs: number;
  srcOutMs: number;
  recInMs: number;
  recOutMs: number;
  /** From a `* FROM CLIP NAME:` comment (the source file name). */
  fromClipName?: string;
  /** From a `* FROM CLIP:` comment (our asset id when we emitted the EDL). */
  fromClipId?: string;
}

export interface EdlSourceAsset {
  id: string;
  fileName: string;
}

/** `HH:MM:SS:FF` (non-drop frame) → milliseconds. */
export function parseEdlTimecode(tc: string, fps: number = EDL_FPS): number {
  const match = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/.exec(tc.trim());
  if (!match) throw new Error(`Invalid EDL timecode: "${tc}"`);
  const [, hh, mm, ss, ff] = match;
  const totalMs = (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * 1000;
  return totalMs + Math.round((Number(ff) * 1000) / fps);
}

// `001  REEL        V     C        srcIn srcOut recIn recOut` — reel is a
// single non-space token (the sanitised form we emit, and the common form for
// NLE exports). Track/transition are captured but unused for a CUT import.
const EDL_EVENT_RE =
  /^(\d{3,})\s+(\S+)\s+(V\d*|A\d*|B\d*)\s+(\S+)\s+(\d{2}:\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2}:\d{2})\s*$/;

/** Parse CMX3600 text into ordered edit events (with comment metadata). */
export function parseTimelineEdl(text: string, fps: number = EDL_FPS): ParsedEdlEvent[] {
  const events: ParsedEdlEvent[] = [];
  let current: ParsedEdlEvent | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const eventMatch = EDL_EVENT_RE.exec(line);
    if (eventMatch) {
      const [, eventNo, reel, , , srcIn, srcOut, recIn, recOut] = eventMatch;
      current = {
        eventNumber: Number(eventNo),
        reel,
        srcInMs: parseEdlTimecode(srcIn, fps),
        srcOutMs: parseEdlTimecode(srcOut, fps),
        recInMs: parseEdlTimecode(recIn, fps),
        recOutMs: parseEdlTimecode(recOut, fps),
      };
      events.push(current);
      continue;
    }

    const clipName = /^\*\s*FROM CLIP NAME:\s*(.+?)\s*$/.exec(line);
    if (clipName && current) {
      current.fromClipName = clipName[1];
      continue;
    }

    const clipId = /^\*\s*FROM CLIP:\s*(.+?)\s*$/.exec(line);
    if (clipId && current) {
      current.fromClipId = clipId[1];
    }
  }

  return events;
}

/** Normalise a source name/reel for relinking (strip extension, fold case). */
export function normalizeSourceName(name: string): string {
  return name.replace(/\.[^.]*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Relink parsed events to vault assets by asset id (from our own comments),
 * then source file name, then reel. Returns CUT clips in record order plus
 * the list of sources that could not be matched.
 */
export function resolveEdlEvents(
  events: ParsedEdlEvent[],
  assets: EdlSourceAsset[],
): { clips: EdlClip[]; unresolved: string[] } {
  const byId = new Map(assets.map((asset) => [asset.id, asset.id]));
  const byName = new Map(
    assets.map((asset) => [normalizeSourceName(asset.fileName), asset.id]),
  );

  const clips: EdlClip[] = [];
  const unresolved: string[] = [];

  const sorted = [...events].sort((a, b) => a.recInMs - b.recInMs);

  for (const event of sorted) {
    let assetId: string | undefined;
    if (event.fromClipId && byId.has(event.fromClipId)) {
      assetId = event.fromClipId;
    } else if (event.fromClipName) {
      assetId = byName.get(normalizeSourceName(event.fromClipName));
    }
    if (!assetId) {
      assetId = byName.get(normalizeSourceName(event.reel));
    }

    if (!assetId) {
      unresolved.push(event.fromClipName ?? event.reel);
      continue;
    }

    clips.push({
      id: `import-${event.eventNumber}`,
      assetId,
      inMs: event.recInMs,
      outMs: event.recOutMs,
      srcInMs: event.srcInMs,
      srcOutMs: event.srcOutMs,
    });
  }

  return { clips, unresolved };
}
