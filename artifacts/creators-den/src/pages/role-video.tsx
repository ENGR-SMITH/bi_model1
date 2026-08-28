// ---------------------------------------------------------------------------
// Video role page — the picture studio.
//
// Column one: a vertical scrolling shelf mixing the project's SELECTS + CUT
// versions with the vault's video uploads. Column two, row 1: the big canvas
// — the selected version's clip (or the picked vault file) streams as a
// proxy, with the spatial AnnotationCanvas on top and a full-screen expand
// button. Column two, row 2: the upload card. Column three, row 1: the pin /
// comment wall; row 2: the Visual Editor's oracle.
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
import { AssetPlayer, EmptyPlayer, pollWhileProcessing, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { VersionShelf, type ShelfItem } from '@/components/version-shelf';
import { formatTimecode } from '@/components/timeline';
import {
  PreviewNotesPanel,
  RoleLayout,
  RoleUploadCard,
  VAULT_KIND_LABELS,
  type PreviewVersion,
} from '@/components/preview-shared';
import { RoleOracle } from '@/components/role-oracle';
import { RoleAccessDenied } from '@/components/role-access-denied';
import { hasRole } from '@/lib/roles';
import { activeClipAt, type TimelineSnapshotLike } from '@/lib/diff';
import type { StudioLeg } from '@/components/role-oracle';

const VIDEO_LEGS: StudioLeg[] = ['SELECTS', 'CUT'];
const VIDEO_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE']);
const VIDEO_UPLOAD_KINDS = ['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE'].map((value) => ({ value, label: VAULT_KIND_LABELS[value] }));

// This role page accepts video files only — the accept list and the client
// check below reject anything else (no audio / image / script files here).
const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.mkv,.webm,.avi,.mpg,.mpeg';
const VIDEO_FILE_RE = /\.(mp4|mov|m4v|mkv|webm|avi|mpg|mpeg)$/i;
const checkVideoFile = (file: File): string | null =>
  file.type.startsWith('video/') || VIDEO_FILE_RE.test(file.name)
    ? null
    : 'Only video files can be uploaded here (.mp4, .mov, .webm, .mkv, .avi).';

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
  /** Explicit vault asset to preview (picked from the version shelf). */
  vaultAssetId?: string;
  /** A note-click seek from the comments rail — jumps the player to it. */
  seekRequest?: { ms: number; n: number } | null;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
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
  // vault file (from the shelf) wins over everything.
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
    <div className="paper-card pv-stage" data-testid="video-canvas">
      <div className="pv-stage-player">
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
            {/* Review pins still render; the Annotate button is intentionally
                off here — the video player has native fullscreen, and pins
                are managed from the preview studios instead. */}
            <AnnotationCanvas
              projectId={projectId}
              leg={version?.leg ?? 'SELECTS'}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={version?.id}
              canAnnotate={false}
              timecodeReveal
              glowPins
            />
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

export default function RoleVideoPage() {
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
  // canvas shows the picked file instead of the newest version's clip.
  const activeVersion = vaultAssetId ? null : selected;

  // Version shelf: timeline versions (newest first) + the vault's video
  // uploads, each tagged with its leg / kind.
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
      .filter((a) => VIDEO_KINDS.has(a.kind))
      .map((a) => ({
        key: `asset-${a.id}`,
        kind: 'asset' as const,
        fileName: a.fileName,
        kindLabel: VAULT_KIND_LABELS[a.kind] ?? a.kind,
        status: a.status,
        media: 'video' as const,
        thumbUrl: a.status === 'PROCESSED' ? proxyUrlFor(projectId, a.id) : undefined,
      }));
    return [...versionItems, ...vaultItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, project.data?.assets, projectId]);

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
    const snap = (selectedDetail.data?.snapshot ?? null) as TimelineSnapshotLike | null;
    const clips = Array.isArray(snap?.clips) ? snap!.clips! : [];
    const firstClipAsset = clips[0]?.assetId;
    const vaultVideo = proj.assets.find((a) => VIDEO_KINDS.has(a.kind) && a.status === 'PROCESSED') ?? proj.assets.find((a) => VIDEO_KINDS.has(a.kind)) ?? null;
    return (vaultAssetId && proj.assets.some((a) => a.id === vaultAssetId) ? vaultAssetId : '') ||
      (firstClipAsset && proj.assets.some((a) => a.id === firstClipAsset) ? firstClipAsset : '') ||
      vaultVideo?.id || '';
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
      `Active: ${activeVersion ? `${activeVersion.leg} v${activeVersion.version}${activeVersion.message ? ` — ${activeVersion.message}` : ''}` : vaultAssetId ? 'a vault file' : 'nothing yet'}`,
      `Vault (${proj.assets.length} file${proj.assets.length === 1 ? '' : 's'}): ${proj.assets.map((a) => `${a.fileName} [${a.kind}]`).join(', ') || 'empty'}`,
      `Transcript:\n${lines.slice(0, 6000) || '(no transcript yet)'}`,
    ].join('\n\n').slice(0, 12000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.data, activeVersion, vaultAssetId, oracleAsset.data]);

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

  // The Video studio only opens for members with the VIDEO role (or the
  // Captain). The nav tab stays visible — this page explains why it is locked.
  if (!hasRole(p.myRoles, 'VIDEO')) {
    return <RoleAccessDenied role="Video" projectId={p.id} />;
  }

  return (
    <RoleLayout
      versions={
        <VersionShelf
          items={shelfItems}
          activeKey={activeKey}
          onSelect={onShelfSelect}
          emptyText="No versions or vault files yet — save a snapshot in the Selects or Cut studio, or upload footage above."
        />
      }
      canvas={
        <VideoCanvas
          projectId={p.id}
          version={activeVersion ? { id: activeVersion.id, leg: activeVersion.leg, version: activeVersion.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
          assets={p.assets}
          vaultAssetId={vaultAssetId ?? undefined}
          seekRequest={seekRequest}
        />
      }
      notes={
        <PreviewNotesPanel
          projectId={p.id}
          legs={VIDEO_LEGS}
          onSeek={onNoteSeek}
          allowResolve
        />
      }
      oracle={
        <RoleOracle
          leg="CUT"
          roleName="Video Editor"
          context={oracleContext}
          placeholder="e.g. Where should the next cut land, and which take is strongest?"
        />
      }
      upload={
        <RoleUploadCard
          projectId={p.id}
          label="video file"
          kinds={VIDEO_UPLOAD_KINDS}
          defaultKind="RAW_VIDEO"
          accept={VIDEO_ACCEPT}
          checkFormat={checkVideoFile}
        />
      }
    />
  );
}
