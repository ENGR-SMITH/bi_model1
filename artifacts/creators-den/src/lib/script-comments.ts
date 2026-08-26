// ---------------------------------------------------------------------------
// Script comment helpers (the words studio).
//
// Script comments are ordinary project comments (leg omitted, so they never
// surface in the video/audio/thumbnail rails) whose `geometry` carries the
// selected passage as { start, length, text } — character offsets into the
// script's plain text plus the quoted words. The highlighted passage is drawn
// in the editor as a colored <mark class="pv-script-hl"> that keeps the same
// color as the reviewer's tag, so clicking a tag in the rail can jump to the
// matching highlight.
// ---------------------------------------------------------------------------

export interface ScriptRange {
  /** Character offset of the selection start into the script's plain text. */
  start: number;
  /** Length in characters of the selected passage. */
  length: number;
  /** The selected words (for display + a fuzzy fallback match after edits). */
  text: string;
}

/** Validate + normalise an unknown comment geometry into a script range. */
export function parseScriptRange(geometry: unknown): ScriptRange | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as Record<string, unknown>;
  const start = typeof g.start === 'number' && Number.isFinite(g.start) && g.start >= 0 ? Math.floor(g.start) : null;
  const length = typeof g.length === 'number' && Number.isFinite(g.length) && g.length > 0 ? Math.floor(g.length) : null;
  const text = typeof g.text === 'string' ? g.text : '';
  return start != null && length != null ? { start, length, text } : null;
}

/** A comment belongs to the script when it has no relay leg and a script range. */
export function isScriptComment(comment: { leg?: string | null; geometry?: unknown }): boolean {
  return !comment.leg && parseScriptRange(comment.geometry) != null;
}

interface TextRow {
  node: Text;
  start: number;
  end: number;
}

/** Every text node in the root with its plain-text offset. */
function textRows(root: Node): TextRow[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rows: TextRow[] = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    rows.push({ node, start: offset, end: offset + node.data.length });
    offset += node.data.length;
  }
  return rows;
}

/**
 * Convert a browser selection Range (from the live editor) into a ScriptRange
 * of plain-text offsets. Handles both text-node and element containers.
 */
export function rangeToOffset(root: Node, range: Range): ScriptRange | null {
  const rows = textRows(root);
  const offsetAt = (container: Node, off: number): number => {
    if (container.nodeType === Node.TEXT_NODE) {
      for (const row of rows) if (row.node === container) return row.start + off;
      return 0;
    }
    // Element container: sum the text length of text nodes that live under a
    // direct child of `container` positioned before the `off`-th child.
    let acc = 0;
    for (const row of rows) {
      if (!container.contains(row.node)) continue;
      let child: Node | null = row.node;
      while (child && child.parentNode !== container) child = child.parentNode;
      if (!child) continue;
      const index = Array.prototype.indexOf.call(container.childNodes, child);
      if (index < 0 || index >= off) break;
      acc += row.node.data.length;
    }
    return acc;
  };
  const start = offsetAt(range.startContainer, range.startOffset);
  const end = offsetAt(range.endContainer, range.endOffset);
  const text = range.toString();
  if (end <= start || !text) return null;
  return { start, length: end - start, text };
}

/**
 * Wrap the passage at `range` in a colored <mark class="pv-script-hl">, split
 * across whatever text nodes it touches. Text already inside a highlight is
 * left alone, so re-applying is idempotent. Returns whether anything wrapped.
 */
export function wrapScriptRange(root: Node, range: ScriptRange, color: string, commentId?: string): boolean {
  const rows = textRows(root);
  const start = range.start;
  const end = start + range.length;
  const total = rows.length > 0 ? rows[rows.length - 1].end : 0;
  if (end > total) return false;

  let wrapped = false;
  for (const row of rows) {
    if (row.end <= start || row.start >= end) continue;
    const parent = row.node.parentElement;
    if (parent && parent.closest('.pv-script-hl')) continue;
    const from = Math.max(row.start, start) - row.start;
    const to = Math.min(row.end, end) - row.start;
    if (from >= to) continue;

    const mark = document.createElement('mark');
    mark.className = 'pv-script-hl';
    mark.style.background = color;
    if (commentId) mark.dataset.commentId = commentId;

    // Split the text node into [before][mid][after] and wrap mid.
    const tail = row.node.splitText(to);
    const mid = row.node.splitText(from);
    mid.parentNode?.insertBefore(mark, mid);
    mark.appendChild(mid);
    wrapped = true;
    void tail;
  }
  return wrapped;
}

/**
 * Bring every script comment's highlight into the editor, skipping ones whose
 * mark is already present (idempotent across reloads). Returns how many
 * comments were newly drawn.
 */
export function applyScriptHighlights(
  root: ParentNode,
  comments: Array<{ id: string; geometry: unknown; color?: string | null }>,
  fallbackColor = '#f2b263',
): number {
  let applied = 0;
  for (const comment of comments) {
    const range = parseScriptRange(comment.geometry);
    if (!range) continue;
    if (comment.id && root.querySelector(`mark.pv-script-hl[data-comment-id="${comment.id}"]`)) continue;
    if (wrapScriptRange(root, range, comment.color ?? fallbackColor, comment.id)) applied += 1;
  }
  return applied;
}

/** The editor mark for a comment, if it has been drawn. */
export function findScriptMark(root: ParentNode, commentId: string): HTMLElement | null {
  return root.querySelector(`mark.pv-script-hl[data-comment-id="${commentId}"]`);
}
