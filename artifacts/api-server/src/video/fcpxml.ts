// ---------------------------------------------------------------------------
// FCPXML interchange — the second rung of the format ladder (VCS design §4:
// "EDL first → FCPXML → OTIO (canonical); AAF export-only"). Where CMX3600 EDL
// is a single-track tape format, FCPXML is what Premiere and Final Cut natively
// export, so this is the interchange an external-first round-trip actually
// wants. Same contract as edl.ts: build a leg snapshot → an interchange
// document, parse an edited document back, relink its sources to vault assets.
//
// Like edl.ts this is dependency-free: a small XML tokenizer handles the
// `resources` / `spine` subset of FCPXML 1.9 that carries a single-track cut.
// Times are rational seconds (`3600/25s`); source identity round-trips through
// the `uid`/`ref` attributes (our asset ids), with file-name relinking as the
// fallback for documents exported by an NLE.
// ---------------------------------------------------------------------------

import { buildCheckoutManifest, normalizeSourceName, type EdlAssetRef, type EdlClip } from "./edl";

/** Frame rate used for FCPXML timecode (PAL default, like the EDL). */
export const FCPXML_FPS = 25;

const FORMAT_ID = "r-fmt";

export interface FcpxmlSourceAsset {
  id: string;
  fileName: string;
}

export interface ParsedFcpxmlClip {
  eventNumber: number;
  /** Clip `name` attribute (usually the source file name). */
  name?: string;
  /** `ref` attribute — the resource id this clip points at. */
  ref?: string;
  /** `uid` attribute — our asset id on round-trips. */
  uid?: string;
  /** Resolved resource file name (from the `asset` the ref points at). */
  srcName?: string;
  /** Record (timeline) in-point, ms. */
  offsetMs: number;
  durationMs: number;
  /** Source in-point, ms. */
  startMs: number;
}

// ---------------------------------------------------------------------------
// Time helpers — FCPXML expresses time as rational seconds: `3600/25s` means
// 3600 frames at 25fps (= 144s). `0s` and `Ns` are also legal.
// ---------------------------------------------------------------------------

/** ms → `frames/fps s` rational-seconds string. */
export function formatFcpxmlTime(ms: number, fps: number = FCPXML_FPS): string {
  const frames = Math.max(0, Math.round((ms / 1000) * fps));
  return `${frames}/${fps}s`;
}

/** `N/Ds`, `Ns`, or `0s` → milliseconds. */
export function parseFcpxmlTime(value: string): number {
  const trimmed = value.trim();
  const rational = /^(\d+)\/(\d+)s$/.exec(trimmed);
  if (rational) return Math.round((Number(rational[1]) / Number(rational[2])) * 1000);
  const plain = /^(\d+(?:\.\d+)?)s$/.exec(trimmed);
  if (plain) return Math.round(Number(plain[1]) * 1000);
  throw new Error(`Invalid FCPXML time: "${value}"`);
}

// ---------------------------------------------------------------------------
// XML escaping / tokenizing (the subset we need: attribute-bearing open tags)
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

const TAG_RE = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  /** Number of open ancestors (0 = top-level). */
  depth: number;
}

/** Yields every open tag with its attributes; tracks nesting depth. */
function* walkXmlElements(xml: string): Generator<XmlElement> {
  TAG_RE.lastIndex = 0;
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(xml)) !== null) {
    const [, closing, tag, attrText, selfClose] = match;
    if (closing) {
      const index = stack.lastIndexOf(tag);
      if (index >= 0) stack.splice(index);
      continue;
    }
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTR_RE.exec(attrText)) !== null) {
      attrs[attr[1]] = decodeEntities(attr[2] ?? attr[3] ?? "");
    }
    yield { tag, attrs, depth: stack.length };
    if (!selfClose) stack.push(tag);
  }
}

// ---------------------------------------------------------------------------
// Build — snapshot → FCPXML 1.9
// ---------------------------------------------------------------------------

/**
 * Build an FCPXML 1.9 document for a timeline snapshot. `clips` are emitted in
 * record order as direct `<spine>` children; each unique source becomes an
 * `<asset>` in `<resources>`, referenced by `ref`. The asset id rides in the
 * clip's `uid` (and the resource `id`), so a round-trip re-import can relink
 * exactly — the FCPXML analogue of the EDL's `* FROM CLIP:` comments.
 */
