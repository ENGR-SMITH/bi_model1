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
  FileVideo2,
  FolderOpen,
  Image as ImageIcon,
  Maximize,
  MessageSquare,
  Mic2,
  Minimize,
  Settings2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVideoProjectQueryKey,
  getListVideoCommentsQueryKey,
  useGetVideoProject,
  useListVideoComments,
  useResolveVideoComment,
} from '@workspace/api-client-react';
import type { VideoAssetDetail, VideoComment } from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';
import { formatClock, proxyUrlFor } from '@/components/asset-preview';
import { formatTimecode } from '@/components/timeline';
import { geometryKey, parseGeometry, reviewerColor, reviewerLabel } from '@/lib/annotations';
import { AgentLaunchButton, BROWSER_UPLOAD_MAX_LABEL, exceedsBrowserUploadCap } from '@/components/agent-upload-modal';

/** Green used to mark a resolved comment / annotation as solved. */
export const RESOLVED_GREEN = 'hsl(150 52% 42%)';

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
// PreviewViewToggle — the top-of-column control that switches the big-canvas
// column between the plain media preview and the split-screen diff map (the
// version-control comparison surface). The "Diff map" option is always
// switchable; a small glowing dot marks when a comparison is actually
// available. When there is no older version, PreviewDiff renders a clear
// notice instead, so the toggle is never confusingly grayed out.
// ---------------------------------------------------------------------------

export type PreviewView = 'preview' | 'diff';

