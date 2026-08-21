import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Captions,
  Check,
  Clapperboard,
  Film,
  ImageIcon,
  Layers,
  LockKeyhole,
  Mic2,
  Move,
  Palette,
  Play,
  Plus,
  Save,
  Scissors,
  Sparkles,
  Square,
  Type,
  X,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
  getGetVideoProjectQueryKey,
  getGetVideoTimelineQueryKey,
  getListVideoJobsQueryKey,
  oracleChat,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoJobs,
  useQueueVideoExport,
  useQueueVideoThumbnail,
  useSaveVideoTimeline,
} from '@workspace/api-client-react';
import type { VideoAssetDetail } from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from './selects';
import { ActivityFeed } from '@/components/activity-feed';
import { Timeline, formatTimecode, type TimelineBlock } from '@/components/timeline';
import { RoleOracle, AiResult } from '@/components/role-oracle';
import { AssetPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { CheckoutPanel, ImportFlow } from '@/components/checkout-import';

const LUT_PRESETS = ['NONE', 'WARM', 'COOL', 'CINEMA', 'PUNCHY'] as const;
const CAPTION_STYLES = ['BOTTOM_CENTER', 'SPLIT', 'MINIMAL'] as const;
const EXPORT_FORMATS = [
  { format: '16:9', label: '16:9 · YouTube' },
  { format: '9:16', label: '9:16 · Shorts' },
  { format: '1:1', label: '1:1 · Instagram' },
] as const;

interface GradeNode {
  lut: (typeof LUT_PRESETS)[number];
  exposure: number; // -100..100
  warmth: number; // -100..100
}

interface GradeClip {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
  grade: GradeNode;
}

interface LowerThird {
  id: string;
  title: string;
  subtitle: string;
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  width: number;
}

interface FinishSnapshot {
  clips: GradeClip[];
  captions: { enabled: boolean; style: (typeof CAPTION_STYLES)[number] };
  lowerThirds: LowerThird[];
  thumbnail: { assetId: string; timeMs: number } | null;
  sceneBlocks: Array<{ id: string; type: string; startMs: number; endMs: number }>;
  markers: Array<{ id: string; label: string; timeMs: number }>;
}

const EMPTY_FINISH: FinishSnapshot = {
  clips: [],
  captions: { enabled: false, style: 'BOTTOM_CENTER' },
  lowerThirds: [],
  thumbnail: null,
  sceneBlocks: [],
  markers: [],
};

const DEFAULT_GRADE: GradeNode = { lut: 'NONE', exposure: 0, warmth: 0 };

/** Turn a grade node into a CSS filter so the proxy shows the look live. */
function gradeFilter(grade: GradeNode): string {
  const LUT_FILTERS: Record<GradeNode['lut'], string> = {
    NONE: '',
    WARM: 'sepia(0.22) saturate(1.06)',
    COOL: 'saturate(0.88) hue-rotate(-6deg)',
    CINEMA: 'contrast(1.12) saturate(0.85)',
    PUNCHY: 'contrast(1.16) saturate(1.2)',
  };
  const parts: string[] = [];
  if (LUT_FILTERS[grade.lut]) parts.push(LUT_FILTERS[grade.lut]);
  if (grade.exposure !== 0) parts.push(`brightness(${(1 + grade.exposure / 200).toFixed(3)})`);
  if (grade.warmth > 0) parts.push(`sepia(${(grade.warmth / 200).toFixed(3)})`);
  else if (grade.warmth < 0) parts.push(`hue-rotate(${(grade.warmth / 5).toFixed(1)}deg)`);
  return parts.join(' ') || 'none';
}

/** The caption line for the current playhead (from the Leg 1 transcript). */
function captionFor(detail: VideoAssetDetail | undefined, playheadMs: number): string | null {
  const segments = detail?.transcript?.segments ?? [];
  const segment = segments.find((s) => playheadMs >= s.startMs && playheadMs < s.endMs);
  return segment?.text ?? null;
}

// ---------------------------------------------------------------------------
// Finish preview — the graded proxy with lower-thirds and captions overlaid.
// ---------------------------------------------------------------------------

function FinishPreview({
  projectId,
  snapshot,
  assets,
  durationMs,
  playheadMs,
  onTimeUpdate,
  onScrub,
  headVersionId,
}: {
  projectId: string;
  snapshot: FinishSnapshot;
  assets: Array<{ id: string; fileName: string }>;
  durationMs: number;
  playheadMs: number;
  onTimeUpdate: (ms: number) => void;
  onScrub: (ms: number) => void;
  /** Scope on-frame pins to the FINISH leg's head snapshot. */
  headVersionId?: string | null;
}) {
  // Order clips by source in-point so scrubbing moves left → right.
  const clips = useMemo(
    () => [...snapshot.clips].sort((a, b) => a.inMs - b.inMs || a.id.localeCompare(b.id)),
    [snapshot.clips],
  );

  // The clip under the playhead drives both the source asset and its grade.
  const activeClip = useMemo(
    () =>
      clips.find(
        (clip) => playheadMs >= clip.inMs && playheadMs < Math.max(clip.inMs + 1, clip.outMs),
      ) ?? null,
    [clips, playheadMs],
  );

  // Manual picker for the no-clips case; once clips exist the scrubber drives it.
  const [fallbackAssetId, setFallbackAssetId] = useState<string | null>(null);
  useEffect(() => {
    if (!fallbackAssetId && assets.length > 0) setFallbackAssetId(assets[0].id);
  }, [assets, fallbackAssetId]);

  const previewAssetId = activeClip?.assetId ?? clips[0]?.assetId ?? fallbackAssetId ?? assets[0]?.id ?? null;
  const detail = useGetVideoAsset(projectId, previewAssetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, previewAssetId ?? ''),
      enabled: Boolean(previewAssetId),
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });

  if (assets.length === 0) return null;

  const asset = assets.find((a) => a.id === previewAssetId) ?? assets[0];
  const grade = activeClip?.grade ?? clips.find((c) => c.assetId === asset.id)?.grade ?? DEFAULT_GRADE;
  const caption = snapshot.captions.enabled ? captionFor(detail.data, playheadMs) : null;

  const clipBlocks: TimelineBlock[] = clips.map((clip) => ({
    id: clip.id,
    label: assets.find((a) => a.id === clip.assetId)?.fileName ?? clip.assetId,
    sublabel: `${clip.grade.lut} · ${formatTimecode(clip.inMs)} → ${formatTimecode(clip.outMs)}`,
    startMs: clip.inMs,
    endMs: Math.max(clip.outMs, clip.inMs + 500),
    tone: 'accent',
  }));

  return (
    <div className="paper-card" data-testid="panel-finish-preview">
      <div className="inline-heading">
        <span className="eyebrow"><Palette size={13} /> Graded preview</span>
        <span className="mono-label">{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
        {clips.length === 0 && assets.length > 1 && (
          <select
            value={fallbackAssetId ?? ''}
            onChange={(event) => setFallbackAssetId(event.target.value || null)}
            className="!w-auto !text-xs"
            data-testid="finish-select-preview-asset"
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.fileName}</option>
            ))}
          </select>
        )}
      </div>
      <p className="setting-copy">Scrub across the clips below — each clip applies its own grade, with lower thirds and captions overlaid live.</p>

      <AssetPlayer
        className="mt-3"
        projectId={projectId}
        assetId={asset.id}
        detail={detail.data}
        playheadMs={playheadMs}
        onTimeUpdate={onTimeUpdate}
        filter={gradeFilter(grade)}
        title={`${asset.fileName} · ${grade.lut}`}
      >
        <div className="den-frame-overlay">
          {snapshot.lowerThirds.map((lower) => (
            <div
              key={lower.id}
              className="den-overlay-card"
              style={{ left: `${lower.x}%`, top: `${lower.y}%`, width: lower.width }}
              data-testid={`preview-lower-third-${lower.id}`}
            >
              <span className="den-overlay-title">{lower.title}</span>
              {lower.subtitle && <span className="den-overlay-sub">{lower.subtitle}</span>}
            </div>
          ))}
          {caption && (
            <div className="den-caption-bar">
              <span className="den-caption-text">{caption}</span>
            </div>
          )}
        </div>
        <AnnotationCanvas
          projectId={projectId}
          leg="FINISH"
          assetId={asset.id}
          playheadMs={playheadMs}
          onSeek={onScrub}
          timelineVersionId={headVersionId}
        />
      </AssetPlayer>

      {clips.length > 0 && (
        <div className="mt-4">
          <Timeline
            title="Grade clips — scrub to compare"
            hint="Click or drag the ruler to move across clips · each clip applies its own grade"
            blocks={clipBlocks}
            durationMs={durationMs}
            playheadMs={playheadMs}
            canEdit={false}
            scrubOnly
            onScrub={onScrub}
            activeId={activeClip?.id ?? null}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="den-tag gold">{grade.lut}</span>
        <span className="den-tag accent">exposure {grade.exposure > 0 ? '+' : ''}{grade.exposure}</span>
        <span className="den-tag teal">warmth {grade.warmth > 0 ? '+' : ''}{grade.warmth}</span>
        {snapshot.captions.enabled && <span className="den-tag muted">{snapshot.captions.style.replaceAll('_', ' ')} captions</span>}
        {activeClip && <span className="den-tag muted">{assets.find((a) => a.id === activeClip.assetId)?.fileName ?? activeClip.assetId}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grade nodes
// ---------------------------------------------------------------------------

function GradePanel({
  snapshot,
  onChange,
  assets,
  canEdit,
}: {
  snapshot: FinishSnapshot;
  onChange: (next: FinishSnapshot) => void;
  assets: Array<{ id: string; fileName: string }>;
  canEdit: boolean;
}) {
  const updateGrade = (id: string, patch: Partial<GradeNode>) => {
    onChange({
      ...snapshot,
      clips: snapshot.clips.map((c) => (c.id === id ? { ...c, grade: { ...c.grade, ...patch } } : c)),
    });
  };

  const removeClip = (id: string) => {
    onChange({ ...snapshot, clips: snapshot.clips.filter((c) => c.id !== id) });
  };

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Layers size={13} /> Per-clip grade nodes</span>
        <span className="mono-label">{snapshot.clips.length} graded</span>
      </div>
      {snapshot.clips.length === 0 ? (
        <p className="setting-copy">
          Add clips to grade — each node matches exposure, warmth, and a LUT so rooms shot at different times sit in one look.
        </p>
      ) : (
        <div className="den-stack mt-3">
          {snapshot.clips.map((clip) => (
            <div key={clip.id} className="paper-card" style={{ padding: 16 }} data-testid={`grade-clip-${clip.id}`}>
              <div className="inline-heading">
                <span className="mono-label !text-[10px]">{assets.find((a) => a.id === clip.assetId)?.fileName ?? clip.assetId}</span>
                {canEdit && (
                  <button type="button" onClick={() => removeClip(clip.id)} className="danger-icon" title="Remove clip">
                    <X size={14} />
                  </button>
                )}
              </div>
              {canEdit ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="field !mb-0">
                    <span>LUT preset</span>
                    <select
                      value={clip.grade.lut}
                      onChange={(event) => updateGrade(clip.id, { lut: event.target.value as GradeNode['lut'] })}
                      data-testid={`grade-lut-${clip.id}`}
                    >
                      {LUT_PRESETS.map((lut) => (
                        <option key={lut} value={lut}>{lut}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field !mb-0">
                    <span>Exposure · {clip.grade.exposure > 0 ? '+' : ''}{clip.grade.exposure}</span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={clip.grade.exposure}
                      onChange={(event) => updateGrade(clip.id, { exposure: Number(event.target.value) })}
                      style={{ accentColor: 'hsl(var(--accent))' }}
                      data-testid={`grade-exposure-${clip.id}`}
                    />
                  </div>
                  <div className="field !mb-0 sm:col-span-2">
                    <span>Warmth · {clip.grade.warmth > 0 ? '+' : ''}{clip.grade.warmth}</span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={clip.grade.warmth}
                      onChange={(event) => updateGrade(clip.id, { warmth: Number(event.target.value) })}
                      style={{ accentColor: 'hsl(var(--sidebar-primary))' }}
                      data-testid={`grade-warmth-${clip.id}`}
                    />
                  </div>
                </div>
              ) : (
                <p className="mono-label mt-2">
                  {clip.grade.lut} · exposure {clip.grade.exposure} · warmth {clip.grade.warmth}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Captions + lower thirds
// ---------------------------------------------------------------------------

function CaptionsPanel({
  snapshot,
  onChange,
  canEdit,
}: {
  snapshot: FinishSnapshot;
  onChange: (next: FinishSnapshot) => void;
  canEdit: boolean;
}) {
  const toggle = () => {
    onChange({ ...snapshot, captions: { ...snapshot.captions, enabled: !snapshot.captions.enabled } });
  };

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Captions size={13} /> Captions</span>
        {canEdit && (
          <button type="button" onClick={toggle} className={snapshot.captions.enabled ? 'den-tag teal' : 'den-tag muted'} data-testid="toggle-captions">
            {snapshot.captions.enabled ? <Check size={10} /> : <Plus size={10} />}
            {snapshot.captions.enabled ? 'Burning in' : 'Burn in'}
          </button>
        )}
      </div>
      <p className="setting-copy">Captions are generated from the Stage 1 transcript — never re-transcribed.</p>
      {snapshot.captions.enabled && canEdit && (
        <div className="den-chip-list mt-3">
          {CAPTION_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => onChange({ ...snapshot, captions: { ...snapshot.captions, style } })}
              className={`den-chip ${snapshot.captions.style === style ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : ''}`}
              data-testid={`caption-style-${style}`}
            >
              {style.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lower thirds — canvas board with drag + resize (direct manipulation)
// ---------------------------------------------------------------------------

function LowerThirdsPanel({
  snapshot,
  onChange,
  canEdit,
  durationMs,
  onScrub,
}: {
  snapshot: FinishSnapshot;
  onChange: (next: FinishSnapshot) => void;
  canEdit: boolean;
  durationMs: number;
  onScrub: (ms: number) => void;
}) {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const add = () => {
    if (!title.trim()) return;
    const lowerThird: LowerThird = {
      id: crypto.randomUUID(),
      title: title.trim(),
      subtitle: subtitle.trim(),
      startMs: 0,
      endMs: Math.min(5000, durationMs),
      x: 6,
      y: 6,
      width: 230,
    };
    onChange({ ...snapshot, lowerThirds: [...snapshot.lowerThirds, lowerThird] });
    setTitle('');
    setSubtitle('');
  };

  const remove = (id: string) => {
    onChange({ ...snapshot, lowerThirds: snapshot.lowerThirds.filter((l) => l.id !== id) });
  };

  const patch = (id: string, value: Partial<LowerThird>) => {
    onChange({ ...snapshot, lowerThirds: snapshot.lowerThirds.map((l) => (l.id === id ? { ...l, ...value } : l)) });
  };

  const startDrag = (event: React.PointerEvent, item: LowerThird) => {
    if (!canEdit) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { id: item.id, startX: event.clientX, startY: event.clientY, origX: item.x, origY: item.y };
    const move = (e: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const itemW = (item.width / rect.width) * 100;
      const x = Math.max(0, Math.min(100 - itemW, drag.origX + ((e.clientX - drag.startX) / rect.width) * 100));
      const y = Math.max(0, Math.min(96, drag.origY + ((e.clientY - drag.startY) / rect.height) * 100));
      patch(drag.id, { x, y });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (event: React.PointerEvent, item: LowerThird) => {
    if (!canEdit) return;
    event.stopPropagation();
    const start = { x: event.clientX, width: item.width };
    const move = (e: globalThis.PointerEvent) => {
      patch(item.id, { width: Math.max(130, Math.min(460, start.width + (e.clientX - start.x))) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Type size={13} /> Lower thirds — the board</span>
        <span className="mono-label">{snapshot.lowerThirds.length} on frame</span>
      </div>
      <p className="setting-copy mb-3">
        <Move size={11} style={{ display: 'inline', verticalAlign: '-1px' }} />
        Drag a card to place it on the frame · pull the corner to resize · click a card to scrub to its time.
      </p>

      <div className="den-canvas" ref={canvasRef} data-testid="lower-third-canvas">
        <span className="den-canvas-grid" />
        {snapshot.lowerThirds.length === 0 ? (
          <div className="panel-empty" style={{ position: 'relative' }}>No cards yet — add one below and it appears here.</div>
        ) : (
          snapshot.lowerThirds.map((lower) => (
            <div
              key={lower.id}
              className="den-canvas-item"
              style={{ left: `${lower.x}%`, top: `${lower.y}%`, width: lower.width }}
              onPointerDown={(event) => startDrag(event, lower)}
              onClick={() => onScrub(lower.startMs)}
              data-testid={`lower-third-${lower.id}`}
            >
              <span className="den-canvas-label">{lower.title}</span>
              {lower.subtitle && <span className="den-canvas-sub">{lower.subtitle}</span>}
              <span className="den-canvas-sub">{formatTimecode(lower.startMs)} → {formatTimecode(lower.endMs)}</span>
              {canEdit && (
                <>
                  <span className="resize-handle" onPointerDown={(event) => startResize(event, lower)} title="Resize" />
                  <button
                    type="button"
                    className="den-canvas-remove"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => remove(lower.id)}
                    title="Remove card"
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name — e.g. Ada Lovelace" maxLength={80} className="flex-1" data-testid="lower-third-title" />
          <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="Title — e.g. Software Pioneer" maxLength={120} className="flex-1" data-testid="lower-third-subtitle" />
          <button type="button" onClick={add} disabled={!title.trim()} className="secondary-btn" data-testid="button-add-lower-third">
            <Plus size={13} /> Add card
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thumbnail + exports
// ---------------------------------------------------------------------------

function ExportPanel({
  projectId,
  snapshot,
  onThumbnail,
  canEdit,
  durationMs,
}: {
  projectId: string;
  snapshot: FinishSnapshot;
  onThumbnail: (timeMs: number, assetId: string) => void;
  canEdit: boolean;
  durationMs: number;
}) {
  const queryClient = useQueryClient();
  const jobs = useListVideoJobs(projectId);
  const exportQueue = useQueueVideoExport();
  const thumbQueue = useQueueVideoThumbnail();
  const [selectedFormats, setSelectedFormats] = useState<string[]>(['16:9', '9:16']);
  const frameRef = useRef<HTMLDivElement>(null);

  const thumbTimeMs = snapshot.thumbnail?.timeMs ?? 0;

  const toggleFormat = (format: string) => {
    setSelectedFormats((prev) =>
      prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format],
    );
  };

  const runExports = () => {
    if (selectedFormats.length === 0) return;
    exportQueue.mutate(
      { projectId, data: { formats: selectedFormats as ('16:9' | '9:16' | '1:1')[] } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  const runThumbnail = () => {
    if (!snapshot.thumbnail) return;
    thumbQueue.mutate(
      { projectId, data: { assetId: snapshot.thumbnail.assetId, timeMs: snapshot.thumbnail.timeMs } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  const scrubThumbnail = (event: React.PointerEvent) => {
    if (!canEdit) return;
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onThumbnail(Math.round(ratio * durationMs), snapshot.thumbnail?.assetId ?? '');
  };

  const latestExport = (jobs.data ?? []).filter((job) => job.type === 'EXPORT').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const exportError = exportQueue.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="paper-card accent-card">
      <div className="inline-heading">
        <span className="eyebrow"><Clapperboard size={13} /> Multi-format export</span>
      </div>

      <div className="mt-3">
        <span className="mono-label">Thumbnail frame — drag to scrub</span>
        <div
          ref={frameRef}
          className="den-waveform mt-2"
          style={{ height: 44, background: 'hsl(var(--primary))', cursor: 'crosshair' }}
          onPointerDown={scrubThumbnail}
          data-testid="thumbnail-scrub"
        >
          <div className="den-waveform-bars" style={{ opacity: 0.35 }}>
            {Array.from({ length: 64 }, (_, i) => (
              <span key={i} style={{ height: `${20 + ((i * 37) % 60)}%`, background: 'hsl(var(--primary-foreground))' }} />
            ))}
          </div>
          <span className="timeline-playhead" style={{ left: `${durationMs > 0 ? (thumbTimeMs / durationMs) * 100 : 0}%` }}>
            <span className="timeline-playhead-label">{formatTimecode(thumbTimeMs)}</span>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="den-tag teal" data-testid="thumbnail-frame">
            <ImageIcon size={11} />
            {snapshot.thumbnail ? `frame @ ${formatTimecode(thumbTimeMs)}` : 'no frame marked'}
          </span>
          {canEdit && (
            <button type="button" onClick={runThumbnail} disabled={!snapshot.thumbnail || thumbQueue.isPending} className="secondary-btn" data-testid="button-extract-thumbnail">
              <ImageIcon size={13} className={thumbQueue.isPending ? 'animate-pulse' : ''} />
              {thumbQueue.isPending ? 'Extracting…' : 'Extract thumbnail'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="mono-label">Formats</span>
        <div className="den-chip-list mt-2">
          {EXPORT_FORMATS.map((item) => {
            const active = selectedFormats.includes(item.format);
            return (
              <button
                key={item.format}
                type="button"
                onClick={() => canEdit && toggleFormat(item.format)}
                className={`den-chip ${active ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : ''}`}
                data-testid={`export-format-${item.format}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {canEdit && (
          <button type="button" onClick={runExports} disabled={exportQueue.isPending || selectedFormats.length === 0} className="primary-btn mt-3" data-testid="button-run-exports">
            <Clapperboard size={14} className={exportQueue.isPending ? 'animate-pulse' : ''} />
            {exportQueue.isPending ? 'Queuing…' : 'Queue exports'}
          </button>
        )}
        {latestExport && (
          <p className="den-footnote mt-3" data-testid="export-status">
            <Sparkles size={12} />
            Latest export: {latestExport.status.toLowerCase()} · {String(latestExport.params?.format ?? '')}
            {latestExport.status === 'SUCCEEDED' && Boolean(latestExport.result?.demo) && ' · demo receipt'}
          </p>
        )}
        {exportQueue.isError && (
          <p className="setting-copy mt-2" role="alert">
            {exportError?.response?.data?.error || 'The export could not be queued.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContentCreatorsFinishPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Live: export/thumbnail progress, comments, and submissions.
  useProjectRealtime(projectId, 'FINISH');
  const [working, setWorking] = useState<FinishSnapshot>(EMPTY_FINISH);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [playheadMs, setPlayheadMs] = useState(0);
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const finishTimeline = useGetVideoTimeline(projectId, 'FINISH');
  const save = useSaveVideoTimeline();

  useEffect(() => {
    if (finishTimeline.data?.snapshot) {
      const snapshot = finishTimeline.data.snapshot as unknown as FinishSnapshot;
      setWorking({
        clips: Array.isArray(snapshot.clips) ? snapshot.clips : [],
        captions: snapshot.captions ?? EMPTY_FINISH.captions,
        lowerThirds: Array.isArray(snapshot.lowerThirds) ? snapshot.lowerThirds.map((l) => ({ ...l, x: l.x ?? 6, y: l.y ?? 6, width: l.width ?? 230 })) : [],
        thumbnail: snapshot.thumbnail ?? null,
        sceneBlocks: Array.isArray(snapshot.sceneBlocks) ? snapshot.sceneBlocks : [],
        markers: Array.isArray(snapshot.markers) ? snapshot.markers : [],
      });
      setDirty(false);
    }
  }, [finishTimeline.data?.snapshot, finishTimeline.data?.version]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === 'MOTION_COLOR';

  const timelineDuration = Math.max(
    60_000,
    project.data?.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0) ?? 60_000,
  );

  const onSave = () => {
    save.mutate(
      { projectId, leg: 'FINISH', data: { snapshot: working as unknown as Record<string, unknown>, message: message.trim() || undefined } },
      {
        onSuccess: () => {
          setMessage('');
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, 'FINISH') });
        },
      },
    );
  };

  const saveError = save.error as { response?: { data?: { error?: string } } } | null;

  const oracleContext = useMemo(() => {
    const clips = working.clips.map((c, i) => `clip ${i + 1}: ${assetsName(c.assetId)} · LUT ${c.grade.lut} · exposure ${c.grade.exposure} · warmth ${c.grade.warmth}`).join('\n') || 'none yet';
    const cards = working.lowerThirds.map((l) => `“${l.title}${l.subtitle ? ` — ${l.subtitle}` : ''}” @ ${formatTimecode(l.startMs)}–${formatTimecode(l.endMs)}`).join('\n') || 'none yet';
    const caps = working.captions.enabled ? working.captions.style : 'off';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Timeline duration: ${formatTimecode(timelineDuration)}`,
      `Grade clips:\n${clips}`,
      `Lower thirds:\n${cards}`,
      `Captions: ${caps}`,
      `Thumbnail: ${working.thumbnail ? `frame @ ${formatTimecode(working.thumbnail.timeMs)}` : 'not marked'}`,
    ].join('\n\n').slice(0, 12000);
  }, [working, project.data?.name, timelineDuration]);

  function assetsName(assetId: string): string {
    return project.data?.assets.find((a) => a.id === assetId)?.fileName ?? assetId;
  }

  const runOracleSuggestion = async (instruction: string): Promise<string | null> => {
    setAiBusy(true);
    try {
      const result = await oracleChat({ messages: [{ role: 'system', content: 'You are the Motion & Color director\'s assistant in a video relay. Be concise and concrete.' }, { role: 'user', content: `${instruction}\n\nContext:\n${oracleContext}` }] });
      setAiResult((prev) => (prev ? { ...prev, meta: { providerId: result.providerId, modelId: result.modelId } } : prev));
      return result.content;
    } catch {
      return null;
    } finally {
      setAiBusy(false);
    }
  };

  const applyGradesFromAnswer = (text: string): number => {
    const re = /clip\s+(\d+)[:.)]\s*(?:LUT\s*=\s*)?([A-Z_]+)\s+(?:exposure\s*=\s*)?([+-]?\d+)\s+(?:warmth\s*=\s*)?([+-]?\d+)/gi;
    const clips = working.clips.map((c) => ({ ...c, grade: { ...c.grade } }));
    let applied = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const index = Number(m[1]) - 1;
      const clip = clips[index];
      if (!clip) continue;
      const lut = m[2].toUpperCase();
      if (!(LUT_PRESETS as readonly string[]).includes(lut)) continue;
      clip.grade = {
        lut: lut as GradeNode['lut'],
        exposure: Math.max(-100, Math.min(100, Number(m[3]) || 0)),
        warmth: Math.max(-100, Math.min(100, Number(m[4]) || 0)),
      };
      applied += 1;
    }
    if (applied > 0) {
      setWorking((prev) => ({ ...prev, clips }));
      setDirty(true);
    }
    return applied;
  };

  const quickActions = [
    {
      id: 'review-finish',
      label: 'Review the finish',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Review the finish: grade consistency, caption style, lower-third timing, and thumbnail pick. Give concrete notes. Be concise.').then((body) => {
          if (body) setAiResult({ title: 'Finish review', body, meta: null });
        });
      },
    },
    {
      id: 'suggest-grade',
      label: 'Suggest grades',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Suggest one cohesive grade. Answer ONLY with lines of the form "clip N: LUT=<preset> exposure=<number> warmth=<number>" using presets NONE, WARM, COOL, CINEMA, PUNCHY and the clip numbers above.').then((body) => {
          if (!body) return;
          const count = applyGradesFromAnswer(body);
          setAiResult({ title: count > 0 ? `Grades — ${count} applied` : 'Grade suggestions (review below)', body, meta: null });
        });
      },
    },
  ];

  if (project.isLoading) {
    return <div className="page"><div className="panel-empty">Opening the finishing suite…</div></div>;
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>FINISHING SUITE CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;
  const released = p.status === 'RELEASED';

  return (
    <div className="page">
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>CONTENT CREATORS · THE FINISHING SUITE</b>
          <span>Grade every clip into one look, burn captions from the transcript, place lower thirds, and export every format.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Motion &amp; Color · finish &amp; polish</SectionEyebrow>
          <h1>Finish &amp; polish.</h1>
          <p>Drag lower-thirds onto the frame, scrub the thumbnail strip, and let the oracle check the look.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-finish-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canEdit ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canEdit ? 'Editing as Motion & Color Director' : 'Viewing'}
          </span>
        </div>
      </div>

      {released && (
        <div className="den-status-banner" data-testid="banner-released">
          <Check size={14} />
          The Lock is released — the team can download the finals from the vault.
        </div>
      )}

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
          const Icon = item.icon;
          const active = item.leg === 'FINISH';
          const href =
            item.leg === 'SELECTS'
              ? `/projects/${p.id}/selects`
              : item.leg === 'CUT'
                ? `/projects/${p.id}/cut`
                : item.leg === 'SOUND'
                  ? `/projects/${p.id}/sound`
                  : `/projects/${p.id}/finish`;
          return (
            <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`finish-tab-leg-${item.leg}`}>
              <Icon size={13} />
              {item.role}
            </Link>
          );
        })}
      </div>

      <div className="den-two-col">
        <div className="space-y-4">
          <FinishPreview
            projectId={p.id}
            snapshot={working}
            assets={p.assets}
            durationMs={timelineDuration}
            playheadMs={playheadMs}
            onTimeUpdate={setPlayheadMs}
            onScrub={setPlayheadMs}
            headVersionId={finishTimeline.data?.versions.find((v) => v.version === finishTimeline.data?.version)?.id ?? null}
          />
          <GradePanel snapshot={working} onChange={(next) => { setWorking(next); setDirty(true); }} assets={p.assets} canEdit={canEdit} />
          <LowerThirdsPanel
            snapshot={working}
            onChange={(next) => { setWorking(next); setDirty(true); }}
            canEdit={canEdit}
            durationMs={timelineDuration}
            onScrub={setPlayheadMs}
          />
          <CaptionsPanel snapshot={working} onChange={(next) => { setWorking(next); setDirty(true); }} canEdit={canEdit} />
          <CommentsPanel projectId={p.id} leg="FINISH" />
        </div>

        <div className="space-y-4">
          <ExportPanel
            projectId={p.id}
            snapshot={working}
            canEdit={canEdit}
            durationMs={timelineDuration}
            onThumbnail={(timeMs, assetId) => {
              setWorking((prev) => ({ ...prev, thumbnail: { assetId: assetId || prev.thumbnail?.assetId || '', timeMs } }));
              setDirty(true);
            }}
          />

          {aiResult && (
            <AiResult
              title={aiResult.title}
              meta={aiResult.meta}
              actions={[
                <button key="dismiss" type="button" className="text-btn" onClick={() => setAiResult(null)}>Dismiss</button>,
              ]}
            >
              {aiResult.body}
            </AiResult>
          )}

          <RoleOracle
            leg="FINISH"
            roleName="Motion & Color Director"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canEdit}
            placeholder="e.g. Should this cut feel warmer in the core?"
          />

          <div className="paper-card accent-card">
            <div className="inline-heading">
              <span className="eyebrow"><Save size={13} /> Save this finish</span>
            </div>
            {canEdit ? (
              <div className="mt-3 flex gap-2">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="What changed in this pass? (optional)"
                  maxLength={500}
                  data-testid="finish-input-save-message"
                />
                <button type="button" onClick={onSave} disabled={save.isPending || !dirty} className="primary-btn" data-testid="finish-button-save">
                  <Save size={13} />
                  {save.isPending ? 'Saving…' : 'Save finish'}
                </button>
              </div>
            ) : (
              <p className="setting-copy mt-3">Only the Motion &amp; Color Director or the Captain can change this finish.</p>
            )}
            {dirty && <p className="den-footnote mt-2"><Sparkles size={12} /> Unsaved changes</p>}
            {save.isError && (
              <p className="setting-copy mt-2" role="alert">
                {saveError?.response?.data?.error || 'The finish could not be saved.'}
              </p>
            )}
          </div>

          <HistoryPanel
            projectId={p.id}
            leg="FINISH"
            versions={finishTimeline.data?.versions ?? []}
            currentVersion={finishTimeline.data?.version ?? null}
            canSubmit={canEdit}
            wipeFilter={(snapshot, ms) => {
              const snap = snapshot as FinishSnapshot;
              const clips = Array.isArray(snap.clips) ? snap.clips : [];
              const clip = clips.find((c) => ms >= c.inMs && ms < Math.max(c.inMs + 1, c.outMs));
              return clip ? gradeFilter(clip.grade) : undefined;
            }}
          />

          <ActivityFeed projectId={p.id} leg="FINISH" className="" />

          <CheckoutPanel
            projectId={p.id}
            projectName={p.name}
            leg="FINISH"
            savedVersion={finishTimeline.data?.version ?? null}
          />

          <ImportFlow projectId={p.id} leg="FINISH" canEdit={canEdit} />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Submit the publish-ready master — when the Captain approves, the Lock releases and the whole team can download the finals.
      </p>
    </div>
  );
}
