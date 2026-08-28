// ---------------------------------------------------------------------------
// Shared review surfaces — the version-history/submit panel and the timecode
// comments panel. Extracted from the former selects stage page so every review
// surface can import them from a neutral module (no page → page import).
// Pure move: behavior is unchanged.
// ---------------------------------------------------------------------------

import { useState, type FormEvent } from 'react';
import { Check, GitCompareArrows, MessageSquare, Pin, Plus, RotateCcw, Send } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVideoTimelineQueryKey,
  getListVideoCommentsQueryKey,
  getListVideoSubmissionsQueryKey,
  useCreateVideoComment,
  useCreateVideoSubmission,
  useListVideoComments,
  useResolveVideoComment,
  useRollbackVideoTimeline,
} from '@workspace/api-client-react';
import type { VideoTimelineVersionSummary } from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';
import { formatTimecode } from '@/components/timeline';
import { DiffView, type WipeFilter } from '@/components/diff-view';

// ---------------------------------------------------------------------------
// Version history + submit
// ---------------------------------------------------------------------------

export function HistoryPanel({
  projectId,
  leg,
  versions,
  currentVersion,
  canSubmit,
  wipeFilter,
}: {
  projectId: string;
  leg: StudioLeg;
  versions: VideoTimelineVersionSummary[];
  currentVersion: number | null;
  canSubmit: boolean;
  /** Optional live filter per version for the A/B wipe (FINISH grades). */
  wipeFilter?: WipeFilter;
}) {
  const queryClient = useQueryClient();
  const rollback = useRollbackVideoTimeline();
  const submit = useCreateVideoSubmission();
  const [note, setNote] = useState('');
  const [compareId, setCompareId] = useState<string | null>(null);

  const headId = versions.find((version) => version.version === currentVersion)?.id ?? null;

  const onRollback = (versionId: string) => {
    rollback.mutate(
      { projectId, leg, data: { versionId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, leg) });
        },
      },
    );
  };

  const onSubmit = () => {
    submit.mutate(
      { projectId, data: { leg, note: note.trim() || undefined } },
      {
        onSuccess: () => {
          setNote('');
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, leg) });
          queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
        },
      },
    );
  };

  const submitError = submit.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow">Snapshot history</span>
        <span className="mono-label">v{currentVersion ?? 0}</span>
      </div>
      {versions.length === 0 ? (
        <p className="setting-copy">No snapshots yet — save your first pass above.</p>
      ) : (
        <div className="den-stack max-h-56 overflow-y-auto pr-1">
          {versions.map((version) => (
            <div key={version.id} className="list-row" data-testid={`version-${version.version}`}>
              <span>
                <b>v{version.version} {version.version === currentVersion && <span className="den-tag teal ml-1">head</span>}</b>
                {version.message && <small>{version.message}</small>}
              </span>
              {version.version !== currentVersion && (
                <button
                  type="button"
                  onClick={() => setCompareId(version.id)}
                  className="link-btn"
                  title="Diff this version against the head"
                  data-testid={`version-compare-${version.version}`}
                >
                  <GitCompareArrows size={12} /> Compare
                </button>
              )}
              {canSubmit && version.version !== currentVersion && (
                <button type="button" onClick={() => onRollback(version.id)} className="link-btn" title="Restore this snapshot as the new head">
                  <RotateCcw size={12} /> Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {compareId && versions.length > 0 && (
        <DiffView
          key={compareId}
          projectId={projectId}
          leg={leg}
          initialAId={headId}
          initialBId={compareId}
          onClose={() => setCompareId(null)}
          wipeFilter={wipeFilter}
        />
      )}

      {canSubmit && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }}>
          <span className="eyebrow">Submit for review</span>
          <p className="setting-copy mt-1">Pins the current head snapshot and hands the stage to the Captain.</p>
          <div className="mt-3 flex gap-2">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note for the Captain (optional)"
              maxLength={2000}
              data-testid="input-submit-note"
            />
            <button type="button" onClick={onSubmit} disabled={submit.isPending} className="secondary-btn" data-testid="button-submit-leg">
              <Send size={13} />
              {submit.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
          {submit.isError && (
            <p className="setting-copy mt-2" role="alert">
              {submitError?.response?.data?.error || 'The pull request could not be created.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function CommentsPanel({
  projectId,
  leg = 'SELECTS',
  submissionId,
  timelineVersionId,
}: {
  projectId: string;
  leg?: StudioLeg;
  /** Scope the panel to a submission (PR) review — notes pin to that review. */
  submissionId?: string | null;
  /** Optional scope: the timeline version being reviewed. */
  timelineVersionId?: string | null;
}) {
  const queryClient = useQueryClient();
  const comments = useListVideoComments(projectId);
  const create = useCreateVideoComment();
  const resolve = useResolveVideoComment();
  const [body, setBody] = useState('');
  const [timecodeMs, setTimecodeMs] = useState<number | null>(null);

  // In PR review mode only that review's notes are listed.
  const rows = submissionId
    ? (comments.data ?? []).filter((comment) => comment.submissionId === submissionId)
    : (comments.data ?? []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim()) return;
    create.mutate(
      {
        projectId,
        data: {
          leg,
          body: body.trim(),
          timecodeMs: timecodeMs ?? undefined,
          submissionId: submissionId ?? undefined,
          timelineVersionId: timelineVersionId ?? undefined,
        },
      },
      {
        onSuccess: () => {
          setBody('');
          setTimecodeMs(null);
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

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><MessageSquare size={13} /> {submissionId ? 'PR review notes' : 'Timecode notes'}</span>
        {submissionId && <span className="den-tag gold">scoped to review</span>}
      </div>
      <form className="space-y-2" onSubmit={submit} data-testid="form-comment">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Pinned note — e.g. the lighting shift at 02:14 is jarring, can we grade this?"
          maxLength={4000}
          rows={2}
          required
          data-testid="input-comment"
        />
        <div className="flex items-center gap-2">
          <span className="mono-label">Pin at</span>
          <input
            value={timecodeMs == null ? '' : formatTimecode(timecodeMs)}
            readOnly
            placeholder="playhead time"
            className="w-28 text-center"
          />
          <button type="submit" disabled={create.isPending || !body.trim()} className="primary-btn ml-auto" data-testid="button-add-comment">
            <Plus size={13} />
            {create.isPending ? 'Pinning…' : 'Pin note'}
          </button>
        </div>
      </form>

      {rows.length > 0 ? (
        <div className="den-stack mt-4">
          {rows.map((comment) => (
            <div key={comment.id} className={`list-row ${comment.resolvedAt ? '' : 'selected'}`} data-testid={`comment-${comment.id}`}>
              <span className="world-symbol"><MessageSquare size={13} /></span>
              <span>
                <b className="mono-label !text-[9px]">
                  {comment.timecodeMs != null ? formatTimecode(comment.timecodeMs) : 'project note'}
                  {comment.kind && comment.kind !== 'TIMECODE' && (
                    <span className="den-tag accent ml-1">{comment.kind}</span>
                  )}
                  {comment.geometry && (
                    <span className="den-tag teal ml-1"><Pin size={9} /> on frame</span>
                  )}
                </b>
                <small className="!normal-case">{comment.body}</small>
                {comment.color && comment.label && (
                  <small className="mt-1 flex items-center gap-1">
                    <span className="annotation-pin-dot" style={{ background: comment.color, width: 14, height: 14, fontSize: 7 }}>
                      {comment.label}
                    </span>
                    reviewer {comment.authorId.slice(0, 8)}
                    {comment.submissionId && ` · review ${comment.submissionId.slice(0, 8)}`}
                  </small>
                )}
              </span>
              <button
                type="button"
                onClick={() => onResolve(comment.id, !comment.resolvedAt)}
                className="link-btn"
                title={comment.resolvedAt ? 'Reopen' : 'Resolve'}
              >
                <Check size={12} />
                {comment.resolvedAt ? 'Reopen' : 'Resolve'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="setting-copy mt-4">No notes yet — pin feedback to a moment in the footage.</p>
      )}
    </div>
  );
}
