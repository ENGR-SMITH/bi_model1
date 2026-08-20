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
  /** Source-window in point (which part of the source media is shown). Defaults to startMs. */
  srcInMs?: number;
  /** Source-window out point (which part of the source media is shown). Defaults to endMs. */
  srcOutMs?: number;
  /** Full duration of the source media — clamps Slip edits. Defaults to durationMs. */
  srcDurationMs?: number;
}

export type TimelineTool = 'select' | 'razor' | 'ripple' | 'rolling' | 'slip' | 'slide';

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

export const MIN_CLIP_MS = 250;

type DragMode =
  | { kind: 'move'; id: string; startMs: number; dragStartX: number; origStart: number }
  | { kind: 'trim-left'; id: string; dragStartX: number; origStart: number }
  | { kind: 'trim-right'; id: string; dragStartX: number; origEnd: number }
  | { kind: 'slip'; id: string; dragStartX: number; origSrcIn: number; origSrcOut: number; srcDuration: number }
  | { kind: 'slide'; id: string; dragStartX: number; origStart: number; origEnd: number }
  | { kind: 'ripple-out'; id: string; dragStartX: number; origEnd: number }
  | { kind: 'ripple-in-left'; id: string; dragStartX: number; origStart: number; prevEnd: number | null }
  | { kind: 'rolling-left'; id: string; dragStartX: number; origStart: number; prevEnd: number }
  | { kind: 'rolling-right'; id: string; dragStartX: number; origEnd: number; nextStart: number }
  | { kind: 'scrub'; dragStartX: number };

