// ---------------------------------------------------------------------------
// Timeline diff — the text-diff half of the review layer (VCS design §8,
// phase 3: "Timeline text diff (clips added/moved, in/out changes)").
//
// Snapshots are JSON documents from `tandem_video_timeline_versions`; the
// diffable artifact is the timeline, not the pixels. This module compares two
// snapshots (any two versions of any leg) and reports what changed in
// review-oriented terms: clips added / removed / moved / trimmed / slipped,
// spine (scene-block) changes, and marker moves.
//
// Pure functions only — no React, so the whole module is unit-testable.
// ---------------------------------------------------------------------------

export interface TimelineClip {
  id?: string;
  assetId: string;
  inMs: number;
  outMs: number;
  srcInMs?: number;
  srcOutMs?: number;
}

export interface TimelineSceneBlock {
  id?: string;
  type: string;
  startMs: number;
  endMs: number;
}

export interface TimelineMarker {
  id?: string;
  label: string;
  timeMs: number;
}

/** A chosen thumbnail design (the THUMBNAIL leg's "clips"). */
export interface TimelineDesign {
  id?: string;
  assetId: string;
  title?: string;
  style?: string;
}

export interface TimelineSnapshotLike {
  clips?: TimelineClip[];
  sceneBlocks?: TimelineSceneBlock[];
  markers?: TimelineMarker[];
  designs?: TimelineDesign[];
  [key: string]: unknown;
}

export type DiffKind = "added" | "removed" | "moved" | "trimmed" | "slipped";

export interface ClipChange {
  kind: DiffKind;
  assetId: string;
  /** 1-based position in version B (for removed: its position in version A). */
  position: number;
  /** Version B window (for removed: version A window). */
  inMs: number;
  outMs: number;
  srcInMs?: number;
  srcOutMs?: number;
  /** Version A window when the in/out changed. */
  wasInMs?: number;
  wasOutMs?: number;
  wasSrcInMs?: number;
  wasSrcOutMs?: number;
  /** Version A position when the clip changed position. */
  fromPosition?: number;
}

export interface SceneBlockChange {
  kind: "added" | "removed" | "moved" | "trimmed";
  type: string;
  position: number;
  startMs: number;
  endMs: number;
  wasStartMs?: number;
  wasEndMs?: number;
  fromPosition?: number;
}

export interface MarkerChange {
  kind: "added" | "removed" | "moved";
  id?: string;
  label: string;
  /** Version B time (for removed: version A time). */
  timeMs: number;
  wasTimeMs?: number;
}

/** A thumbnail-design change — keyed by the chosen image (asset). */
export interface DesignChange {
  kind: "added" | "removed" | "changed";
  assetId: string;
  /** 1-based position in version B (for removed: its position in version A). */
  position: number;
  title?: string;
  style?: string;
  wasTitle?: string;
  wasStyle?: string;
}

export interface DiffCounts {
  added: number;
  removed: number;
  moved: number;
  trimmed: number;
  slipped: number;
}

export interface DesignCounts {
  added: number;
  removed: number;
  changed: number;
}

export interface TimelineDiff {
  clips: ClipChange[];
  sceneBlocks: SceneBlockChange[];
  markers: MarkerChange[];
  designs: DesignChange[];
  counts: { clips: DiffCounts; sceneBlocks: DiffCounts; markers: DiffCounts; designs: DesignCounts };
}

const EMPTY_COUNTS = (): DiffCounts => ({ added: 0, removed: 0, moved: 0, trimmed: 0, slipped: 0 });

export const EMPTY_DIFF: TimelineDiff = {
  clips: [],
  sceneBlocks: [],
  markers: [],
  designs: [],
  counts: {
    clips: EMPTY_COUNTS(),
    sceneBlocks: EMPTY_COUNTS(),
    markers: EMPTY_COUNTS(),
    designs: { added: 0, removed: 0, changed: 0 },
  },
};

