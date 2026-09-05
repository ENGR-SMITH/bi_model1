// ---------------------------------------------------------------------------
// Formatting helpers for the analytics UI. Pure functions so they are unit
// testable (see analytics-format.test.ts). Every helper treats null/undefined
// as "no data" and returns the em dash — the analytics pages never invent
// numbers for channels without snapshots.
// ---------------------------------------------------------------------------

/** Compact number: 12 → "12", 1_250 → "1.2K", 3_400_000 → "3.4M". */
export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trimZero(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimZero(value / 1_000)}K`;
  return Math.round(value).toLocaleString('en-US');
}

function trimZero(value: number): string {
  // Truncate to one decimal (compact-number convention: 1_250 → 1.2K).
  return (Math.floor(value * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** Minutes → "40m", "12h 30m", "1.2K h" (compact above 1000 hours). */
export function formatWatchTime(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  const hours = minutes / 60;
  if (hours >= 1000) return `${trimZero(hours / 1000)}K h`;
  if (hours >= 1) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(minutes)}m`;
}

/** CTR / retention rate → "4.5%". */
export function formatPercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${rate.toFixed(1)}%`;
}

/** USD revenue → "$1.20", "$12.50K", "—" when not monetized. */
export function formatCurrency(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  const abs = Math.abs(usd);
  if (abs >= 1_000_000) return `$${trimZero(usd / 1_000_000)}M`;
  if (abs >= 1_000) return `$${trimZero(usd / 1_000)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);
}

/** ISO date → "Aug 20, 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Seconds → "0:45", "4:12", "1:02:03". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * How far `value` sits below `median`, as a positive percentage
 * (e.g. 42 means 42% below the channel median). Returns null when either is
 * missing/non-positive — no comparison possible.
 */
export function belowMedianPct(value: number | null | undefined, median: number | null | undefined): number | null {
  if (value == null || median == null || !Number.isFinite(value) || !Number.isFinite(median) || median <= 0) return null;
  const ratio = value / median;
  if (ratio >= 1) return null;
  return Math.round((1 - ratio) * 100);
}

/** True when `value` is at least `threshold`× below the channel median (0.6 → 40%+ below). */
export function isBelowMedian(value: number | null | undefined, median: number | null | undefined, threshold = 0.6): boolean {
  if (value == null || median == null || !Number.isFinite(value) || !Number.isFinite(median) || median <= 0) return false;
  return value <= median * threshold;
}

/** Pick the best thumbnail URL from a catalog thumbnails object (unknown → null). */
export function pickThumbnailUrl(thumbnails: unknown): string | null {
  if (!thumbnails || typeof thumbnails !== 'object') return null;
  const t = thumbnails as Record<string, { url?: string } | undefined>;
  return t.high?.url ?? t.default?.url ?? null;
}

export const SORT_LABELS: Record<string, string> = {
  publishedAt: 'Newest first',
  views: 'Most views',
  watchTime: 'Watch time',
  likes: 'Most likes',
  ctr: 'Best CTR',
  retention: 'Best retention',
  revenue: 'Revenue',
};