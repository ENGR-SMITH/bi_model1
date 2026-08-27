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

import { DiffMap } from '@/components/diff-map';
import { AudioDiffMap } from '@/components/audio-diff-map';
import {
  getGetVideoTimelineVersionQueryKey,
  useGetVideoTimelineVersion,
} from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';

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

function mediaAssetId(leg: StudioLeg, snapshot: unknown): string {
  const snap = (snapshot ?? null) as MediaSnapshot | null;
  if (leg === 'THUMBNAIL') return snap?.designs?.[0]?.assetId ?? '';
  const clip = snap?.clips?.[0]?.assetId;
  if (clip) return clip;
  if (leg === 'SOUND') {
    return snap?.music?.[0]?.assetId ?? snap?.pickups?.[0]?.assetId ?? '';
  }
  return '';
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
}: {
  projectId: string;
  leg: StudioLeg;
  versions: PreviewDiffSelection[];
  selected: PreviewDiffSelection | null;
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

  // No older version to compare against (oldest / lone version) — the column
  // falls back to showing only the single canvas, exactly as before.
  if (!base || !predecessor) return null;
  // Readied only once both snapshots are present.
  if (!own.data || !prev.data) return null;

  const newerAssetId = mediaAssetId(leg, own.data.snapshot);
  const olderAssetId = mediaAssetId(leg, prev.data.snapshot);

  // No comparable media on either side — nothing to diff.
  if (!newerAssetId || !olderAssetId) return null;

  if (VIDEO_LIKE_LEGS.has(leg)) {
    return (
      <div className="preview-diff-panel" data-testid="preview-diff">
        <DiffMap
          key={`${leg}-${base.id}-vs-${predecessor.id}`}
          projectId={projectId}
          kind="video"
          newerAssetId={newerAssetId}
          olderAssetId={olderAssetId}
          newerLabel={`${leg} v${own.data.version}`}
          olderLabel={`v${prev.data.version}`}
        />
      </div>
    );
  }

  if (leg === 'THUMBNAIL') {
    return (
      <div className="preview-diff-panel" data-testid="preview-diff">
        <DiffMap
          key={`${leg}-${base.id}-vs-${predecessor.id}`}
          projectId={projectId}
          kind="image"
          newerAssetId={newerAssetId}
          olderAssetId={olderAssetId}
          newerLabel={`THUMBNAIL v${own.data.version}`}
          olderLabel={`v${prev.data.version}`}
        />
      </div>
    );
  }

  // SOUND — spectral diff-map on the decoded audio proxies.
  return (
    <div className="preview-diff-panel" data-testid="preview-diff">
      <AudioDiffMap
        key={`${leg}-${base.id}-vs-${predecessor.id}`}
        projectId={projectId}
        newerAssetId={newerAssetId}
        olderAssetId={olderAssetId}
        newerLabel={`SOUND v${own.data.version}`}
        olderLabel={`v${prev.data.version}`}
      />
    </div>
  );
}