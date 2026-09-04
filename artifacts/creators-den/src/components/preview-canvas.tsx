// ---------------------------------------------------------------------------
// Preview canvases — the BIG CANVAS stage shared by the preview studios and
// the Captain's review desk.
//
// These are the exact implementations the preview/video, preview/audio and
// preview/thumbnail studios render (see the local <VideoCanvas> /
// <AudioCanvas> / <ThumbnailCanvas> in those page files). The review desk
// imports the same components instead of keeping its own copy, so the canvas
// on the Captain's page can never drift from the working studio canvases.
//
//   VideoStageCanvas       — SELECTS / CUT: the snapshot's clip at the
//                            playhead streams in the frame player, switching
//                            clips as the playhead moves, review pins on the
//                            frame, timecode markers under it.
//   AudioStageCanvas       — SOUND: wavelength bar player for the snapshot's
//                            audio, pins drop straight on the wave.
//   ThumbnailStageCanvas   — THUMBNAIL: the chosen design rendered at its
//                            natural aspect with spatial pins.
//
// Every canvas validates a snapshot's clip/design reference against the
// project's CURRENT vault assets and falls back to real, playable media of
// the right kind, so a stale/missing reference never points the player at a
// dead proxy.
//
// `submissionId` is the review-desk scope: when set, the timecode markers and
// AnnotationCanvas pins only show notes that belong to THAT submission (the
// preview studios leave it unset and show the leg's notes).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AudioLines, Image as ImageIcon, Play } from 'lucide-react';
import { getGetVideoAssetQueryKey, useGetVideoAsset, useListVideoComments } from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';
import { AssetPlayer, EmptyPlayer, ImageStage, pollWhileProcessing, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { FullscreenButton, WaveformPlayer } from '@/components/preview-shared';
import { formatTimecode } from '@/components/timeline';
import { activeClipAt, type TimelineSnapshotLike } from '@/lib/diff';

const VIDEO_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE']);
const AUDIO_KINDS = new Set(['RAW_AUDIO', 'VO_PICKUP']);
const IMAGE_KINDS = new Set(['THUMBNAIL_DESIGN', 'GRAPHIC']);

/** A saved timeline version shaped for the canvases. */
export interface StageCanvasVersion {
  id: string;
  leg: StudioLeg;
  version: number;
  snapshot: unknown;
}

export const STAGE_CANVAS_KINDS: Record<string, Set<string>> = {
  VIDEO: VIDEO_KINDS,
  SOUND: AUDIO_KINDS,
  THUMBNAIL: IMAGE_KINDS,
};

interface StageCanvasBaseProps {
  projectId: string;
  version: StageCanvasVersion | null;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
  /** Explicit vault asset to preview (picked from the timeline row). */
  vaultAssetId?: string | null;
  /** The column-header annotation slot — the annotate pencil portals here. */
  annotationHeaderRef?: RefObject<HTMLDivElement | null>;
  /** Review-desk scope — only THIS submission's notes show as markers/pins. */
  submissionId?: string | null;
  /** Override for the empty-state title (defaults to the studio wording). */
  emptyTitle?: string;
}

// ---------------------------------------------------------------------------
// VideoStageCanvas — SELECTS / CUT.
// ---------------------------------------------------------------------------

export function VideoStageCanvas({
  projectId,
  version,
  assets,
  vaultAssetId,
  seekRequest,
  annotationHeaderRef,
  submissionId,
  emptyTitle = 'No video in the vault yet.',
}: StageCanvasBaseProps & {
  /** A note-click seek from the comments rail — jumps the player to it. */
  seekRequest?: { ms: number; n: number } | null;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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

  // Red ticks = annotation timecodes; teal ticks = clip boundaries. In the
  // review desk only the reviewed submission's notes are shown.
  const markers = useMemo(() => {
    const list: Array<{ id: string; ms: number; tone: 'danger' | 'teal' }> = [];
    if (submissionId || version) {
      for (const comment of comments.data ?? []) {
        if (comment.timecodeMs == null) continue;
        if (submissionId) {
          if (comment.submissionId !== submissionId || comment.assetId !== assetId) continue;
        } else if (comment.leg !== version!.leg) {
          continue;
        }
        list.push({ id: `note-${comment.id}`, ms: comment.timecodeMs, tone: 'danger' });
      }
    }
    clips.forEach((clip, index) => {
      list.push({ id: `clip-${index}`, ms: clip.inMs, tone: 'teal' });
    });
    return list;
  }, [comments.data, clips, submissionId, assetId, version]);

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="video-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><Play size={13} /> Big canvas{version ? ` · ${version.leg} v${version.version}` : ''}</span>
        <span className="flex items-center gap-2">
          {!version && <span className="den-tag teal">vault preview</span>}
          <span className="mono-label">{formatTimecode(playheadMs)}</span>
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
              submissionId={submissionId ?? undefined}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
              timecodeReveal
              glowPins
            />
          </AssetPlayer>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">{emptyTitle}</p>
            <p className="text-xs opacity-70">Add footage in the vault to preview it here.</p>
          </EmptyPlayer>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AudioStageCanvas — SOUND.
// ---------------------------------------------------------------------------

export function AudioStageCanvas({
  projectId,
  version,
  assets,
  vaultAssetId,
  seekRequest,
  annotationHeaderRef,
  submissionId,
  emptyTitle = 'No audio in the vault yet.',
}: StageCanvasBaseProps & {
  /** A note-click seek from the comments rail — jumps the player to it. */
  seekRequest?: { ms: number; n: number } | null;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
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

  // Red ticks = annotation timecodes + pickup pins; teal = clip boundaries
  // (music track starts join in the review desk so the Captain sees the
  // mix's entries). In the review desk only this submission's notes show.
  const markers = useMemo(() => {
    const list: Array<{ id: string; ms: number; tone: 'danger' | 'teal' }> = [];
    if (submissionId || version) {
      for (const comment of comments.data ?? []) {
        if (comment.timecodeMs == null) continue;
        if (submissionId) {
          if (comment.submissionId !== submissionId || comment.assetId !== assetId) continue;
        } else if (comment.leg !== version!.leg) {
          continue;
        }
        list.push({ id: `note-${comment.id}`, ms: comment.timecodeMs, tone: 'danger' });
      }
    }
    clips.forEach((clip, index) => list.push({ id: `clip-${index}`, ms: clip.inMs, tone: 'teal' }));
    if (submissionId) {
      music.forEach((track, index) => list.push({ id: `music-${index}`, ms: track.inMs, tone: 'teal' }));
    }
    pickups.forEach((pickup, index) => list.push({ id: `pickup-${index}`, ms: pickup.timeMs, tone: 'danger' }));
    return list;
  }, [comments.data, clips, music, pickups, submissionId, assetId, version]);

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="audio-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><AudioLines size={13} /> Big canvas{version ? ` · SOUND v${version.version}` : ''}</span>
        <span className="flex items-center gap-2">
          {!version && <span className="den-tag teal">vault preview</span>}
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
              submissionId={submissionId ?? undefined}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
              dropLine
            />
            <FullscreenButton targetRef={stageRef} />
          </WaveformPlayer>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">{emptyTitle}</p>
            <p className="text-xs opacity-70">Add audio in the vault to preview it here.</p>
          </EmptyPlayer>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThumbnailStageCanvas — THUMBNAIL.
// ---------------------------------------------------------------------------

export function ThumbnailStageCanvas({
  projectId,
  version,
  assets,
  vaultAssetId,
  annotationHeaderRef,
  submissionId,
  emptyTitle = 'No thumbnail design in the vault yet.',
}: StageCanvasBaseProps) {
  const stageRef = useRef<HTMLDivElement>(null);

  const snap = version ? ((version.snapshot ?? null) as {
    designs?: Array<{ id?: string; assetId: string; title?: string; style?: string }>;
  } | null) : null;
  const designs = Array.isArray(snap?.designs) ? snap!.designs! : [];
  const design = designs[0] ?? null;

  const fallback = useMemo(
    () =>
      assets.find((a) => IMAGE_KINDS.has(a.kind) && a.status === 'PROCESSED') ??
      assets.find((a) => IMAGE_KINDS.has(a.kind)) ??
      null,
    [assets],
  );
  // A version's chosen design may reference an asset that is no longer in the
  // vault — validate it so the stage always shows a real image. An explicitly
  // picked vault file (from the timeline row) wins over everything.
  const explicitAsset = vaultAssetId && assets.some((a) => a.id === vaultAssetId) ? vaultAssetId : '';
  const designAssetId = design?.assetId && assets.some((a) => a.id === design.assetId) ? design.assetId : '';
  const assetId = explicitAsset || designAssetId || fallback?.id || '';

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="thumbnail-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><ImageIcon size={13} /> Big canvas{version ? ` · THUMBNAIL v${version.version}` : ''}</span>
        <span className="flex items-center gap-2">
          {!version && <span className="den-tag teal">vault preview</span>}
        </span>
      </div>
      <div className="pv-stage-player mt-2">
        {assetId ? (
          <ImageStage src={proxyUrlFor(projectId, assetId)}>
            <AnnotationCanvas
              projectId={projectId}
              leg="THUMBNAIL"
              assetId={assetId}
              playheadMs={null}
              timelineVersionId={version?.id}
              submissionId={submissionId ?? undefined}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
              glowPins
            />
            <FullscreenButton targetRef={stageRef} />
          </ImageStage>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">{emptyTitle}</p>
            <p className="text-xs opacity-70">Add a design in the vault to preview it here.</p>
          </EmptyPlayer>
        )}
      </div>
    </div>
  );
}
