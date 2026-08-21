// ---------------------------------------------------------------------------
// Unified annotation model helpers (VCS design §10 / §12).
//
// A comment becomes a spatial annotation when it carries a normalized
// geometry: { x, y, w?, h? } in 0..1 frame space. On the shared canvas each
// reviewer needs a unique color + short identifier with zero setup, so both
// are derived deterministically from the author id (stable across reloads).
// ---------------------------------------------------------------------------

export interface AnnotationGeometry {
  /** Normalized 0..1 — pin / top-left of a highlight. */
  x: number;
  y: number;
  /** Normalized width/height for HIGHLIGHT / MARK regions. */
  w?: number;
  h?: number;
}

export const REVIEWER_COLORS = [
  "#e05252", // red
  "#f09d3d", // orange
  "#f0c85c", // gold
  "#4caf7d", // green
  "#38b2ac", // teal
  "#4a9ff5", // blue
  "#8b7cf6", // violet
  "#e56fb4", // pink
] as const;

export type ReviewerColor = (typeof REVIEWER_COLORS)[number];

/** FNV-ish string hash → unsigned int. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic per-reviewer color on the annotation canvas. */
export function reviewerColor(authorId: string): ReviewerColor {
  return REVIEWER_COLORS[hashString(authorId) % REVIEWER_COLORS.length];
}

/** Deterministic per-reviewer letter label (A–Z), e.g. "A", "B", "C". */
export function reviewerLabel(authorId: string): string {
  return String.fromCharCode(65 + (hashString(authorId) % 26));
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Validate + normalise an unknown geometry value (from a comment row).
 * Returns null when it is not a usable { x, y } pair, so callers can safely
 * treat it as "timecode-only note".
 */
export function parseGeometry(value: unknown): AnnotationGeometry | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  const x = typeof g.x === "number" && Number.isFinite(g.x) ? g.x : null;
  const y = typeof g.y === "number" && Number.isFinite(g.y) ? g.y : null;
  if (x == null || y == null) return null;
  const w = typeof g.w === "number" && Number.isFinite(g.w) ? g.w : undefined;
  const h = typeof g.h === "number" && Number.isFinite(g.h) ? g.h : undefined;
  return { x: clamp01(x), y: clamp01(y), ...(w != null ? { w: clamp01(w) } : {}), ...(h != null ? { h: clamp01(h) } : {}) };
}

/** Stable identity for grouping comments into pins (near-exact frame points). */
export function geometryKey(geometry: AnnotationGeometry): string {
  return `${geometry.x.toFixed(3)},${geometry.y.toFixed(3)}`;
}
