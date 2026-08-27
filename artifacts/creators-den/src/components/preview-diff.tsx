// ---------------------------------------------------------------------------
// PreviewDiff — the split-screen version-control surface for the preview pages.
//
// The user picks a version off the timeline carousel (row 2 of the first
// column). That version becomes the "new" baseline to review. Whenever it has
// an older version to compare against, this renders the imported VCS
// `DiffView` (the side-by-side A/B wipe + timeline change list) in the first
// column, underneath the big canvas:
//
//   VIDEO A (newest)  → compares against VIDEO B (older)
//   VIDEO B           → compares against VIDEO A (oldest)
//   VIDEO A (oldest)  → no older version → renders nothing, so the column
//                       just shows the single canvas (current behaviour).
//
// The predecessor is the selected version's direct parent in the timeline
// chain (`parentVersionId`, falling back to the previous sequential version).
// ---------------------------------------------------------------------------

import { DiffView } from '@/components/diff-view';
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
  // Fall back to the previous sequential version of the same leg.
  return (
    sameLeg
      .filter((v) => v.version < selected.version)
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

/**
 * The first-column split-screen VCS surface. Renders nothing when the selected
 * version has no older version to compare with (so the column keeps showing
 * just the single round-the-selection canvas), and otherwise the full
 * `DiffView` comparing the selected version (newer, A) vs its predecessor
 * (older, B). Keyed on the selection so the diff resets whenever the request
 * changes.
 */
export function PreviewDiff({
  projectId,
  leg,
  versions,
  selected,
}: {
  projectId: string;
  /** The leg of the version currently selected on the carousel. */
  leg: StudioLeg;
  /** Every version available for the leg(s), newest first. */
  versions: PreviewDiffSelection[];
  /** The currently selected version on the carousel. */
  selected: PreviewDiffSelection | null;
}) {
  const base = selected ?? null;
  const predecessor = predecessorOf(versions, base);
  // Oldest version (or a lone version) has nothing to compare against — the
  // column falls back to showing only the single canvas, exactly as before.
  if (!base || !predecessor) return null;

  return (
    <div className="preview-diff-panel" data-testid="preview-diff">
      <DiffView
        key={`${leg}-${base.id}-vs-${predecessor.id}`}
        projectId={projectId}
        leg={leg}
        initialAId={base.id}
        initialBId={predecessor.id}
      />
    </div>
  );
}