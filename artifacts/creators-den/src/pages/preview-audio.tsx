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
import { ArrowLeft, AudioLines } from 'lucide-react';
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
import { EmptyPlayer, pollWhileProcessing, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { PreviewDiff, type PreviewDiffSelection } from '@/components/preview-diff';
import {
  FullscreenButton,
  PreviewLayout,
  PreviewNotesPanel,
  VAULT_KIND_LABELS,
  VersionCarousel,
  WaveformPlayer,
  type CarouselItem,
  type PreviewVersion,
} from '@/components/preview-shared';
import type { StudioLeg } from '@/components/role-oracle';

const AUDIO_KINDS = new Set(['RAW_AUDIO', 'VO_PICKUP']);

// ---------------------------------------------------------------------------
// AudioCanvas — the wave canvas for one selected SOUND version. Falls back to
// the vault's processed audio when the version has none on its timeline.
// ---------------------------------------------------------------------------

function AudioCanvas({
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
  const stageRef = useRef<HTMLDivElement>(null);
  const annotationHeaderRef = useRef<HTMLDivElement>(null);
  const comments = useListVideoComments(projectId);

  // The comments rail and this canvas are siblings, so the page lifts a
  // note-click seek up and passes it back down — the wave follows the new
  // playhead (the audio element syncs to it inside WaveformPlayer).
  useEffect(() => {
    if (!seekRequest) return;
    setPlayheadMs(seekRequest.ms);
  }, [seekRequest]);

  const snap = version ? ((version.snapshot ?? null) as {
    clips?: Array<{ id?: string; assetId: string; inMs: number; outMs: number }>;
    music?: Array<{ id?: string; assetId: string; inMs: number; outMs: number; duckUnderSpeech?: boolean }>;
    pickups?: Array<{ id?: string; assetId: string; timeMs: number }>;
  } | null) : null;
  const clips = Array.isArray(snap?.clips) ? snap!.clips! : [];
  const music = Array.isArray(snap?.music) ? snap!.music! : [];
  const pickups = Array.isArray(snap?.pickups) ? snap!.pickups! : [];

  const fallback = useMemo(
    () =>
      assets.find((a) => AUDIO_KINDS.has(a.kind) && a.status === 'PROCESSED') ??
      assets.find((a) => AUDIO_KINDS.has(a.kind)) ??
      null,
    [assets],
  );
  // Validate snapshot references against the vault so a stale/missing asset
  // falls back to real, playable audio. An explicitly picked vault file
  // (from the timeline row) wins over everything.
  const explicitAsset = vaultAssetId && assets.some((a) => a.id === vaultAssetId) ? vaultAssetId : undefined;
  const firstValid = (id?: string) => (id && assets.some((a) => a.id === id) ? id : undefined);
  const assetId = explicitAsset ?? firstValid(clips[0]?.assetId) ?? firstValid(music[0]?.assetId) ?? firstValid(pickups[0]?.assetId) ?? fallback?.id ?? '';
  const detail = useGetVideoAsset(projectId, assetId, {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId),
      enabled: Boolean(assetId),
      // Keep fetching until the proxy finishes, then stop on its own — same
      // behaviour as the vault player.
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });
  const onSeek = (ms: number) => setPlayheadMs(ms);

  // Red ticks = annotation timecodes + pickup pins; teal = clip boundaries.
  const markers = useMemo(() => {
    const list: Array<{ id: string; ms: number; tone: 'danger' | 'teal' }> = [];
    if (version) {
      for (const comment of comments.data ?? []) {
        if (comment.timecodeMs == null || comment.leg !== version.leg) continue;
        list.push({ id: `note-${comment.id}`, ms: comment.timecodeMs, tone: 'danger' });
      }
    }
    clips.forEach((clip, index) => list.push({ id: `clip-${index}`, ms: clip.inMs, tone: 'teal' }));
    pickups.forEach((pickup, index) => list.push({ id: `pickup-${index}`, ms: pickup.timeMs, tone: 'danger' }));
    return list;
  }, [comments.data, clips, pickups, version]);

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="audio-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><AudioLines size={13} /> Big canvas{version ? ` · SOUND v${version.version}` : ''}</span>
        <span className="flex items-center gap-2">
          {!version && <span className="den-tag teal">vault preview</span>}
          <div ref={annotationHeaderRef} className="annotation-header-slot" />
        </span>
      </div>
      <div className="pv-stage-player mt-2">
        {assetId ? (
          <WaveformPlayer
            projectId={projectId}
            assetId={assetId}
            detail={detail.data}
            playheadMs={playheadMs}
            onTimeUpdate={onSeek}
            onPlayheadChange={onSeek}
            markers={markers}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={version?.leg ?? 'SOUND'}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={version?.id}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
              dropLine
            />
            <FullscreenButton targetRef={stageRef} />
          </WaveformPlayer>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">No audio in the vault yet.</p>
            <p className="text-xs opacity-70">Add audio in the vault to preview it here.</p>
          </EmptyPlayer>
        )}
      </div>
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
  // Last note-click seek from the comments rail, with a counter so repeat
  // clicks on the same timecode still re-trigger the canvas effect.
  const [seekRequest, setSeekRequest] = useState<{ ms: number; n: number } | null>(null);
  const onNoteSeek = (ms: number) => setSeekRequest((prev) => ({ ms, n: (prev?.n ?? 0) + 1 }));
  const soundVersions = useListVideoTimelineVersions(projectId, 'SOUND');
  const soundTimeline = useGetVideoTimeline(projectId, 'SOUND');

  // Raw SOUND version rows feed the split-screen diff (selected vs its
  // immediate predecessor).
  const diffVersions = useMemo<PreviewDiffSelection[]>(
    () =>
      (soundVersions.data ?? []).map((v) => ({
        id: v.id,
        leg: 'SOUND' as const,
        version: v.version,
        parentVersionId: v.parentVersionId ?? null,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [soundVersions.data],
  );

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
  const [vaultAssetId, setVaultAssetId] = useState<string | null>(null);

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

  // While a vault file is being previewed there is no active version.
  const activeVersion = vaultAssetId ? null : selected;

  // Timeline row: versions (newest first) + the vault's audio uploads.
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
      .filter((a) => AUDIO_KINDS.has(a.kind))
      .map((a) => ({
        key: `asset-${a.id}`,
        kind: 'asset',
        id: a.id,
        fileName: a.fileName,
        kindLabel: VAULT_KIND_LABELS[a.kind] ?? a.kind,
        status: a.status,
        media: 'audio',
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
        <>
          <AudioCanvas
            projectId={p.id}
            version={activeVersion ? { id: activeVersion.id, leg: activeVersion.leg, version: activeVersion.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
            assets={p.assets}
            vaultAssetId={vaultAssetId ?? undefined}
            seekRequest={seekRequest}
          />
          {/* Split-screen VCS: the selected version vs its immediate predecessor,
              shown beneath the canvas when there's an older version to compare. */}
          <PreviewDiff
            projectId={p.id}
            leg="SOUND"
            versions={diffVersions}
            selected={activeVersion ? { id: activeVersion.id, leg: activeVersion.leg, version: activeVersion.version } : null}
          />
        </>
      }
      rail={
        <PreviewNotesPanel
          projectId={p.id}
          legs={['SOUND']}
          onSeek={onNoteSeek}
        />
      }
      versions={
        <VersionCarousel
          items={carouselItems}
          activeKey={activeKey}
          onSelect={onCarouselSelect}
          emptyText="No sound versions saved yet — save a snapshot in the Sound studio first."
        />
      }
    />
  );
}
