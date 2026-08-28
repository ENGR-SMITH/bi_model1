// ---------------------------------------------------------------------------
// Video preview — the picture studio.
//
// Left column, row 1: the big canvas — the selected version's clip streams as
// a proxy, with the spatial AnnotationCanvas on top (pins carry the reviewer
// colour + the exact timecode), red ticks marking annotation times on the
// player's timeline, and a full-screen expand button.
// Left column, row 2: the carousel of the project's SELECTS + CUT versions.
// Right column: the pin / comment wall, scoped to the selected version.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import { Link, useParams } from 'wouter';
import {
  getGetVideoAssetQueryKey,
  getGetVideoTimelineVersionQueryKey,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useGetVideoTimelineVersion,
  useListVideoComments,
  useListVideoTimelineVersions,
} from '@workspace/api-client-react';
import { useProjectRealtime } from '@/lib/realtime';
import { AssetPlayer, EmptyPlayer, pollWhileProcessing, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { formatTimecode } from '@/components/timeline';
import {
  FullscreenButton,
  PreviewCanvasColumn,
  PreviewLayout,
  PreviewNotesPanel,
  VAULT_KIND_LABELS,
  VersionCarousel,
  type CarouselItem,
  type PreviewVersion,
  type PreviewView,
} from '@/components/preview-shared';
import { predecessorOf, PreviewDiff, type PreviewDiffSelection } from '@/components/preview-diff';
import { activeClipAt, type TimelineSnapshotLike } from '@/lib/diff';
import type { StudioLeg } from '@/components/role-oracle';

const VIDEO_LEGS: StudioLeg[] = ['SELECTS', 'CUT'];
const VIDEO_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE']);

// ---------------------------------------------------------------------------
// VideoCanvas — the big canvas for one selected version. When the version has
// no clips (or no version is saved yet), it falls back to the vault's own
// processed footage so the canvas always shows real media.
// ---------------------------------------------------------------------------

function VideoCanvas({
  projectId,
  version,
  assets,
  vaultAssetId,
  seekRequest,
}: {
  projectId: string;
  version: { id: string; leg: StudioLeg; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
  /** Explicit vault asset to preview (picked from the timeline row). */
  vaultAssetId?: string | null;
  /** A note-click seek from the comments rail — jumps the player to it. */
  seekRequest?: { ms: number; n: number } | null;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const annotationHeaderRef = useRef<HTMLDivElement>(null);
  const comments = useListVideoComments(projectId);

  // The comments rail and this canvas are siblings, so the page lifts a
  // note-click seek up and passes it back down — jump straight to it.
  useEffect(() => {
    if (!seekRequest) return;
    setPlayheadMs(seekRequest.ms);
    if (videoRef.current) videoRef.current.currentTime = seekRequest.ms / 1000;
  }, [seekRequest]);

  const snap = version ? ((version.snapshot ?? null) as TimelineSnapshotLike | null) : null;
  const clips = Array.isArray(snap?.clips) ? snap!.clips! : [];
  const activeClip = activeClipAt(snap, playheadMs) ?? clips[0] ?? null;

  const fallback = useMemo(
    () =>
      assets.find((a) => VIDEO_KINDS.has(a.kind) && a.status === 'PROCESSED') ??
      assets.find((a) => VIDEO_KINDS.has(a.kind)) ??
      null,
    [assets],
  );
  // A snapshot clip may reference an asset that is no longer in the vault
  // (or still processing) — validate against the project's assets so the
  // canvas always falls back to real, playable media. An explicitly picked
  // vault file (from the timeline row) wins over everything.
  const explicitAsset = vaultAssetId && assets.some((a) => a.id === vaultAssetId) ? vaultAssetId : '';
  const clipAssetId = activeClip?.assetId && assets.some((a) => a.id === activeClip.assetId) ? activeClip.assetId : '';
  const assetId = explicitAsset || clipAssetId || fallback?.id || '';
  const detail = useGetVideoAsset(projectId, assetId, {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId),
      enabled: Boolean(assetId),
      // Keep fetching until the proxy finishes, then stop on its own — same
      // behaviour as the vault player.
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });
  const onSeek = (ms: number) => {
    setPlayheadMs(ms);
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  };

  // Red ticks = annotation timecodes for this leg; teal ticks = clip boundaries.
  const markers = useMemo(() => {
    const list: Array<{ id: string; ms: number; tone: 'danger' | 'teal' }> = [];
    if (version) {
      for (const comment of comments.data ?? []) {
        if (comment.timecodeMs == null || comment.leg !== version.leg) continue;
        list.push({ id: `note-${comment.id}`, ms: comment.timecodeMs, tone: 'danger' });
      }
    }
    clips.forEach((clip, index) => {
      list.push({ id: `clip-${index}`, ms: clip.inMs, tone: 'teal' });
    });
    return list;
  }, [comments.data, clips, version]);

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="video-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><Play size={13} /> Big canvas{version ? ` · ${version.leg} v${version.version}` : ''}</span>
        <span className="flex items-center gap-2">
          {!version && <span className="den-tag teal">vault preview</span>}
          <span className="mono-label">{formatTimecode(playheadMs)}</span>
          <div ref={annotationHeaderRef} className="annotation-header-slot" />
        </span>
      </div>
      <div className="pv-stage-player mt-2">
        {assetId ? (
          <AssetPlayer
            projectId={projectId}
            assetId={assetId}
            detail={detail.data}
            videoRef={videoRef}
            playheadMs={playheadMs}
            onTimeUpdate={setPlayheadMs}
            markers={markers}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={version?.leg ?? 'SELECTS'}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={version?.id}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
              timecodeReveal
              glowPins
            />
            <FullscreenButton targetRef={stageRef} />
          </AssetPlayer>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">No video in the vault yet.</p>
            <p className="text-xs opacity-70">Add footage in the vault to preview it here.</p>
          </EmptyPlayer>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function VideoPreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);
  // Last note-click seek from the comments rail, with a counter so repeat
  // clicks on the same timecode still re-trigger the canvas effect.
  const [seekRequest, setSeekRequest] = useState<{ ms: number; n: number } | null>(null);
  const onNoteSeek = (ms: number) => setSeekRequest((prev) => ({ ms, n: (prev?.n ?? 0) + 1 }));

  const selectsVersions = useListVideoTimelineVersions(projectId, 'SELECTS');
  const cutVersions = useListVideoTimelineVersions(projectId, 'CUT');
  const selectsTimeline = useGetVideoTimeline(projectId, 'SELECTS');
  const cutTimeline = useGetVideoTimeline(projectId, 'CUT');

  // Both legs' raw version rows feed the split-screen diff (the selected
  // version is diffed against its immediate predecessor in the same leg).
  const diffVersions = useMemo<PreviewDiffSelection[]>(
    () => [
      ...(selectsVersions.data ?? []).map((v) => ({ id: v.id, leg: 'SELECTS' as const, version: v.version, parentVersionId: v.parentVersionId ?? null })),
      ...(cutVersions.data ?? []).map((v) => ({ id: v.id, leg: 'CUT' as const, version: v.version, parentVersionId: v.parentVersionId ?? null })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectsVersions.data, cutVersions.data],
  );

  // Both legs' versions, newest first, each tagged with its leg + head state.
  const versions = useMemo<PreviewVersion[]>(() => {
    const rows: PreviewVersion[] = [];
    for (const [leg, query, head] of [
      ['SELECTS', selectsVersions, selectsTimeline],
      ['CUT', cutVersions, cutTimeline],
    ] as const) {
      for (const v of query.data ?? []) {
        rows.push({
          id: v.id,
          leg,
          version: v.version,
          message: v.message ?? '',
          createdAt: v.createdAt,
          isHead: v.version === head.data?.version,
        });
      }
    }
    return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectsVersions.data, cutVersions.data, selectsTimeline.data?.version, cutTimeline.data?.version]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vaultAssetId, setVaultAssetId] = useState<string | null>(null);
  // Preview / split-screen diff-map toggle for the big-canvas column.
  const [view, setView] = useState<PreviewView>('preview');

  // Default to the newest version once the list arrives (unless a vault file
  // has been picked from the timeline row).
  useEffect(() => {
    if (!selectedId && !vaultAssetId && versions.length > 0) setSelectedId(versions[0].id);
  }, [versions, selectedId, vaultAssetId]);

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;
  const selectedDetail = useGetVideoTimelineVersion(projectId, selected?.leg ?? '', selected?.id ?? '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, selected?.leg ?? '', selected?.id ?? ''),
      enabled: Boolean(selected) && !vaultAssetId,
    },
  });

  // While a vault file is being previewed there is no active version — the
  // canvas shows the picked file instead of the newest version's clip.
  const activeVersion = vaultAssetId ? null : selected;

  // The selected version as a diff selection, plus whether it actually has an
  // older predecessor to diff against (oldest / lone → no diff-map).
  const activeSelection: PreviewDiffSelection | null = activeVersion
    ? { id: activeVersion.id, leg: activeVersion.leg, version: activeVersion.version }
    : null;
  const hasDiff = Boolean(activeSelection && predecessorOf(diffVersions, activeSelection));

  // If the selected version suddenly has no older version to compare (e.g. the
  // oldest one is picked), fall the column back to the plain preview view.
  useEffect(() => {
    if (!hasDiff) setView('preview');
  }, [hasDiff]);

  // Timeline row: versions (newest first) + the vault's video uploads.
  const carouselItems = useMemo<CarouselItem[]>(() => {
    const versionItems: CarouselItem[] = versions.map((v) => ({
      key: `version-${v.id}`,
      kind: 'version',
      id: v.id,
      leg: v.leg,
      version: v.version,
      message: v.message,
      createdAt: v.createdAt,
      isHead: v.isHead,
    }));
    const vaultItems: CarouselItem[] = (project.data?.assets ?? [])
      .filter((a) => VIDEO_KINDS.has(a.kind))
      .map((a) => ({
        key: `asset-${a.id}`,
        kind: 'asset',
        id: a.id,
        fileName: a.fileName,
        kindLabel: VAULT_KIND_LABELS[a.kind] ?? a.kind,
        status: a.status,
        media: 'video',
        thumbUrl: a.status === 'PROCESSED' ? proxyUrlFor(projectId, a.id) : undefined,
      }));
    return [...versionItems, ...vaultItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, project.data?.assets, projectId]);

  const activeKey = vaultAssetId ? `asset-${vaultAssetId}` : selected ? `version-${selected.id}` : carouselItems[0]?.key ?? null;

  const onCarouselSelect = (key: string) => {
    if (key.startsWith('asset-')) {
      setVaultAssetId(key.slice('asset-'.length));
      setSelectedId(null);
    } else {
      setSelectedId(key.slice('version-'.length));
      setVaultAssetId(null);
    }
  };

  if (project.isLoading) {
    return (
      <div className="page">
        <div className="panel-empty">Opening the picture studio…</div>
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>STUDIO CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;

  return (
    <PreviewLayout
      canvas={
        <PreviewCanvasColumn
          view={view}
          onViewChange={setView}
          hasDiff={hasDiff}
          eyebrow={<span className="eyebrow">Big canvas</span>}
          preview={
            <VideoCanvas
              projectId={p.id}
              version={activeVersion ? { id: activeVersion.id, leg: activeVersion.leg, version: activeVersion.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
              assets={p.assets}
              vaultAssetId={vaultAssetId ?? undefined}
              seekRequest={seekRequest}
            />
          }
          diff={
            // Split-screen VCS: the selected version vs its immediate
            // predecessor (renders nothing for the oldest / lone version).
            <PreviewDiff
              projectId={p.id}
              leg={activeVersion?.leg ?? 'SELECTS'}
              versions={diffVersions}
              selected={activeSelection}
              fallbackAssetIds={(p.assets ?? []).filter((a) => VIDEO_KINDS.has(a.kind)).map((a) => a.id)}
            />
          }
        />
      }
      rail={
        <PreviewNotesPanel
          projectId={p.id}
          legs={VIDEO_LEGS}
          onSeek={onNoteSeek}
        />
      }
      versions={
        <VersionCarousel
          items={carouselItems}
          activeKey={activeKey}
          onSelect={onCarouselSelect}
          emptyText="No selects or cut versions saved yet — save a snapshot in the Selects or Cut studio first."
        />
      }
    />
  );
}
