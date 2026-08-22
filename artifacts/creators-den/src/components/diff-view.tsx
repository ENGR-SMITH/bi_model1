// ---------------------------------------------------------------------------
// DiffView — the review layer's compare surface (VCS design §8 phase 3).
//
// Pick two versions of a leg and see:
//   1. The timeline text diff — clips added / removed / moved / trimmed /
//      slipped, spine (scene-block) changes, and marker moves.
//   2. A side-by-side A/B proxy wipe — both versions' frames at the same
//      timecode, revealed by dragging a divider (Frame.io-style). The optional
//      `wipeFilter` lets a leg apply its own live grade (FINISH) per version.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  GitCompareArrows,
  Pause,
  Play,
  X,
} from 'lucide-react';
import {
  getGetVideoAssetQueryKey,
  getGetVideoTimelineVersionQueryKey,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimelineVersion,
  useListVideoTimelineVersions,
} from '@workspace/api-client-react';
import type { VideoTimelineVersionSummary } from '@workspace/api-client-react';
import { Timeline, formatTimecode, activeBlockId, type TimelineBlock } from '@/components/timeline';
import { AssetPlayer, ImageStage, proxyUrlFor } from '@/components/asset-preview';
import type { StudioLeg } from '@/components/role-oracle';
import {
  activeClipAt,
  diffSummary,
  diffTimelineSnapshots,
  type ClipChange,
  type DesignChange,
  type MarkerChange,
  type SceneBlockChange,
  type TimelineSnapshotLike,
} from '@/lib/diff';

/** Per-version live filter (e.g. a FINISH grade of the clip under the playhead). */
export type WipeFilter = (snapshot: unknown, playheadMs: number) => string | undefined;

// GitHub-dark diff palette — semantic change colors tuned to read on the
// near-black canvas (kept distinct per kind, not collapsed to the red accent).
const KIND_COLOR: Record<string, string> = {
  added: '#3fb950',
  removed: '#f85149',
  trimmed: '#e3b341',
  moved: '#58a6ff',
  slipped: '#bc8cff',
};

const KIND_ICON: Record<string, string> = {
  added: '+',
  removed: '−',
  trimmed: '~',
  moved: '⇄',
  slipped: '↔',
};

function versionLabel(version: VideoTimelineVersionSummary): string {
  const date = new Date(version.createdAt).toLocaleDateString();
  return `v${version.version}${version.message ? ` · ${version.message.slice(0, 40)}` : ''} · ${date}`;
}

function ClipDiffRows({ changes, assetName }: { changes: ClipChange[]; assetName: (id: string) => string }) {
  if (changes.length === 0) return null;
  return (
    <>
      {changes.map((entry, index) => {
        const detail =
          entry.kind === 'trimmed' && entry.wasInMs != null
            ? `${formatTimecode(entry.inMs)} → ${formatTimecode(entry.outMs)} (was ${formatTimecode(entry.wasInMs)} → ${formatTimecode(entry.wasOutMs)})`
            : `${formatTimecode(entry.inMs)} → ${formatTimecode(entry.outMs)}`;
        const move =
          entry.kind === 'moved' && entry.fromPosition != null
            ? ` · moved from #${entry.fromPosition}`
            : entry.kind === 'slipped' && entry.wasSrcInMs != null
              ? ` · src ${formatTimecode(entry.wasSrcInMs)} → ${formatTimecode(entry.wasSrcOutMs)}`
              : '';
        return (
          <div key={`${entry.assetId}-${index}`} className="list-row" data-testid={`diff-clip-${entry.kind}-${index}`}>
            <span className="world-symbol" style={{ color: KIND_COLOR[entry.kind] }}>{KIND_ICON[entry.kind]}</span>
            <span>
              <b>{assetName(entry.assetId)}</b>
              <small className="mono-label !text-[9px]">#{entry.position} · {detail}{move}</small>
            </span>
          </div>
        );
      })}
    </>
  );
}

