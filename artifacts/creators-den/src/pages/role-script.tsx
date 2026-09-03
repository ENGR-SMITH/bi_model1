// ---------------------------------------------------------------------------
// Script role page — the words studio.
//
// A full-width rich text editor (no side cards): the top bar carries the
// transcribe dropdown + button and an upload-to-transcribe affordance on the
// left, the script name input in the middle, and import / export / save on
// the right. The script (name + body) autosaves to the browser for the
// project, and the save button forces a save on demand. Transcribing a file
// locks it into the vault (PROXY + TRANSCRIBE pipeline) and types the words
// into the editor, each line tagged with its timecode.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Bold,
  Check,
  Eraser,
  FileDown,
  FileText,
  FileUp,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Pencil,
  Quote,
  Redo2,
  Save,
  Strikethrough,
  Undo2,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVideoAssetQueryKey,
  getGetVideoProjectQueryKey,
  getUploadVideoAssetUrl,
  useGetVideoAsset,
  useGetVideoProject,
  useListVideoComments,
} from '@workspace/api-client-react';
import type { VideoTranscriptSegment } from '@workspace/api-client-react';
import { useProjectRealtime } from '@/lib/realtime';
import { pollWhileProcessing } from '@/components/asset-preview';
import { formatTimecode } from '@/components/timeline';
import { AgentUploadModal, exceedsBrowserUploadCap } from '@/components/agent-upload-modal';
import {
  findScriptMark,
  parseScriptRange,
  scriptColor,
  wrapScriptRange,
} from '@/lib/script-comments';
import { ScriptCommentsPanel } from '@/components/script-comments';
import { RoleAccessDenied } from '@/components/role-access-denied';
import { hasRole } from '@/lib/roles';

const stripHtml = (value: string): string =>
  value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

const words = (value: string): number => {
  const text = stripHtml(value);
  return text ? text.split(/\s+/).length : 0;
};

const MEDIA_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE', 'RAW_AUDIO', 'VO_PICKUP']);
const TRANSCRIBE_ACCEPT = 'audio/*,video/*,.mp4,.mov,.m4v,.mkv,.webm,.wav,.mp3,.m4a,.aac,.flac,.ogg,.aif,.aiff';

// This page only ever imports/exports subtitle script files — no media.
const SCRIPT_ACCEPT = '.srt,.vtt,.sbv,.sub';
const SCRIPT_FILE_RE = /\.(srt|vtt|sbv|sub)$/i;
const checkScriptFile = (file: File): string | null =>
  SCRIPT_FILE_RE.test(file.name) ? null : 'Only subtitle script files can be imported here (.srt, .vtt, .sbv, .sub).';

type SubtitleFormat = 'srt' | 'vtt' | 'sbv' | 'sub';

function storageKey(projectId: string): string {
  return `creators-den-script-${projectId}`;
}

function nameKey(projectId: string): string {
  return `creators-den-script-name-${projectId}`;
}

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

function timeToMs(match: RegExpMatchArray): number {
  return ((+match[1]) * 3600 + (+match[2]) * 60 + (+match[3])) * 1000 + Math.round(+`0.${match[4]}` * 1000);
}

/** Parse .srt / .vtt / .sbv / .sub into start-timestamped cues. */
function parseSubtitle(text: string): Array<{ startMs: number; text: string }> {
  const lines = text.split(/\r?\n/);
  const cues: Array<{ startMs: number; text: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    // Arrow style (srt / vtt): 00:00:01,000 --> 00:00:04,000
    const arrow = line.match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->/);
    // Comma style (sbv / sub): 0:00:01.000,0:00:04.000
    const comma = line.match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3}),\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/);
    const match = arrow ?? comma;
    if (match) {
      const startMs = timeToMs(match);
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (!next) break;
        if (arrow && /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/.test(next)) break;
        if (comma && /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3},/.test(next)) break;
        body.push(next);
        j += 1;
      }
      if (body.length > 0) cues.push({ startMs, text: body.join(' ') });
      i = j;
    } else {
      i += 1;
    }
  }
  return cues;
}

