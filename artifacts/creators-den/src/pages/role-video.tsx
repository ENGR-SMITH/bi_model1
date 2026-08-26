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
import { AssetPlayer, EmptyPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { formatTimecode } from '@/components/timeline';
import {
  FullscreenButton,
  PreviewNotesPanel,
  RoleDownloadBar,
  RoleLayout,
  RoleUploadBar,
  VersionList,
  type PreviewVersion,
} from '@/components/preview-shared';
import { activeClipAt, type TimelineSnapshotLike } from '@/lib/diff';
import type { StudioLeg } from '@/components/role-oracle';

const VIDEO_LEGS: StudioLeg[] = ['SELECTS', 'CUT'];
const VIDEO_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE']);

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
}: {
  projectId: string;
  version: { id: string; leg: StudioLeg; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const comments = useListVideoComments(projectId);

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
  // canvas always falls back to real, playable media.
  const clipAssetId = activeClip?.assetId && assets.some((a) => a.id === activeClip.assetId) ? activeClip.assetId : '';
  const assetId = clipAssetId || fallback?.id || '';
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
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={version?.leg ?? 'SELECTS'}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={version?.id}
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

export default function RoleVideoPage() {
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

  // The file shown in the player — the selected version's first clip when it
  // still exists in the vault, otherwise the first playable video asset.
  const versionSnap = (selectedDetail.data?.snapshot ?? null) as TimelineSnapshotLike | null;
  const versionClips = Array.isArray(versionSnap?.clips) ? versionSnap!.clips! : [];
  const firstClipAsset = versionClips[0]?.assetId;
  const vaultVideo = p.assets.find((a) => VIDEO_KINDS.has(a.kind) && a.status === 'PROCESSED') ?? p.assets.find((a) => VIDEO_KINDS.has(a.kind)) ?? null;
  const downloadAssetId = (firstClipAsset && p.assets.some((a) => a.id === firstClipAsset) ? firstClipAsset : '') || vaultVideo?.id || '';

  return (
    <RoleLayout
      versions={
        <VersionList
          versions={versions}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          emptyText="No selects or cut versions saved yet — save a snapshot in the Selects or Cut studio first."
        />
      }
      canvas={
        <VideoCanvas
          projectId={p.id}
          version={selected ? { id: selected.id, leg: selected.leg, version: selected.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
          assets={p.assets}
        />
      }
      download={
        <RoleDownloadBar projectId={p.id} assetId={downloadAssetId} label="video file" released={p.status === 'RELEASED'} />
      }
      notes={
        <PreviewNotesPanel
          projectId={p.id}
          legs={VIDEO_LEGS}
        />
      }
      upload={
        <RoleUploadBar projectId={p.id} label="video file" accept={VIDEO_ACCEPT} kind="RAW_VIDEO" checkFormat={checkVideoFile} />
      }
    />
  );
}
