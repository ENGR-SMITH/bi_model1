// ---------------------------------------------------------------------------
// DiffMap — the split-screen version-control surface (ported from the smith_mi
// video-version-comparison app). Shows the visual difference map between two
// media versions in the preview first column.
//
// Layout mirrors the source app: the version being reviewed ("V · reviewed")
// plays on the left; the right pane is a live difference map — a darkened V1
// with blue (new / brighter in the compared version) and red (removed / darker)
// dots. A draggable wipe divider reveals the compared version underneath.
//
// Frames come from the project's proxy streams (same-origin, so canvas pixel
// readback works), drawn with `drawContain` so differing aspect ratios still
// align. Both proxies float in hidden media elements that follow one shared
// playhead; the diff-map redraws on every `timeupdate`.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { drawContain, renderDiffImage } from '@/lib/frame-diff';
import { proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { FullscreenButton } from '@/components/preview-shared';
import type { StudioLeg } from '@/components/role-oracle';

const READY_ENOUGH = 2;

function waitForFrame(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (video.readyState >= READY_ENOUGH) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('loadeddata', finish);
      video.removeEventListener('canplay', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    video.addEventListener('loadeddata', finish);
    video.addEventListener('canplay', finish);
  });
}

function seekVideo(video: HTMLVideoElement, second: number, timeoutMs = 800): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      video.removeEventListener('loadedmetadata', begin);
      window.clearTimeout(timer);
      resolve();
    };
    const begin = () => {
      if (done) return;
      video.removeEventListener('loadedmetadata', begin);
      if (video.readyState >= READY_ENOUGH && Math.abs(video.currentTime - second) < 1e-3) {
        requestAnimationFrame(finish);
        return;
      }
      video.addEventListener('seeked', finish);
      try {
        video.currentTime = second;
      } catch {
        finish();
      }
    };
    const timer = window.setTimeout(finish, timeoutMs);
    if (video.readyState >= 1) begin();
    else video.addEventListener('loadedmetadata', begin);
  });
}

async function seekBoth(a: HTMLVideoElement, b: HTMLVideoElement, second: number): Promise<void> {
  await Promise.all([seekVideo(a, second), seekVideo(b, second)]);
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const f = Math.floor((safe % 1) * 24);
  const base = [h, m, s].map((value) => String(value).padStart(2, '0')).join(':');
  return `${base}:${String(f).padStart(2, '0')}`;
}