/** Read the editor's paragraphs (timecode tags optional) into timed cues. */
function cuesFromEditor(root: HTMLElement | null): Array<{ startMs: number; endMs: number; text: string }> {
  if (!root) return [];
  const raw: Array<{ startMs: number | null; text: string }> = [];
  for (const paragraph of Array.from(root.querySelectorAll('p'))) {
    const clone = paragraph.cloneNode(true) as HTMLElement;
    const tag = clone.querySelector('.pv-script-tc');
    let startMs: number | null = null;
    if (tag) {
      const tc = tag.textContent?.trim();
      const parsed = tc?.match(/^(\d+):(\d{2})$/);
      if (parsed) startMs = ((+parsed[1]) * 60 + (+parsed[2])) * 1000;
      tag.remove();
    }
    const text = (clone.innerText ?? '').trim();
    if (text) raw.push({ startMs, text });
  }
  if (raw.length === 0) {
    const text = (root.innerText ?? '').trim();
    if (text) raw.push({ startMs: null, text });
  }
  // Anchored timecodes win; untimed paragraphs flow at 2s after the last cue.
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  let running = 0;
  raw.forEach((cue, index) => {
    const startMs = cue.startMs ?? running;
    const next = raw[index + 1];
    const endMs = next?.startMs != null && next.startMs > startMs ? next.startMs : startMs + 2000;
    cues.push({ startMs, endMs, text: cue.text });
    running = endMs;
  });
  return cues;
}

