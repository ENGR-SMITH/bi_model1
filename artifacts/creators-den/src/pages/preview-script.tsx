// ---------------------------------------------------------------------------
// Script preview — the words studio (view-only review).
//
// The script itself is edited on the main Script page; here it is a read-only
// desk for review: highlight any passage and a pin-note composer pops up at
// the selection. Pinning wraps the passage in a colored <mark> (the same
// reviewer color as the tag) and saves a script comment, which lands in the
// comments rail beside the editor and in the main Script page's rail. Each
// line from a transcription keeps its timecode tag.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Pin } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListVideoCommentsQueryKey,
  useCreateVideoComment,
  useGetVideoProject,
  useListVideoComments,
} from '@workspace/api-client-react';
import { useUser } from '@clerk/react';
import { useProjectRealtime } from '@/lib/realtime';
import { reviewerColor, reviewerLabel } from '@/lib/annotations';
import {
  applyScriptHighlights,
  isScriptComment,
  rangeToOffset,
  wrapScriptRange,
} from '@/lib/script-comments';
import { ScriptCommentsPanel } from '@/components/script-comments';

const stripHtml = (value: string): string =>
  value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

const words = (value: string): number => {
  const text = stripHtml(value);
  return text ? text.split(/\s+/).length : 0;
};

function storageKey(projectId: string): string {
  return `creators-den-script-${projectId}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScriptPreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);
  const queryClient = useQueryClient();
  const { user } = useUser();
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  const [html, setHtml] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey(projectId)) ?? '';
    } catch {
      return '';
    }
  });
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState('');

  // The live selection + where to anchor the pin-note composer.
  const [composer, setComposer] = useState<{ x: number; y: number; range: Range } | null>(null);
  const [pinBody, setPinBody] = useState('');

  const comments = useListVideoComments(projectId);
  const create = useCreateVideoComment();

  const authorId = user?.id ?? '';
  const authorColor = reviewerColor(authorId);
  const authorLabel = reviewerLabel(authorId);

  // Autosave (debounced) straight to the browser for this project — the
  // script body plus any highlight marks that were pinned.
  useEffect(() => {
    setSaved(false);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey(projectId), html);
      } catch {
        // Storage unavailable — keep working in memory.
      }
      setSaved(true);
    }, 450);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [html, projectId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Dismiss the composer when clicking anywhere outside it.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.script-pin-composer')) return;
      setComposer(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Draw every script comment's highlighted passage into the editor, keeping
  // marks that were already saved in the html (idempotent).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const scriptComments = (comments.data ?? []).filter((comment) => isScriptComment(comment));
    if (scriptComments.length === 0) return;
    if (applyScriptHighlights(el, scriptComments) > 0) setHtml(el.innerHTML);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.data]);

  // A selection inside the editor raises the pin-note composer at its end.
  const onEditorSelect = () => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setComposer(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      setComposer(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const editorRect = el.getBoundingClientRect();
    setPinBody('');
    setComposer({ x: rect.left - editorRect.left + rect.width / 2, y: rect.bottom - editorRect.top, range });
  };

  const submitPin = () => {
    const root = editorRef.current;
    if (!root || !composer || !pinBody.trim()) return;
    const range = rangeToOffset(root, composer.range);
    if (!range) return;
    create.mutate(
      {
        projectId,
        data: {
          body: pinBody.trim(),
          kind: 'HIGHLIGHT',
          geometry: { start: range.start, length: range.length, text: range.text },
          color: authorColor,
          label: authorLabel,
        },
      },
      {
        onSuccess: (comment) => {
          // Wrap the passage now so the highlight appears immediately.
          wrapScriptRange(root, range, comment.color ?? authorColor, comment.id);
          setHtml(root.innerHTML);
          setToast('Pin note added to the script.');
          window.getSelection()?.removeAllRanges();
          setComposer(null);
          setPinBody('');
          queryClient.invalidateQueries({ queryKey: getListVideoCommentsQueryKey(projectId) });
        },
      },
    );
  };

  const createError = create.error as { response?: { data?: { error?: string } } } | null;

  const count = useMemo(() => {
    const text = stripHtml(html);
    const paragraphTags = (html.match(/<p[\s>]/g) ?? []).length;
    return {
      words: words(html),
      chars: text.length,
      paragraphs: paragraphTags || (text ? 1 : 0),
    };
  }, [html]);

  if (project.isLoading) {
    return (
      <div className="page">
        <div className="panel-empty">Opening the script desk…</div>
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>DESK CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;

  return (
    <div className="page pv-page">
      <div className="pv-top">
        <div className="pv-canvas-col">
          <div className="paper-card pv-script" data-testid="script-editor">
            <div
              ref={editorRef}
              className="pv-script-area pv-script-area-readonly"
              onMouseUp={onEditorSelect}
              onKeyUp={onEditorSelect}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setComposer(null);
              }}
              data-placeholder="The script is edited on the main Script page — highlight a passage here to leave a pin note."
              data-testid="script-editor-area"
            />
            <div className="pv-script-footer">
              <span><b>{count.words}</b> words</span>
              <span><b>{count.chars}</b> characters</span>
              <span><b>{count.paragraphs}</b> paragraphs</span>
              <span className="footer-spacer" />
              <span className="mono-label">script · {p.name}</span>
              <span className={`save-indicator ${saved ? '' : 'dirty'}`} data-testid="script-save-state">
                <span className="pulse-dot" /> {saved ? 'Autosaved' : 'Saving…'}
              </span>
            </div>

            {composer && (
              <div
                className="script-pin-composer"
                style={{ left: composer.x, top: composer.y }}
                onClick={(event) => event.stopPropagation()}
                data-testid="script-pin-composer"
              >
                <span className="eyebrow"><Pin size={11} /> Pin note</span>
                <textarea
                  value={pinBody}
                  onChange={(event) => setPinBody(event.target.value)}
                  placeholder="Note on this passage…"
                  rows={2}
                  maxLength={4000}
                  autoFocus
                  data-testid="script-pin-input"
                />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={submitPin} disabled={create.isPending || !pinBody.trim()} className="primary-btn !px-3 !py-1.5 !text-xs" data-testid="script-pin-submit">
                    {create.isPending ? 'Pinning…' : 'Pin note'}
                  </button>
                  <button type="button" onClick={() => setComposer(null)} className="text-btn !text-xs">Cancel</button>
                </div>
                {create.isError && (
                  <p className="setting-copy !text-[11px]" role="alert">
                    {createError?.response?.data?.error || 'The pin could not be added.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="pv-notes-col">
          <ScriptCommentsPanel projectId={p.id} />
          {toast && (
            <p className="den-footnote mt-3" data-testid="script-toast">
              <Check size={12} /> {toast}
            </p>
          )}
        </div>
      </div>
      <div className="pv-script-hint" data-testid="script-hint">
        <span className="mono-label">view only</span> — the script is edited on the main Script page; highlight any passage to pin a note.
      </div>
    </div>
  );
}
