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
import { ArrowLeft, LockKeyhole, Play } from 'lucide-react';
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
import { AssetPlayer, EmptyPlayer } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { formatTimecode } from '@/components/timeline';
import {
  FullscreenButton,
  PreviewLayout,
  PreviewNotesPanel,
  VersionCarousel,
  type PreviewVersion,
} from '@/components/preview-shared';
import { activeClipAt, type TimelineSnapshotLike } from '@/lib/diff';
import type { StudioLeg } from '@/components/role-oracle';

const VIDEO_LEGS: StudioLeg[] = ['SELECTS', 'CUT'];

// ---------------------------------------------------------------------------
// VideoCanvas — the big canvas for one selected version.
// ---------------------------------------------------------------------------

function VideoCanvas({
  projectId,
  version,
  assets,
}: {
  projectId: string;
  version: { id: string; leg: StudioLeg; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string }>;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const comments = useListVideoComments(projectId);

  const snap = (version?.snapshot ?? null) as TimelineSnapshotLike | null;
  const clips = Array.isArray(snap?.clips) ? snap!.clips! : [];
  const activeClip = activeClipAt(snap, playheadMs) ?? clips[0] ?? null;
  const assetId = activeClip?.assetId ?? '';
  const detail = useGetVideoAsset(projectId, assetId, {
    query: { queryKey: getGetVideoAssetQueryKey(projectId, assetId), enabled: Boolean(assetId) },
  });
  const assetName = assets.find((a) => a.id === assetId)?.fileName ?? assetId.slice(0, 8);

  const onSeek = (ms: number) => {
    setPlayheadMs(ms);
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  };

  // Red ticks = annotation timecodes for this leg; teal ticks = clip boundaries.
  const markers = useMemo(() => {
    const list: Array<{ id: string; ms: number; tone: 'danger' | 'teal' }> = [];
    for (const comment of comments.data ?? []) {
      if (comment.timecodeMs == null || comment.leg !== version?.leg) continue;
      list.push({ id: `note-${comment.id}`, ms: comment.timecodeMs, tone: 'danger' });
    }
    clips.forEach((clip, index) => {
      list.push({ id: `clip-${index}`, ms: clip.inMs, tone: 'teal' });
    });
    return list;
  }, [comments.data, clips, version?.leg]);

  if (!version) {
    return (
      <div className="paper-card pv-stage" data-testid="video-canvas">
        <div className="inline-heading">
          <span className="eyebrow"><Play size={13} /> Big canvas</span>
        </div>
        <EmptyPlayer className="mt-3">
          <p className="text-sm font-semibold">No version selected yet.</p>
        </EmptyPlayer>
      </div>
    );
  }

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="video-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><Play size={13} /> Big canvas · {version.leg} v{version.version}</span>
        <span className="flex items-center gap-2">
          {activeClip && <span className="den-tag gold truncate">{assetName}</span>}
          <span className="mono-label">{formatTimecode(playheadMs)}</span>
        </span>
      </div>
      <div className="pv-stage-player mt-3">
        {assetId ? (
          <AssetPlayer
            projectId={projectId}
            assetId={assetId}
            detail={detail.data}
            videoRef={videoRef}
            playheadMs={playheadMs}
            onTimeUpdate={setPlayheadMs}
            markers={markers}
            title={assetName}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={version.leg}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={version.id}
            />
          </AssetPlayer>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">This version has no clips on the timeline.</p>
            <p className="text-xs opacity-70">Save a snapshot in the Selects or Cut studio to see it here.</p>
          </EmptyPlayer>
        )}
        <FullscreenButton targetRef={stageRef} />
      </div>
      {activeClip && (
        <div className="cd-metarow mt-3">
          <span className="cd-metatext min-w-0">
            <b className="truncate">{assetName}</b>
            <small>
              window {formatTimecode(activeClip.inMs)} → {formatTimecode(activeClip.outMs)} · {clips.length} clip{clips.length === 1 ? '' : 's'} in v{version.version}
            </small>
          </span>
        </div>
      )}
      <p className="den-footnote mt-3">
        <LockKeyhole size={13} />
        Streaming the degraded proxy — the locked original never leaves the vault. Red ticks mark annotation timecodes on the timeline.
      </p>
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

  const selectsVersions = useListVideoTimelineVersions(projectId, 'SELECTS');
  const cutVersions = useListVideoTimelineVersions(projectId, 'CUT');
  const selectsTimeline = useGetVideoTimeline(projectId, 'SELECTS');
  const cutTimeline = useGetVideoTimeline(projectId, 'CUT');

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

  // Default to the newest version once the list arrives.
  useEffect(() => {
    if (!selectedId && versions.length > 0) setSelectedId(versions[0].id);
  }, [versions, selectedId]);

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;
  const selectedDetail = useGetVideoTimelineVersion(projectId, selected?.leg ?? '', selected?.id ?? '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, selected?.leg ?? '', selected?.id ?? ''),
      enabled: Boolean(selected),
    },
  });

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
      main={
        <>
          <VideoCanvas
            projectId={p.id}
            version={selected ? { id: selected.id, leg: selected.leg, version: selected.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
            assets={p.assets}
          />
          <VersionCarousel
            versions={versions}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            emptyText="No selects or cut versions saved yet — save a snapshot in the Selects or Cut studio first."
          />
        </>
      }
      rail={
        <PreviewNotesPanel
          projectId={p.id}
          legs={VIDEO_LEGS}
          timelineVersionId={selected?.id}
          composerLeg={selected?.leg ?? 'SELECTS'}
        />
      }
    />
  );
}