/** Serialize cues into the requested subtitle format. */
function buildSubtitle(format: SubtitleFormat, cues: Array<{ startMs: number; endMs: number; text: string }>): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  const hms = (ms: number, sep: string, frac: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const f = pad(Math.floor((ms % 1000) / (1000 / Math.pow(10, frac))), frac);
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${f}`;
  };
  if (format === 'srt') {
    return cues
      .map((cue, index) => `${index + 1}\n${hms(cue.startMs, ',', 3)} --> ${hms(cue.endMs, ',', 3)}\n${cue.text}\n`)
      .join('\n');
  }
  if (format === 'vtt') {
    return `WEBVTT\n\n${cues.map((cue) => `${hms(cue.startMs, '.', 3)} --> ${hms(cue.endMs, '.', 3)}\n${cue.text}\n`).join('\n')}`;
  }
  // .sbv uses millisecond fractions; .sub uses centiseconds (SubViewer).
  const frac = format === 'sbv' ? 3 : 2;
  const short = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const f = pad(Math.floor((ms % 1000) / (1000 / Math.pow(10, frac))), frac);
    return `${h}:${pad(m, 2)}:${pad(s, 2)}.${f}`;
  };
  const body = cues.map((cue) => `${short(cue.startMs)},${short(cue.endMs)}\n${cue.text}\n`).join('\n');
  return format === 'sub' ? `[INFORMATION]\n[TITLE]\n[END INFORMATION]\n\n${body}` : body;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RoleScriptPage() {
  const { projectId } = useParams<{ projectId: string }>();
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const scriptFileRef = useRef<HTMLInputElement>(null);
  const transcribeFileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const insertedRef = useRef<string | null>(null);

  const [html, setHtml] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey(projectId)) ?? '';
    } catch {
      return '';
    }
  });
  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem(nameKey(projectId)) ?? '';
    } catch {
      return '';
    }
  });
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState('');
  const [exportFormat, setExportFormat] = useState<SubtitleFormat>('srt');
  // The comment whose tag + editor highlight are currently picked; clicking
  // again (on the tag or the highlighted passage) clears it.
  const [selectedNote, setSelectedNote] = useState<string | null>(null);

  const comments = useListVideoComments(projectId);

  // Transcribe source — pick an already-processed vault file, or upload one.
  const [pickerId, setPickerId] = useState('');
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'transcribing' | 'done'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadName, setUploadName] = useState('');
  const [uploadAssetId, setUploadAssetId] = useState<string | null>(null);
  // A picked transcribe file that is too big for the browser path.
  const [blockedFile, setBlockedFile] = useState<File | null>(null);
  const pickedDetail = useGetVideoAsset(projectId, pickerId, {
    query: { queryKey: getGetVideoAssetQueryKey(projectId, pickerId), enabled: Boolean(pickerId) },
  });

  // Poll a freshly uploaded file until its transcript is ready, then hand the
  // segments to the editor exactly once.
  const imported = useGetVideoAsset(projectId, uploadAssetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, uploadAssetId ?? ''),
      enabled: Boolean(uploadAssetId),
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });

  // Autosave (debounced) the name + body straight to the browser for this project.
  useEffect(() => {
    setSaved(false);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey(projectId), html);
        localStorage.setItem(nameKey(projectId), name);
      } catch {
        // Storage unavailable — keep working in memory.
      }
      setSaved(true);
    }, 450);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [html, name, projectId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Restore the saved script into the editor on mount — the html state comes
  // from localStorage but is only ever rendered here, so without this the
  // editor would come back empty after leaving the page.
  useEffect(() => {
    const el = editorRef.current;
    if (el && html) el.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clicking a highlighted passage in the editor toggles its selection,
  // which lights up the matching comment tag in the rail (and vice versa).
  const onEditorMarkClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const mark = target.closest('mark.pv-script-hl');
    if (!mark) return;
    const id = mark.getAttribute('data-comment-id');
    if (!id) return;
    event.preventDefault();
    setSelectedNote((current) => (current === id ? null : id));
  };

  // Selection drives the highlights: the picked comment's passage is wrapped
  // in its colored mark (and brought into view), every other highlight is
  // unwrapped — so deselecting a tag visibly removes the text highlight.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const hadMarks = el.querySelector('mark.pv-script-hl') != null;
    el.querySelectorAll('mark.pv-script-hl').forEach((mark) => {
      mark.replaceWith(...Array.from(mark.childNodes));
    });
    let changed = hadMarks;
    if (selectedNote) {
      const comment = (comments.data ?? []).find((c) => c.id === selectedNote);
      const range = comment ? parseScriptRange(comment.geometry) : null;
      if (comment && range) {
        const color = comment.color ?? scriptColor(comment.id);
        if (wrapScriptRange(el, range, color, comment.id)) changed = true;
        const mark = findScriptMark(el, selectedNote);
        if (mark) {
          mark.classList.add('is-selected');
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
    if (changed) setHtml(el.innerHTML);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote]);

  useEffect(() => {
    const transcript = imported.data?.transcript;
    if (!transcript?.segments?.length || !uploadAssetId || insertedRef.current === uploadAssetId) return;
    insertedRef.current = uploadAssetId;
    setUploadPhase('done');
    insertTranscript(transcript.segments, imported.data?.fileName ?? uploadName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imported.data, uploadAssetId]);

  useEffect(
    () => () => {
      xhrRef.current?.abort();
    },
    [],
  );

  const command = (cmdName: string, value?: string) => {
    document.execCommand(cmdName, false, value);
    setHtml(editorRef.current?.innerHTML ?? '');
  };

  const onEditorInput = () => {
    setHtml(editorRef.current?.innerHTML ?? '');
  };

  const saveNow = () => {
    try {
      localStorage.setItem(storageKey(projectId), html);
      localStorage.setItem(nameKey(projectId), name);
    } catch {
      // Storage unavailable — the autosave path handles this silently.
    }
    setSaved(true);
    setToast('Script saved.');
  };

  const insertTranscript = (segments: VideoTranscriptSegment[], fileName: string) => {
    const el = editorRef.current;
    if (!el) return;
    const frag = document.createElement('div');
    for (const segment of segments) {
      const paragraph = document.createElement('p');
      const tag = document.createElement('span');
      tag.className = 'pv-script-tc';
      tag.textContent = formatTimecode(segment.startMs);
      paragraph.appendChild(tag);
      paragraph.appendChild(document.createTextNode(segment.text));
      frag.appendChild(paragraph);
    }
    el.appendChild(frag);
    setHtml(el.innerHTML);
    setToast(`Transcribed ${segments.length} line${segments.length === 1 ? '' : 's'} from ${fileName}`);
  };

  const transcribePicked = () => {
    if (!pickerId) {
      setToast('Choose a file to transcribe first.');
      return;
    }
    const transcript = pickedDetail.data?.transcript;
    if (!transcript?.segments?.length) {
      setToast('That file has no transcript yet — it is still being transcribed in the background.');
      return;
    }
    insertTranscript(transcript.segments, pickedDetail.data?.fileName ?? pickerId);
  };

  const startTranscribeUpload = (file: File) => {
    // Files at/over the cap need the desktop agent, never a browser POST.
    if (exceedsBrowserUploadCap(file)) {
      setBlockedFile(file);
      return;
    }
    setUploadProgress(0);
    setUploadName(file.name);
    setUploadPhase('uploading');
    insertedRef.current = null;

    const kind = file.type.startsWith('audio') ? 'RAW_AUDIO' : 'RAW_VIDEO';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', kind);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', getUploadVideoAssetUrl(projectId));
    xhr.upload.onprogress = (progressEvent) => {
      if (progressEvent.lengthComputable && progressEvent.total > 0) {
        setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
      }
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { id?: string };
          if (data.id) {
            setUploadAssetId(data.id);
            setUploadPhase('transcribing');
            queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
            return;
          }
        } catch {
          // fall through to the error path
        }
        setUploadPhase('idle');
        setToast('The upload did not return a vault asset id.');
      } else {
        let message = 'The upload failed. Try once more.';
        try {
          const data = JSON.parse(xhr.responseText) as { error?: string };
          if (typeof data?.error === 'string') message = data.error;
        } catch {
          // Non-JSON body — keep the generic message.
        }
        setUploadPhase('idle');
        setToast(message);
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setUploadPhase('idle');
      setToast('The upload was interrupted — your connection dropped.');
    };
    xhr.send(formData);
  };

  const onPickTranscribeFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (transcribeFileRef.current) transcribeFileRef.current.value = '';
    startTranscribeUpload(file);
  };

  const onImportScriptFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (scriptFileRef.current) scriptFileRef.current.value = '';
    const invalid = checkScriptFile(file);
    if (invalid) {
      setToast(invalid);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const cues = parseSubtitle(String(reader.result ?? ''));
      const el = editorRef.current;
      if (!el) return;
      if (cues.length === 0) {
        setToast('No subtitle cues were found in that file.');
        return;
      }
      const frag = document.createElement('div');
      for (const cue of cues) {
        const paragraph = document.createElement('p');
        const tag = document.createElement('span');
        tag.className = 'pv-script-tc';
        tag.textContent = formatTimecode(cue.startMs);
        paragraph.appendChild(tag);
        paragraph.appendChild(document.createTextNode(cue.text));
        frag.appendChild(paragraph);
      }
      el.appendChild(frag);
      setHtml(el.innerHTML);
      setToast(`Imported ${cues.length} cue${cues.length === 1 ? '' : 's'} from ${file.name}.`);
    };
    reader.readAsText(file);
  };

  const exportScript = (format: SubtitleFormat) => {
    const cues = cuesFromEditor(editorRef.current);
    const blob = new Blob([buildSubtitle(format, cues)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.trim() ? name.trim().replace(/\s+/g, '-') : 'script'}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    setToast(`Exported the script as .${format} (${cues.length} cue${cues.length === 1 ? '' : 's'}).`);
  };

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

  // The Script desk only opens for members with the SCRIPT role (or the
  // Captain). The nav tab stays visible — this page explains why it is locked.
  if (!hasRole(p.myRoles, 'SCRIPT')) {
    return <RoleAccessDenied role="Script" projectId={p.id} />;
  }

  const processedMedia = p.assets.filter((asset) => asset.status === 'PROCESSED' && MEDIA_KINDS.has(asset.kind));

  return (
    <div className="page pv-page role-page">
      <div className="pv-top pv-script-top">
        <div className="pv-canvas-col">
          <div className="paper-card pv-script" data-testid="script-editor">
            <div className="pv-script-head">
              <div className="pv-script-head-left">
                <select
                  value={pickerId}
                  onChange={(event) => setPickerId(event.target.value)}
                  className="pv-head-select"
                  data-testid="script-transcribe-picker"
                >
                  <option value="">Transcribe a file…</option>
                  {processedMedia.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.fileName}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="pv-head-btn"
                  onClick={transcribePicked}
                  disabled={!pickerId}
                  title={pickerId ? 'Insert the selected file\'s transcript' : 'Choose a file to transcribe first'}
                  data-testid="script-transcribe-btn"
                >
                  <AudioLines size={13} /> Transcribe
                </button>
                <input
                  ref={transcribeFileRef}
                  type="file"
                  accept={TRANSCRIBE_ACCEPT}
                  onChange={onPickTranscribeFile}
                  className="hidden"
                  data-testid="script-transcribe-upload-input"
                />
                <button
                  type="button"
                  className="pv-head-btn pv-head-icon"
                  title="Upload audio or video to transcribe"
                  onClick={() => transcribeFileRef.current?.click()}
                  data-testid="script-transcribe-upload"
                >
                  <FileUp size={15} />
                </button>
              </div>

              <label className="pv-script-name-wrap" title="Click to name this script">
                <Pencil size={12} />
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Name this script…"
                  className="pv-script-name"
                  maxLength={120}
                  data-testid="script-name"
                />
              </label>

              <div className="pv-script-head-right">
                <input
                  ref={scriptFileRef}
                  type="file"
                  accept={SCRIPT_ACCEPT}
                  onChange={onImportScriptFile}
                  className="hidden"
                  data-testid="script-import-file"
                />
                <button type="button" className="pv-head-btn" onClick={() => scriptFileRef.current?.click()} data-testid="script-import-btn">
                  <FileText size={12} /> Import script
                </button>
                <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as SubtitleFormat)} className="pv-head-select pv-head-select-sm" data-testid="script-export-format">
                  <option value="srt">.srt</option>
                  <option value="vtt">.vtt</option>
                  <option value="sbv">.sbv</option>
                  <option value="sub">.sub</option>
                </select>
                <button type="button" className="pv-head-btn" onClick={() => exportScript(exportFormat)} data-testid="script-export-btn">
                  <FileDown size={12} /> Export
                </button>
                <button type="button" className="pv-head-btn pv-head-icon" title="Save now" onClick={saveNow} data-testid="script-save-btn">
                  <Save size={15} />
                </button>
              </div>
            </div>

            <div className="pv-toolbar" data-testid="script-toolbar">
              <button type="button" onClick={() => command('undo')} aria-label="Undo" title="Undo"><Undo2 size={15} /></button>
              <button type="button" onClick={() => command('redo')} aria-label="Redo" title="Redo"><Redo2 size={15} /></button>
              <span className="bar-divider" aria-hidden />
              <button type="button" onClick={() => command('bold')} aria-label="Bold" title="Bold"><Bold size={15} /></button>
              <button type="button" onClick={() => command('italic')} aria-label="Italic" title="Italic"><Italic size={15} /></button>
              <button type="button" onClick={() => command('strikeThrough')} aria-label="Strikethrough" title="Strikethrough"><Strikethrough size={15} /></button>
              <button type="button" onClick={() => command('formatBlock', 'h2')} aria-label="Heading" title="Heading"><Heading1 size={15} /></button>
              <button type="button" onClick={() => command('formatBlock', 'h3')} aria-label="Subheading" title="Subheading"><Heading2 size={15} /></button>
              <button type="button" onClick={() => command('insertUnorderedList')} aria-label="Bulleted list" title="Bulleted list"><List size={15} /></button>
              <button type="button" onClick={() => command('insertOrderedList')} aria-label="Numbered list" title="Numbered list"><ListOrdered size={15} /></button>
              <button type="button" onClick={() => command('formatBlock', 'blockquote')} aria-label="Quote" title="Quote"><Quote size={15} /></button>
              <button
                type="button"
                aria-label="Link"
                title="Link"
                onClick={() => {
                  const url = window.prompt('Link URL');
                  if (url) command('createLink', url);
                }}
              >
                <Link2 size={15} />
              </button>
              <button type="button" onClick={() => command('removeFormat')} aria-label="Clear formatting" title="Clear formatting"><Eraser size={15} /></button>
            </div>

            {/* Too big for the browser path — download + use the desktop agent. */}
            {blockedFile && (
              <AgentUploadModal
                fileName={blockedFile.name}
                fileSizeBytes={blockedFile.size}
                context="media file"
                onClose={() => setBlockedFile(null)}
              />
            )}

            {(uploadPhase === 'uploading' || uploadPhase === 'transcribing') && (
              <div className="pv-script-upload">
                {uploadPhase === 'uploading' ? (
                  <span className="den-upload-progress">
                    <span className="den-upload-progress-bar"><span style={{ width: `${uploadProgress}%` }} /></span>
                    <b>{uploadProgress}%</b>
                  </span>
                ) : (
                  <span className="den-footnote">
                    <Loader2 size={12} className="spin" />
                    Proxying and transcribing <b>{uploadName}</b> in the background — the script fills itself in.
                  </span>
                )}
              </div>
            )}

            <div
              ref={editorRef}
              className="pv-script-area"
              contentEditable
              suppressContentEditableWarning
              onInput={onEditorInput}
              onClick={onEditorMarkClick}
              data-placeholder="Begin where the pressure is…"
              data-testid="script-editor-area"
            />
            <div className="pv-script-footer">
              <span><b>{count.words}</b> words</span>
              <span><b>{count.chars}</b> characters</span>
              <span><b>{count.paragraphs}</b> paragraphs</span>
              {uploadPhase === 'done' && (
                <span className="den-tag teal" data-testid="script-transcribe-done"><Check size={10} /> {uploadName} transcribed</span>
              )}
              <span className="footer-spacer" />
              <span className="mono-label">script{name ? ` · ${name}` : ''} · {p.name}</span>
              <span className={`save-indicator ${saved ? '' : 'dirty'}`} data-testid="script-save-state">
                <span className="pulse-dot" /> {saved ? 'Autosaved' : 'Saving…'}
              </span>
            </div>
          </div>
        </div>
        <div className="pv-script-notes-col">
          <ScriptCommentsPanel
            projectId={p.id}
            allowResolve
            selectedId={selectedNote}
            onSelect={(id) => setSelectedNote((current) => (current === id ? null : id))}
          />
        </div>
      </div>
      {toast && (
        <p className="den-footnote mt-3" data-testid="script-toast">
          <Check size={12} /> {toast}
        </p>
      )}
    </div>
  );
}
