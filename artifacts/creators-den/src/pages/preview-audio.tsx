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
import { EmptyPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import {
  FullscreenButton,
  PreviewNotesPanel,
  RoleDownloadBar,
  RoleLayout,
  RoleUploadBar,
  VersionList,
  WaveformPlayer,
  type PreviewVersion,
} from '@/components/preview-shared';
import type { StudioLeg } from '@/components/role-oracle';

const AUDIO_KINDS = new Set(['RAW_AUDIO', 'VO_PICKUP']);

// This role page accepts audio files only — the accept list and the client
// check below reject anything else (no video / image / script files here).
const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.aif,.aiff,.opus';
const AUDIO_FILE_RE = /\.(wav|mp3|m4a|aac|flac|ogg|aif|aiff|opus)$/i;
const checkAudioFile = (file: File): string | null =>
  file.type.startsWith('audio/') || AUDIO_FILE_RE.test(file.name)
    ? null
    : 'Only audio files can be uploaded here (.wav, .mp3, .m4a, .flac, .ogg).';

// ---------------------------------------------------------------------------
// AudioCanvas — the wave canvas for one selected SOUND version. Falls back to
// the vault's processed audio when the version has none on its timeline.
// ---------------------------------------------------------------------------

function AudioCanvas({
  projectId,
  version,
  assets,
}: {
  projectId: string;
  version: { id: string; leg: StudioLeg; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const comments = useListVideoComments(projectId);

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
  // falls back to real, playable audio.
  const firstValid = (id?: string) => (id && assets.some((a) => a.id === id) ? id : undefined);
  const assetId = firstValid(clips[0]?.assetId) ?? firstValid(music[0]?.assetId) ?? firstValid(pickups[0]?.assetId) ?? fallback?.id ?? '';
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
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={version?.leg ?? 'SOUND'}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={version?.id}
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

  // The file shown in the player — the selected version's first audio reference
  // when it still exists in the vault, otherwise the first playable audio asset.
  const versionSnap = (selectedDetail.data?.snapshot ?? null) as {
    clips?: Array<{ assetId: string }>;
    music?: Array<{ assetId: string }>;
    pickups?: Array<{ assetId: string }>;
  } | null;
  const versionAsset =
    (Array.isArray(versionSnap?.clips) ? versionSnap!.clips![0]?.assetId : undefined) ??
    (Array.isArray(versionSnap?.music) ? versionSnap!.music![0]?.assetId : undefined) ??
    (Array.isArray(versionSnap?.pickups) ? versionSnap!.pickups![0]?.assetId : undefined) ??
    '';
  const vaultAudio = p.assets.find((a) => AUDIO_KINDS.has(a.kind) && a.status === 'PROCESSED') ?? p.assets.find((a) => AUDIO_KINDS.has(a.kind)) ?? null;
  const downloadAssetId = (versionAsset && p.assets.some((a) => a.id === versionAsset) ? versionAsset : '') || vaultAudio?.id || '';

  return (
    <RoleLayout
      versions={
        <VersionList
          versions={versions}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          emptyText="No sound versions saved yet — save a snapshot in the Sound studio first."
        />
      }
      canvas={
        <AudioCanvas
          projectId={p.id}
          version={selected ? { id: selected.id, leg: selected.leg, version: selected.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
          assets={p.assets}
        />
      }
      download={
        <RoleDownloadBar projectId={p.id} assetId={downloadAssetId} label="audio file" released={p.status === 'RELEASED'} />
      }
      notes={
        <PreviewNotesPanel
          projectId={p.id}
          legs={['SOUND']}
        />
      }
      upload={
        <RoleUploadBar projectId={p.id} label="audio file" accept={AUDIO_ACCEPT} kind="RAW_AUDIO" checkFormat={checkAudioFile} />
      }
    />
  );
}
