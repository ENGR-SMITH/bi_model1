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
//                       timecode notes, with a composer that pins at the
//                       current playhead.
//   FullscreenButton  — expands the canvas container to full screen.
//   WaveformPlayer    — audio player rendered as a wavelength bar view with
//                       a red tick at the exact playhead / annotation time.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Maximize,
  MessageSquare,
  Minimize,
  Pin,
  Play,
} from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListVideoCommentsQueryKey,
  useCreateVideoComment,
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

export function PreviewLayout({
  eyebrow,
  title,
  description,
  backHref,
  backLabel = 'Back',
  status,
  actions,
  main,
  rail,
}: {
  eyebrow: string;
  title: string;
  description: string;
  backHref: string;
  backLabel?: string;
  /** A status tag rendered in the header (e.g. "4 versions"). */
  status?: ReactNode;
  /** Extra header actions rendered next to the back link. */
  actions?: ReactNode;
  /** Left column — the canvas rows (big canvas + version carousel). */
  main: ReactNode;
  /** Right column — the pin / comment wall. */
  rail: ReactNode;
}) {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={backHref} className="secondary-btn" data-testid="preview-back">
            <ArrowLeft size={13} />
            {backLabel}
          </Link>
          {actions}
          {status}
        </div>
      </div>
      <div className="pv-split" data-testid="preview-split">
        <div className="pv-left">
          {main}
        </div>
        <div className="pv-right">
          {rail}
        </div>
      </div>
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
  hint,
}: {
  versions: PreviewVersion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyText: string;
  hint?: string;
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
      {hint && <p className="setting-copy">{hint}</p>}
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
  timelineVersionId,
  playheadMs,
  onSeek,
  composerLeg,
}: {
  projectId: string;
  /** The relay legs whose notes this panel shows (e.g. SELECTS + CUT for video). */
  legs: StudioLeg[];
  /** Optional scope: notes pinned to a specific asset. */
  assetId?: string;
  /** Optional scope: the timeline version being reviewed. */
  timelineVersionId?: string | null;
  /** Playhead used when the composer pins a note. */
  playheadMs?: number | null;
  /** Clicking a note with a timecode seeks the canvas here. */
  onSeek?: (ms: number) => void;
  /** The leg new notes are written with (the version currently selected). */
  composerLeg: StudioLeg;
}) {
  const queryClient = useQueryClient();
  const comments = useListVideoComments(projectId);
  const create = useCreateVideoComment();
  const resolve = useResolveVideoComment();
  const [body, setBody] = useState('');

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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim()) return;
    create.mutate(
      {
        projectId,
        data: {
          leg: composerLeg,
          assetId: assetId ?? undefined,
          timecodeMs: playheadMs ?? undefined,
          body: body.trim(),
          timelineVersionId: timelineVersionId ?? undefined,
        },
      },
      {
        onSuccess: () => {
          setBody('');
          queryClient.invalidateQueries({ queryKey: getListVideoCommentsQueryKey(projectId) });
        },
      },
    );
  };

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

  const createError = create.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="paper-card pv-notes" data-testid="preview-notes">
      <div className="inline-heading">
        <span className="eyebrow"><Pin size={13} /> Pins · comments · notes</span>
        <span className="mono-label">{rows.length}</span>
      </div>
      {timelineVersionId && (
        <p className="den-footnote mt-1">
          scoped to {legs.join(' / ')} · v{timelineVersionId.slice(0, 8)}
        </p>
      )}

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
        <p className="setting-copy mt-3">No pins or notes yet — drop pins on the canvas with <b>Annotate</b>, or pin a note at the playhead below.</p>
      )}

      <form className="mt-4 space-y-2 border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }} onSubmit={submit} data-testid="preview-note-composer">
        <span className="eyebrow"><MessageSquare size={12} /> Pin a note</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Note at this moment…"
          maxLength={4000}
          rows={2}
          data-testid="preview-note-input"
        />
        <div className="flex items-center gap-2">
          <span className="mono-label">at {playheadMs != null ? formatTimecode(playheadMs) : 'playhead'}</span>
          <button type="submit" disabled={create.isPending || !body.trim()} className="primary-btn ml-auto !px-3 !py-1.5 !text-xs" data-testid="preview-note-submit">
            <Pin size={12} />
            {create.isPending ? 'Pinning…' : 'Pin note'}
          </button>
        </div>
        {create.isError && (
          <p className="setting-copy !text-[11px]" role="alert">
            {createError?.response?.data?.error || 'The note could not be pinned.'}
          </p>
        )}
      </form>
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