export function buildTimelineFcpxml(args: {
  title: string;
  version?: number | null;
  clips: EdlClip[];
  assetById: Map<string, EdlAssetRef>;
  fps?: number;
}): string {
  const fps = args.fps ?? FCPXML_FPS;
  const clips = [...args.clips].sort((a, b) => (a.inMs ?? 0) - (b.inMs ?? 0));

  // Unique sources in first-use order, with a source-window duration.
  const byAsset = new Map<string, { fileName: string; kind: string; durationMs: number }>();
  for (const clip of clips) {
    if (!clip.assetId) continue;
    const durationMs = clip.srcOutMs ?? clip.outMs ?? 0;
    const existing = byAsset.get(clip.assetId);
    if (existing) {
      existing.durationMs = Math.max(existing.durationMs, durationMs);
    } else {
      byAsset.set(clip.assetId, {
        fileName: args.assetById.get(clip.assetId)?.fileName ?? clip.assetId,
        kind: args.assetById.get(clip.assetId)?.kind ?? "RAW_VIDEO",
        durationMs,
      });
    }
  }

  // Reference every manifest asset even if a clip lacks an assetId — keeps the
  // document self-describing like the EDL's `* MEDIA MANIFEST` trailer.
  for (const item of buildCheckoutManifest(clips, args.assetById)) {
    if (!byAsset.has(item.assetId)) {
      byAsset.set(item.assetId, {
        fileName: item.fileName,
        kind: item.kind,
        durationMs: item.lastOutMs,
      });
    }
  }

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<!DOCTYPE fcpxml PUBLIC "-//Apple//DTD FCPXML 1.9//EN" "http://finalcutpro.apple.com/fcpxml/1.9">`,
  );
  lines.push(`<fcpxml version="1.9">`);
  lines.push(`  <resources>`);
  lines.push(
    `    <format id="${FORMAT_ID}" name="FFVideoFormat1080p25" frameDuration="1/${fps}s" width="1920" height="1080" />`,
  );
  for (const [assetId, asset] of byAsset) {
    const src = `file:///vault/${escapeXml(asset.fileName)}`;
    lines.push(
      `    <asset id="${escapeXml(assetId)}" uid="${escapeXml(assetId)}" name="${escapeXml(asset.fileName)}" src="${src}" start="0s" duration="${formatFcpxmlTime(asset.durationMs, fps)}" hasVideo="1" hasAudio="1" format="${FORMAT_ID}" />`,
    );
  }
  lines.push(`  </resources>`);
  lines.push(`  <library>`);
  lines.push(`    <event name="Creators Den">`);
  lines.push(`      <project name="${escapeXml(args.title)}">`);
  const sequenceDuration = clips.reduce((max, clip) => Math.max(max, clip.outMs ?? 0), 0);
  lines.push(
    `        <sequence format="${FORMAT_ID}" tcStart="0s" tcFormat="NDF" duration="${formatFcpxmlTime(sequenceDuration, fps)}">`,
  );
  lines.push(`          <spine>`);
  for (const clip of clips) {
    const assetId = clip.assetId ?? clip.id;
    const asset = byAsset.get(assetId);
    const name = asset?.fileName ?? assetId;
    lines.push(
      `            <clip name="${escapeXml(name)}" uid="${escapeXml(assetId)}" ref="${escapeXml(assetId)}" offset="${formatFcpxmlTime(clip.inMs ?? 0, fps)}" duration="${formatFcpxmlTime((clip.outMs ?? 0) - (clip.inMs ?? 0), fps)}" start="${formatFcpxmlTime(clip.srcInMs ?? clip.inMs ?? 0, fps)}" format="${FORMAT_ID}" tcFormat="NDF" />`,
    );
  }
  lines.push(`          </spine>`);
  lines.push(`        </sequence>`);
  lines.push(`      </project>`);
  lines.push(`    </event>`);
  lines.push(`  </library>`);
  lines.push(`</fcpxml>`);

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Parse — an edited FCPXML document back into spine clips
// ---------------------------------------------------------------------------

/**
 * Parse an FCPXML 1.9 document into ordered spine clips (direct children of
 * `<spine>` only — nested `sync-clip` tracks, gaps, and transitions are out of
 * scope for the single-track CUT import, matching the EDL's scope).
 */
export function parseTimelineFcpxml(xml: string): ParsedFcpxmlClip[] {
  const resources = new Map<string, { name?: string; src?: string }>();
  const clips: ParsedFcpxmlClip[] = [];
  let spineDepth = -1;
  let resourcesDepth = -1;
  let eventNumber = 0;

  for (const element of walkXmlElements(xml)) {
    if (element.tag === "spine") {
      spineDepth = element.depth;
      continue;
    }
    if (element.tag === "resources") {
      resourcesDepth = element.depth;
      continue;
    }
    if (element.tag === "asset" && resourcesDepth >= 0 && element.depth === resourcesDepth + 1 && element.attrs.id) {
      resources.set(element.attrs.id, {
        name: element.attrs.name,
        src: element.attrs.src,
      });
      continue;
    }
    if (element.tag === "clip" && spineDepth >= 0 && element.depth === spineDepth + 1) {
      if (element.attrs.offset == null || element.attrs.duration == null) continue;
      const ref = element.attrs.ref ?? element.attrs.uid;
      const resource = ref ? resources.get(ref) : undefined;
      const srcName = resource?.name ?? basename(resource?.src);
      clips.push({
        eventNumber: ++eventNumber,
        name: element.attrs.name,
        ref,
        uid: element.attrs.uid,
        srcName,
        offsetMs: parseFcpxmlTime(element.attrs.offset),
        durationMs: parseFcpxmlTime(element.attrs.duration),
        startMs: parseFcpxmlTime(element.attrs.start ?? "0s"),
      });
    }
  }

  return clips;
}

function basename(src?: string): string | undefined {
  if (!src) return undefined;
  const cleaned = src.replace(/^file:\/\/\//, "").split(/[\\/]/).pop();
  return cleaned ? decodeEntities(cleaned) : undefined;
}

// ---------------------------------------------------------------------------
// Relink — parsed spine clips → timeline clips against vault assets
// ---------------------------------------------------------------------------

/**
 * Relink parsed FCPXML clips to vault assets by asset id (our uid/ref on
 * round-trips), then by source file name. Returns timeline clips in record
 * order plus the sources that could not be matched.
 */
export function resolveFcpxmlEvents(
  events: ParsedFcpxmlClip[],
  assets: FcpxmlSourceAsset[],
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
    if (event.uid && byId.has(event.uid)) {
      assetId = event.uid;
    } else if (event.ref && byId.has(event.ref)) {
      assetId = event.ref;
    }
    if (!assetId) {
      const name = event.srcName ?? event.name;
      if (name) assetId = byName.get(normalizeSourceName(name));
    }

    if (!assetId) {
      unresolved.push(event.srcName ?? event.name ?? event.uid ?? event.ref ?? "unknown");
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