/** The block whose [start, end) window contains the playhead — or null. */
export function activeClipAt(snapshot: TimelineSnapshotLike | null | undefined, playheadMs: number): TimelineClip | null {
  const clips = snapshot?.clips ?? [];
  return (
    clips.find(
      (clip) => playheadMs >= clip.inMs && playheadMs < Math.max(clip.inMs + 1, clip.outMs),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Alignment helpers
// ---------------------------------------------------------------------------

/**
 * A stable identity for a clip across two versions. Prefer the clip id when it
 * exists on both sides (same-session saves); fall back to the source window
 * (asset + in/out) when ids were regenerated (e.g. EDL imports mint `import-N`
 * ids per import, so two imports of the same cut have different ids).
 */
function clipKey(clip: TimelineClip, otherIds: Set<string>): string {
  if (clip.id && otherIds.has(clip.id)) return `id:${clip.id}`;
  return `src:${clip.assetId}:${clip.inMs}:${clip.outMs}`;
}

/** Longest common subsequence over two keyed arrays → matched (i, j) pairs in order. */
function lcsPairs(aKeys: string[], bKeys: string[]): Array<[number, number]> {
  const n = aKeys.length;
  const m = bKeys.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = aKeys[i] === bKeys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aKeys[i] === bKeys[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Clip diff
// ---------------------------------------------------------------------------

function diffClips(a: TimelineClip[], b: TimelineClip[]): ClipChange[] {
  const aIds = new Set(a.map((c) => c.id).filter(Boolean) as string[]);
  const bIds = new Set(b.map((c) => c.id).filter(Boolean) as string[]);
  const aKeys = a.map((c) => clipKey(c, bIds));
  const bKeys = b.map((c) => clipKey(c, aIds));

  const lcs = lcsPairs(aKeys, bKeys);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  for (const [ai, bi] of lcs) {
    usedA.add(ai);
    usedB.add(bi);
  }

  // Leftovers on each side, in order.
  const remainingA: number[] = [];
  const remainingB: number[] = [];
  for (let i = 0; i < a.length; i += 1) if (!usedA.has(i)) remainingA.push(i);
  for (let j = 0; j < b.length; j += 1) if (!usedB.has(j)) remainingB.push(j);

  // Best-effort alignment of the leftovers by asset (in source order), so a
  // clip whose id was regenerated (e.g. two EDL imports) still matches its
  // counterpart and reports as trimmed/moved instead of remove+add.
  const byAssetA = new Map<string, number[]>();
  for (const i of remainingA) {
    const list = byAssetA.get(a[i].assetId) ?? [];
    list.push(i);
    byAssetA.set(a[i].assetId, list);
  }
  const byAssetB = new Map<string, number[]>();
  for (const j of remainingB) {
    const list = byAssetB.get(b[j].assetId) ?? [];
    list.push(j);
    byAssetB.set(b[j].assetId, list);
  }
  const aligned: Array<[number, number]> = [];
  for (const [assetId, aIdx] of byAssetA) {
    const bIdx = byAssetB.get(assetId);
    if (!bIdx) continue;
    const n = Math.min(aIdx.length, bIdx.length);
    for (let k = 0; k < n; k += 1) aligned.push([aIdx[k], bIdx[k]]);
  }

  const changes: ClipChange[] = [];

  const describe = (ai: number | null, bi: number | null, kind: DiffKind): ClipChange => {
    const aClip = ai != null ? a[ai] : null;
    const bClip = bi != null ? b[bi] : null;
    const clip = bClip ?? aClip!;
    const change: ClipChange = {
      kind,
      assetId: clip.assetId,
      position: (bi != null ? bi : ai!) + 1,
      inMs: (bClip ?? aClip)!.inMs,
      outMs: (bClip ?? aClip)!.outMs,
      srcInMs: (bClip ?? aClip)!.srcInMs,
      srcOutMs: (bClip ?? aClip)!.srcOutMs,
    };
    if (ai != null && bi != null) {
      if (aClip!.inMs !== bClip!.inMs || aClip!.outMs !== bClip!.outMs) {
        change.wasInMs = aClip!.inMs;
        change.wasOutMs = aClip!.outMs;
      }
      if (aClip!.srcInMs !== bClip!.srcInMs || aClip!.srcOutMs !== bClip!.srcOutMs) {
        change.wasSrcInMs = aClip!.srcInMs;
        change.wasSrcOutMs = aClip!.srcOutMs;
      }
      if (ai !== bi) change.fromPosition = ai + 1;
    }
    return change;
  };

  // Added clips (in B, absent from A), in B order.
  for (const j of remainingB) {
    if (!aligned.some(([, bj]) => bj === j)) changes.push(describe(null, j, "added"));
  }
  // LCS pairs keep relative order — unchanged clips are omitted; only
  // window changes surface.
  for (const [ai, bi] of lcs) {
    const aClip = a[ai];
    const bClip = b[bi];
    if (aClip.inMs !== bClip.inMs || aClip.outMs !== bClip.outMs) {
      changes.push(describe(ai, bi, "trimmed"));
    } else if (aClip.srcInMs !== bClip.srcInMs || aClip.srcOutMs !== bClip.srcOutMs) {
      changes.push(describe(ai, bi, "slipped"));
    }
  }
  // Asset-aligned leftovers: moved and/or trimmed. A pair that is identical
  // in both window and position is not a change at all — omit it.
  for (const [ai, bi] of aligned) {
    const aClip = a[ai];
    const bClip = b[bi];
    if (aClip.inMs === bClip.inMs && aClip.outMs === bClip.outMs && ai === bi) continue;
    const kind: DiffKind = aClip.inMs !== bClip.inMs || aClip.outMs !== bClip.outMs ? "trimmed" : "moved";
    changes.push(describe(ai, bi, kind));
  }
  // Removed clips (in A, absent from B), in A order.
  for (const i of remainingA) {
    if (!aligned.some(([ai]) => ai === i)) changes.push(describe(i, null, "removed"));
  }

  // Display order: added/moved/trimmed/slipped by version-B position, removed
  // clips by their version-A position.
  return changes.sort((x, y) => x.position - y.position);
}

// ---------------------------------------------------------------------------
// Scene block (spine) diff — blocks are keyed by their type (HOOK…CTA).
// ---------------------------------------------------------------------------

function diffSceneBlocks(a: TimelineSceneBlock[], b: TimelineSceneBlock[]): SceneBlockChange[] {
  const changes: SceneBlockChange[] = [];
  const byTypeA = new Map(a.map((block) => [block.type, block]));

  b.forEach((block, index) => {
    const prev = byTypeA.get(block.type);
    if (!prev) {
      changes.push({ kind: "added", type: block.type, position: index + 1, startMs: block.startMs, endMs: block.endMs });
      return;
    }
    byTypeA.delete(block.type);
    const change: SceneBlockChange = {
      kind: "moved",
      type: block.type,
      position: index + 1,
      startMs: block.startMs,
      endMs: block.endMs,
    };
    const aIndex = a.findIndex((x) => x.type === block.type);
    if (aIndex !== index) change.fromPosition = aIndex + 1;
    if (prev.startMs !== block.startMs || prev.endMs !== block.endMs) {
      change.kind = "trimmed";
      change.wasStartMs = prev.startMs;
      change.wasEndMs = prev.endMs;
    } else if (aIndex === index) {
      return; // unchanged
    }
    changes.push(change);
  });

  a.forEach((block, index) => {
    if (byTypeA.has(block.type)) {
      changes.push({ kind: "removed", type: block.type, position: index + 1, startMs: block.startMs, endMs: block.endMs });
    }
  });

  return changes;
}

// ---------------------------------------------------------------------------
// Marker diff — keyed by id when possible, else label + time.
// ---------------------------------------------------------------------------

function diffMarkers(a: TimelineMarker[], b: TimelineMarker[]): MarkerChange[] {
  const changes: MarkerChange[] = [];
  const aIds = new Set(a.map((m) => m.id).filter(Boolean) as string[]);
  const bIds = new Set(b.map((m) => m.id).filter(Boolean) as string[]);

  const keyOf = (marker: TimelineMarker, otherIds: Set<string>): string =>
    marker.id && otherIds.has(marker.id) ? `id:${marker.id}` : `pos:${marker.label}:${marker.timeMs}`;

  const aKeys = a.map((m) => keyOf(m, bIds));
  const bKeys = b.map((m) => keyOf(m, aIds));
  const usedB = new Set<number>();
  const usedA = new Set<number>();

  b.forEach((marker, index) => {
    const key = bKeys[index];
    const ai = aKeys.indexOf(key);
    if (ai < 0 || usedA.has(ai)) {
      changes.push({ kind: "added", id: marker.id, label: marker.label, timeMs: marker.timeMs });
      return;
    }
    usedA.add(ai);
    usedB.add(index);
    const prev = a[ai];
    if (prev.timeMs !== marker.timeMs) {
      changes.push({ kind: "moved", id: marker.id, label: marker.label, timeMs: marker.timeMs, wasTimeMs: prev.timeMs });
    }
  });

  a.forEach((marker, index) => {
    if (!usedA.has(index)) {
      changes.push({ kind: "removed", id: marker.id, label: marker.label, timeMs: marker.timeMs });
    }
  });

  return changes;
}

// ---------------------------------------------------------------------------
// Design diff — the THUMBNAIL leg's "clips". Keyed by the chosen image
// (asset), since a designer swaps designs by picking a different upload.
// ---------------------------------------------------------------------------

function diffDesigns(a: TimelineDesign[], b: TimelineDesign[]): DesignChange[] {
  const changes: DesignChange[] = [];
  const byAssetA = new Map(a.map((design) => [design.assetId, design]));

  b.forEach((design, index) => {
    const prev = byAssetA.get(design.assetId);
    if (!prev) {
      changes.push({
        kind: "added",
        assetId: design.assetId,
        position: index + 1,
        title: design.title,
        style: design.style,
      });
      return;
    }
    byAssetA.delete(design.assetId);
    if (prev.title !== design.title || prev.style !== design.style) {
      changes.push({
        kind: "changed",
        assetId: design.assetId,
        position: index + 1,
        title: design.title,
        style: design.style,
        wasTitle: prev.title,
        wasStyle: prev.style,
      });
    }
  });

  a.forEach((design, index) => {
    if (byAssetA.has(design.assetId)) {
      changes.push({
        kind: "removed",
        assetId: design.assetId,
        position: index + 1,
        title: design.title,
        style: design.style,
      });
    }
  });

  return changes;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function diffTimelineSnapshots(a: TimelineSnapshotLike | null | undefined, b: TimelineSnapshotLike | null | undefined): TimelineDiff {
  const clipsA = Array.isArray(a?.clips) ? a!.clips! : [];
  const clipsB = Array.isArray(b?.clips) ? b!.clips! : [];
  const blocksA = Array.isArray(a?.sceneBlocks) ? a!.sceneBlocks! : [];
  const blocksB = Array.isArray(b?.sceneBlocks) ? b!.sceneBlocks! : [];
  const markersA = Array.isArray(a?.markers) ? a!.markers! : [];
  const markersB = Array.isArray(b?.markers) ? b!.markers! : [];
  const designsA = Array.isArray(a?.designs) ? a!.designs! : [];
  const designsB = Array.isArray(b?.designs) ? b!.designs! : [];

  const clips = diffClips(clipsA, clipsB);
  const sceneBlocks = diffSceneBlocks(blocksA, blocksB);
  const markers = diffMarkers(markersA, markersB);
  const designs = diffDesigns(designsA, designsB);

  const tally = (list: Array<ClipChange | SceneBlockChange | MarkerChange>): DiffCounts => {
    const counts = EMPTY_COUNTS();
    for (const entry of list) counts[entry.kind] += 1;
    return counts;
  };

  const designCounts: DesignCounts = { added: 0, removed: 0, changed: 0 };
  for (const design of designs) designCounts[design.kind] += 1;

  return {
    clips,
    sceneBlocks,
    markers,
    designs,
    counts: {
      clips: tally(clips),
      sceneBlocks: tally(sceneBlocks),
      markers: tally(markers),
      designs: designCounts,
    },
  };
}

/** Short human summary, e.g. "3 clips · +1 −1 ~1 · CTA moved · 2 markers moved". */
export function diffSummary(diff: TimelineDiff): string {
  const parts: string[] = [];
  const c = diff.counts.clips;
  if (c.added + c.removed + c.moved + c.trimmed + c.slipped > 0) {
    parts.push(`${c.added + c.removed + c.moved + c.trimmed + c.slipped} clip${c.added + c.removed + c.moved + c.trimmed + c.slipped === 1 ? "" : "s"}`);
    const bits: string[] = [];
    if (c.added) bits.push(`+${c.added}`);
    if (c.removed) bits.push(`−${c.removed}`);
    if (c.trimmed) bits.push(`~${c.trimmed} trimmed`);
    if (c.moved) bits.push(`${c.moved} moved`);
    if (c.slipped) bits.push(`${c.slipped} slipped`);
    parts.push(bits.join(" "));
  }
  for (const block of diff.sceneBlocks) {
    if (block.kind === "removed") parts.push(`${block.type} removed`);
    else if (block.kind === "added") parts.push(`${block.type} added`);
    else if (block.kind === "moved") parts.push(`${block.type} moved`);
    else parts.push(`${block.type} retimed`);
  }
  if (diff.counts.markers.moved > 0) parts.push(`${diff.counts.markers.moved} marker${diff.counts.markers.moved === 1 ? "" : "s"} moved`);
  const d = diff.counts.designs;
  if (d.added + d.removed + d.changed > 0) {
    parts.push(`${d.added + d.removed + d.changed} design${d.added + d.removed + d.changed === 1 ? "" : "s"} (${d.changed ? "changed, " : ""}${d.added ? `+${d.added} ` : ""}${d.removed ? `−${d.removed}` : ""})`);
  }
  return parts.join(" · ") || "No changes";
}
