// ---------------------------------------------------------------------------
// AnnotationCanvas (VCS design §10 / §13) — the shared spatial-review surface.
//
// Rendered inside an AssetPlayer frame (as a child overlay). Comments that
// carry a normalized `geometry` become Frame.io-style pins: a colored dot with
// the reviewer's letter label at that frame point. Clicking a pin opens its
// thread (and seeks the player to its timecode); with "Annotate" on, clicking
// an empty part of the frame drops a new pin at that point, which becomes a
// PIN comment scoped to the current playhead and (optionally) the head
// timeline version. The comment field pops up right at the clicked point.
// Reviewer color + label are derived from the author id, so every reviewer is
// distinguishable with zero setup.
//
// Pass `headerRef` to render the annotate toggle as an edit (pencil) icon
// button into that element (the card header's top-right corner); otherwise
// the toggle stays as a pill over the media. Pass `dropLine` (audio wave) to
// draw a red vertical line at the selected point while annotating.
// ---------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Pencil, Pin, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListVideoCommentsQueryKey,
  useCreateVideoComment,
  useGetVideoProject,
  useListVideoComments,
} from '@workspace/api-client-react';
import type { VideoComment } from '@workspace/api-client-react';
import { formatTimecode } from '@/components/timeline';
import type { StudioLeg } from '@/components/role-oracle';
import {
  clamp01,
  geometryKey,
  parseGeometry,
  reviewerColor,
  reviewerLabel,
  type AnnotationGeometry,
} from '@/lib/annotations';

interface PinGroup {
  key: string;
  geometry: AnnotationGeometry;
  comments: VideoComment[];
}

