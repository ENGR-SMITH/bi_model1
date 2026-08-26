// ---------------------------------------------------------------------------
// Preview building blocks (shared by the four preview pages).
//
//   PreviewLayout     — the two-column preview shell: left column is split
//                       into two rows (big canvas on top, version carousel
//                       underneath), the right column takes the full height
//                       and holds the pin/comment wall.
//   VersionCarousel   — a horizontal carousel of a project's timeline
//                       versions (v1, v2, …), labelled with their relay leg.
//   PreviewNotesPanel — the right rail: every annotation pin (grouped by
//                       frame point with its reviewer colour tag) plus the
//                       timecode notes.
//   FullscreenButton  — expands the canvas container to full screen. Rendered
//                       inside the media player, pinned to its bottom-right.
//   WaveformPlayer    — audio player rendered as a wavelength bar view with
//                       a red tick at the exact playhead / annotation time.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderOpen,
  Maximize,
  MessageSquare,
  Minimize,
  Pin,
  Play,
  Upload,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVideoProjectQueryKey,
  getListVideoCommentsQueryKey,
  getUploadVideoAssetUrl,
  useListVideoComments,
  useResolveVideoComment,
} from '@workspace/api-client-react';
import type { VideoAssetDetail, VideoComment } from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';
import { formatClock, proxyUrlFor } from '@/components/asset-preview';
import { formatTimecode } from '@/components/timeline';
import { geometryKey, parseGeometry, reviewerColor, reviewerLabel } from '@/lib/annotations';

// ---------------------------------------------------------------------------
// PreviewLayout
// ---------------------------------------------------------------------------

