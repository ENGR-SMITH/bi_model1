// ---------------------------------------------------------------------------
// Script preview — the words studio.
//
// A rich text editor in the spirit of the Author Den's draft page: format
// bar, autosaved to the browser for the project, word/character/paragraph
// counters. The import rail takes an audio or video file, locks it into the
// vault (same PROXY + TRANSCRIBE pipeline), and types the transcription into
// the editor where it stays fully editable — each line tagged with its
// timecode. Existing vault footage with a transcript can be inserted too.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Bold,
  Check,
  Eraser,
  FileAudio,
  FileVideo2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Sparkles,
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
} from '@workspace/api-client-react';
import type { VideoTranscriptSegment } from '@workspace/api-client-react';
import { useProjectRealtime } from '@/lib/realtime';
import { pollWhileProcessing } from '@/components/asset-preview';
import { formatTimecode } from '@/components/timeline';

const stripHtml = (value: string): string =>
  value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

const words = (value: string): number => {
  const text = stripHtml(value);
  return text ? text.split(/\s+/).length : 0;
};

function storageKey(projectId: string): string {
  return `creators-den-script-${projectId}`;
}

type ImportPhase = 'idle' | 'uploading' | 'transcribing' | 'done';

// ---------------------------------------------------------------------------
// ImportRail — upload audio/video to transcribe, or insert an existing vault
// transcript into the editor.
// ---------------------------------------------------------------------------

