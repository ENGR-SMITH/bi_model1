// ---------------------------------------------------------------------------
// Audio role page — the sound studio.
//
// Column one: a vertical scrolling shelf mixing the project's SOUND versions
// with the vault's audio uploads. Column two, row 1: the big canvas — the
// selected version's audio (or the picked vault file) plays as a wavelength
// bar view with a red tick at the playhead; pins drop straight on the wave.
// Column two, row 2: the upload card. Column three, row 1: the pin / comment
// wall; row 2: the Sound Designer's oracle.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
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
import { VersionShelf, type ShelfItem } from '@/components/version-shelf';
import { formatTimecode } from '@/components/timeline';
import {
  FullscreenButton,
  PreviewNotesPanel,
  RoleLayout,
  RoleUploadCard,
  VAULT_KIND_LABELS,
  WaveformPlayer,
  type PreviewVersion,
} from '@/components/preview-shared';
import { RoleOracle } from '@/components/role-oracle';
import type { StudioLeg } from '@/components/role-oracle';

const AUDIO_KINDS = new Set(['RAW_AUDIO', 'VO_PICKUP']);
const AUDIO_UPLOAD_KINDS = ['RAW_AUDIO', 'VO_PICKUP'].map((value) => ({ value, label: VAULT_KIND_LABELS[value] }));

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
  vaultAssetId,
}: {
  projectId: string;
  version: { id: string; leg: StudioLeg; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
  /** Explicit vault asset to preview (picked from the version shelf). */
  vaultAssetId?: string;
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
  // falls back to real, playable audio. An explicitly picked vault file (from
  // the shelf) wins over everything.
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
      <div className="pv-stage-player">
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
            {/* Review pins still render; the Annotate button is intentionally
                off here — pins are managed from the preview studios instead. */}
            <AnnotationCanvas
              projectId={projectId}
              leg={version?.leg ?? 'SOUND'}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={version?.id}
              canAnnotate={false}
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

export default function RoleAudioPage() {
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
  const [vaultAssetId, setVaultAssetId] = useState<string | null>(null);

  // Default to the newest version once the list arrives (unless a vault file
  // has been picked from the version shelf).
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
  // canvas shows the picked file instead of the newest version's mix.
  const activeVersion = vaultAssetId ? null : selected;

  // Version shelf: SOUND versions (newest first) + the vault's audio uploads.
  const shelfItems = useMemo<ShelfItem[]>(() => {
    const proj = project.data;
    const versionItems: ShelfItem[] = versions.map((v) => ({
      key: `version-${v.id}`,
      kind: 'version' as const,
      version: v.version,
      leg: v.leg,
      message: v.message,
      createdAt: v.createdAt,
      isHead: v.isHead,
    }));
    const vaultItems: ShelfItem[] = (proj?.assets ?? [])
      .filter((a) => AUDIO_KINDS.has(a.kind))
      .map((a) => ({
        key: `asset-${a.id}`,
        kind: 'asset' as const,
        fileName: a.fileName,
        kindLabel: VAULT_KIND_LABELS[a.kind] ?? a.kind,
        status: a.status,
        media: 'audio' as const,
      }));
    return [...versionItems, ...vaultItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, project.data?.assets]);

  const activeKey = vaultAssetId ? `asset-${vaultAssetId}` : selected ? `version-${selected.id}` : shelfItems[0]?.key ?? null;

  const onShelfSelect = (key: string) => {
    if (key.startsWith('asset-')) {
      setVaultAssetId(key.slice('asset-'.length));
      setSelectedId(null);
    } else {
      setSelectedId(key.slice('version-'.length));
      setVaultAssetId(null);
    }
  };

  // The asset actually shown in the player — feeds the oracle's context
  // (transcript + vault). Same query key the canvas uses, so no duplicate fetch.
  const canvasAssetId = useMemo(() => {
    const proj = project.data;
    if (!proj) return '';
    const snap = (selectedDetail.data?.snapshot ?? null) as {
      clips?: Array<{ assetId: string }>;
      music?: Array<{ assetId: string }>;
      pickups?: Array<{ assetId: string }>;
    } | null;
    const versionAsset =
      (Array.isArray(snap?.clips) ? snap!.clips![0]?.assetId : undefined) ??
      (Array.isArray(snap?.music) ? snap!.music![0]?.assetId : undefined) ??
      (Array.isArray(snap?.pickups) ? snap!.pickups![0]?.assetId : undefined) ??
      '';
    const vaultAudio = proj.assets.find((a) => AUDIO_KINDS.has(a.kind) && a.status === 'PROCESSED') ?? proj.assets.find((a) => AUDIO_KINDS.has(a.kind)) ?? null;
    return (vaultAssetId && proj.assets.some((a) => a.id === vaultAssetId) ? vaultAssetId : '') ||
      (versionAsset && proj.assets.some((a) => a.id === versionAsset) ? versionAsset : '') ||
      vaultAudio?.id || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.data, vaultAssetId, selectedDetail.data?.snapshot]);

  const oracleAsset = useGetVideoAsset(projectId, canvasAssetId, {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, canvasAssetId),
      enabled: Boolean(canvasAssetId),
    },
  });

  const oracleContext = useMemo(() => {
    const proj = project.data;
    if (!proj) return '';
    const lines = (oracleAsset.data?.transcript?.segments ?? [])
      .map((s) => `${formatTimecode(s.startMs)}–${formatTimecode(s.endMs)}: ${s.text}`)
      .join('\n');
    return [
      `Project: ${proj.name}`,
      `Active: ${activeVersion ? `SOUND v${activeVersion.version}${activeVersion.message ? ` — ${activeVersion.message}` : ''}` : vaultAssetId ? 'a vault file' : 'nothing yet'}`,
      `Vault (${proj.assets.length} file${proj.assets.length === 1 ? '' : 's'}): ${proj.assets.map((a) => `${a.fileName} [${a.kind}]`).join(', ') || 'empty'}`,
      `Transcript:\n${lines.slice(0, 6000) || '(no transcript yet)'}`,
    ].join('\n\n').slice(0, 12000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.data, activeVersion, vaultAssetId, oracleAsset.data]);

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
    <RoleLayout
      versions={
        <VersionShelf
          items={shelfItems}
          activeKey={activeKey}
          onSelect={onShelfSelect}
          emptyText="No versions or vault files yet — save a snapshot in the Sound studio, or upload audio above."
        />
      }
      canvas={
        <AudioCanvas
          projectId={p.id}
          version={activeVersion ? { id: activeVersion.id, leg: activeVersion.leg, version: activeVersion.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
          assets={p.assets}
          vaultAssetId={vaultAssetId ?? undefined}
        />
      }
      notes={
        <PreviewNotesPanel
          projectId={p.id}
          legs={['SOUND']}
        />
      }
      oracle={
        <RoleOracle
          leg="SOUND"
          roleName="Sound Designer"
          context={oracleContext}
          placeholder="e.g. Where should the score duck under the dialogue?"
        />
      }
      upload={
        <RoleUploadCard
          projectId={p.id}
          label="audio file"
          kinds={AUDIO_UPLOAD_KINDS}
          defaultKind="RAW_AUDIO"
          accept={AUDIO_ACCEPT}
          checkFormat={checkAudioFile}
        />
      }
    />
  );
}
