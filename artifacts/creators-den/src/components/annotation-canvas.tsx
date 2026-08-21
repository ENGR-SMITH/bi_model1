// ---------------------------------------------------------------------------
// AnnotationCanvas (VCS design §10 / §13) — the shared spatial-review surface.
//
// Rendered inside an AssetPlayer frame (as a child overlay). Comments that
// carry a normalized `geometry` become Frame.io-style pins: a colored dot with
// the reviewer's letter label at that frame point. Clicking a pin opens its
// thread (and seeks the player to its timecode); with "Annotate" on, clicking
// an empty part of the frame drops a new pin at that point, which becomes a
// PIN comment scoped to the current playhead and (optionally) the head
// timeline version. Reviewer color + label are derived from the author id, so
// every reviewer is distinguishable with zero setup.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Pin, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListVideoCommentsQueryKey,
  useCreateVideoComment,
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
}) {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const comments = useListVideoComments(projectId);
  const create = useCreateVideoComment();

  const overlayRef = useRef<HTMLDivElement>(null);
  const [annotating, setAnnotating] = useState(false);
  const [drop, setDrop] = useState<{ x: number; y: number } | null>(null);
  const [body, setBody] = useState('');
  const [openPin, setOpenPin] = useState<string | null>(null);

  // Turn annotate mode off when the frame (asset) changes.
  useEffect(() => {
    setAnnotating(false);
    setDrop(null);
    setOpenPin(null);
  }, [assetId]);

  const authorId = user?.id ?? '';
  const authorColor = reviewerColor(authorId);
  const authorLabel = reviewerLabel(authorId);

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

  const onOverlayClick = (event: React.MouseEvent) => {
    if (!annotating || !canAnnotate || !assetId) return;
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

  return (
    <div
      ref={overlayRef}
      className={annotating ? 'annotation-canvas annotating' : 'annotation-canvas'}
      onClick={onOverlayClick}
      data-testid="annotation-canvas"
      data-annotating={annotating}
    >
      {pins.map((pin) => (
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
          title={`${pin.comments.length} note${pin.comments.length === 1 ? '' : 's'} — ${pin.comments[0]?.timecodeMs != null ? formatTimecode(pin.comments[0].timecodeMs) : 'on the frame'}`}
          data-testid={`annotation-pin-${pin.key}`}
        >
          <span className="annotation-pin-dot" style={{ background: reviewerColor(pin.comments[0].authorId) }}>
            {reviewerLabel(pin.comments[0].authorId)}
          </span>
          {pin.comments.length > 1 && <span className="annotation-pin-count">{pin.comments.length}</span>}
        </button>
      ))}

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
                    {comment.authorId.slice(0, 8)} · {comment.timecodeMs != null ? formatTimecode(comment.timecodeMs) : 'frame note'}
                    {comment.timelineVersionId ? ` · v${comment.timelineVersionId.slice(0, 4)}` : ''}
                  </b>
                  <small className="!normal-case">{comment.body}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {annotating && canAnnotate && !drop && (
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

      {!annotating && canAnnotate && pins.length === 0 && (
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
      {!annotating && canAnnotate && pins.length > 0 && (
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
    </div>
  );
}