function ImportRail({
  projectId,
  onTranscript,
}: {
  projectId: string;
  onTranscript: (segments: VideoTranscriptSegment[], fileName: string) => void;
}) {
  const queryClient = useQueryClient();
  const project = useGetVideoProject(projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);
  const insertedRef = useRef<string | null>(null);

  // Pick an existing processed asset whose transcript we can drop in.
  const [pickerId, setPickerId] = useState('');
  const pickedDetail = useGetVideoAsset(projectId, pickerId, {
    query: { queryKey: getGetVideoAssetQueryKey(projectId, pickerId), enabled: Boolean(pickerId) },
  });

  // Poll the freshly uploaded asset until its transcript is ready, then hand
  // the segments to the editor exactly once.
  const imported = useGetVideoAsset(projectId, assetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId ?? ''),
      enabled: Boolean(assetId),
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });

  useEffect(() => {
    const transcript = imported.data?.transcript;
    if (!transcript?.segments?.length || !assetId || insertedRef.current === assetId) return;
    insertedRef.current = assetId;
    setPhase('done');
    onTranscript(transcript.segments, imported.data?.fileName ?? fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imported.data, assetId]);

  useEffect(
    () => () => {
      xhrRef.current?.abort();
    },
    [],
  );

  const startUpload = (file: File) => {
    setError('');
    setFileName(file.name);
    setProgress(0);
    setPhase('uploading');
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
        setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
      }
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { id?: string };
          if (data.id) {
            setAssetId(data.id);
            setPhase('transcribing');
            queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
            return;
          }
        } catch {
          // fall through to the error path
        }
        setPhase('idle');
        setError('The upload did not return a vault asset id.');
      } else {
        let message = 'The upload failed. Try once more.';
        try {
          const data = JSON.parse(xhr.responseText) as { error?: string };
          if (typeof data?.error === 'string') message = data.error;
        } catch {
          // Non-JSON body — keep the generic message.
        }
        setPhase('idle');
        setError(message);
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setPhase('idle');
      setError('The upload was interrupted — your connection dropped.');
    };
    xhr.send(formData);
  };

  const cancel = () => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setPhase('idle');
    setProgress(0);
  };

  const onPickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    startUpload(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const insertPicked = () => {
    const transcript = pickedDetail.data?.transcript;
    if (!transcript?.segments?.length) {
      setError('That file has no transcript yet — uploads are transcribed in the background.');
      return;
    }
    setError('');
    onTranscript(transcript.segments, pickedDetail.data?.fileName ?? pickerId);
  };

  const processedAssets = (project.data?.assets ?? []).filter((asset) => asset.status === 'PROCESSED');

  return (
    <div className="paper-card accent-card">
      <div className="inline-heading">
        <span className="eyebrow"><AudioLines size={13} /> Import · transcribe</span>
        {phase === 'transcribing' && <span className="den-tag gold">transcribing</span>}
        {phase === 'done' && <span className="den-tag teal">inserted</span>}
      </div>
      <p className="setting-copy">
        Drop an audio or video file here — it is locked into the vault (deduped, proxied, transcribed in the background) and the words appear in the script below, editable.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*,.mp4,.mov,.m4v,.mkv,.webm,.wav,.mp3,.m4a,.aac,.flac,.ogg,.aif,.aiff"
        onChange={onPickFile}
        disabled={phase === 'uploading' || phase === 'transcribing'}
        data-testid="script-import-file"
      />

      {phase === 'uploading' && (
        <div className="den-upload-progress mt-3" data-testid="script-upload-progress">
          <div className="den-upload-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <b>{progress}%</b>
          <button type="button" onClick={cancel} className="den-upload-cancel" data-testid="script-upload-cancel">
            Cancel
          </button>
        </div>
      )}
      {phase === 'transcribing' && (
        <p className="den-footnote mt-3">
          <Loader2 size={13} className="spin" />
          Proxying and transcribing <b>{fileName}</b> in the background — the script fills itself in.
        </p>
      )}
      {phase === 'done' && (
        <p className="den-footnote mt-3">
          <Check size={13} />
          Transcribed <b>{fileName}</b> into the script below.
        </p>
      )}
      {error && (
        <p className="setting-copy mt-2" role="alert" style={{ color: 'hsl(var(--destructive))' }}>
          {error}
        </p>
      )}

      <div className="mt-4 border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="eyebrow"><FileAudio size={12} /> From the vault</span>
        <p className="setting-copy mt-1">Or drop an already-transcribed asset's words in:</p>
        <div className="mt-2 flex gap-2">
          <select value={pickerId} onChange={(event) => setPickerId(event.target.value)} data-testid="script-picker-asset">
            <option value="">Choose a processed file…</option>
            {processedAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.fileName}</option>
            ))}
          </select>
          <button type="button" onClick={insertPicked} disabled={!pickerId} className="secondary-btn" data-testid="script-insert-picked">
            <FileVideo2 size={13} /> Insert
          </button>
        </div>
        {processedAssets.length === 0 && (
          <p className="setting-copy mt-2">No processed footage yet — the upload above is the fastest way in.</p>
        )}
      </div>

      <p className="den-footnote mt-3">
        <Sparkles size={13} />
        Uploads join the vault like any other raw footage; identical bytes are deduped, and the locked originals never leave.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScriptPreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);
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

  // Autosave (debounced) straight to the browser for this project.
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

  const command = (name: string, value?: string) => {
    document.execCommand(name, false, value);
    setHtml(editorRef.current?.innerHTML ?? '');
  };

  const onEditorInput = () => {
    setHtml(editorRef.current?.innerHTML ?? '');
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
            <div className="pv-script-head">
              <div className="eyebrow">SCRIPT / DRAFT</div>
              <span className={`save-indicator ${saved ? '' : 'dirty'}`} data-testid="script-save-state">
                <span className="pulse-dot" /> {saved ? 'Autosaved' : 'Saving…'}
              </span>
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
            <div
              ref={editorRef}
              className="pv-script-area"
              contentEditable
              suppressContentEditableWarning
              onInput={onEditorInput}
              data-placeholder="Begin where the pressure is…"
              data-testid="script-editor-area"
            />
            <div className="pv-script-footer">
              <span><b>{count.words}</b> words</span>
              <span><b>{count.chars}</b> characters</span>
              <span><b>{count.paragraphs}</b> paragraphs</span>
              <span className="footer-spacer" />
              <span className="mono-label">script · {p.name}</span>
            </div>
          </div>
        </div>
        <div className="pv-notes-col">
          <ImportRail projectId={p.id} onTranscript={insertTranscript} />
          {toast && (
            <p className="den-footnote mt-3" data-testid="script-toast">
              <Check size={12} /> {toast}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