function SpineDiffRows({ changes }: { changes: SceneBlockChange[] }) {
  if (changes.length === 0) return null;
  return (
    <>
      {changes.map((entry, index) => {
        const detail =
          entry.kind === 'trimmed' && entry.wasStartMs != null
            ? `@ ${formatTimecode(entry.startMs)} (was ${formatTimecode(entry.wasStartMs)})`
            : `@ ${formatTimecode(entry.startMs)}`;
        const move = entry.kind === 'moved' && entry.fromPosition != null ? ` · from #${entry.fromPosition}` : '';
        return (
          <div key={`${entry.type}-${index}`} className="list-row" data-testid={`diff-block-${entry.kind}-${entry.type}`}>
            <span className="world-symbol" style={{ color: KIND_COLOR[entry.kind] }}>{KIND_ICON[entry.kind]}</span>
            <span>
              <b>{entry.type}</b>
              <small className="mono-label !text-[9px]">{detail}{move}</small>
            </span>
          </div>
        );
      })}
    </>
  );
}

function MarkerDiffRows({ changes }: { changes: MarkerChange[] }) {
  if (changes.length === 0) return null;
  return (
    <>
      {changes.map((entry, index) => {
        const detail =
          entry.kind === 'moved' && entry.wasTimeMs != null
            ? `@ ${formatTimecode(entry.timeMs)} (was ${formatTimecode(entry.wasTimeMs)})`
            : `@ ${formatTimecode(entry.timeMs)}`;
        return (
          <div key={`${entry.id ?? entry.label}-${index}`} className="list-row" data-testid={`diff-marker-${entry.kind}-${index}`}>
            <span className="world-symbol" style={{ color: KIND_COLOR[entry.kind] }}>{KIND_ICON[entry.kind]}</span>
            <span>
              <b>{entry.label}</b>
              <small className="mono-label !text-[9px]">{detail}</small>
            </span>
          </div>
        );
      })}
    </>
  );
}