export function DiffMap({
  projectId,
  olderAssetId,
  newerAssetId,
  kind,
  leg,
  timelineVersionId,
  annotationHeaderRef,
  olderLabel = 'Older',
  newerLabel = 'Reviewing',
  sensitivity: sensitivityProp,
  onSensitivityChange,
}: {
  projectId: string;
  /** The older version's asset proxy (reference frame). */
  olderAssetId: string;
  /** The newer version's asset proxy (the version under review). */
  newerAssetId: string;
  kind: 'video' | 'image';
  /** Relay leg — annotations dropped on the reviewed (right) pane are scoped
   * to it (and to `timelineVersionId` when the selection is a version). */
  leg: StudioLeg;
  timelineVersionId?: string | null;
  /** The column-header annotation slot — the annotate pencil portals here. */
  annotationHeaderRef?: RefObject<HTMLDivElement | null>;
  olderLabel?: string;
  newerLabel?: string;
  /** Controlled diff sensitivity (4-60) — owned by the preview page so the
   * column's settings dropdown can drive it. */
  sensitivity?: number;
  onSensitivityChange?: (sensitivity: number) => void;
}) {
  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sensitivityState, setSensitivityState] = useState(24);
  const sensitivity = sensitivityProp ?? sensitivityState;
  const setSensitivity = (next: number) => {
    setSensitivityState(next);
    onSensitivityChange?.(next);
  };
  const [wipePos, setWipePos] = useState(0.8);
  const [mismatch, setMismatch] = useState(false);
  const [ready, setReady] = useState(false);

  const newerVideoRef = useRef<HTMLVideoElement>(null);
  const olderVideoRef = useRef<HTMLVideoElement>(null);
  const newerImgRef = useRef<HTMLImageElement>(null);
  const olderImgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const newestPaneRef = useRef<HTMLDivElement>(null);
  const surfRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const computeSeqRef = useRef(0);

  const olderUrl = proxyUrlFor(projectId, olderAssetId);
  const newerUrl = proxyUrlFor(projectId, newerAssetId);

  const isImage = kind === 'image';

  // Determine duration + readiness once media metadata loads.
  useEffect(() => {
    setReady(false);
    if (isImage) {
      if (newerImgRef.current?.complete && olderImgRef.current?.complete) setReady(true);
      return;
    }
    const v = newerVideoRef.current;
    if (!v) return;
    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
      setReady(true);
    };
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [newerAssetId, olderAssetId, isImage]);

  // The diff map for the current shared playhead (video) or once (image).
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const media = isImage
      ? {
          newer: { el: newerImgRef.current, w: newerImgRef.current?.naturalWidth ?? 0, h: newerImgRef.current?.naturalHeight ?? 0 },
          older: { el: olderImgRef.current, w: olderImgRef.current?.naturalWidth ?? 0, h: olderImgRef.current?.naturalHeight ?? 0 },
        }
      : {
          newer: { el: newerVideoRef.current, w: newerVideoRef.current?.videoWidth ?? 0, h: newerVideoRef.current?.videoHeight ?? 0 },
          older: { el: olderVideoRef.current, w: olderVideoRef.current?.videoWidth ?? 0, h: olderVideoRef.current?.videoHeight ?? 0 },
        };
    if (!media.newer.el || !media.older.el) return;
    const nw = media.newer.w;
    const nh = media.newer.h;
    const ow = media.older.w;
    const oh = media.older.h;
    if (!nw || !nh || !ow || !oh) return;

    const aspectNewer = nw / nh;
    const aspectOlder = ow / oh;
    setMismatch(Math.abs(aspectNewer - aspectOlder) > 0.02);

    const width = 640;
    const aspect = (aspectNewer + aspectOlder) / 2 || 16 / 9;
    const height = Math.max(2, Math.round(width / aspect));
    canvas.width = width;
    canvas.height = height;

    // `newer` canvas is the review target (also the diff base layer); `older`
    // is the reference frame. Dots mark where the newer differs from older.
    const newerCv = document.createElement('canvas');
    const olderCv = document.createElement('canvas');
    newerCv.width = olderCv.width = width;
    newerCv.height = olderCv.height = height;
    const ctxNewer = newerCv.getContext('2d', { willReadFrequently: true });
    const ctxOlder = olderCv.getContext('2d', { willReadFrequently: true });
    const out = canvas.getContext('2d');
    if (!ctxNewer || !ctxOlder || !out) return;

    drawContain(ctxNewer, media.newer.el, nw, nh, width, height);
    drawContain(ctxOlder, media.older.el, ow, oh, width, height);
    const dataNewer = ctxNewer.getImageData(0, 0, width, height);
    const dataOlder = ctxOlder.getImageData(0, 0, width, height);

    // Base = older (darkened) with dots showing newer-vs-older changes; the
    // newer version is revealed to the right of the wipe divider.
    const diff = renderDiffImage(dataOlder.data, dataNewer.data, width, height, sensitivity);
    out.drawImage(diff, 0, 0);

    const split = Math.round(wipePos * width);
    out.save();
    out.beginPath();
    out.rect(split, 0, width - split, height);
    out.clip();
    out.drawImage(newerCv, 0, 0);
    out.restore();

    out.fillStyle = 'rgba(220, 240, 250, .92)';
    out.fillRect(split - 1, 0, 2, height);
    out.fillStyle = '#9be7ff';
    out.beginPath();
    out.arc(split, height / 2, 7, 0, Math.PI * 2);
    out.fill();
    out.strokeStyle = '#123c4d';
    out.lineWidth = 2;
    out.stroke();
  }, [isImage, sensitivity, wipePos]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Video: recompute the diff on playhead moves (debounced).
  useEffect(() => {
    if (!ready || isImage) return;
    const seq = (computeSeqRef.current += 1);
    const newer = newerVideoRef.current;
    const older = olderVideoRef.current;
    if (!newer || !older) return;
    const timer = window.setTimeout(() => {
      void seekBoth(older, newer, Math.min(playhead, duration)).then(() => {
        if (seq !== computeSeqRef.current) return;
        drawRef.current();
      });
    }, 70);
    return () => window.clearTimeout(timer);
  }, [playhead, duration, ready, isImage]);

  // Image: draw once ready, and on sensitivity/wipe changes.
  useEffect(() => {
    if (isImage) drawRef.current();
  }, [sensitivity, wipePos, ready, isImage, newerAssetId, olderAssetId]);

  // Redraw instantly on wipe / sensitivity drags without seeking.
  useEffect(() => {
    if (!ready) return;
    drawRef.current();
  }, [wipePos, sensitivity, ready]);

  // Dual-video sync + redraw on timeupdate.
  useEffect(() => {
    if (isImage) return;
    const a = olderVideoRef.current;
    const b = newerVideoRef.current;
    if (!a || !b) return;
    const sync = () => {
      setPlayhead(a.currentTime || 0);
      if (Math.abs(a.currentTime - b.currentTime) > 0.04) b.currentTime = a.currentTime;
      drawRef.current();
    };
    a.addEventListener('timeupdate', sync);
    return () => a.removeEventListener('timeupdate', sync);
  }, [isImage, ready]);

  const togglePlay = async () => {
    const a = olderVideoRef.current;
    const b = newerVideoRef.current;
    if (!a || !b) return;
    if (playing) {
      a.pause();
      b.pause();
      setPlaying(false);
    } else {
      await seekBoth(a, b, playhead);
      await Promise.all([a.play().catch(() => {}), b.play().catch(() => {})]);
      setPlaying(true);
    }
  };

  const seek = async (second: number) => {
    setPlaying(false);
    olderVideoRef.current?.pause();
    newerVideoRef.current?.pause();
    const next = Math.max(0, Math.min(duration || second, second));
    setPlayhead(next);
    const a = olderVideoRef.current;
    const b = newerVideoRef.current;
    if (a) a.currentTime = next;
    if (b) b.currentTime = next;
  };

  const step = (frames: number) => {
    setPlaying(false);
    const next = Math.max(0, Math.min(duration || 0, playhead + frames / 24));
    if (olderVideoRef.current) olderVideoRef.current.currentTime = next;
    if (newerVideoRef.current) newerVideoRef.current.currentTime = next;
    setPlayhead(next);
  };

  const updateWipe = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setWipePos(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  };

  const progress = duration > 0 ? (playhead / duration) * 100 : 0;

  return (
    <section className="df-surf" ref={surfRef} data-testid="diff-map">
      <div className="df-stage">
        {!isImage && (
          <video ref={olderVideoRef} src={olderUrl} muted playsInline preload="auto" className="df-hidden" data-testid="df-video-older" />
        )}
        {isImage && (
          <img ref={olderImgRef} src={olderUrl} alt="" className="df-hidden" data-testid="df-img-older" />
        )}
        <div className="df-split">
          {/* Left pane — the reviewed (newest) media, annotatable. */}
          <div className="df-pane" ref={newestPaneRef}>
            {isImage ? (
              <img ref={newerImgRef} src={newerUrl} alt={newerLabel} className="df-pane-media" onLoad={() => setReady(true)} data-testid="df-pane-newer" />
            ) : (
              <video ref={newerVideoRef} src={newerUrl} muted={!playing} playsInline preload="auto" autoPlay={undefined} className="df-pane-media" onLoadedMetadata={() => {
                const v = newerVideoRef.current;
                if (v && Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
                setReady(true);
              }} data-testid="df-pane-video" />
            )}
            {/* Only the newest version is annotatable — pins drop here. */}
            <AnnotationCanvas
              projectId={projectId}
              leg={leg}
              assetId={newerAssetId}
              playheadMs={isImage ? null : Math.round(playhead * 1000)}
              onSeek={(ms) => void seek(ms / 1000)}
              timelineVersionId={timelineVersionId}
              headerRef={annotationHeaderRef}
              surfaceRef={newestPaneRef}
              timecodeReveal={!isImage}
              glowPins
            />
          </div>
          {/* Right pane — the diff-map (older reference + wipe reveal). */}
          <div className="df-pane df-pane-map">
            <canvas
              ref={canvasRef}
              className="df-canvas"
              tabIndex={0}
              style={{ cursor: 'ew-resize', touchAction: 'none', outline: 'none' }}
              onPointerDown={(event) => {
                draggingRef.current = true;
                (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
                updateWipe(event.clientX);
              }}
              onPointerMove={(event) => {
                if (draggingRef.current) updateWipe(event.clientX);
              }}
              onPointerUp={() => { draggingRef.current = false; }}
              onPointerCancel={() => { draggingRef.current = false; }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') setWipePos((p) => Math.max(0, p - 0.02));
                if (event.key === 'ArrowRight') setWipePos((p) => Math.min(1, p + 0.02));
              }}
              data-testid="df-canvas"
            />
            {mismatch && (
              <div className="df-mismatch" data-testid="df-mismatch">
                <AlertTriangle size={11} /> Aspect ratios differ — alignment is approximate
              </div>
            )}
            <div className="df-legend">
              <span><i className="df-chip blue" />New / brighter</span>
              <span><i className="df-chip red" />Removed / darker</span>
              <span className="df-mode">WIPE {Math.round(wipePos * 100)}% · {Math.round((1 - wipePos) * 100)}% OPEN</span>
            </div>
          </div>
        </div>
        <FullscreenButton targetRef={surfRef} className="df-fs" />
        {!isImage && (
          <button
            type="button"
            className="df-play-overlay"
            onClick={() => void togglePlay()}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
            data-testid="df-play-overlay"
          >
            {playing ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}
          </button>
        )}
      </div>

      {!isImage && (
        <div className="df-transport">
          <div className="df-buttons">
            <button type="button" onClick={() => seek(0)} aria-label="Beginning" title="Beginning"><SkipBack size={13} /></button>
            <button type="button" onClick={() => step(-1)} aria-label="Previous frame" title="Previous frame"><ChevronLeft size={15} /></button>
            <button type="button" onClick={() => step(1)} aria-label="Next frame" title="Next frame"><ChevronRight size={15} /></button>
            <button type="button" onClick={() => seek(duration)} aria-label="End" title="End"><SkipForward size={13} /></button>
          </div>
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="0.001"
            value={Math.min(playhead, duration || 1)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Playback position"
            className="df-seek"
            data-testid="df-seek"
          />
          <span className="df-time">{formatClock(playhead)} / {formatClock(duration)}</span>
        </div>
      )}
    </section>
  );
}