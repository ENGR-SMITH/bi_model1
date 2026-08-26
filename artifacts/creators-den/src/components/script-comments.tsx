// ---------------------------------------------------------------------------
// ScriptCommentsPanel — the comment / note rail for the words studio.
//
// Lists every script comment (a project comment with no relay leg whose
// geometry is a { start, length, text } range). Each row shows the reviewer's
// colored tag + letter, the quoted passage, and the note itself. On the main
// Script page `allowResolve` turns on the Resolve / Reopen control, and
// `onJump` scrolls the editor to the matching highlighted passage. Resolved
// notes sink to the bottom of the list.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { Check, MessageSquare } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListVideoCommentsQueryKey,
  useGetVideoProject,
  useListVideoComments,
  useResolveVideoComment,
} from '@workspace/api-client-react';
import { reviewerLabel } from '@/lib/annotations';
import { isScriptComment, parseScriptRange, scriptColor } from '@/lib/script-comments';
import { RESOLVED_GREEN } from '@/components/preview-shared';

export function ScriptCommentsPanel({
  projectId,
  allowResolve = false,
  selectedId = null,
  onSelect,
}: {
  projectId: string;
  /** Whether the Resolve / Reopen control renders (main Script page only). */
  allowResolve?: boolean;
  /** The comment whose tag is currently picked (mirrored from the editor). */
  selectedId?: string | null;
  /** Clicking a tag selects / deselects it and jumps to the passage. */
  onSelect?: (commentId: string) => void;
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

  // Script comments only — open ones first, then resolved, oldest first.
  const rows = useMemo(() => {
    const script = (comments.data ?? []).filter((comment) => isScriptComment(comment));
    return [...script].sort((a, b) => {
      const resolvedA = a.resolvedAt ? 1 : 0;
      const resolvedB = b.resolvedAt ? 1 : 0;
      return resolvedA - resolvedB || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [comments.data]);

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
    <div className="paper-card pv-notes script-notes" data-testid="script-notes">
      <div className="script-notes-head">
        <span className="eyebrow"><MessageSquare size={12} /> Comments · notes</span>
        <span className="den-tag accent">{rows.length}</span>
      </div>
      <div className="den-stack">
        {rows.length === 0 && (
          <p className="setting-copy mt-3">
            <MessageSquare size={12} className="inline" style={{ verticalAlign: -2, marginRight: 6 }} />
            No comments on the script yet — highlight a passage in the editor to pin a note.
          </p>
        )}
        {rows.map((comment) => {
          const range = parseScriptRange(comment.geometry);
          // The stored color wins; anything without one (older notes) still
          // gets a varied color derived from its id rather than one per reviewer.
          const color = comment.color ?? scriptColor(comment.id);
          const label = comment.label ?? reviewerLabel(comment.authorId);
          return (
            <div
              key={comment.id}
              className={`list-row pv-comment-row script-note ${comment.resolvedAt ? 'is-resolved' : ''} ${selectedId === comment.id ? 'is-selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect?.(comment.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(comment.id);
                }
              }}
              title={onSelect ? 'Jump to this passage in the script' : undefined}
              data-testid={`script-note-${comment.id}`}
            >
              <span className="annotation-pin-dot" style={{ background: comment.resolvedAt ? RESOLVED_GREEN : color }}>
                {label}
              </span>
              <span>
                <b className="mono-label !text-[9px]">
                  <span style={{ color: comment.resolvedAt ? RESOLVED_GREEN : color }}>{nameOf(comment.authorId)}</span>
                  {comment.resolvedAt && <span className="den-tag resolved" data-testid={`script-note-resolved-${comment.id}`}>resolved</span>}
                </b>
                {range && range.text && <span className="script-quote">“{range.text}”</span>}
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
                  data-testid={`script-note-resolve-${comment.id}`}
                >
                  <Check size={12} />
                  <span>{comment.resolvedAt ? 'Reopen' : 'Resolve'}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
