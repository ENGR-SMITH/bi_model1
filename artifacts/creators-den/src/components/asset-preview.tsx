// ---------------------------------------------------------------------------
// AssetPlayer — the one player every role workspace uses to look at footage.
//
// Streams the degraded proxy (never the original), shows the live processing
// state while the proxy is still being built, and gives the caller a hook for
// time updates so timelines / waveforms can follow the playhead. Overlays
// (grade previews, lower thirds, captions) render inside the frame via
// `children`.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AudioLines, Image as ImageIcon, Loader2, Play, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
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
  controls = true,
  markers,
  directStreamUrl,
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
  /** Show the native transport controls. Hidden for the A/B wipe's top layer. */
  controls?: boolean;
  /** Review markers (design §10): comments pinned at a timecode, drawn as a clickable rail under the frame. */
  markers?: Array<{ id: string; ms: number; tone?: 'accent' | 'gold' | 'danger' | 'teal' | 'muted'; label?: string }>;
  /** Stream a URL directly, bypassing the proxy-ready gate — used to preview
   * a PENDING_REVIEW staged file (the Captain reviews the raw submission). */
  directStreamUrl?: string;
}) {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const internalAudioRef = useRef<HTMLAudioElement>(null);
  const [mediaError, setMediaError] = useState(false);
  const [streamStatus, setStreamStatus] = useState<number | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const videoRef = externalVideoRef ?? internalVideoRef;
  // The seek effect reads whichever element is actually mounted.
  const mediaRef: RefObject<HTMLMediaElement | null> = audio
    ? internalAudioRef
    : videoRef;
  const proxyUrl = proxyUrlFor(projectId, assetId);
  const streamUrl = directStreamUrl ?? proxyUrl;
  const ready = Boolean(directStreamUrl) || hasProxyFile(detail);
  const processing = !directStreamUrl && Boolean(detail) && detail!.status !== 'PROCESSED';
  const loading = detail === undefined && !directStreamUrl;
  const proxyFile = detail?.files?.find((file) => file.kind === 'PROXY');
  const demoProxy = proxyFile?.metadata?.demo === true;
  // Static images (designed thumbnails) are their own proxy — render an <img>.
  const isImage = Boolean(proxyFile) && Boolean(proxyFile!.mimeType?.startsWith('image/'));
  const durationMs = assetDurationMs(detail, 0);

  // Seek the mounted media element and tell the caller the playhead moved
  // (used by the review marker rail — design §10 "clickable pins in the player").
  const seekTo = (ms: number) => {
    const media = mediaRef.current;
    if (media) {
      media.currentTime = Math.min(durationMs, Math.max(0, ms)) / 1000;
    }
    onPlayheadChange?.(ms);
  };

  // Turn the silent media error into an actionable explanation. The probe below
  // fetches the stream just for its status, so we can distinguish a server-side
  // 401/403/404 from a genuine browser codec-decoding failure.
  let errorMessage: string;
  if (streamStatus === 401 || streamStatus === 403) {
    errorMessage = `The proxy stream returned HTTP ${streamStatus} — the player isn't authorized to fetch it. Reload to refresh your session.`;
  } else if (streamStatus === 409) {
    errorMessage = 'The proxy is being regenerated. This page will update automatically.';
  } else if (streamStatus === 404) {
    // A submit-for-review upload streams its staged ORIGINAL (it has no proxy
    // yet) — a 404 there means the held file itself is gone from the server
    // (a dev restart on ephemeral storage is the usual cause), not a missing
    // proxy, so the recovery advice is different.
    errorMessage =
      detail?.status === 'PENDING_REVIEW'
        ? 'The submitted file is no longer on the server — files held for review are lost when the server restarts. Reject this review so the submitter can hand the file in again.'
        : 'The proxy file is missing on the server. Re-upload the asset and wait for processing to finish.';
  } else if (demoProxy) {
    errorMessage = 'The server is in demo mode (no ffmpeg detected), so the preview is your original file — browsers can only play H.264 MP4 or WebM here.';
  } else {
    errorMessage = "The proxy may still be finishing, or the file uses a codec this browser can't decode.";
  }

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

  // A new asset mounts fresh — clear any error left by a previous clip.
  useEffect(() => {
    setMediaError(false);
    setStreamStatus(null);
  }, [assetId]);

  // When the proxy becomes unavailable (e.g. server re-queued regeneration)
  // or the detail refetches with a new status, reset the error state so the
  // component can transition to the processing / loading view.
  useEffect(() => {
    if (!ready || detail?.status !== 'PROCESSED') {
      setMediaError(false);
      setStreamStatus(null);
    }
  }, [ready, detail?.status]);

  // When the media element fails, probe the stream ourselves so the message
  // reflects the real cause (401/403/404 vs. an undecodable codec).
  useEffect(() => {
    if (!mediaError || !ready) return;
    let cancelled = false;
    fetch(proxyUrl, { headers: { Range: 'bytes=0-0' } })
      .then((res) => {
        if (!cancelled) setStreamStatus(res.status);
      })
      .catch(() => {
        if (!cancelled) setStreamStatus(-1);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaError, ready, proxyUrl]);

  const emitTime = (element: HTMLMediaElement) => {
    onTimeUpdate?.(Math.floor(element.currentTime * 1000));
  };

  return (
    <div className={`den-player ${className}`} data-testid="asset-player">
      {ready ? (
        mediaError ? (
          <div className="den-player-state" data-testid="asset-player-error">
            <TriangleAlert className="mb-2" size={22} />
            <p className="text-sm font-semibold">This footage couldn't play in the browser.</p>
            <p className="text-xs opacity-70">{errorMessage}</p>
            <p className="mono-label mt-1">
              {streamStatus === null
                ? 'checking stream…'
                : streamStatus === -1
                  ? 'stream unreachable'
                  : streamStatus === 409
                    ? 'regenerating proxy…'
                    : `stream HTTP ${streamStatus}`}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {streamStatus === 409 ? (
                <Loader2 className="spin" size={13} />
              ) : (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setMediaError(false);
                    setRetryKey((key) => key + 1);
                  }}
                  data-testid="asset-player-retry"
                >
                  <RotateCcw size={13} /> Retry
                </button>
              )}
              <a href={proxyUrl} target="_blank" rel="noreferrer" className="secondary-btn" data-testid="asset-player-open">
                Open stream
              </a>
            </div>
          </div>
        ) : audio ? (
          <div className="den-player-audio">
            <span className="den-player-audio-icon"><AudioLines size={18} /></span>
            <audio
              ref={internalAudioRef}
              key={`${assetId}-${retryKey}`}
              src={streamUrl}
              controls={controls}
              preload="metadata"
              onTimeUpdate={(event) => emitTime(event.currentTarget)}
              onPlay={(event) => emitTime(event.currentTarget)}
              onError={() => setMediaError(true)}
              onLoadedData={() => setMediaError(false)}
              data-testid="asset-player-audio"
            />
          </div>
        ) : isImage ? (
          <img
            key={`${assetId}-${retryKey}`}
            src={streamUrl}
            alt="Preview"
            style={filter ? { filter } : undefined}
            onError={() => setMediaError(true)}
            onLoad={() => setMediaError(false)}
            data-testid="asset-player-image"
          />
        ) : (
          <video
            ref={videoRef}
            key={`${assetId}-${retryKey}`}
            src={streamUrl}
            controls={controls}
            preload="metadata"
            style={filter ? { filter } : undefined}
            onTimeUpdate={(event) => emitTime(event.currentTarget)}
            onPlay={(event) => emitTime(event.currentTarget)}
            onError={() => setMediaError(true)}
            onLoadedData={() => setMediaError(false)}
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

      {markers && markers.length > 0 && !audio && !isImage && durationMs > 0 && (
        <div
          className="den-marker-rail"
          role="slider"
          aria-label="Review markers — click to seek"
          aria-valuemin={0}
          aria-valuemax={durationMs}
          aria-valuenow={Math.min(playheadMs ?? 0, durationMs)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            seekTo(ratio * durationMs);
          }}
          data-testid="marker-rail"
        >
          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              className={`den-marker-pin ${marker.tone ?? 'accent'}`}
              style={{ left: `${Math.min(100, Math.max(0, (marker.ms / durationMs) * 100))}%` }}
              title={marker.label ?? formatClock(marker.ms)}
              onClick={(event) => {
                event.stopPropagation();
                seekTo(marker.ms);
              }}
              data-testid="marker-pin"
            />
          ))}
        </div>
      )}

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

/**
 * ImageStage — the thumbnail review surface. Renders a static image sized to
 * its natural aspect ratio (so spatial pins on the AnnotationCanvas overlay
 * land exactly on the pixels), with the frame chrome of the other players.
 */
export function ImageStage({
  src,
  title,
  children,
  className = '',
}: {
  src: string;
  title?: string;
  /** Overlays rendered on top of the image (AnnotationCanvas…). */
  children?: ReactNode;
  className?: string;
}) {
  const [aspect, setAspect] = useState('16 / 9');

  return (
    <div className={`den-player ${className}`} data-testid="image-stage">
      <div className="thumbnail-stage" style={{ aspectRatio: aspect }}>
        <img
          src={src}
          alt={title ?? 'Design preview'}
          onLoad={(event) => {
            const el = event.currentTarget;
            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
              setAspect(`${el.naturalWidth} / ${el.naturalHeight}`);
            }
          }}
          data-testid="image-stage-img"
        />
        {children}
      </div>
      {title && (
        <div className="den-player-bar">
          <span className="truncate">{title}</span>
          <span className="mono-label"><ImageIcon size={10} /> static frame</span>
        </div>
      )}
    </div>
  );
}
