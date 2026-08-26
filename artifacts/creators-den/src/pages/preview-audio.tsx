// ---------------------------------------------------------------------------
// Audio preview — the sound studio.
//
// Left column, row 1: the big canvas — the selected version's audio plays as
// a wavelength bar view with a red tick at the exact playhead / annotation
// time. Pins drop straight on the wave (colour-tagged), and the full-screen
// button expands the canvas.
// Left column, row 2: the carousel of the project's SOUND versions.
// Right column: the pin / comment wall.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, AudioLines, LockKeyhole, Play } from 'lucide-react';
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
import { EmptyPlayer } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import {
  FullscreenButton,
  PreviewLayout,
  PreviewNotesPanel,
  VersionCarousel,
  WaveformPlayer,
  type PreviewVersion,
} from '@/components/preview-shared';
import type { StudioLeg } from '@/components/role-oracle';

// ---------------------------------------------------------------------------
// AudioCanvas — the wave canvas for one selected SOUND version.
// ---------------------------------------------------------------------------

function AudioCanvas({
  projectId,
  version,
  assets,
}: {
  projectId: string;
  version: { id: string; leg: StudioLeg; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string }>;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const comments = useListVideoComments(projectId);

  const snap = (version?.snapshot ?? null) as {
    clips?: Array<{ id?: string; assetId: string; inMs: number; outMs: number }>;
    music?: Array<{ id?: string; assetId: string; inMs: number; outMs: number; duckUnderSpeech?: boolean }>;
    pickups?: Array<{ id?: string; assetId: string; timeMs: number }>;
  } | null;
  const clips = Array.isArray(snap?.clips) ? snap!.clips! : [];
  const music = Array.isArray(snap?.music) ? snap!.music! : [];
  const pickups = Array.isArray(snap?.pickups) ? snap!.pickups! : [];
  const assetId = clips[0]?.assetId ?? music[0]?.assetId ?? pickups[0]?.assetId ?? '';
  const detail = useGetVideoAsset(projectId, assetId, {
    query: { queryKey: getGetVideoAssetQueryKey(projectId, assetId), enabled: Boolean(assetId) },
  });
  const assetName = assets.find((a) => a.id === assetId)?.fileName ?? assetId.slice(0, 8);

  const onSeek = (ms: number) => setPlayheadMs(ms);

  // Red ticks = annotation timecodes + pickup pins; teal = clip boundaries.
  const markers = useMemo(() => {
    const list: Array<{ id: string; ms: number; tone: 'danger' | 'teal' }> = [];
    for (const comment of comments.data ?? []) {
      if (comment.timecodeMs == null || comment.leg !== version?.leg) continue;
      list.push({ id: `note-${comment.id}`, ms: comment.timecodeMs, tone: 'danger' });
    }
    clips.forEach((clip, index) => list.push({ id: `clip-${index}`, ms: clip.inMs, tone: 'teal' }));
    pickups.forEach((pickup, index) => list.push({ id: `pickup-${index}`, ms: pickup.timeMs, tone: 'danger' }));
    return list;
  }, [comments.data, clips, pickups, version?.leg]);

  if (!version) {
    return (
      <div className="paper-card pv-stage" data-testid="audio-canvas">
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
    <div className="paper-card pv-stage" ref={stageRef} data-testid="audio-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><AudioLines size={13} /> Big canvas · SOUND v{version.version}</span>
        <span className="flex items-center gap-2">
          {assetId && <span className="den-tag gold truncate">{assetName}</span>}
        </span>
      </div>
      <div className="pv-stage-player mt-3">
        {assetId ? (
          <WaveformPlayer
            projectId={projectId}
            assetId={assetId}
            detail={detail.data}
            playheadMs={playheadMs}
            onTimeUpdate={onSeek}
            onPlayheadChange={onSeek}
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
          </WaveformPlayer>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">This version has no audio on the timeline.</p>
            <p className="text-xs opacity-70">Save a snapshot in the Sound studio to see it here.</p>
          </EmptyPlayer>
        )}
        <FullscreenButton targetRef={stageRef} />
      </div>
      {assetId && (
        <div className="cd-metarow mt-3">
          <span className="cd-metatext min-w-0">
            <b className="truncate">{assetName}</b>
            <small>
              {clips.length} clip{clips.length === 1 ? '' : 's'} · {music.length} music track{music.length === 1 ? '' : 's'} · {pickups.length} pickup{pickups.length === 1 ? '' : 's'} in v{version.version}
            </small>
          </span>
        </div>
      )}
      <p className="den-footnote mt-3">
        <LockKeyhole size={13} />
        Streaming the degraded proxy — the locked original never leaves the vault. The red tick marks the exact annotation time on the wave.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AudioPreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);
  const soundVersions = useListVideoTimelineVersions(projectId, 'SOUND');
  const soundTimeline = useGetVideoTimeline(projectId, 'SOUND');

  const versions = useMemo<PreviewVersion[]>(
    () =>
      (soundVersions.data ?? [])
        .map((v) => ({
          id: v.id,
          leg: 'SOUND' as const,
          version: v.version,
          message: v.message ?? '',
          createdAt: v.createdAt,
          isHead: v.version === soundTimeline.data?.version,
        }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [soundVersions.data, soundTimeline.data?.version],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        <div className="panel-empty">Opening the sound studio…</div>
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
        <AudioCanvas
          projectId={p.id}
          version={selected ? { id: selected.id, leg: selected.leg, version: selected.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
          assets={p.assets}
        />
      }
      rail={
        <PreviewNotesPanel
          projectId={p.id}
          legs={['SOUND']}
          timelineVersionId={selected?.id}
          composerLeg="SOUND"
        />
      }
      versions={
        <VersionCarousel
          versions={versions}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          emptyText="No sound versions saved yet — save a snapshot in the Sound studio first."
        />
      }
    />
  );
}
