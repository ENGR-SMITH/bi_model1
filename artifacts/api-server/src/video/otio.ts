// ---------------------------------------------------------------------------
// OTIO interchange — the canonical rung of the format ladder (VCS design §4:
// "EDL first → FCPXML → OTIO (canonical); AAF export-only"). OpenTimelineIO is
// the neutral, JSON-based timeline format that Premiere, Resolve, and Avid can
// all round-trip through, so it is the interchange of record.
//
// Same contract as edl.ts / fcpxml.ts: build a leg snapshot → an OTIO document,
// parse an edited document back, relink its sources to vault assets. Times are
// OTIO RationalTime (frame value + rate, 25fps like the other formats);
// source identity round-trips through `metadata.assetId`, with `target_url`
// basename relinking as the fallback for documents from other tools.
//
// Because OTIO is JSON there is no XML to tokenize — `JSON.parse` + a small
// walk of the video track handles it.
// ---------------------------------------------------------------------------

import { normalizeSourceName, type EdlAssetRef, type EdlClip } from "./edl";

/** Frame rate used for OTIO times (PAL default, like EDL/FCPXML). */
export const OTIO_FPS = 25;

export interface OtioSourceAsset {
  id: string;
  fileName: string;
}

export interface ParsedOtioClip {
  eventNumber: number;
  /** Clip `name` (usually the source file name). */
  name?: string;
  /** `media_references.target_url` — the source URL. */
  targetUrl?: string;
  /** `metadata.assetId` — our asset id on round-trips. */
  assetId?: string;
  /** Record (timeline) in-point, ms — accumulated from prior track items. */
  offsetMs: number;
  durationMs: number;
  /** Source in-point, ms. */
  startMs: number;
}

// ---------------------------------------------------------------------------
// Time helpers — OTIO stores RationalTime as `{ rate, value }` where `value`
// is in frames at `rate`. 25fps → 40ms per frame.
// ---------------------------------------------------------------------------

function frames(ms: number, fps: number): number {
  return Math.max(0, Math.round((ms / 1000) * fps));
}

interface RationalTimeLike {
  value?: unknown;
  rate?: unknown;
}

function msFromRationalTime(time: RationalTimeLike | null | undefined, fallbackRate: number): number {
  if (!time) return 0;
  const value = Number(time.value ?? 0);
  const rate = Number(time.rate ?? fallbackRate) || fallbackRate;
  return Math.round((value / rate) * 1000);
}

// ---------------------------------------------------------------------------
// Build — snapshot → OTIO Timeline.1
// ---------------------------------------------------------------------------

/**
 * Build an OTIO `Timeline.1` JSON document for a timeline snapshot. Clips are
 * emitted in record order on a single video track (matching the EDL/FCPXML
 * single-rail scope); each source becomes an `ExternalReference` whose
 * `target_url` names the vault file. The asset id rides in `metadata.assetId`
 * so a round-trip re-import relinks exactly.
 */
