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

import { Component, type ReactNode, type RefObject } from 'react';
import { DiffMap } from '@/components/diff-map';
import { AudioDiffMap } from '@/components/audio-diff-map';
import type { DiffSettings } from '@/components/preview-shared';
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

/**
 * One item the split-screen diff can compare. A saved timeline version
 * (`kind: 'version'`, compared against its older version) or a vault file
 * (`kind: 'asset'`, compared against the older file of the same media).
 */
export interface PreviewDiffSelection {
  /** Carousel key, e.g. `version-…` or `asset-…`. */
  key: string;
  /** Version id (for versions) or asset id (for assets). */
  id: string;
  leg: StudioLeg;
  kind: 'version' | 'asset';
  /** Version number — present for versions. */
  version?: number;
  parentVersionId?: string | null;
  /** Creation time, used to order assets (older = earlier). */
  createdAt: string;
  /** Human label for assets (e.g. the file name); versions use `leg vN`. */
  label?: string;
}

/**
 * Pick the "older" item to diff a selected item against. Versions compare
 * against their parent version (falling back to the previous sequential
 * version of the same leg); vault assets compare against the previous asset
 * of the same media. Returns null for the oldest / lone item.
 */
export function predecessorOf(
  items: PreviewDiffSelection[],
  selected: PreviewDiffSelection | null,
): PreviewDiffSelection | null {
  if (!selected) return null;
  const sameLeg = items.filter((s) => s.leg === selected.leg && s.key !== selected.key);
  if (sameLeg.length === 0) return null;

  if (selected.kind === 'version') {
    const versions = sameLeg.filter((s) => s.kind === 'version');
    if (selected.parentVersionId) {
      const parent = versions.find((s) => s.id === selected.parentVersionId);
      if (parent) return parent;
    }
    return (
      versions
        .filter((v) => (v.version ?? 0) < (selected.version ?? 0))
        .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
    );
  }

  // Assets: the immediately older file of the same media (by recency).
  return (
    sameLeg
      .filter((s) => s.kind === 'asset' && new Date(s.createdAt).getTime() < new Date(selected.createdAt).getTime())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null
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
  settings,
  onSettingsChange,
  annotationHeaderRef,
}: {
  projectId: string;
  leg: StudioLeg;
  versions: PreviewDiffSelection[];
  selected: PreviewDiffSelection | null;
  /** Vault asset ids (of the right media kind) to fall back on when a version
   * snapshot carries no explicit clip/design — mirrors how the canvas already
   * falls back to a vault asset. */
  fallbackAssetIds?: string[];
  /** Diff-map settings owned by the page (driven by the settings dropdown). */
  settings?: DiffSettings;
  onSettingsChange?: (settings: DiffSettings) => void;
  /** The column-header annotation slot — the diff map's annotate pencil
   * portals here, identical to the preview surface's. */
  annotationHeaderRef?: RefObject<HTMLDivElement | null>;
}) {
  // Handlers bridging the controlled diff components back to the page state.
  const changeSensitivity = (sensitivity: number) =>
    onSettingsChange?.({ sensitivity, levelMatch: settings?.levelMatch ?? true });
  const changeLevelMatch = (levelMatch: boolean) =>
    onSettingsChange?.({ sensitivity: settings?.sensitivity ?? 6, levelMatch });
  const base = selected ?? null;
  const predecessor = predecessorOf(versions, base);
  // Non-empty leg fallbacks (the query is disabled when base/predecessor are
  // missing, so these are only used for a stable query key).
  const baseLeg: StudioLeg = base?.leg ?? 'SELECTS';
  const prevLeg: StudioLeg = predecessor?.leg ?? 'SELECTS';

  // Asset-vs-asset comparisons use the file ids directly; only version
  // comparisons need the two snapshots fetched.
  const baseIsVersion = base?.kind === 'version';
  const prevIsVersion = predecessor?.kind === 'version';
  const needsSnapshots = Boolean(base && predecessor && baseIsVersion && prevIsVersion);

  // Hooks run unconditionally (Rules of Hooks) — `enabled` guards the fetch.
  const own = useGetVideoTimelineVersion(projectId, baseLeg, baseIsVersion ? (base?.id ?? '') : '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, baseLeg, baseIsVersion ? (base?.id ?? '') : ''),
      enabled: needsSnapshots,
    },
  });
  const prev = useGetVideoTimelineVersion(projectId, prevLeg, prevIsVersion ? (predecessor?.id ?? '') : '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, prevLeg, prevIsVersion ? (predecessor?.id ?? '') : ''),
      enabled: needsSnapshots,
    },
  });

  // No older item exists (oldest / lone item) — explain instead of a blank.
  if (!base || !predecessor) {
    return (
      <div className="preview-diff-panel preview-diff-note" data-testid="preview-diff">
        <p>
          {base?.kind === 'asset'
            ? `“${base.label ?? 'This file'}” is the only ${leg} file here — there's nothing older to compare it against.`
            : `${leg} has no older version than <b>v${base?.version ?? 1}</b> — save a newer snapshot in the ${leg} studio to compare.`}
        </p>
      </div>
    );
  }

  // Asset comparison — the two file ids ARE the media.
  if (!baseIsVersion || !prevIsVersion) {
    const newerAssetId = base.id;
    const olderAssetId = predecessor.id;
    const newerLabel = base.label ?? `${leg} file`;
    const olderLabel = predecessor.label ?? `${leg} file`;
    return (
      <div className="preview-diff-panel" data-testid="preview-diff">
        <DiffBoundary key={`${leg}-${base.key}-vs-${predecessor.key}`}>
          {leg === 'SOUND' ? (
            <AudioDiffMap
              projectId={projectId}
              newerAssetId={newerAssetId}
              olderAssetId={olderAssetId}
              newerLabel={newerLabel}
              olderLabel={olderLabel}
              leg={leg}
              timelineVersionId={base.kind === 'version' ? base.id : null}
              sensitivity={settings?.sensitivity}
              onSensitivityChange={changeSensitivity}
              levelMatch={settings?.levelMatch}
              onLevelMatchChange={changeLevelMatch}
              annotationHeaderRef={annotationHeaderRef}
            />
          ) : leg === 'THUMBNAIL' ? (
            <DiffMap
              projectId={projectId}
              kind="image"
              newerAssetId={newerAssetId}
              olderAssetId={olderAssetId}
              newerLabel={newerLabel}
              olderLabel={olderLabel}
              leg={leg}
              timelineVersionId={base.kind === 'version' ? base.id : null}
              sensitivity={settings?.sensitivity}
              onSensitivityChange={changeSensitivity}
              annotationHeaderRef={annotationHeaderRef}
            />
          ) : (
            <DiffMap
              projectId={projectId}
              kind="video"
              newerAssetId={newerAssetId}
              olderAssetId={olderAssetId}
              newerLabel={newerLabel}
              olderLabel={olderLabel}
              leg={leg}
              timelineVersionId={base.kind === 'version' ? base.id : null}
              sensitivity={settings?.sensitivity}
              onSensitivityChange={changeSensitivity}
              annotationHeaderRef={annotationHeaderRef}
            />
          )}
        </DiffBoundary>
      </div>
    );
  }

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

  // A saved snapshot can reference a vault file that has since left the
  // project (deleted by its uploader / the Captain, or still held back as a
  // pending submission) — streaming that proxy 404s, which is exactly what
  // made the review desk's diff map die while the same footage played fine in
  // the vault. Resolve each side only to media that is actually in the vault:
  // a vanished reference stops the diff (with a clear notice below) instead
  // of hitting a dead stream, while a snapshot with NO media at all still
  // falls back to the newest vault file of the right kind, like the canvases.
  const vaultIds = new Set(fallbackAssetIds);
  const vaultFallback = fallbackAssetIds[0] ?? '';
  const ownCandidate = mediaAssetId(leg, own.data.snapshot);
  const prevCandidate = mediaAssetId(leg, prev.data.snapshot);
  const ownGone = Boolean(ownCandidate) && !vaultIds.has(ownCandidate);
  const prevGone = Boolean(prevCandidate) && !vaultIds.has(prevCandidate);
  const newerAssetId = ownGone ? '' : ownCandidate || vaultFallback;
  const olderAssetId = prevGone ? '' : prevCandidate || vaultFallback;

  // One/both snapshots have no comparable media in the vault — surface a
  // clear notice (naming a missing/deleted file when that's the cause)
  // instead of silently rendering nothing, so the missing diff isn't a
  // mystery and no dead proxy is ever streamed.
  if (!newerAssetId || !olderAssetId) {
    const ownBad = !newerAssetId;
    const prevBad = !olderAssetId;
    const bad = ownBad && prevBad
      ? `v${own.data.version} and v${prev.data.version}`
      : ownBad
        ? `v${own.data.version}`
        : `v${prev.data.version}`;
    const gone = ownGone || prevGone;
    // A noun that reads right for the media kind being diffed.
    const mediaNoun = leg === 'SOUND' ? 'audio' : leg === 'THUMBNAIL' ? 'design image' : 'footage';
    return (
      <div className="preview-diff-panel preview-diff-note" data-testid="preview-diff">
        <p>
          {gone ? (
            <>
              The {mediaNoun} behind <b>{bad}</b> is no longer in the project vault,
              so the split-screen diff can't play it — compare a version whose
              media is still in the vault, or review it in <b>Preview</b>.
            </>
          ) : (
            <>
              No comparable {mediaNoun} on <b>{bad}</b> to diff against the other
              version — add media to that version's timeline first.
            </>
          )}
        </p>
      </div>
    );
  }

  // Both versions resolve to the same vault asset. The pixel diff between an
  // asset and itself is a meaningless, all-gray frame — surface that clearly
  // instead of rendering a blank diff the user would read as "not working".
  if (newerAssetId === olderAssetId) {
    return (
      <div className="preview-diff-panel preview-diff-note" data-testid="preview-diff">
        <p>
          Both versions reference the same media{' '}
          (<b className="mono-label">{newerAssetId.slice(0, 8)}</b>) — there's
          no difference to map. Give <b>v{own.data.version}</b> a different clip
          than <b>v{prev.data.version}</b> to compare.
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
            leg={leg}
            timelineVersionId={base.id}
            sensitivity={settings?.sensitivity}
            onSensitivityChange={changeSensitivity}
            annotationHeaderRef={annotationHeaderRef}
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
            leg={leg}
            timelineVersionId={base.id}
            sensitivity={settings?.sensitivity}
            onSensitivityChange={changeSensitivity}
            annotationHeaderRef={annotationHeaderRef}
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
          leg={leg}
          timelineVersionId={base.id}
          sensitivity={settings?.sensitivity}
          onSensitivityChange={changeSensitivity}
          levelMatch={settings?.levelMatch}
          onLevelMatchChange={changeLevelMatch}
          annotationHeaderRef={annotationHeaderRef}
        />
      </DiffBoundary>
    </div>
  );
}