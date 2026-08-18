// ---------------------------------------------------------------------------
// AssetPlayer — the one player every role workspace uses to look at footage.
//
// Streams the degraded proxy (never the original), shows the live processing
// state while the proxy is still being built, and gives the caller a hook for
// time updates so timelines / waveforms can follow the playhead. Overlays
// (grade previews, lower thirds, captions) render inside the frame via
// `children`.
// ---------------------------------------------------------------------------

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { AudioLines, Loader2, Play, RotateCcw, Sparkles } from 'lucide-react';
import type { VideoAssetDetail } from '@workspace/api-client-react';

export function proxyUrlFor(projectId: string, assetId: string): string {
  return `/api/video/projects/${projectId}/assets/${assetId}/proxy`;
}

export function hasProxyFile(asset: VideoAssetDetail | undefined): boolean {
  return Boolean(asset && (asset.files ?? []).some((file) => file.kind === 'PROXY'));
}

export function assetDurationMs(
  detail: VideoAssetDetail | undefined,
  fallbackMs: number,
): number {
  return detail?.durationMs ?? fallbackMs;
}

/**
 * Poll interval helper: keep refetching an asset detail query until the
 * backend has finished processing it (then stop automatically).
 */
export function pollWhileProcessing(detail: VideoAssetDetail | undefined): number | false {
  return detail && detail.status !== 'PROCESSED' ? 3000 : false;
}

/**
 * The asset kind determines the player element: audio-only files render as an
 * `<audio>` bar instead of a 16:9 video frame.
 */
export function isAudioKind(kind: string | undefined): boolean {
  return kind === 'RAW_AUDIO' || kind === 'VO_PICKUP';
}

export function AssetPlayer({
  projectId,
  assetId,
  detail,
  playheadMs,
  onTimeUpdate,
  onPlayheadChange,
  filter,
  className = '',
  children,
  title,
  videoRef: externalVideoRef,
  audio = false,
}: {
  projectId: string;
  assetId: string;
  /** Asset detail from the parent's useGetVideoAsset query (polled while processing). */
  detail?: VideoAssetDetail;
  /** External playhead (ms) — drives seek requests when it changes. */
  playheadMs?: number;
  /** Fired on playback time updates (for timeline/waveform sync). */
  onTimeUpdate?: (ms: number) => void;
  /** Fired when the playhead should move (user scrub from the timeline). */
  onPlayheadChange?: (ms: number) => void;
  /** CSS filter applied to the video (e.g. a live grade preview). */
  filter?: string;
  className?: string;
  /** Overlays rendered on top of the frame (lower thirds, captions…). */
  children?: ReactNode;
  title?: string;
  /** External ref so the owner can play/pause/seek the video programmatically. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Render an audio element (for RAW_AUDIO / VO_PICKUP) instead of video. */
  audio?: boolean;
}) {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const internalAudioRef = useRef<HTMLAudioElement>(null);
  const videoRef = externalVideoRef ?? internalVideoRef;
  // The seek effect reads whichever element is actually mounted.
  const mediaRef: RefObject<HTMLMediaElement | null> = audio
    ? internalAudioRef
    : videoRef;
  const proxyUrl = proxyUrlFor(projectId, assetId);
  const ready = hasProxyFile(detail);
  const processing = Boolean(detail) && detail!.status !== 'PROCESSED';
  const loading = detail === undefined;

  // Follow external playhead changes (timeline clicks / transcript seeks).
  // `assetId` is a dependency so a freshly-mounted element (a new clip) seeks
  // straight to the playhead instead of resting at 0:00.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !ready || playheadMs === undefined) return;
    if (Math.abs(media.currentTime * 1000 - playheadMs) > 400) {
      media.currentTime = playheadMs / 1000;
    }
  }, [playheadMs, ready, mediaRef, assetId]);

  const emitTime = (element: HTMLMediaElement) => {
    onTimeUpdate?.(Math.floor(element.currentTime * 1000));
  };

  return (
    <div className={`den-player ${className}`} data-testid="asset-player">
      {ready ? (
        audio ? (
          <div className="den-player-audio">
            <span className="den-player-audio-icon"><AudioLines size={18} /></span>
            <audio
              ref={internalAudioRef}
              key={assetId}
              src={proxyUrl}
              controls
              preload="metadata"
              onTimeUpdate={(event) => emitTime(event.currentTarget)}
              onPlay={(event) => emitTime(event.currentTarget)}
              data-testid="asset-player-audio"
            />
          </div>
        ) : (
          <video
            ref={videoRef}
            key={assetId}
            src={proxyUrl}
            controls
            preload="metadata"
            style={filter ? { filter } : undefined}
            onTimeUpdate={(event) => emitTime(event.currentTarget)}
            onPlay={(event) => emitTime(event.currentTarget)}
            data-testid="asset-player-video"
          />
        )
      ) : loading ? (
        <div className="den-player-state">
          <Loader2 className="spin mb-2" size={22} />
          <p className="text-sm font-semibold">Preparing the preview…</p>
          <p className="text-xs opacity-70">Checking whether the proxy is ready.</p>
        </div>
      ) : processing ? (
        <div className="den-player-state">
          <Loader2 className="spin mb-2" size={22} />
          <p className="text-sm font-semibold">Building the proxy…</p>
          <p className="text-xs opacity-70">
            {detail ? `${detail.status.toLowerCase().replaceAll('_', ' ')} — this updates on its own` : 'processing in the background'}
          </p>
        </div>
      ) : (
        <div className="den-player-state">
          <Sparkles className="mb-2" size={22} />
          <p className="text-sm font-semibold">No proxy yet</p>
          <p className="text-xs opacity-70">The proxy is generated after the first upload pass — refresh in a moment.</p>
          <button
            type="button"
            className="secondary-btn mt-3"
            onClick={() => window.location.reload()}
            data-testid="asset-player-retry"
          >
            <RotateCcw size={13} /> Refresh
          </button>
        </div>
      )}

      {children}

      {title && (
        <div className="den-player-bar">
          <span className="truncate">{title}</span>
          <span className="mono-label">{formatClock(playheadMs ?? 0)}</span>
        </div>
      )}
    </div>
  );
}

/** 0:00 → 1:23:45 style clock. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function EmptyPlayer({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`den-player ${className}`}>
      <div className="den-player-state">
        <Play className="mb-2" size={22} />
        {children}
      </div>
    </div>
  );
}