function DesignDiffRows({ changes, assetName }: { changes: DesignChange[]; assetName: (id: string) => string }) {
  if (changes.length === 0) return null;
  return (
    <>
      {changes.map((entry, index) => {
        const detail =
          entry.kind === 'changed'
            ? `title “${entry.wasTitle ?? ''}” → “${entry.title ?? ''}” · ${entry.wasStyle ?? '—'} → ${entry.style ?? '—'}`
            : `#${entry.position}${entry.title ? ` · “${entry.title}”` : ''}${entry.style ? ` · ${entry.style}` : ''}`;
        return (
          <div key={`${entry.assetId}-${index}`} className="list-row" data-testid={`diff-design-${entry.kind}-${index}`}>
            <span className="world-symbol" style={{ color: KIND_COLOR[entry.kind] }}>{entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '−' : '~'}</span>
            <span>
              <b>{assetName(entry.assetId)}</b>
              <small className="mono-label !text-[9px]">{detail}</small>
            </span>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// A/B wipe — both versions' proxies at the same playhead, revealed by a
// draggable divider. Top layer is version A, bottom layer is version B.
// ---------------------------------------------------------------------------

function CompareWipe({
  projectId,
  leg,
  versionA,
  versionB,
  wipeFilter,
  assetName,
}: {
  projectId: string;
  leg: StudioLeg;
  versionA: { id: string; version: number; snapshot: unknown } | null;
  versionB: { id: string; version: number; snapshot: unknown } | null;
  wipeFilter?: (snapshot: unknown, playheadMs: number) => string | undefined;
  assetName: (id: string) => string;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const [wipePos, setWipePos] = useState(50);
  const [playing, setPlaying] = useState(false);
  const wipeRef = useRef<HTMLDivElement>(null);
  const videoRefA = useRef<HTMLVideoElement | null>(null);
  const videoRefB = useRef<HTMLVideoElement | null>(null);

  const snapA = (versionA?.snapshot ?? null) as TimelineSnapshotLike | null;
  const snapB = (versionB?.snapshot ?? null) as TimelineSnapshotLike | null;
  const clipA = activeClipAt(snapA, playheadMs) ?? snapA?.clips?.[0] ?? null;
  const clipB = activeClipAt(snapB, playheadMs) ?? snapB?.clips?.[0] ?? null;
  // The THUMBNAIL leg has no clips — the "frame" is the chosen design image.
  const designA = snapA?.designs?.[0] ?? null;
  const designB = snapB?.designs?.[0] ?? null;
  const assetIdA = clipA?.assetId ?? designA?.assetId ?? '';
  const assetIdB = clipB?.assetId ?? designB?.assetId ?? '';
  const isThumbnail = leg === 'THUMBNAIL';

  const detailA = useGetVideoAsset(projectId, assetIdA, {
    query: { queryKey: getGetVideoAssetQueryKey(projectId, assetIdA), enabled: Boolean(assetIdA) },
  });
  const detailB = useGetVideoAsset(projectId, assetIdB, {
    query: { queryKey: getGetVideoAssetQueryKey(projectId, assetIdB), enabled: Boolean(assetIdB) },
  });

  const filterA = wipeFilter ? wipeFilter(snapA, playheadMs) : undefined;
  const filterB = wipeFilter ? wipeFilter(snapB, playheadMs) : undefined;

  // Sync play/pause between the two video layers.
  useEffect(() => {
    const a = videoRefA.current;
    const b = videoRefB.current;
    if (!a || !b) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    b.addEventListener('play', onPlay);
    b.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      b.removeEventListener('play', onPlay);
      b.removeEventListener('pause', onPause);
    };
  }, [assetIdA, assetIdB, versionA?.id, versionB?.id]);

  const togglePlay = () => {
    const a = videoRefA.current;
    const b = videoRefB.current;
    if (playing) {
      a?.pause();
      b?.pause();
    } else {
      void a?.play().catch(() => {});
      void b?.play().catch(() => {});
    }
  };

  const startWipe = (event: React.PointerEvent) => {
    event.preventDefault();
    const el = wipeRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      setWipePos(ratio * 100);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const clipBlocks: TimelineBlock[] = (snapA?.clips ?? []).map((clip, index) => ({
    id: clip.id ?? `clip-${index}`,
    label: `#${index + 1}`,
    sublabel: `${formatTimecode(clip.inMs)} → ${formatTimecode(clip.outMs)}`,
    startMs: clip.inMs,
    endMs: clip.outMs,
    tone: 'accent',
  }));

  if (!versionA && !versionB) return null;

  return (
    <div className="paper-card mt-4" data-testid="diff-wipe">
      <div className="inline-heading">
        <span className="eyebrow"><GitCompareArrows size={13} /> Side-by-side compare</span>
        <span className="flex items-center gap-2">
          <span className="den-tag accent">v{versionA?.version ?? '–'}</span>
          <ArrowLeftRight size={12} />
          <span className="den-tag teal">v{versionB?.version ?? '–'}</span>
        </span>
      </div>
      <p className="setting-copy">
        {isThumbnail
          ? 'Both chosen designs in full, side by side — compare the frames as the viewer would see them.'
          : 'Drag the divider to wipe between the two versions at the same timecode. Play the video or scrub the ruler below.'}
      </p>

      {!assetIdA && !assetIdB ? (
        <p className="setting-copy mt-3">Neither version has a clip or design on the timeline — nothing to compare in the player.</p>
      ) : isThumbnail ? (
        <div className="mt-3 grid gap-4 sm:grid-cols-2" data-testid="diff-designs-side-by-side">
          {[
            { tag: 'A', version: versionA, assetId: assetIdA, design: designA },
            { tag: 'B', version: versionB, assetId: assetIdB, design: designB },
          ].map(({ tag, version, assetId, design }) => (
            <div key={tag} data-testid={`diff-design-${tag.toLowerCase()}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`den-tag ${tag === 'A' ? 'accent' : 'teal'}`}>{tag} · v{version?.version ?? '–'}</span>
                <span className="mono-label truncate">{assetId ? assetName(assetId) : 'no design'}</span>
              </div>
              {assetId ? (
                <ImageStage
                  src={proxyUrlFor(projectId, assetId)}
                  title={
                    design
                      ? [design.title, design.style].filter(Boolean).join(' · ') || assetName(assetId)
                      : assetName(assetId)
                  }
                />
              ) : (
                <div className="den-player-state">
                  <p className="text-sm font-semibold">Version {tag} has no design in this snapshot</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div
            ref={wipeRef}
            className="mt-3"
            style={{ position: 'relative' }}
            data-testid="diff-wipe-stage"
          >
            {assetIdB ? (
              <AssetPlayer
                projectId={projectId}
                assetId={assetIdB}
                detail={detailB.data}
                playheadMs={playheadMs}
                onTimeUpdate={setPlayheadMs}
                videoRef={videoRefB}
                controls={false}
                filter={filterB}
              />
            ) : (
              <div className="den-player-state"><p className="text-sm font-semibold">Version B has no clip at this timecode</p></div>
            )}
            {assetIdA && (
              <div
                style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - wipePos}% 0 0)` }}
                data-testid="diff-wipe-layer-a"
              >
                <AssetPlayer
                  projectId={projectId}
                  assetId={assetIdA}
                  detail={detailA.data}
                  playheadMs={playheadMs}
                  onTimeUpdate={setPlayheadMs}
                  videoRef={videoRefA}
                  controls={false}
                  filter={filterA}
                />
              </div>
            )}
            {assetIdA && assetIdB && (
              <div
                className="diff-wipe-divider"
                style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipePos}%` }}
                onPointerDown={startWipe}
                data-testid="diff-wipe-handle"
              >
                <span><ArrowLeftRight size={11} /></span>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={togglePlay} className="secondary-btn" data-testid="diff-wipe-play">
              {playing ? <Pause size={13} /> : <Play size={13} />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <span className="mono-label">{formatTimecode(playheadMs)}</span>
            <span className="den-tag accent">A · {clipA?.assetId ? 'clip' : 'no clip'}</span>
            <span className="den-tag teal">B · {clipB?.assetId ? 'clip' : 'no clip'}</span>
          </div>

          {clipBlocks.length > 0 && (
            <div className="mt-3">
              <Timeline
                title=""
                hint=""
                blocks={clipBlocks}
                durationMs={Math.max(60_000, ...clipBlocks.map((b) => b.endMs))}
                playheadMs={playheadMs}
                canEdit={false}
                scrubOnly
                onScrub={setPlayheadMs}
                activeId={activeBlockId(clipBlocks, playheadMs)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffView
// ---------------------------------------------------------------------------

export function DiffView({
  projectId,
  leg,
  initialAId,
  initialBId,
  onClose,
  wipeFilter,
}: {
  projectId: string;
  leg: StudioLeg;
  initialAId?: string | null;
  initialBId?: string | null;
  onClose?: () => void;
  /** Per-version live filter (e.g. the FINISH grade of the active clip). */
  wipeFilter?: (snapshot: unknown, playheadMs: number) => string | undefined;
}) {
  const versions = useListVideoTimelineVersions(projectId, leg);
  const [aId, setAId] = useState<string | null>(initialAId ?? null);
  const [bId, setBId] = useState<string | null>(initialBId ?? null);
  const [dismissed, setDismissed] = useState(false);

  const list = versions.data ?? [];

  // Default A = newest, B = the version before it (or A when only one exists).
  useEffect(() => {
    if (list.length === 0) return;
    if (!aId) setAId(initialAId ?? list[0].id);
    if (!bId) setBId(initialBId ?? list[1]?.id ?? list[0].id);
  }, [list, aId, bId, initialAId, initialBId]);

  const versionA = useGetVideoTimelineVersion(projectId, leg, aId ?? '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, leg, aId ?? ''),
      enabled: Boolean(aId),
    },
  });
  const versionB = useGetVideoTimelineVersion(projectId, leg, bId ?? '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, leg, bId ?? ''),
      enabled: Boolean(bId),
    },
  });
  const project = useGetVideoProject(projectId);

  const assetName = (assetId: string): string =>
    project.data?.assets.find((asset) => asset.id === assetId)?.fileName ?? assetId.slice(0, 8);

  const diff = useMemo(
    () => diffTimelineSnapshots(versionA.data?.snapshot, versionB.data?.snapshot),
    [versionA.data?.snapshot, versionB.data?.snapshot],
  );
  const summary = useMemo(() => diffSummary(diff), [diff]);

  if (dismissed) return null;

  return (
    <div className="paper-card accent-card mt-4" data-testid="diff-view">
      <div className="inline-heading">
        <span className="eyebrow"><GitCompareArrows size={13} /> Version diff</span>
        <span className="flex items-center gap-2">
          {leg === 'THUMBNAIL' ? (
            <span className="mono-label">{diff.counts.designs.added + diff.counts.designs.removed + diff.counts.designs.changed} design change{diff.counts.designs.added + diff.counts.designs.removed + diff.counts.designs.changed === 1 ? '' : 's'}</span>
          ) : (
            <span className="mono-label">{diff.counts.clips.added + diff.counts.clips.removed + diff.counts.clips.moved + diff.counts.clips.trimmed + diff.counts.clips.slipped} clip change{diff.counts.clips.added + diff.counts.clips.removed + diff.counts.clips.moved + diff.counts.clips.trimmed + diff.counts.clips.slipped === 1 ? '' : 's'}</span>
          )}
          {onClose ? (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close diff" data-testid="diff-view-close">
              <X size={14} />
            </button>
          ) : (
            <button type="button" className="text-btn" onClick={() => setDismissed(true)} data-testid="diff-view-dismiss">
              Dismiss
            </button>
          )}
        </span>
      </div>

      {list.length === 0 ? (
        <p className="setting-copy">No versions yet — save at least one snapshot to compare.</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="field !mb-0">
              <span>Version A · newer</span>
              <select value={aId ?? ''} onChange={(event) => setAId(event.target.value || null)} data-testid="diff-select-a">
                {list.map((version) => (
                  <option key={version.id} value={version.id}>{versionLabel(version)}</option>
                ))}
              </select>
            </div>
            <div className="field !mb-0">
              <span>Version B · older</span>
              <select value={bId ?? ''} onChange={(event) => setBId(event.target.value || null)} data-testid="diff-select-b">
                {list.map((version) => (
                  <option key={version.id} value={version.id}>{versionLabel(version)}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="den-footnote mt-3" data-testid="diff-summary">
            <Check size={12} />
            {summary}
          </p>

          <CompareWipe
            projectId={projectId}
            leg={leg}
            versionA={versionA.data ? { id: versionA.data.id, version: versionA.data.version, snapshot: versionA.data.snapshot } : null}
            versionB={versionB.data ? { id: versionB.data.id, version: versionB.data.version, snapshot: versionB.data.snapshot } : null}
            wipeFilter={wipeFilter}
            assetName={assetName}
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="paper-card !p-3">
              <div className="inline-heading"><span className="eyebrow">Clips</span></div>
              <div className="den-stack mt-2">
                <ClipDiffRows changes={diff.clips} assetName={assetName} />
              </div>
            </div>
            <div className="paper-card !p-3">
              <div className="inline-heading"><span className="eyebrow">Spine · scene blocks</span></div>
              <div className="den-stack mt-2">
                <SpineDiffRows changes={diff.sceneBlocks} />
              </div>
            </div>
            <div className="paper-card !p-3">
              <div className="inline-heading"><span className="eyebrow">Markers</span></div>
              <div className="den-stack mt-2">
                <MarkerDiffRows changes={diff.markers} />
              </div>
            </div>
            {leg === 'THUMBNAIL' && (
              <div className="paper-card !p-3">
                <div className="inline-heading"><span className="eyebrow">Designs · chosen image</span></div>
                <div className="den-stack mt-2">
                  <DesignDiffRows changes={diff.designs} assetName={assetName} />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