function pickRulerStep(durationMs: number): number {
  const candidates = [500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
  const target = durationMs / 10;
  for (const step of candidates) {
    if (step >= target) return step;
  }
  return 3600000;
}

/** The block immediately before a given block in time (endMs <= startMs). */
function prevBlock(blocks: TimelineBlock[], block: TimelineBlock): TimelineBlock | null {
  return blocks
    .filter((b) => b.id !== block.id && b.endMs <= block.startMs + 1)
    .sort((a, b) => b.endMs - a.endMs)[0] ?? null;
}

/** The block immediately after a given block in time (startMs >= endMs). */
function nextBlock(blocks: TimelineBlock[], block: TimelineBlock): TimelineBlock | null {
  return blocks
    .filter((b) => b.id !== block.id && b.startMs >= block.endMs - 1)
    .sort((a, b) => a.startMs - b.startMs)[0] ?? null;
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
  tool = 'select',
  onRazor,
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
  /** Active editing tool. Defaults to 'select' (drag body to move, pull edges to trim). */
  tool?: TimelineTool;
  /** Fired when the Razor tool clicks inside a block at a given timecode. */
  onRazor?: (ms: number) => void;
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
      onChange?.(
        blocks.map((b) =>
          b.id === drag.id
            ? { ...b, startMs: nextStart, srcInMs: b.srcInMs != null ? b.srcInMs + (nextStart - drag.origStart) : undefined }
            : b,
        ),
      );
    } else if (drag.kind === 'trim-right') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const delta = ms - drag.dragStartX;
      const nextEnd = Math.max(block.startMs + MIN_CLIP_MS, Math.min(durationMs, drag.origEnd + delta));
      onChange?.(
        blocks.map((b) =>
          b.id === drag.id
            ? { ...b, endMs: nextEnd, srcOutMs: b.srcOutMs != null ? b.srcOutMs + (nextEnd - drag.origEnd) : undefined }
            : b,
        ),
      );
    } else if (drag.kind === 'slip') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const delta = ms - drag.dragStartX;
      // Shift the source window only — position and duration stay put.
      const width = drag.origSrcOut - drag.origSrcIn;
      const nextSrcIn = Math.max(0, Math.min(drag.srcDuration - width, drag.origSrcIn + delta));
      onChange?.(
        blocks.map((b) =>
          b.id === drag.id
            ? { ...b, srcInMs: nextSrcIn, srcOutMs: nextSrcIn + width }
            : b,
        ),
      );
    } else if (drag.kind === 'slide') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const dur = Math.max(MIN_CLIP_MS, block.endMs - block.startMs);
      const prev = prevBlock(blocks, block);
      const next = nextBlock(blocks, block);
      const maxLeft = prev ? prev.endMs - drag.origStart + (prev.endMs - prev.startMs - MIN_CLIP_MS) : 0;
      const maxRight = next ? next.startMs - drag.origEnd + (next.endMs - next.startMs - MIN_CLIP_MS) : durationMs - drag.origEnd;
      const delta = Math.max(-maxLeft, Math.min(maxRight, ms - drag.dragStartX));
      const nextStart = drag.origStart + delta;
      onChange?.(
        blocks.map((b) => {
          if (b.id === drag.id) return { ...b, startMs: nextStart, endMs: nextStart + dur };
          if (prev && b.id === prev.id) {
            const prevEnd = prev.endMs + delta;
            return { ...b, endMs: prevEnd, srcOutMs: b.srcOutMs != null ? b.srcOutMs + delta : undefined };
          }
          if (next && b.id === next.id) {
            const nextStartPos = next.startMs + delta;
            return { ...b, startMs: nextStartPos, srcInMs: b.srcInMs != null ? b.srcInMs + delta : undefined };
          }
          return b;
        }),
      );
    } else if (drag.kind === 'ripple-out') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const delta = ms - drag.dragStartX;
      const nextEnd = Math.max(block.startMs + MIN_CLIP_MS, Math.min(durationMs, drag.origEnd + delta));
      const applied = nextEnd - drag.origEnd;
      onChange?.(
        blocks.map((b) => {
          if (b.id === drag.id) return { ...b, endMs: nextEnd, srcOutMs: b.srcOutMs != null ? b.srcOutMs + applied : undefined };
          // Everything that starts at (or after) the trimmed clip's out point shifts with it.
          if (b.startMs >= drag.origEnd) return { ...b, startMs: b.startMs + applied, endMs: b.endMs + applied };
          return b;
        }),
      );
    } else if (drag.kind === 'ripple-in-left') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const delta = ms - drag.dragStartX;
      const minStart = drag.prevEnd != null ? Math.max(drag.prevEnd, 0) : 0;
      const nextStart = Math.max(minStart, Math.min(block.endMs - MIN_CLIP_MS, drag.origStart + delta));
      const applied = nextStart - drag.origStart;
      onChange?.(
        blocks.map((b) => {
          if (b.id === drag.id) return { ...b, startMs: nextStart, srcInMs: b.srcInMs != null ? b.srcInMs + applied : undefined };
          // Everything that starts at (or after) the trimmed clip follows it.
          if (b.startMs >= drag.origStart) return { ...b, startMs: b.startMs + applied, endMs: b.endMs + applied };
          return b;
        }),
      );
    } else if (drag.kind === 'rolling-left') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const delta = ms - drag.dragStartX;
      // Roll the cut between prev and this clip: prev end and this start move together.
      const prev = blocks.find((b) => b.endMs === drag.prevEnd);
      if (!prev) return;
      const minPrevEnd = prev.startMs + MIN_CLIP_MS;
      const maxPrevEnd = block.endMs - MIN_CLIP_MS;
      const nextPrevEnd = Math.max(minPrevEnd, Math.min(maxPrevEnd, drag.prevEnd + delta));
      const applied = nextPrevEnd - drag.prevEnd;
      onChange?.(
        blocks.map((b) => {
          if (b.id === drag.id) return { ...b, startMs: drag.prevEnd + applied, srcInMs: b.srcInMs != null ? b.srcInMs + applied : undefined };
          if (b.id === prev.id) return { ...b, endMs: nextPrevEnd, srcOutMs: b.srcOutMs != null ? b.srcOutMs + applied : undefined };
          return b;
        }),
      );
    } else if (drag.kind === 'rolling-right') {
      const block = blocks.find((b) => b.id === drag.id);
      if (!block) return;
      const delta = ms - drag.dragStartX;
      const next = blocks.find((b) => b.startMs === drag.nextStart);
      if (!next) return;
      const minThisEnd = block.startMs + MIN_CLIP_MS;
      const maxThisEnd = next.endMs - MIN_CLIP_MS;
      const nextThisEnd = Math.max(minThisEnd, Math.min(maxThisEnd, drag.origEnd + delta));
      const applied = nextThisEnd - drag.origEnd;
      onChange?.(
        blocks.map((b) => {
          if (b.id === drag.id) return { ...b, endMs: nextThisEnd, srcOutMs: b.srcOutMs != null ? b.srcOutMs + applied : undefined };
          if (b.id === next.id) return { ...b, startMs: drag.origEnd + applied, srcInMs: b.srcInMs != null ? b.srcInMs + applied : undefined };
          return b;
        }),
      );
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

  const showTrimHandles = tool === 'select' || tool === 'ripple' || tool === 'rolling';
  const cursorClass =
    tool === 'razor' ? 'tool-razor' : tool === 'slip' || tool === 'slide' ? 'tool-grab' : '';

  return (
    <div className={`timeline-shell ${cursorClass}`} data-testid="timeline">
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
            const srcIn = block.srcInMs ?? block.startMs;
            const srcOut = block.srcOutMs ?? block.endMs;

            let bodyPointerDown: ((event: React.PointerEvent) => void) | undefined;
            if (editable) {
              if (tool === 'razor') {
                bodyPointerDown = (event) => {
                  event.stopPropagation();
                  onRazor?.(msFromClientX(event.clientX));
                };
              } else if (tool === 'slip') {
                bodyPointerDown = (event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  event.stopPropagation();
                  onSelect?.(block.id);
                  startDrag(
                    {
                      kind: 'slip',
                      id: block.id,
                      dragStartX: msFromClientX(event.clientX),
                      origSrcIn: srcIn,
                      origSrcOut: srcOut,
                      srcDuration: block.srcDurationMs ?? durationMs,
                    },
                    event,
                  );
                };
              } else if (tool === 'slide') {
                bodyPointerDown = (event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  event.stopPropagation();
                  onSelect?.(block.id);
                  startDrag(
                    { kind: 'slide', id: block.id, dragStartX: msFromClientX(event.clientX), origStart: block.startMs, origEnd: block.endMs },
                    event,
                  );
                };
              } else {
                bodyPointerDown = (event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  event.stopPropagation();
                  onSelect?.(block.id);
                  startDrag({ kind: 'move', id: block.id, startMs: block.startMs, dragStartX: msFromClientX(event.clientX), origStart: block.startMs }, event);
                };
              }
            }

            const prev = prevBlock(blocks, block);
            const next = nextBlock(blocks, block);

            // Edge handlers: which tool trims the cut on each side.
            let leftHandle: ((event: React.PointerEvent) => void) | undefined;
            let rightHandle: ((event: React.PointerEvent) => void) | undefined;
            if (editable && showTrimHandles) {
              leftHandle = (event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                event.stopPropagation();
                onSelect?.(block.id);
                if (tool === 'rolling') {
                  if (prev) {
                    startDrag(
                      { kind: 'rolling-left', id: block.id, dragStartX: msFromClientX(event.clientX), origStart: block.startMs, prevEnd: prev.endMs },
                      event,
                    );
                  } else {
                    // First clip: trim the in point like a ripple on the head.
                    startDrag(
                      { kind: 'ripple-in-left', id: block.id, dragStartX: msFromClientX(event.clientX), origStart: block.startMs, prevEnd: null },
                      event,
                    );
                  }
                } else if (tool === 'ripple') {
                  startDrag(
                    { kind: 'ripple-in-left', id: block.id, dragStartX: msFromClientX(event.clientX), origStart: block.startMs, prevEnd: prev?.endMs ?? null },
                    event,
                  );
                } else {
                  startDrag({ kind: 'trim-left', id: block.id, dragStartX: msFromClientX(event.clientX), origStart: block.startMs }, event);
                }
              };
              rightHandle = (event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                event.stopPropagation();
                onSelect?.(block.id);
                if (tool === 'rolling') {
                  if (next) {
                    startDrag(
                      { kind: 'rolling-right', id: block.id, dragStartX: msFromClientX(event.clientX), origEnd: block.endMs, nextStart: next.startMs },
                      event,
                    );
                  } else {
                    startDrag({ kind: 'ripple-out', id: block.id, dragStartX: msFromClientX(event.clientX), origEnd: block.endMs }, event);
                  }
                } else if (tool === 'ripple') {
                  startDrag({ kind: 'ripple-out', id: block.id, dragStartX: msFromClientX(event.clientX), origEnd: block.endMs }, event);
                } else {
                  startDrag({ kind: 'trim-right', id: block.id, dragStartX: msFromClientX(event.clientX), origEnd: block.endMs }, event);
                }
              };
            }

            return (
              <div
                key={block.id}
                className={`timeline-block tone-${block.tone ?? 'accent'} ${draggingId === block.id ? 'dragging' : ''} ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${block.locked ? 'timeline-block-locked' : ''}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                data-testid={`timeline-block-${block.id}`}
                onPointerDown={bodyPointerDown}
                onPointerEnter={(event) => {
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  setHoverTip({ block, x: rect.left, y: rect.top - 6 });
                }}
                onPointerLeave={() => setHoverTip((tip) => (tip?.block.id === block.id ? null : tip))}
              >
                {editable && showTrimHandles && (
                  <>
                    <span
                      className={`timeline-trim left ${tool === 'rolling' ? 'roll' : ''}`}
                      title={tool === 'rolling' ? 'Roll the cut with the previous clip' : tool === 'ripple' ? 'Ripple-trim the in point' : 'Drag to trim the in point'}
                      onPointerDown={leftHandle}
                    />
                    <span
                      className={`timeline-trim right ${tool === 'rolling' ? 'roll' : ''}`}
                      title={tool === 'rolling' ? 'Roll the cut with the next clip' : tool === 'ripple' ? 'Ripple-trim the out point' : 'Drag to trim the out point'}
                      onPointerDown={rightHandle}
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
          {formatTimecode(hoverTip.block.srcInMs ?? hoverTip.block.startMs)} → {formatTimecode(hoverTip.block.srcOutMs ?? hoverTip.block.endMs)} · {formatDuration(hoverTip.block.endMs - hoverTip.block.startMs)}
          </small>
        </div>
      )}
    </div>
  );
}