export function buildTimelineOtio(args: {
  title: string;
  version?: number | null;
  clips: EdlClip[];
  assetById: Map<string, EdlAssetRef>;
  fps?: number;
}): string {
  const fps = args.fps ?? OTIO_FPS;
  const clips = [...args.clips].sort((a, b) => (a.inMs ?? 0) - (b.inMs ?? 0));

  const clipObjects = clips.map((clip) => {
    const assetId = clip.assetId ?? clip.id;
    const asset = args.assetById.get(assetId);
    const name = asset?.fileName ?? assetId;
    return {
      OTIO_SCHEMA: "Clip.1",
      name,
      source_range: {
        OTIO_SCHEMA: "TimeRange.1",
        start_time: {
          OTIO_SCHEMA: "RationalTime.1",
          rate: fps,
          value: frames(clip.srcInMs ?? clip.inMs ?? 0, fps),
        },
        duration: {
          OTIO_SCHEMA: "RationalTime.1",
          rate: fps,
          value: frames((clip.outMs ?? 0) - (clip.inMs ?? 0), fps),
        },
      },
      media_references: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: `file:///vault/${name}`,
        available_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
          duration: {
            OTIO_SCHEMA: "RationalTime.1",
            rate: fps,
            value: frames(clip.srcOutMs ?? clip.outMs ?? 0, fps),
          },
        },
      },
      metadata: { assetId },
    };
  });

  const timeline = {
    OTIO_SCHEMA: "Timeline.1",
    metadata: {
      creatorsDen: {
        version: args.version ?? 0,
      },
    },
    name: args.title,
    global_start_time: null,
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      children: [
        {
          OTIO_SCHEMA: "Track.1",
          kind: "Video",
          children: clipObjects,
        },
      ],
    },
  };

  return `${JSON.stringify(timeline, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Parse — an edited OTIO document back into spine clips
// ---------------------------------------------------------------------------

/**
 * Parse an OTIO `Timeline.1` JSON document into ordered clips. Only the video
 * track is read (matching the EDL/FCPXML single-rail scope); non-clip items
 * (gaps, transitions, nested stacks) still advance the record cursor so the
 * clips' record positions stay correct.
 */
export function parseTimelineOtio(json: string): ParsedOtioClip[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new Error("Invalid OTIO document — expected JSON");
  }
  if (!doc || typeof doc !== "object") throw new Error("Invalid OTIO document");

  const stack = (doc as { tracks?: { children?: unknown[] } }).tracks?.children ?? [];
  const clips: ParsedOtioClip[] = [];
  let eventNumber = 0;

  for (const rawTrack of stack) {
    const track = rawTrack as { kind?: string; children?: unknown[] };
    if (track.kind !== "Video") continue;
    const fallbackRate = OTIO_FPS;
    let cursorMs = 0;

    for (const rawItem of track.children ?? []) {
      const item = rawItem as {
        OTIO_SCHEMA?: string;
        name?: unknown;
        source_range?: { start_time?: RationalTimeLike; duration?: RationalTimeLike };
        media_references?: { target_url?: unknown };
        metadata?: { assetId?: unknown };
      };
      const durationMs = msFromRationalTime(item.source_range?.duration ?? null, fallbackRate);

      if (item.OTIO_SCHEMA === "Clip.1") {
        const startMs = msFromRationalTime(item.source_range?.start_time ?? null, fallbackRate);
        clips.push({
          eventNumber: ++eventNumber,
          name: typeof item.name === "string" ? item.name : undefined,
          targetUrl: typeof item.media_references?.target_url === "string" ? item.media_references.target_url : undefined,
          assetId: typeof item.metadata?.assetId === "string" ? item.metadata.assetId : undefined,
          offsetMs: cursorMs,
          durationMs,
          startMs,
        });
      }

      cursorMs += durationMs;
    }
  }

  return clips;
}

// ---------------------------------------------------------------------------
// Relink — parsed clips → timeline clips against vault assets
// ---------------------------------------------------------------------------

function basenameOf(url: string): string {
  return url.replace(/^file:\/\/\//, "").split(/[\\/]/).pop() ?? url;
}

/**
 * Relink parsed OTIO clips to vault assets by asset id (`metadata.assetId` on
 * round-trips), then by source file name (from `target_url` / clip name).
 * Returns timeline clips in record order plus the unmatched sources.
 */
export function resolveOtioEvents(
  events: ParsedOtioClip[],
  assets: OtioSourceAsset[],
): { clips: EdlClip[]; unresolved: string[] } {
  const byId = new Map(assets.map((asset) => [asset.id, asset.id]));
  const byName = new Map(
    assets.map((asset) => [normalizeSourceName(asset.fileName), asset.id]),
  );

  const clips: EdlClip[] = [];
  const unresolved: string[] = [];

  const sorted = [...events].sort((a, b) => a.offsetMs - b.offsetMs);

  for (const event of sorted) {
    let assetId: string | undefined;
    if (event.assetId && byId.has(event.assetId)) {
      assetId = event.assetId;
    }
    if (!assetId) {
      const name = event.targetUrl ? basenameOf(event.targetUrl) : event.name;
      if (name) assetId = byName.get(normalizeSourceName(name));
    }

    if (!assetId) {
      unresolved.push(event.targetUrl ?? event.name ?? event.assetId ?? "unknown");
      continue;
    }

    clips.push({
      id: `import-${event.eventNumber}`,
      assetId,
      inMs: event.offsetMs,
      outMs: event.offsetMs + event.durationMs,
      srcInMs: event.startMs,
      srcOutMs: event.startMs + event.durationMs,
    });
  }

  return { clips, unresolved };
}