export function AnnotationCanvas({
  projectId,
  leg,
  assetId,
  playheadMs = null,
  onSeek,
  canAnnotate = true,
  timelineVersionId,
  submissionId,
  headerRef,
  dropLine = false,
}: {
  projectId: string;
  leg: StudioLeg;
  /** The asset whose frame this canvas overlays. Pins are filtered to it. */
  assetId?: string;
  /** Playhead used as the drop timecode for new pins — null for static images (thumbnail review). */
  playheadMs?: number | null;
  /** Clicking a pin with a timecode seeks the player here. */
  onSeek?: (ms: number) => void;
  /** Whether the reviewer may drop new pins. */
  canAnnotate?: boolean;
  /** Optional scope: the timeline version being reviewed. */
  timelineVersionId?: string | null;
  /** Optional scope: the submission (PR) being reviewed — pins filter to it. */
  submissionId?: string | null;
  /** When set, the annotate toggle renders as an edit (pencil) icon button
      into this element (the card header's top-right corner) instead of a pill
      over the media — the familiar editing-tools affordance. */
  headerRef?: RefObject<HTMLDivElement | null>;
  /** Draw a red vertical line at the selected point (the audio wave). */
  dropLine?: boolean;
}) {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const comments = useListVideoComments(projectId);
  const create = useCreateVideoComment();
  const project = useGetVideoProject(projectId);

  const overlayRef = useRef<HTMLDivElement>(null);
  const [annotating, setAnnotating] = useState(false);
  const [drop, setDrop] = useState<{ x: number; y: number } | null>(null);
  const [body, setBody] = useState('');
  const [openPin, setOpenPin] = useState<string | null>(null);

  // The header element, once the page's ref attaches (portal target for the
  // edit toggle when `headerRef` is provided). useLayoutEffect guarantees the
  // portal mounts before the first paint, so nothing flashes.
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (headerRef?.current) setHeaderEl(headerRef.current);
  }, [headerRef]);

  // Turn annotate mode off when the frame (asset) changes.
  useEffect(() => {
    setAnnotating(false);
    setDrop(null);
    setOpenPin(null);
  }, [assetId]);

  const authorId = user?.id ?? '';
  const authorColor = reviewerColor(authorId);
  const authorLabel = reviewerLabel(authorId);

  // userId → display name, so every comment shows who actually wrote it.
  const memberNameById = useMemo(
    () => new Map((project.data?.members ?? []).map((member) => [member.userId, member.name])),
    [project.data?.members],
  );
  const nameOf = (id: string) => memberNameById.get(id) ?? id.slice(0, 8);

  // Comments for this leg + asset that carry a usable geometry, grouped into
  // pins by frame point. Timecode-only notes (kind TIMECODE) stay in the
  // CommentsPanel list; they are not drawn on the canvas.
  const pins = useMemo<PinGroup[]>(() => {
    const groups = new Map<string, PinGroup>();
    for (const comment of comments.data ?? []) {
      if (comment.leg !== leg) continue;
      if (assetId && comment.assetId !== assetId) continue;
      // In PR review mode only that review's pins are drawn on the frame.
      if (submissionId && comment.submissionId !== submissionId) continue;
      const geometry = parseGeometry(comment.geometry);
      if (!geometry) continue;
      const key = geometryKey(geometry);
      const group = groups.get(key) ?? { key, geometry, comments: [] };
      group.comments.push(comment);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [comments.data, leg, assetId, submissionId]);

  const openGroup = openPin ? pins.find((pin) => pin.key === openPin) ?? null : null;

  // Dropping a pin listens on pointerdown, not click: the audio wave's own
  // pointerdown handler calls setPointerCapture, which retargets the
  // subsequent click to the wave — so a click-based drop never fired there.
  const onOverlayPointerDown = (event: React.PointerEvent) => {
    if (!annotating || !canAnnotate || !assetId) return;
    // Ignore presses that start on an existing pin or an open panel.
    const target = event.target as HTMLElement;
    if (target.closest('.annotation-pin, .annotation-thread, .annotation-composer, .annotation-close-annotate, .annotation-toggle')) return;
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    setOpenPin(null);
    setDrop({ x, y });
    setBody('');
  };

  const submitDrop = () => {
    if (!drop || !body.trim() || !assetId) return;
    create.mutate(
      {
        projectId,
        data: {
          leg,
          assetId,
          // Static-image annotations (thumbnail review) carry no timecode.
          timecodeMs: playheadMs ?? undefined,
          body: body.trim(),
          kind: 'PIN',
          geometry: drop,
          color: authorColor,
          label: authorLabel,
          timelineVersionId: timelineVersionId ?? undefined,
          submissionId: submissionId ?? undefined,
        },
      },
      {
        onSuccess: () => {
          setDrop(null);
          setBody('');
          queryClient.invalidateQueries({ queryKey: getListVideoCommentsQueryKey(projectId) });
        },
      },
    );
  };

  const dropError = create.error as { response?: { data?: { error?: string } } } | null;

  if (!assetId) return null;

  const pinsEl = pins.map((pin) => (
    <button
      key={pin.key}
      type="button"
      className="annotation-pin"
      style={{ left: `${pin.geometry.x * 100}%`, top: `${pin.geometry.y * 100}%` }}
      onClick={(event) => {
        event.stopPropagation();
        setDrop(null);
        if (pin.comments[0]?.timecodeMs != null) onSeek?.(pin.comments[0].timecodeMs);
        setOpenPin(pin.key === openPin ? null : pin.key);
      }}
      title={`${pin.comments.length} note${pin.comments.length === 1 ? '' : 's'} — ${nameOf(pin.comments[0].authorId)}${pin.comments[0]?.timecodeMs != null ? ` @ ${formatTimecode(pin.comments[0].timecodeMs)}` : ' on the frame'}`}
      data-testid={`annotation-pin-${pin.key}`}
    >
      <span className="annotation-pin-dot" style={{ background: reviewerColor(pin.comments[0].authorId) }}>
        {reviewerLabel(pin.comments[0].authorId)}
      </span>
      {pin.comments.length > 1 && <span className="annotation-pin-count">{pin.comments.length}</span>}
    </button>
  ));

  return (
    <div
      ref={overlayRef}
      className={annotating ? 'annotation-canvas annotating' : 'annotation-canvas'}
      onPointerDown={onOverlayPointerDown}
      data-testid="annotation-canvas"
      data-annotating={annotating}
    >
      {pinsEl}

      {/* The red vertical selector line on the audio wave while annotating. */}
      {drop && dropLine && (
        <span className="annotation-drop-line" style={{ left: `${drop.x * 100}%` }} data-testid="annotation-drop-line" />
      )}

      {openGroup && (
        <div
          className="annotation-thread"
          style={{ left: `${Math.min(openGroup.geometry.x * 100, 62)}%`, top: `${Math.min(openGroup.geometry.y * 100, 55)}%` }}
          onClick={(event) => event.stopPropagation()}
          data-testid="annotation-thread"
        >
          <div className="inline-heading">
            <span className="eyebrow"><MessageSquare size={12} /> Notes on frame</span>
            <button type="button" className="icon-btn" onClick={() => setOpenPin(null)} aria-label="Close thread">
              <X size={12} />
            </button>
          </div>
          <div className="annotation-thread-list">
            {openGroup.comments.map((comment) => (
              <div key={comment.id} className="list-row" data-testid={`annotation-thread-comment-${comment.id}`}>
                <span
                  className="annotation-pin-dot"
                  style={{ background: reviewerColor(comment.authorId), width: 18, height: 18, fontSize: 9 }}
                >
                  {reviewerLabel(comment.authorId)}
                </span>
                <span>
                  <b className="mono-label !text-[9px]">
                    {nameOf(comment.authorId)} · {comment.timecodeMs != null ? formatTimecode(comment.timecodeMs) : 'frame note'}
                    {comment.timelineVersionId ? ` · v${comment.timelineVersionId.slice(0, 4)}` : ''}
                  </b>
                  <small className="!normal-case">{comment.body}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {annotating && canAnnotate && !drop && !headerRef && (
        <button
          type="button"
          className="annotation-close-annotate"
          onClick={(event) => {
            event.stopPropagation();
            setAnnotating(false);
          }}
          data-testid="annotation-stop"
        >
          <X size={12} /> Stop annotating
        </button>
      )}

      {!annotating && canAnnotate && !headerRef && pins.length === 0 && (
        <button
          type="button"
          className="annotation-toggle"
          onClick={(event) => {
            event.stopPropagation();
            setAnnotating(true);
          }}
          data-testid="annotation-start"
        >
          <Pin size={12} /> Annotate
        </button>
      )}
      {!annotating && canAnnotate && !headerRef && pins.length > 0 && (
        <button
          type="button"
          className="annotation-toggle"
          onClick={(event) => {
            event.stopPropagation();
            setAnnotating(true);
          }}
          data-testid="annotation-start"
        >
          <Pin size={12} /> {pins.length} pin{pins.length === 1 ? '' : 's'}
        </button>
      )}

      {drop && (
        <div
          className="annotation-composer"
          style={{ left: `${Math.min(drop.x * 100, 60)}%`, top: `${Math.min(drop.y * 100, 50)}%` }}
          onClick={(event) => event.stopPropagation()}
          data-testid="annotation-composer"
        >
          <span className="eyebrow">
            <Pin size={11} /> Pin note {playheadMs != null ? `@ ${formatTimecode(playheadMs)}` : '· on the frame'}
          </span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Note on this frame…"
            rows={2}
            maxLength={4000}
            autoFocus
            data-testid="annotation-input"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={submitDrop} disabled={create.isPending || !body.trim()} className="primary-btn !px-3 !py-1.5 !text-xs" data-testid="annotation-submit">
              {create.isPending ? 'Pinning…' : 'Pin note'}
            </button>
            <button type="button" onClick={() => setDrop(null)} className="text-btn !text-xs">Cancel</button>
          </div>
          {create.isError && (
            <p className="setting-copy !text-[11px]" role="alert">
              {dropError?.response?.data?.error || 'The pin could not be added.'}
            </p>
          )}
        </div>
      )}

      {/* The header edit (pencil) button — the familiar editing-tools
          affordance, portaled into the card header's top-right corner. */}
      {headerRef && headerEl &&
        createPortal(
          <button
            type="button"
            className={`annotation-toggle annotation-edit-btn ${annotating ? 'active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              setAnnotating((a) => !a);
            }}
            aria-pressed={annotating}
            title={annotating ? 'Stop annotating' : 'Annotate this media'}
            data-testid="annotation-start"
          >
            <Pencil size={14} />
          </button>,
          headerEl,
        )}
    </div>
  );
}
