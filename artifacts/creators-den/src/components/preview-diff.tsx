// ---------------------------------------------------------------------------
// PreviewDiff — the split-screen version-control surface for the preview pages.
//
// The user picks a version off the timeline carousel (row 2 of the first
// column). That version becomes the version under review. Whenever it has an
// older version to compare against, this renders the visual difference map
// (the split-screen pixel diff-map + wipe, ported from the smith_mi app) in
// the first column, underneath the big canvas:
//
//   VIDEO C (newest)  → compares against VIDEO B (older)
//   VIDEO B           → compares against VIDEO A (oldest)
//   VIDEO A (oldest)  → no older version → renders nothing, so the column
//                       just shows the single canvas (current behaviour).
//
// The predecessor is the selected version's direct parent in the timeline
// chain (`parentVersionId`, falling back to the previous sequential version).
// ---------------------------------------------------------------------------

import { Component, type ReactNode } from 'react';
import { DiffMap } from '@/components/diff-map';
import { AudioDiffMap } from '@/components/audio-diff-map';
import {
  getGetVideoTimelineVersionQueryKey,
  useGetVideoTimelineVersion,
} from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';

/**
 * Catches a runtime crash inside a diff surface (worker init, canvas draw,
 * decode, …) so the whole canvas column doesn't unmount to nothing — it shows
 * the actual error text below the preview instead.
 */
class DiffBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: String((err as { message?: string })?.message ?? err) };
  }
  override componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.error('DiffMap crashed:', err);
  }
  override render() {
    if (this.state.error) {
      return (
        <div
          className="preview-diff-panel preview-diff-note"
          role="alert"
          style={{ flex: 'none' }}
        >
          <p>
            <b>Split-screen diff failed to render</b> · {this.state.error}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Snapshot of what the preview page knows about one timeline version. */
export interface PreviewDiffSelection {
  id: string;
  leg: StudioLeg;
  version: number;
  parentVersionId?: string | null;
}

/**
 * Pick the "older" version to diff a selected version against. Versions are
 * supplied newest-first (as the API returns them). The direct parent wins
 * (most faithful lineage); otherwise the previous sequential version of the
 * same leg is used. Returns null for the oldest version / a lone version.
 */
export function predecessorOf(
  versions: PreviewDiffSelection[],
  selected: PreviewDiffSelection | null,
): PreviewDiffSelection | null {
  if (!selected) return null;
  const sameLeg = versions.filter((v) => v.leg === selected.leg && v.id !== selected.id);
  if (sameLeg.length === 0) return null;
  if (selected.parentVersionId) {
    const parent = sameLeg.find((v) => v.id === selected.parentVersionId);
    if (parent) return parent;
  }
  return (
    sameLeg
      .filter((v) => v.version < selected.version)
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

/** Media-friendly snapshot shape so asset lookup only reads what it needs. */
type MediaSnapshot = {
  clips?: Array<{ assetId?: string }>;
  music?: Array<{ assetId?: string }>;
  pickups?: Array<{ assetId?: string }>;
  designs?: Array<{ assetId?: string }>;
};

function mediaAssetId(leg: StudioLeg, snapshot: unknown, fallback: string[] = []): string {
  const snap = (snapshot ?? null) as MediaSnapshot | null;
  if (leg === 'THUMBNAIL') return snap?.designs?.[0]?.assetId ?? fallback[0] ?? '';
  const clip = snap?.clips?.[0]?.assetId;
  if (clip) return clip;
  if (leg === 'SOUND') {
    return snap?.music?.[0]?.assetId ?? snap?.pickups?.[0]?.assetId ?? fallback[0] ?? '';
  }
  return fallback[0] ?? '';
}

const VIDEO_LIKE_LEGS = new Set<StudioLeg>(['SELECTS', 'CUT']);

/**
 * The first-column split-screen VCS surface. Renders nothing when the selected
 * version has no older version to compare with (the column keeps showing just
 * the single canvas), and otherwise the visual `DiffMap` for video / thumbnail
 * (and the text `DiffView` for audio) comparing the selected version (newer)
 * vs its predecessor (older). Keyed on the selection so the diff resets
 * whenever the request changes.
 */
export function PreviewDiff({
  projectId,
  leg,
  versions,
  selected,
  fallbackAssetIds = [],
}: {
  projectId: string;
  leg: StudioLeg;
  versions: PreviewDiffSelection[];
  selected: PreviewDiffSelection | null;
  /** Vault asset ids (of the right media kind) to fall back on when a version
   * snapshot carries no explicit clip/design — mirrors how the canvas already
   * falls back to a vault asset. */
  fallbackAssetIds?: string[];
}) {
  const base = selected ?? null;
  const predecessor = predecessorOf(versions, base);
  // Non-empty leg fallbacks (the query is disabled when base/predecessor are
  // missing, so these are only used for a stable query key).
  const baseLeg: StudioLeg = base?.leg ?? 'SELECTS';
  const prevLeg: StudioLeg = predecessor?.leg ?? 'SELECTS';

  // Hooks run unconditionally (Rules of Hooks) — `enabled` guards the fetch.
  const own = useGetVideoTimelineVersion(projectId, baseLeg, base?.id ?? '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, baseLeg, base?.id ?? ''),
      enabled: Boolean(base && predecessor),
    },
  });
  const prev = useGetVideoTimelineVersion(projectId, prevLeg, predecessor?.id ?? '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, prevLeg, predecessor?.id ?? ''),
      enabled: Boolean(base && predecessor),
    },
  });

  // No older version exists (oldest / lone version) — per design the column
  // keeps showing only the single canvas.
  if (!base || !predecessor) return null;

  const ownError = own.error ? String((own.error as { message?: string })?.message ?? own.error) : null;
  const prevError = prev.error ? String((prev.error as { message?: string })?.message ?? prev.error) : null;

  // Loading the two snapshots — surface progress instead of a silent blank.
  if (!own.data || !prev.data) {
    return (
      <div className="preview-diff-panel preview-diff-note" data-testid="preview-diff">
        <p>
          {ownError || prevError
            ? `Couldn't load the compare data: ${ownError ?? prevError}`
            : `Building the split-screen diff between ${leg} v${base.version} and v${predecessor.version}…`}
        </p>
      </div>
    );
  }

  const newerAssetId = mediaAssetId(leg, own.data.snapshot, fallbackAssetIds);
  const olderAssetId = mediaAssetId(leg, prev.data.snapshot, fallbackAssetIds);

  // One/both snapshots reference no comparable media — surface a clear notice
  // instead of silently rendering nothing, so the missing-diff isn't a mystery.
  if (!newerAssetId || !olderAssetId) {
    const missing = !newerAssetId ? `v${own.data.version}` : `v${prev.data.version}`;
    return (
      <div className="preview-diff-panel preview-diff-note" data-testid="preview-diff">
        <p>
          No comparable {leg === 'THUMBNAIL' ? 'design image' : 'clip'} on{' '}
          <b>{missing}</b> to diff against the other version — add media to that
          version's timeline first.
        </p>
      </div>
    );
  }

  if (VIDEO_LIKE_LEGS.has(leg)) {
    return (
      <div className="preview-diff-panel" data-testid="preview-diff">
        <DiffBoundary key={`${leg}-${base.id}-vs-${predecessor.id}`}>
          <DiffMap
            projectId={projectId}
            kind="video"
            newerAssetId={newerAssetId}
            olderAssetId={olderAssetId}
            newerLabel={`${leg} v${own.data.version}`}
            olderLabel={`v${prev.data.version}`}
          />
        </DiffBoundary>
      </div>
    );
  }

  if (leg === 'THUMBNAIL') {
    return (
      <div className="preview-diff-panel" data-testid="preview-diff">
        <DiffBoundary key={`${leg}-${base.id}-vs-${predecessor.id}`}>
          <DiffMap
            projectId={projectId}
            kind="image"
            newerAssetId={newerAssetId}
            olderAssetId={olderAssetId}
            newerLabel={`THUMBNAIL v${own.data.version}`}
            olderLabel={`v${prev.data.version}`}
          />
        </DiffBoundary>
      </div>
    );
  }

  // SOUND — spectral diff-map on the decoded audio proxies.
  return (
    <div className="preview-diff-panel" data-testid="preview-diff">
      <DiffBoundary key={`${leg}-${base.id}-vs-${predecessor.id}`}>
        <AudioDiffMap
          projectId={projectId}
          newerAssetId={newerAssetId}
          olderAssetId={olderAssetId}
          newerLabel={`SOUND v${own.data.version}`}
          olderLabel={`v${prev.data.version}`}
        />
      </DiffBoundary>
    </div>
  );
}