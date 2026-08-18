import { useCallback, useRef, useState, type ReactNode } from 'react';
import { GripVertical, LockKeyhole } from 'lucide-react';

export type TimelineTone = 'accent' | 'primary' | 'teal' | 'gold' | 'danger' | 'muted';

export interface TimelineBlock {
  id: string;
  label: string;
  sublabel?: string;
  startMs: number;
  endMs: number;
  tone?: TimelineTone;
  locked?: boolean;
}

export function formatTimecode(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '–:––';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/** The block whose [start, end) window contains the playhead — or null. */
export function activeBlockId(blocks: TimelineBlock[], playheadMs: number): string | null {
  return (
    blocks.find(
      (block) => playheadMs >= block.startMs && playheadMs < Math.max(block.startMs + 1, block.endMs),
    )?.id ?? null
  );
}

const MIN_CLIP_MS = 250;

type DragMode =
  | { kind: 'move'; id: string; startMs: number; dragStartX: number; origStart: number }
  | { kind: 'trim-left'; id: string; dragStartX: number; origStart: number }
  | { kind: 'trim-right'; id: string; dragStartX: number; origEnd: number }
  | { kind: 'scrub'; dragStartX: number };

function pickRulerStep(durationMs: number): number {
  const candidates = [500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
  const target = durationMs / 10;
  for (const step of candidates) {
    if (step >= target) return step;
  }
  return 3600000;
}

export function Timeline({
  blocks,
  durationMs,
  playheadMs,
  canEdit,
  onChange,
  onScrub,
  onSelect,
  selectedId,
  activeId,
  renderBlock,
  title,
  hint,
  rows = 'single',
  scrubOnly = false,
}: {
  blocks: TimelineBlock[];
  durationMs: number;
  playheadMs: number;
  canEdit: boolean;
  onChange?: (next: TimelineBlock[]) => void;
  onScrub?: (ms: number) => void;
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  /** Block id currently under the playhead — highlighted as "playing". */
  activeId?: string | null;
  renderBlock?: (block: TimelineBlock) => ReactNode;
  title?: string;
  hint?: string;
  rows?: 'single' | 'double';
  /** Allow ruler scrubbing while keeping blocks non-editable (read-only review). */
  scrubOnly?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTip, setHoverTip] = useState<{ block: TimelineBlock; x: number; y: number } | null>(null);

  const msFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * durationMs);
  }, [durationMs]);

  const handleMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const ms = msFromClientX(event.clientX);

    if (drag.kind === 'move') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const dur = Math.max(MIN_CLIP_MS, block.endMs - block.startMs);
      const nextStart = Math.max(0, Math.min(durationMs - dur, drag.origStart + (ms - drag.startMs)));
      onChange?.(
        blocks.map((b) => (b.id === drag.id ? { ...b, startMs: nextStart, endMs: nextStart + dur } : b)),
      );
    } else if (drag.kind === 'trim-left') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const delta = ms - drag.dragStartX;
      const nextStart = Math.max(0, Math.min(block.endMs - MIN_CLIP_MS, drag.origStart + delta));
      onChange?.(blocks.map((b) => (b.id === drag.id ? { ...b, startMs: nextStart } : b)));
    } else if (drag.kind === 'trim-right') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const delta = ms - drag.dragStartX;
      const nextEnd = Math.max(block.startMs + MIN_CLIP_MS, Math.min(durationMs, drag.origEnd + delta));
      onChange?.(blocks.map((b) => (b.id === drag.id ? { ...b, endMs: nextEnd } : b)));
    } else if (drag.kind === 'scrub') {
      onScrub?.(ms);
    }
  }, [blocks, durationMs, msFromClientX, onChange, onScrub]);

  const handleUp = useCallback(() => {
    dragRef.current = null;
    setDraggingId(null);
    document.removeEventListener('pointermove', handleMove);
    document.removeEventListener('pointerup', handleUp);
  }, [handleMove]);

  const startDrag = useCallback((mode: DragMode, event: React.PointerEvent) => {
    dragRef.current = mode;
    if (mode.kind !== 'scrub') setDraggingId(mode.id);
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, [handleMove, handleUp]);

  const startScrub = useCallback((event: React.PointerEvent) => {
    const ms = msFromClientX(event.clientX);
    onScrub?.(ms);
    startDrag({ kind: 'scrub', dragStartX: ms }, event);
  }, [msFromClientX, onScrub, startDrag]);

  const step = pickRulerStep(durationMs);
  const ticks: number[] = [];
  for (let t = 0; t <= durationMs; t += step) ticks.push(t);

  const playheadPct = durationMs > 0 ? Math.min(100, Math.max(0, (playheadMs / durationMs) * 100)) : 0;

  return (
    <div className="timeline-shell" data-testid="timeline">
      {(title || hint) && (
        <div className="timeline-head">
          <b>{title ?? 'Timeline'}</b>
          <span className="timeline-hint">
            <GripVertical size={12} />
            {hint ?? 'Drag to move · pull edges to trim · click the ruler to scrub'}
          </span>
        </div>
      )}
      <div
        ref={rulerRef}
        className="timeline-ruler"
        onPointerDown={(event) => {
          if (!canEdit && !scrubOnly) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          startScrub(event);
        }}
        data-testid="timeline-ruler"
      >
        {ticks.map((t) => (
          <span key={t} className="timeline-ruler-tick" style={{ left: `${(t / durationMs) * 100}%` }} />
        ))}
        {ticks.map((t) =>
          t % (step * 2) === 0 || t === 0 ? (
            <span key={`l${t}`} className="timeline-ruler-label" style={{ left: `${(t / durationMs) * 100}%` }}>
              {formatTimecode(t)}
            </span>
          ) : null,
        )}
        <span className="timeline-playhead" style={{ left: `${playheadPct}%` }}>
          <span className="timeline-playhead-label">{formatTimecode(playheadMs)}</span>
        </span>
      </div>

      <div
        ref={trackRef}
        className={`timeline-track ${rows === 'double' ? 'rows-2' : ''}`}
        data-testid="timeline-track"
      >
        {blocks.length === 0 ? (
          <div className="timeline-empty">Nothing on the timeline yet.</div>
        ) : (
          blocks.map((block) => {
            const dur = Math.max(MIN_CLIP_MS, block.endMs - block.startMs);
            const left = durationMs > 0 ? (block.startMs / durationMs) * 100 : 0;
            const width = durationMs > 0 ? (dur / durationMs) * 100 : 0;
            const selected = selectedId === block.id;
            const active = activeId === block.id;
            const editable = canEdit && !block.locked;
            return (
              <div
                key={block.id}
                className={`timeline-block tone-${block.tone ?? 'accent'} ${draggingId === block.id ? 'dragging' : ''} ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${block.locked ? 'timeline-block-locked' : ''}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                data-testid={`timeline-block-${block.id}`}
                onPointerDown={(event) => {
                  if (!editable) {
                    // Read-only review: clicking a block jumps the playhead to its start.
                    if (scrubOnly && onScrub) onScrub(block.startMs);
                    return;
                  }
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  event.stopPropagation();
                  onSelect?.(block.id);
                  startDrag({ kind: 'move', id: block.id, startMs: block.startMs, dragStartX: msFromClientX(event.clientX), origStart: block.startMs }, event);
                }}
                onPointerEnter={(event) => {
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  setHoverTip({ block, x: rect.left, y: rect.top - 6 });
                }}
                onPointerLeave={() => setHoverTip((tip) => (tip?.block.id === block.id ? null : tip))}
              >
                {editable && (
                  <>
                    <span
                      className="timeline-trim left"
                      title="Drag to trim the in point"
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                        event.stopPropagation();
                        onSelect?.(block.id);
                        startDrag({ kind: 'trim-left', id: block.id, dragStartX: msFromClientX(event.clientX), origStart: block.startMs }, event);
                      }}
                    />
                    <span
                      className="timeline-trim right"
                      title="Drag to trim the out point"
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                        event.stopPropagation();
                        onSelect?.(block.id);
                        startDrag({ kind: 'trim-right', id: block.id, dragStartX: msFromClientX(event.clientX), origEnd: block.endMs }, event);
                      }}
                    />
                  </>
                )}
                {block.locked && <LockKeyhole size={11} className="absolute right-1.5 top-1.5 opacity-70" />}
                {renderBlock ? (
                  renderBlock(block)
                ) : (
                  <span className="timeline-block-label">
                    {block.label}
                    {block.sublabel && <span className="timeline-block-sub">{block.sublabel}</span>}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {hoverTip && (
        <div className="timeline-hover-tip" style={{ left: Math.min(hoverTip.x, window.innerWidth - 220), top: Math.max(8, hoverTip.y) }}>
          <b>{hoverTip.block.label}</b>
          <small>
            {formatTimecode(hoverTip.block.startMs)} → {formatTimecode(hoverTip.block.endMs)} · {formatDuration(hoverTip.block.endMs - hoverTip.block.startMs)}
          </small>
        </div>
      )}
    </div>
  );
}