export function PreviewLayout({ canvas, rail, versions }: { canvas: ReactNode; rail: ReactNode; versions?: ReactNode }) {
  return (
    <div className="page pv-page" data-testid="preview-page">
      <div className="pv-top">
        <div className="pv-canvas-col">
          {canvas}
        </div>
        <div className="pv-notes-col">
          {rail}
        </div>
      </div>
      {versions && (
        <div className="pv-versions-row">
          {versions}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VersionCarousel — horizontal scroll row of timeline versions.
// ---------------------------------------------------------------------------

export interface PreviewVersion {
  id: string;
  leg: StudioLeg;
  version: number;
  message: string;
  createdAt: string;
  /** The leg's current head (latest saved) version. */
  isHead: boolean;
}

export function VersionCarousel({
  versions,
  selectedId,
  onSelect,
  emptyText,
}: {
  versions: PreviewVersion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyText: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollByCards = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.6), behavior: 'smooth' });
  };

  return (
    <div className="paper-card pv-carousel" data-testid="version-carousel">
      <div className="inline-heading">
        <span className="eyebrow"><Clock3 size={13} /> Timeline versions</span>
        <span className="mono-label">{versions.length} saved</span>
      </div>
      {versions.length === 0 ? (
        <p className="setting-copy mt-2" data-testid="version-carousel-empty">{emptyText}</p>
      ) : (
        <div className="pv-carousel-wrap">
          <button type="button" className="pv-carousel-arrow" onClick={() => scrollByCards(-1)} aria-label="Earlier versions" data-testid="carousel-prev">
            <ChevronLeft size={16} />
          </button>
          <div className="pv-carousel-track" ref={trackRef} data-testid="carousel-track">
            {versions.map((version) => {
              const active = version.id === selectedId;
              return (
                <button
                  key={version.id}
                  type="button"
                  className={`pv-version-card ${active ? 'active' : ''}`}
                  onClick={() => onSelect(version.id)}
                  data-testid={`version-card-${version.leg}-${version.version}`}
                >
                  <span className="pv-version-head">
                    <span className="den-tag accent">v{version.version}</span>
                    <span className="pv-version-leg">{version.leg}</span>
                    {version.isHead && <span className="den-tag teal">head</span>}
                  </span>
                  {version.message ? <b className="pv-version-msg truncate">{version.message}</b> : <b className="pv-version-msg muted">no message</b>}
                  <span className="pv-version-date">{new Date(version.createdAt).toLocaleDateString()} · {new Date(version.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="pv-carousel-arrow" onClick={() => scrollByCards(1)} aria-label="Later versions" data-testid="carousel-next">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoleLayout — the three role pages (Video / Audio / Thumbnail).
// Three columns at 14 : 46 : 40, with the second and third columns split into
// two rows at 68 : 32. Column one (the version & vault shelf) spans the full
// height; the bottom rows of columns two and three hold the upload card and
// the oracle.
// ---------------------------------------------------------------------------

export function RoleLayout({
  versions,
  canvas,
  notes,
  oracle,
  upload,
}: {
  /** Column one — the vertical shelf of timeline versions + vault uploads. */
  versions: ReactNode;
  /** Column two, row one — the big canvas. */
  canvas: ReactNode;
  /** Column three, row one — the pin / comment wall. */
  notes: ReactNode;
  /** Column three, row two — the role oracle. */
  oracle: ReactNode;
  /** Column two, row two — the upload card. */
  upload: ReactNode;
}) {
  return (
    <div className="page pv-page role-page" data-testid="role-page">
      <div className="role-grid">
        <div className="role-versions-col">{versions}</div>
        <div className="role-canvas-main">{canvas}</div>
        <div className="role-canvas-bar">{upload}</div>
        <div className="role-notes-main">{notes}</div>
        <div className="role-notes-bar">{oracle}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VAULT_KIND_LABELS — human labels for the vault asset kinds, shared by the
// role upload cards and the version shelf.
// ---------------------------------------------------------------------------

export const VAULT_KIND_LABELS: Record<string, string> = {
  RAW_VIDEO: 'Camera footage',
  RAW_AUDIO: 'Separate audio',
  SCREEN_REC: 'Screen recording',
  B_ROLL: 'B-roll',
  REFERENCE: 'Reference video',
  VO_PICKUP: 'Pickup voiceover',
  GRAPHIC: 'Graphic',
  THUMBNAIL_DESIGN: 'Thumbnail design',
};

// ---------------------------------------------------------------------------
// RoleUploadCard — the bottom row of the canvas column. A compact upload
// section: a format dropdown (the page's own vault kinds), a clickable /
// draggable drop zone, an upload button, and a progress row. The file joins
// the vault under the chosen kind, guarded by the page's accept list + format
// check, so a video can never be dropped on the thumbnail page and vice versa.
// ---------------------------------------------------------------------------

export function RoleUploadCard({
  projectId,
  label,
  kinds,
  defaultKind,
  accept,
  checkFormat,
}: {
  projectId: string;
  /** e.g. "video file" / "audio file" / "thumbnail design". */
  label: string;
  /** The vault kinds this page accepts, shown in the format dropdown. */
  kinds: Array<{ value: string; label: string }>;
  /** The kind selected by default (e.g. RAW_VIDEO on the video page). */
  defaultKind: string;
  /** <input accept> — the allowed extensions/mime types. */
  accept: string;
  /** Client-side format guard — returns an error message for a disallowed file. */
  checkFormat: (file: File) => string | null;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [kind, setKind] = useState(defaultKind);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      xhrRef.current?.abort();
    },
    [],
  );

  const startUpload = (file: File) => {
    const invalid = checkFormat(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setPendingFile(null);
    setName(file.name);
    setProgress(0);
    setPhase('uploading');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', kind);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', getUploadVideoAssetUrl(projectId));
    xhr.upload.onprogress = (progressEvent) => {
      if (progressEvent.lengthComputable && progressEvent.total > 0) {
        setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
      }
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        setPhase('done');
        queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
        if (fileRef.current) fileRef.current.value = '';
      } else {
        let message = 'The upload failed. Try once more.';
        try {
          const data = JSON.parse(xhr.responseText) as { error?: string };
          if (typeof data?.error === 'string') message = data.error;
        } catch {
          // Non-JSON body — keep the generic message.
        }
        setPhase('idle');
        setError(message);
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setPhase('idle');
      setError('The upload was interrupted — your connection dropped.');
    };
    xhr.send(formData);
  };

  const cancel = () => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setPhase('idle');
    setProgress(0);
  };

  const pickFile = (file: File | undefined | null) => {
    if (!file) return;
    const invalid = checkFormat(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setPendingFile(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onDropZoneClick = () => fileRef.current?.click();

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDrag(false);
    pickFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div className="paper-card role-upload-card" data-testid="role-upload">
      <span className="eyebrow"><Upload size={13} /> Upload {label}</span>
      <div className="role-upload-row">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          disabled={phase === 'uploading'}
          aria-label="File format"
          data-testid="role-upload-kind"
        >
          {kinds.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="primary-btn"
          onClick={() => pendingFile && startUpload(pendingFile)}
          disabled={phase === 'uploading' || !pendingFile}
          data-testid="role-upload-button"
        >
          <Upload size={13} />
          {phase === 'uploading' ? `${progress}%` : 'Upload'}
        </button>
      </div>
      <div
        className={`role-upload-drop ${drag ? 'drag' : ''}`}
        role="button"
        tabIndex={0}
        onClick={onDropZoneClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onDropZoneClick();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        title="Click to browse, or drop a file here"
        data-testid="role-upload-drop"
      >
        {pendingFile ? (
          <span><FolderOpen size={14} /> <b>{pendingFile.name}</b> — ready to upload</span>
        ) : (
          <span><FolderOpen size={14} /> Drag &amp; drop your {label} here, or click to browse</span>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        onChange={(event) => pickFile(event.target.files?.[0])}
        disabled={phase === 'uploading'}
        className="hidden"
        data-testid="role-upload-input"
      />
      {phase === 'uploading' && (
        <span className="role-upload-status" data-testid="role-upload-progress">
          <span className="den-upload-progress-bar"><span style={{ width: `${progress}%` }} /></span>
          <b className="mono-label">{progress}%</b>
          <button type="button" onClick={cancel} className="den-upload-cancel">Cancel</button>
        </span>
      )}
      {phase === 'done' && (
        <span className="role-upload-status" data-testid="role-upload-done">
          <Check size={12} /> <b className="truncate">{name}</b> is in the vault
        </span>
      )}
      {phase === 'idle' && error && (
        <span className="setting-copy" role="alert" style={{ color: 'hsl(var(--destructive))' }} data-testid="role-upload-error">{error}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FullscreenButton
// ---------------------------------------------------------------------------

export function FullscreenButton({ targetRef, label = 'Full screen' }: { targetRef: RefObject<HTMLElement | null>; label?: string }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (typeof document !== 'undefined' && !document.fullscreenEnabled) return null;

  const toggle = () => {
    const el = targetRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <button
      type="button"
      className="pv-fs"
      onClick={toggle}
      onPointerDown={(event) => event.stopPropagation()}
      title={active ? 'Exit full screen' : 'Expand the media to full screen'}
      data-testid="preview-fullscreen"
    >
      {active ? <Minimize size={14} /> : <Maximize size={14} />}
      <span>{active ? 'Exit full screen' : label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// PreviewNotesPanel — the right rail: pin tags (with reviewer colour) +
// comments + notes, scoped to the legs being previewed.
// ---------------------------------------------------------------------------

interface PinGroup {
  key: string;
  geometry: { x: number; y: number };
  comments: VideoComment[];
}

export function PreviewNotesPanel({
  projectId,
  legs,
  assetId,
  onSeek,
}: {
  projectId: string;
  /** The relay legs whose notes this panel shows (e.g. SELECTS + CUT for video). */
  legs: StudioLeg[];
  /** Optional scope: notes pinned to a specific asset. */
  assetId?: string;
  /** Clicking a note with a timecode seeks the canvas here. */
  onSeek?: (ms: number) => void;
}) {
  const queryClient = useQueryClient();
  const comments = useListVideoComments(projectId);
  const resolve = useResolveVideoComment();

  const rows = useMemo(() => {
    const legSet = new Set(legs);
    return (comments.data ?? []).filter((comment) => {
      if (!comment.leg || !legSet.has(comment.leg as StudioLeg)) return false;
      if (assetId && comment.assetId !== assetId) return false;
      return true;
    });
  }, [comments.data, legs, assetId]);

  const pins = useMemo<PinGroup[]>(() => {
    const groups = new Map<string, PinGroup>();
    for (const comment of rows) {
      const geometry = parseGeometry(comment.geometry);
      if (!geometry) continue;
      const key = geometryKey(geometry);
      const group = groups.get(key) ?? { key, geometry, comments: [] };
      group.comments.push(comment);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows]);

  const timelineNotes = useMemo(
    () =>
      rows
        .filter((comment) => !parseGeometry(comment.geometry) && comment.timecodeMs != null)
        .sort((a, b) => (a.timecodeMs ?? 0) - (b.timecodeMs ?? 0)),
    [rows],
  );

  const onResolve = (commentId: string, resolved: boolean) => {
    resolve.mutate(
      { projectId, commentId, data: { resolved } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoCommentsQueryKey(projectId) });
        },
      },
    );
  };

  return (
    <div className="paper-card pv-notes" data-testid="preview-notes">
      <div className="inline-heading">
        <span className="eyebrow"><Pin size={13} /> Pins · comments · notes</span>
        <span className="mono-label">{rows.length}</span>
      </div>

      {pins.length > 0 && (
        <div className="den-stack mt-3">
          {pins.map((pin) => {
            const first = pin.comments[0];
            const color = reviewerColor(first.authorId);
            const label = reviewerLabel(first.authorId);
            const times = [...new Set(pin.comments.map((c) => c.timecodeMs).filter((t): t is number => t != null))];
            return (
              <div key={pin.key} className="pv-note-pin" data-testid={`preview-pin-${pin.key}`}>
                <button
                  type="button"
                  className="pv-note-pin-head"
                  onClick={() => {
                    if (times.length > 0) onSeek?.(times[0]);
                  }}
                  title={times.length > 0 ? `Seek to ${formatTimecode(times[0])}` : 'on the frame'}
                >
                  <span className="annotation-pin-dot" style={{ background: color }}>{label}</span>
                  <b>{pin.comments.length} note{pin.comments.length === 1 ? '' : 's'} on frame</b>
                  {times.length > 0 && <span className="mono-label">{formatTimecode(times[0])}</span>}
                </button>
                <div className="pv-note-pin-body">
                  {pin.comments.map((comment) => (
                    <div key={comment.id} className="list-row" data-testid={`preview-pin-comment-${comment.id}`}>
                      <span className="annotation-pin-dot" style={{ background: reviewerColor(comment.authorId), width: 18, height: 18, fontSize: 9 }}>
                        {reviewerLabel(comment.authorId)}
                      </span>
                      <span>
                        <b className="mono-label !text-[9px]">
                          {comment.authorId.slice(0, 8)} · {comment.timecodeMs != null ? formatTimecode(comment.timecodeMs) : 'frame note'}
                        </b>
                        <small className="!normal-case">{comment.body}</small>
                      </span>
                      <button type="button" className="link-btn" onClick={() => onResolve(comment.id, !comment.resolvedAt)} title={comment.resolvedAt ? 'Reopen' : 'Resolve'}>
                        <Check size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {timelineNotes.length > 0 && (
        <div className="den-stack mt-3">
          <span className="mono-label">Timecode notes</span>
          {timelineNotes.map((comment) => (
            <div key={comment.id} className="list-row" data-testid={`preview-note-${comment.id}`}>
              <span className="world-symbol"><MessageSquare size={12} /></span>
              <span>
                <b className="mono-label !text-[9px]">
                  {comment.timecodeMs != null ? formatTimecode(comment.timecodeMs) : 'project note'}
                  {comment.color && comment.label && (
                    <span className="annotation-pin-dot" style={{ background: comment.color, width: 14, height: 14, fontSize: 7, display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}>
                      {comment.label}
                    </span>
                  )}
                </b>
                <small className="!normal-case">{comment.body}</small>
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={() => comment.timecodeMs != null && onSeek?.(comment.timecodeMs)}
                title={comment.timecodeMs != null ? 'Seek to this note' : undefined}
              >
                <Play size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {pins.length === 0 && timelineNotes.length === 0 && (
        <p className="setting-copy mt-3">No pins or notes yet — drop pins on the canvas with <b>Annotate</b> and they'll appear here.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WaveformPlayer — an audio proxy rendered as a wavelength bar view with a
// red tick at the exact playhead / annotation time. Clicking or dragging the
// wave seeks; the native <audio> controls sit underneath.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededHeights(seedText: string, count: number): number[] {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  const rand = mulberry32(seed >>> 0);
  return Array.from({ length: count }, () => 0.18 + rand() * 0.82);
}

const WAVE_BARS = 140;

export function WaveformPlayer({
  projectId,
  assetId,
  detail,
  playheadMs = 0,
  onTimeUpdate,
  onPlayheadChange,
  markers,
  children,
  title,
}: {
  projectId: string;
  assetId: string;
  detail?: VideoAssetDetail;
  playheadMs?: number;
  onTimeUpdate?: (ms: number) => void;
  onPlayheadChange?: (ms: number) => void;
  /** Review ticks drawn on the wave — annotations land as red ticks. */
  markers?: Array<{ id: string; ms: number; tone?: 'accent' | 'gold' | 'danger' | 'teal' | 'muted' }>;
  children?: ReactNode;
  title?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(detail?.durationMs ?? 0);

  const heights = useMemo(() => seededHeights(assetId, WAVE_BARS), [assetId]);
  const proxyUrl = proxyUrlFor(projectId, assetId);

  // The native element's duration is the source of truth once metadata loads.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(Math.round(audio.duration * 1000));
    };
    audio.addEventListener('loadedmetadata', onMeta);
    return () => audio.removeEventListener('loadedmetadata', onMeta);
  }, [assetId]);

  // Follow external playhead changes (carousel / note clicks).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Math.abs(audio.currentTime * 1000 - playheadMs) > 400 && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(Math.max(0, playheadMs / 1000), audio.duration || 0);
    }
  }, [playheadMs, assetId]);

  useEffect(() => {
    setDuration(detail?.durationMs ?? 0);
  }, [detail?.durationMs]);

  const msFromClientX = (clientX: number): number => {
    const el = waveRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * duration);
  };

  const onWaveDown = (event: React.PointerEvent) => {
    if (duration <= 0) return;
    const ms = msFromClientX(event.clientX);
    onPlayheadChange?.(ms);
    const audio = audioRef.current;
    if (audio) audio.currentTime = ms / 1000;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const move = (e: PointerEvent) => {
      const next = msFromClientX(e.clientX);
      onPlayheadChange?.(next);
      if (audio) audio.currentTime = next / 1000;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const playheadPct = duration > 0 ? Math.min(100, Math.max(0, (playheadMs / duration) * 100)) : 0;

  return (
    <div className="den-player pv-wave-player" data-testid="waveform-player">
      <div ref={waveRef} className="pv-wave" onPointerDown={onWaveDown} data-testid="waveform-surface">
        <div className="pv-wave-bars">
          {heights.map((height, index) => {
            const played = index / WAVE_BARS <= playheadPct / 100;
            return <span key={index} className={played ? 'played' : ''} style={{ height: `${height * 100}%` }} />;
          })}
        </div>
        {duration > 0 &&
          (markers ?? []).map((marker) => (
            <span
              key={marker.id}
              className={`pv-wave-marker ${marker.tone ?? 'danger'}`}
              style={{ left: `${Math.min(100, Math.max(0, (marker.ms / duration) * 100))}%` }}
              data-testid="waveform-marker"
            />
          ))}
        <span className="pv-wave-tick" style={{ left: `${playheadPct}%` }} data-testid="waveform-tick">
          <span className="pv-wave-tick-label">{formatClock(playheadMs)}</span>
        </span>
        {children}
      </div>
      <div className="pv-wave-controls">
        <audio
          ref={audioRef}
          src={proxyUrl}
          controls
          preload="metadata"
          onTimeUpdate={(event) => onTimeUpdate?.(Math.floor(event.currentTarget.currentTime * 1000))}
          onPlay={(event) => onTimeUpdate?.(Math.floor(event.currentTarget.currentTime * 1000))}
          data-testid="waveform-audio"
        />
        {title && <span className="pv-wave-title truncate">{title}</span>}
      </div>
    </div>
  );
}