export function PreviewViewToggle({
  view,
  onChange,
  hasDiff,
}: {
  view: PreviewView;
  onChange: (view: PreviewView) => void;
  /** Whether a comparison (an older version) is currently available. */
  hasDiff: boolean;
}) {
  const segments: Array<{ value: PreviewView; label: string; title: string; glow?: boolean }> = [
    { value: 'preview', label: 'Preview', title: 'Show the selected media on its own' },
    { value: 'diff', label: 'Diff map', title: hasDiff ? 'Compare the selected version against its older predecessor' : 'No older version to compare this against yet', glow: true },
  ];
  return (
    <div className="pv-view-toggle" role="tablist" aria-label="Canvas view" data-testid="preview-view-toggle">
      {segments.map((segment) => {
        const active = view === segment.value;
        return (
          <button
            key={segment.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={['pv-view-toggle-btn', active ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(segment.value)}
            title={segment.title}
            data-testid={active ? `preview-view-${segment.value}-active` : `preview-view-${segment.value}`}
          >
            {segment.label}
            {segment.glow && hasDiff && <span className="pv-view-toggle-dot" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffSettings — the diff-map settings a preview page owns so the settings
// dropdown (beside the Diff map toggle) and the diff surfaces share one state.
// ---------------------------------------------------------------------------

export interface DiffSettings {
  /** Pixel-diff threshold (video / image) or spectral slack dB (audio). */
  sensitivity: number;
  /** Auto level-match (audio only). */
  levelMatch: boolean;
}

export const DEFAULT_DIFF_SETTINGS: DiffSettings = {
  sensitivity: 24,
  levelMatch: true,
};

/** Audio defaults — spectral slack lives in a different range (2-12 dB). */
export const DEFAULT_AUDIO_DIFF_SETTINGS: DiffSettings = {
  sensitivity: 6,
  levelMatch: true,
};

// ---------------------------------------------------------------------------
// PreviewSettingsMenu — the settings dropdown beside the Diff map toggle.
// Holds every diff-map setting for the current page: pixel sensitivity for
// video / thumbnail, plus spectral dB slack and auto level-match for audio.
// ---------------------------------------------------------------------------

export function PreviewSettingsMenu({
  kind,
  settings,
  onChange,
}: {
  /** Which controls to show — spectral for audio, pixel threshold otherwise. */
  kind: 'audio' | 'pixel';
  settings: DiffSettings;
  onChange: (settings: DiffSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="pv-diff-settings" ref={ref}>
      <button
        type="button"
        className={['pv-view-toggle-btn', open ? 'active' : ''].filter(Boolean).join(' ')}
        onClick={() => setOpen((value) => !value)}
        aria-label="Diff map settings"
        aria-expanded={open}
        title="Diff map settings"
        data-testid="preview-diff-settings-toggle"
      >
        <Settings2 size={13} />
      </button>
      {open && (
        <div className="pv-diff-settings-pop" role="menu" data-testid="preview-diff-settings">
          {kind === 'audio' ? (
            <>
              <label className="pv-setting-row">
                <span>Diff sensitivity (dB)</span>
                <input
                  type="range"
                  min="2"
                  max="12"
                  step="0.5"
                  value={settings.sensitivity}
                  onChange={(event) => onChange({ ...settings, sensitivity: Number(event.target.value) })}
                  data-testid="preview-diff-sensitivity"
                />
                <b>{settings.sensitivity.toFixed(1)}</b>
              </label>
              <button
                type="button"
                role="switch"
                aria-checked={settings.levelMatch}
                className={`pv-setting-toggle ${settings.levelMatch ? 'on' : ''}`}
                onClick={() => onChange({ ...settings, levelMatch: !settings.levelMatch })}
                title="Auto level-match the two versions before comparing"
                data-testid="preview-diff-levelmatch"
              >
                Auto level match
              </button>
            </>
          ) : (
            <label className="pv-setting-row">
              <span>Diff sensitivity</span>
              <input
                type="range"
                min="4"
                max="60"
                value={settings.sensitivity}
                onChange={(event) => onChange({ ...settings, sensitivity: Number(event.target.value) })}
                data-testid="preview-diff-sensitivity"
              />
              <b>{settings.sensitivity}</b>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PreviewCanvasColumn — the top-of-column header holding the canvas eyebrow +
// the PreviewViewToggle (and its settings dropdown), then the column content
// switched on `view`. In "diff" mode the split-screen diff surface fills the
// column in place of the single media preview; PreviewDiff decides what to
// show (the diff, or a clear notice when there's nothing older to compare).
// When the selected item has no older version to compare, the whole toggle +
// settings row is hidden so the column just shows the plain preview.
// ---------------------------------------------------------------------------

export function PreviewCanvasColumn({
  view,
  onViewChange,
  hasDiff,
  eyebrow,
  preview,
  diff,
  settings,
  onSettingsChange,
  settingsKind = 'pixel',
  annotationHeaderRef,
}: {
  view: PreviewView;
  onViewChange: (view: PreviewView) => void;
  hasDiff: boolean;
  /** Label shown in the column header, e.g. the canvas eyebrow. */
  eyebrow?: ReactNode;
  /** The plain media card (video / waveform / image). */
  preview: ReactNode;
  /** The split-screen diff surface (or a notice when nothing to compare). */
  diff: ReactNode;
  /** Diff settings for the dropdown (and to hand down to PreviewDiff). */
  settings?: DiffSettings;
  onSettingsChange?: (settings: DiffSettings) => void;
  settingsKind?: 'audio' | 'pixel';
  /** The column-header annotation slot — the annotate pencil portals here,
   * centered between the canvas label and the view toggle. Both the preview
   * surface and the diff map render their pencil into it. */
  annotationHeaderRef?: RefObject<HTMLDivElement | null>;
}) {
  const showDiff = hasDiff && view === 'diff';
  return (
    <>
      <div className="pv-canvas-head">
        {eyebrow}
        <div className="pv-canvas-annotation-slot" ref={annotationHeaderRef} />
        {hasDiff ? (
          <div className="pv-canvas-head-actions">
            <PreviewViewToggle view={view} onChange={onViewChange} hasDiff={hasDiff} />
            {settings && onSettingsChange && (
              <PreviewSettingsMenu kind={settingsKind} settings={settings} onChange={onSettingsChange} />
            )}
          </div>
        ) : (
          <span aria-hidden />
        )}
      </div>
      {showDiff ? <div className="pv-canvas-col-full">{diff}</div> : preview}
    </>
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

/** One card in the preview timeline row — a saved version OR a vault file. */
export type CarouselItem =
  | {
      key: string;
      kind: 'version';
      id: string;
      leg: StudioLeg;
      version: number;
      message: string;
      createdAt: string;
      isHead: boolean;
    }
  | {
      key: string;
      kind: 'asset';
      id: string;
      fileName: string;
      kindLabel: string;
      status: string;
      media: 'video' | 'audio' | 'image';
      /** Proxy stream for the thumbnail — present once the asset is PROCESSED. */
      thumbUrl?: string;
    };

export function VersionCarousel({
  items,
  activeKey,
  onSelect,
  emptyText,
}: {
  /** Timeline versions (newest first) + the vault's uploads for this page. */
  items: CarouselItem[];
  /** The currently-active item's key (`version-…` or `asset-…`). */
  activeKey: string | null;
  onSelect: (key: string) => void;
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
        <span className="mono-label">{items.length} on record</span>
      </div>
      {items.length === 0 ? (
        <p className="setting-copy mt-2" data-testid="version-carousel-empty">{emptyText}</p>
      ) : (
        <div className="pv-carousel-wrap">
          <button type="button" className="pv-carousel-arrow" onClick={() => scrollByCards(-1)} aria-label="Earlier items" data-testid="carousel-prev">
            <ChevronLeft size={16} />
          </button>
          <div className="pv-carousel-track" ref={trackRef} data-testid="carousel-track">
            {items.map((item) => {
              const active = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`pv-version-card ${active ? 'active' : ''}`}
                  onClick={() => onSelect(item.key)}
                  data-testid={`carousel-card-${item.key}`}
                >
                  {item.kind === 'version' ? (
                    <>
                      <span className="pv-version-head">
                        <span className="den-tag accent">v{item.version}</span>
                        <span className="pv-version-leg">{item.leg}</span>
                        {item.isHead && <span className="den-tag teal">head</span>}
                      </span>
                      {item.message ? <b className="pv-version-msg truncate">{item.message}</b> : <b className="pv-version-msg muted">no message</b>}
                      <span className="pv-version-date">{new Date(item.createdAt).toLocaleDateString()} · {new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    </>
                  ) : (
                    <>
                      <span className="pv-version-head">
                        <span className="vs-thumb">
                          {item.thumbUrl && item.media !== 'audio' ? (
                            item.media === 'image' ? (
                              <img
                                src={item.thumbUrl}
                                alt=""
                                loading="lazy"
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <video src={`${item.thumbUrl}#t=0.5`} muted playsInline preload="metadata" />
                            )
                          ) : (
                            item.media === 'audio' ? <Mic2 size={14} /> : item.media === 'image' ? <ImageIcon size={14} /> : <FileVideo2 size={14} />
                          )}
                        </span>
                        <span className="pv-version-leg">{item.kindLabel}</span>
                        {item.status !== 'PROCESSED' && <span className="den-tag gold">processing</span>}
                      </span>
                      <b className="pv-version-msg truncate">{item.fileName}</b>
                      <span className="pv-version-date">{item.status === 'PROCESSED' ? 'in the vault' : 'processing…'}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <button type="button" className="pv-carousel-arrow" onClick={() => scrollByCards(1)} aria-label="Later items" data-testid="carousel-next">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoleLayout — the three role pages (Video / Audio / Thumbnail).
// Three columns at 10 : 50 : 40. Column one (the version & vault shelf)
// spans the full height. Columns two and three each split into their own
// two-row grid, so each column keeps its own proportions: column three is
// 32 : 68 (the comment wall short panel on top, the "Hand this stage in"
// card in the tall row below). Column two holds the big canvas — a single
// full-height stage now that role pages no longer upload straight to the
// vault (files come in through submit-for-review instead).
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
  /** Column three, row two — the pin / comment wall. */
  notes: ReactNode;
  /** Column three, row one — the role oracle / submit card. */
  oracle: ReactNode;
  /** Column two, row two — optional direct-upload card. Role pages no longer
      add files straight to the vault: files arrive through submit-for-review
      (approve moves them into the vault), so this slot is unused today. */
  upload?: ReactNode;
}) {
  return (
    <div className="page pv-page role-page" data-testid="role-page">
      <div className="role-grid">
        <div className="role-versions-col">{versions}</div>
        <div className={`role-col-2${upload ? '' : ' role-col-2--solo'}`}>
          <div className="role-canvas-main">{canvas}</div>
          {upload && <div className="role-canvas-bar">{upload}</div>}
        </div>
        <div className="role-col-3">
          {/* Crew-first: the comment wall sits on top (short row), the
              "Hand this stage in" card takes the tall row below it. */}
          <div className="role-notes-main">{notes}</div>
          <div className="role-notes-bar">{oracle}</div>
        </div>
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
// RoleUploadCard — the bottom row of the canvas column: a file PICKER only.
// The format dropdown + drop zone choose the file and the vault kind; there is
// deliberately NO upload button — the "Hand this stage in" card submits the
// chosen file together with the member's description for the Captain's review
// (the desktop-agent button is the alternative path for oversized files). The
// card reports the picked file upward through onPick so the page can hand it
// to the submit card, and the page passes the pick back down via `selected`
// so the chip reflects the file that will travel with the submission.
// ---------------------------------------------------------------------------

export function RoleUploadCard({
  projectId,
  label,
  kinds,
  defaultKind,
  accept,
  checkFormat,
  onPick,
  onClear,
  selected,
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
  /** Reports a newly picked file (and kind) so the submit card can send it. */
  onPick: (file: File, kind: string) => void;
  /** Clears the picked file (page resets its controlled state). */
  onClear: () => void;
  /** The currently picked file (controlled by the page). */
  selected: { file: File; kind: string } | null;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(selected?.kind ?? defaultKind);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');

  const pickFile = (file: File | undefined | null) => {
    if (!file) return;
    const invalid = checkFormat(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    onPick(file, kind);
    if (fileRef.current) fileRef.current.value = '';
  };

  const changeKind = (value: string) => {
    setKind(value);
    // Re-label the pending pick so the submitted kind stays in sync.
    if (selected?.file) onPick(selected.file, value);
  };

  const onDropZoneClick = () => fileRef.current?.click();

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDrag(false);
    pickFile(event.dataTransfer.files?.[0]);
  };

  const overCap = selected ? exceedsBrowserUploadCap(selected.file) : false;

  return (
    <div className="paper-card role-upload-card" data-testid="role-upload">
      <div className="role-upload-row">
        <select
          value={kind}
          onChange={(event) => changeKind(event.target.value)}
          aria-label="File format"
          data-testid="role-upload-kind"
        >
          {kinds.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {/* The second method — hand the file in through the desktop agent
            instead (no browser cap; it submits for review with its own
            description field). */}
        <AgentLaunchButton
          projectId={projectId}
          label="Desktop agent"
          context={label}
          onDone={() => queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) })}
        />
      </div>
      <div
        className={`role-upload-drop ${drag ? 'drag' : ''} ${selected ? 'has-file' : ''}`}
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
        {selected ? (
          <span><FolderOpen size={14} /> <b>{selected.file.name}</b> — will travel with your submission</span>
        ) : (
          <span><FolderOpen size={14} /> Drag &amp; drop your {label} here, or click to browse</span>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        onChange={(event) => pickFile(event.target.files?.[0])}
        className="hidden"
        data-testid="role-upload-input"
      />
      <div className="role-upload-actions">
        {selected ? (
          <button type="button" className="link-btn" onClick={onClear} data-testid="role-upload-clear">
            Remove this file
          </button>
        ) : null}
        {error && (
          <span className="setting-copy" role="alert" style={{ color: 'hsl(var(--destructive))' }} data-testid="role-upload-error">{error}</span>
        )}
        {overCap && (
          <span className="setting-copy" role="alert" style={{ color: 'hsl(var(--destructive))' }} data-testid="role-upload-too-big">
            {selected!.file.name} is over the {BROWSER_UPLOAD_MAX_LABEL} browser limit — use the desktop agent for this one.
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FullscreenButton
// ---------------------------------------------------------------------------

export function FullscreenButton({ targetRef, label = 'Full screen', className = '' }: { targetRef: RefObject<HTMLElement | null>; label?: string; className?: string }) {
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
      className={`pv-fs ${className}`.trim()}
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
  allowResolve = false,
}: {
  projectId: string;
  /** The relay legs whose notes this panel shows (e.g. SELECTS + CUT for video). */
  legs: StudioLeg[];
  /** Optional scope: notes pinned to a specific asset. */
  assetId?: string;
  /** Clicking a note with a timecode seeks the canvas here. */
  onSeek?: (ms: number) => void;
  /** Whether the Resolve / Reopen controls appear on each comment. The
      preview studios are for adding + reviewing comments; the main role
      studios resolve them, so the buttons only render there. */
  allowResolve?: boolean;
}) {
  const queryClient = useQueryClient();
  const comments = useListVideoComments(projectId);
  const resolve = useResolveVideoComment();
  const project = useGetVideoProject(projectId);

  // userId → display name, so every note shows who actually wrote it.
  const memberNameById = useMemo(
    () => new Map((project.data?.members ?? []).map((member) => [member.userId, member.name])),
    [project.data?.members],
  );
  const nameOf = (id: string) => memberNameById.get(id) ?? id.slice(0, 8);

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
    return [...groups.values()]
      // Closed tags sink to the bottom of the list; open ones stay on top.
      .sort((a, b) => {
        const resolvedA = a.comments.length > 0 && a.comments.every((c) => c.resolvedAt) ? 1 : 0;
        const resolvedB = b.comments.length > 0 && b.comments.every((c) => c.resolvedAt) ? 1 : 0;
        return resolvedA - resolvedB || a.key.localeCompare(b.key);
      });
  }, [rows]);

  const timelineNotes = useMemo(
    () =>
      rows
        .filter((comment) => !parseGeometry(comment.geometry) && comment.timecodeMs != null)
        // Closed notes sink to the bottom of the list; open ones stay on top.
        .sort((a, b) => {
          const resolvedA = a.resolvedAt ? 1 : 0;
          const resolvedB = b.resolvedAt ? 1 : 0;
          return resolvedA - resolvedB || (a.timecodeMs ?? 0) - (b.timecodeMs ?? 0);
        }),
    [rows],
  );

  const onResolve = (commentId: string, resolved: boolean) => {
    if (!allowResolve) return;
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
      {pins.length > 0 && (
        <div className="den-stack mt-3">
          {pins.map((pin) => {
            const first = pin.comments[0];
            const color = reviewerColor(first.authorId);
            const label = reviewerLabel(first.authorId);
            const times = [...new Set(pin.comments.map((c) => c.timecodeMs).filter((t): t is number => t != null))];
            // A frame is solved when every note on it has been resolved — the
            // tag turns green to show the issue is closed.
            const resolved = pin.comments.length > 0 && pin.comments.every((c) => c.resolvedAt);
            return (
              <div
                key={pin.key}
                className={`pv-note-pin ${resolved ? 'is-resolved' : ''}`}
                style={!resolved ? { borderColor: `${color}55`, boxShadow: `inset 3px 0 0 ${color}` } : undefined}
                data-testid={`preview-pin-${pin.key}`}
              >
                <button
                  type="button"
                  className="pv-note-pin-head"
                  onClick={() => {
                    if (times.length > 0) onSeek?.(times[0]);
                  }}
                  title={times.length > 0 ? `Seek to ${formatTimecode(times[0])}` : 'on the frame'}
                >
                  <span className="annotation-pin-dot" style={{ background: resolved ? RESOLVED_GREEN : color }}>{label}</span>
                  <b>{pin.comments.length} note{pin.comments.length === 1 ? '' : 's'} on frame</b>
                  {resolved && <span className="den-tag resolved" data-testid={`preview-pin-solved-${pin.key}`}>resolved</span>}
                  {times.length > 0 && <span className="den-tag timechip">{formatTimecode(times[0])}</span>}
                </button>
                <div className="pv-note-pin-body">
                  {pin.comments.map((comment) => (
                    <div
                      key={comment.id}
                      className={`list-row pv-comment-row ${comment.resolvedAt ? 'is-resolved' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => comment.timecodeMs != null && onSeek?.(comment.timecodeMs)}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && comment.timecodeMs != null) {
                          event.preventDefault();
                          onSeek?.(comment.timecodeMs);
                        }
                      }}
                      title={comment.timecodeMs != null ? `Seek to ${formatTimecode(comment.timecodeMs)}` : undefined}
                      data-testid={`preview-pin-comment-${comment.id}`}
                    >
                      <span
                        className="annotation-pin-dot"
                        style={{ background: comment.resolvedAt ? RESOLVED_GREEN : reviewerColor(comment.authorId), width: 18, height: 18, fontSize: 9 }}
                      >
                        {reviewerLabel(comment.authorId)}
                      </span>
                      <span>
                        <b className="mono-label !text-[9px]">
                          <span style={{ color: comment.resolvedAt ? RESOLVED_GREEN : reviewerColor(comment.authorId) }}>
                            {nameOf(comment.authorId)}
                          </span>
                          {comment.timecodeMs != null && <span className="den-tag timechip">{formatTimecode(comment.timecodeMs)}</span>}
                          {comment.resolvedAt && <span className="den-tag resolved" data-testid={`preview-comment-resolved-${comment.id}`}>resolved</span>}
                        </b>
                        <small className="!normal-case">{comment.body}</small>
                      </span>
                      {allowResolve && (
                        <button
                          type="button"
                          className={`link-btn resolve-btn ${comment.resolvedAt ? 'is-resolved' : ''}`}
                          style={comment.resolvedAt ? { color: RESOLVED_GREEN, borderColor: 'hsl(150 52% 42% / .4)' } : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            onResolve(comment.id, !comment.resolvedAt);
                          }}
                          title={comment.resolvedAt ? 'Reopen' : 'Resolve'}
                          data-testid={`preview-resolve-${comment.id}`}
                        >
                          <Check size={12} />
                          <span>{comment.resolvedAt ? 'Reopen' : 'Resolve'}</span>
                        </button>
                      )}
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
            <div
              key={comment.id}
              className={`list-row pv-comment-row ${comment.resolvedAt ? 'is-resolved' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => comment.timecodeMs != null && onSeek?.(comment.timecodeMs)}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && comment.timecodeMs != null) {
                  event.preventDefault();
                  onSeek?.(comment.timecodeMs);
                }
              }}
              title={comment.timecodeMs != null ? `Seek to ${formatTimecode(comment.timecodeMs)}` : undefined}
              data-testid={`preview-note-${comment.id}`}
            >
              <span className="world-symbol"><MessageSquare size={12} /></span>
              <span>
                <b className="mono-label !text-[9px]">
                  <span style={{ color: comment.resolvedAt ? RESOLVED_GREEN : (comment.color ?? reviewerColor(comment.authorId)) }}>
                    {comment.timecodeMs != null ? formatTimecode(comment.timecodeMs) : 'project note'}
                  </span>
                  {comment.color && comment.label && (
                    <span
                      className="annotation-pin-dot"
                      style={{ background: comment.resolvedAt ? RESOLVED_GREEN : comment.color, width: 14, height: 14, fontSize: 7, display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}
                    >
                      {comment.label}
                    </span>
                  )}
                  {comment.resolvedAt && <span className="den-tag resolved" data-testid={`preview-note-resolved-${comment.id}`}>resolved</span>}
                  <span className="note-author">· {nameOf(comment.authorId)}</span>
                </b>
                <small className="!normal-case">{comment.body}</small>
              </span>
              {allowResolve && (
                <button
                  type="button"
                  className={`link-btn resolve-btn ${comment.resolvedAt ? 'is-resolved' : ''}`}
                  style={comment.resolvedAt ? { color: RESOLVED_GREEN, borderColor: 'hsl(150 52% 42% / .4)' } : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onResolve(comment.id, !comment.resolvedAt);
                  }}
                  title={comment.resolvedAt ? 'Reopen' : 'Resolve'}
                  data-testid={`preview-note-resolve-${comment.id}`}
                >
                  <Check size={12} />
                  <span>{comment.resolvedAt ? 'Reopen' : 'Resolve'}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pins.length === 0 && timelineNotes.length === 0 && (
        <p className="setting-copy mt-3">No pins or notes yet — review comments from the studios will appear here.</p>
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


