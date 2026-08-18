import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clapperboard,
  Compass,
  Film,
  LockKeyhole,
  MessageSquare,
  Mic2,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
  getGetVideoProjectQueryKey,
  getGetVideoReferenceQueryKey,
  getGetVideoTimelineQueryKey,
  getListVideoCommentsQueryKey,
  getListVideoSubmissionsQueryKey,
  useAnalyzeVideoReference,
  useCreateVideoComment,
  useCreateVideoSubmission,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoReference,
  useGetVideoTimeline,
  useListVideoComments,
  useListVideoSubmissions,
  useResolveVideoComment,
  useRollbackVideoTimeline,
  useSaveVideoTimeline,
} from '@workspace/api-client-react';
import type {
  VideoAssetDetail,
  VideoTranscriptSegment,
  VideoTimelineVersionSummary,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';

const LEGS = [
  { leg: 'SELECTS', role: 'Story Architect', icon: Film },
  { leg: 'CUT', role: 'Visual Editor', icon: Scissors },
  { leg: 'SOUND', role: 'Sound Designer', icon: Mic2 },
  { leg: 'FINISH', role: 'Motion & Color', icon: Palette },
] as const;

const LEG_ROLES: Record<string, string> = {
  SELECTS: 'ARCHITECT',
  CUT: 'VISUAL_EDITOR',
  SOUND: 'SOUND_DESIGNER',
  FINISH: 'MOTION_COLOR',
};

const SCENE_TYPES = ['HOOK', 'SETUP', 'CORE', 'PAYOFF', 'CTA'] as const;

interface Clip {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
}

interface SceneBlock {
  id: string;
  type: (typeof SCENE_TYPES)[number];
  startMs: number;
  endMs: number;
}

interface WorkingSnapshot {
  clips: Clip[];
  sceneBlocks: SceneBlock[];
  markers: Array<{ id: string; label: string; timeMs: number }>;
}

const EMPTY_SNAPSHOT: WorkingSnapshot = { clips: [], sceneBlocks: [], markers: [] };

function formatTimecode(ms: number | null | undefined): string {
  if (ms == null) return '–:––';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

// ---------------------------------------------------------------------------
// Reference guide (M4) — viral reference pacing, side-by-side
// ---------------------------------------------------------------------------

function ReferenceGuide({ projectId, assets, onSeek }: { projectId: string; assets: Array<{ id: string; fileName: string; kind: string }>; onSeek: (ms: number) => void }) {
  const queryClient = useQueryClient();
  const analyze = useAnalyzeVideoReference();
  const references = assets.filter((asset) => asset.kind === 'REFERENCE');
  const referenceAsset = references[0] ?? assets[0];
  const [selectedId, setSelectedId] = useState(referenceAsset?.id ?? '');
  const reference = useGetVideoReference(projectId, selectedId, {
    query: { queryKey: getGetVideoReferenceQueryKey(projectId, selectedId), enabled: Boolean(selectedId) },
  });

  if (assets.length === 0) return null;

  const pacing = reference.data?.pacing as { sections?: Array<{ label: string; startMs: number; endMs: number }>; source?: string } | null;

  const run = () => {
    if (!selectedId) return;
    analyze.mutate(
      { projectId, assetId: selectedId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVideoReferenceQueryKey(projectId, selectedId) });
        },
      },
    );
  };

  const error = analyze.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
          <Compass className="h-4 w-4" />
          Reference guide
        </div>
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="focus-house rounded-lg border-2 border-[#e5d7c5] bg-[#f7eddf] px-3 py-1.5 text-xs text-[#292b45]"
          data-testid="select-reference-asset"
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.fileName}</option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#77717a]">
        Import a viral vlog as a reference and its pacing (Hook → Setup → Core → Payoff → CTA) appears here, side-by-side with your own selects.
      </p>

      {reference.data?.status === 'READY' && pacing?.sections ? (
        <div className="mt-4 space-y-2">
          {pacing.sections.map((section, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onSeek(section.startMs)}
              className="focus-house group flex w-full items-center justify-between gap-3 rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] px-3 py-2.5 transition-colors hover:border-[#8dc2ad]"
              data-testid={`reference-beat-${section.label}`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-[#292b45]">
                <Play className="h-3 w-3 text-[#e55b4c]" />
                {section.label}
              </span>
              <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">
                {Math.floor(section.startMs / 1000 / 60)}:{String(Math.floor((section.startMs / 1000) % 60)).padStart(2, '0')}
              </span>
            </button>
          ))}
          <p className="pt-1 font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">
            pacing source · {pacing.source ?? 'DEMO'}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={run}
          disabled={analyze.isPending || !selectedId}
          className="focus-house mt-4 inline-flex items-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-wait disabled:opacity-60"
          data-testid="button-analyze-reference"
        >
          <Compass className={`h-4 w-4 ${analyze.isPending ? 'animate-spin' : ''}`} />
          {analyze.isPending ? 'Analyzing…' : 'Analyze pacing'}
        </button>
      )}
      {analyze.isError && (
        <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
          {error?.response?.data?.error || 'The reference could not be analyzed.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player + transcript (left rail)
// ---------------------------------------------------------------------------

function TranscriptPanel({
  asset,
  onSeek,
  onSelect,
  onComment,
}: {
  asset: VideoAssetDetail | undefined;
  onSeek: (ms: number) => void;
  onSelect: (segment: VideoTranscriptSegment) => void;
  onComment: (segment: VideoTranscriptSegment) => void;
}) {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const segments = asset?.transcript?.segments ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((segment) => segment.text.toLowerCase().includes(q));
  }, [segments, query]);

  if (!asset) return null;
  const transcript = asset.transcript;

  return (
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
          <Search className="h-4 w-4" />
          Transcript
        </div>
        {transcript && (
          <span className={`rounded-full px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] ${transcript.status === 'DEMO' ? 'bg-[#f0c85c] text-[#292b45]' : 'bg-[#e5f1e8] text-[#286254]'}`}>
            {transcript.status === 'DEMO' ? 'Demo — whisper not installed' : transcript.model}
          </span>
        )}
      </div>

      {transcript ? (
        <>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the transcript…"
            className="focus-house mt-4 w-full rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
            data-testid="input-transcript-search"
          />
          <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-[#77717a]">No transcript lines match.</p>
            ) : (
              filtered.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => {
                    setActiveId(segment.id);
                    onSeek(segment.startMs);
                  }}
                  className={`group w-full rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${activeId === segment.id ? 'border-[#e55b4c] bg-[#ffe9df]' : 'border-[#e5d7c5] bg-[#f7eddf] hover:border-[#8dc2ad]'}`}
                  data-testid={`transcript-segment-${segment.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">
                      {formatTimecode(segment.startMs)} → {formatTimecode(segment.endMs)}
                    </span>
                    <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <span onClick={(event) => { event.stopPropagation(); onSelect(segment); }} className="rounded-full bg-[#286254] p-1 text-[#fff4e6]" title="Mark as a select">
                        <Plus className="h-3 w-3" />
                      </span>
                      <span onClick={(event) => { event.stopPropagation(); onComment(segment); }} className="rounded-full bg-[#292b45] p-1 text-[#f0c85c]" title="Comment at this timecode">
                        <MessageSquare className="h-3 w-3" />
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-[#292b45]">{segment.text}</p>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-sm text-[#77717a]">
          <Sparkles className="h-4 w-4 text-[#e55b4c]" />
          Transcription is still running. Uploads are processed in the background — refresh in a moment.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selects builder (right rail)
// ---------------------------------------------------------------------------

function SelectsPanel({
  snapshot,
  onChange,
  canEdit,
  dirty,
}: {
  snapshot: WorkingSnapshot;
  onChange: (next: WorkingSnapshot) => void;
  canEdit: boolean;
  dirty: boolean;
}) {
  const addClip = (segment: VideoTranscriptSegment, assetId: string) => {
    const clip: Clip = { id: crypto.randomUUID(), assetId, inMs: segment.startMs, outMs: segment.endMs };
    onChange({ ...snapshot, clips: [...snapshot.clips, clip] });
  };

  const removeClip = (id: string) => {
    onChange({ ...snapshot, clips: snapshot.clips.filter((clip) => clip.id !== id) });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">Selects</span>
          <span className="rounded-full bg-[#292b45] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#f0c85c]">{snapshot.clips.length} marked</span>
        </div>
        {snapshot.clips.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-[#77717a]">
            Hover a transcript line and hit <Plus className="inline h-3.5 w-3.5" /> to mark it as a select. Your picks build the paper edit.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {snapshot.clips.map((clip, index) => (
              <div key={clip.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] px-3 py-2.5" data-testid={`select-clip-${clip.id}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">#{index + 1}</span>
                  <span className="text-sm font-bold text-[#292b45]">{formatTimecode(clip.inMs)} → {formatTimecode(clip.outMs)}</span>
                </div>
                {canEdit && (
                  <button type="button" onClick={() => removeClip(clip.id)} className="rounded-full p-1 text-[#98909a] hover:bg-[#ffe9df] hover:text-[#a33d31]" title="Remove select">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {dirty && (
          <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#a33d31]">
            <Sparkles className="h-3.5 w-3.5" />
            Unsaved changes
          </p>
        )}
      </div>

      <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
        <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">Scene blocks</span>
        <p className="mt-1 text-xs leading-relaxed text-[#77717a]">The narrative spine — Hook → Setup → Core → Payoff → CTA.</p>
        <div className="mt-4 space-y-2">
          {SCENE_TYPES.map((type) => {
            const block = snapshot.sceneBlocks.find((b) => b.type === type);
            return (
              <div key={type} className={`flex items-center justify-between gap-3 rounded-xl border-2 px-3 py-2.5 ${block ? 'border-[#8dc2ad] bg-[#e5f1e8]' : 'border-[#e5d7c5] bg-[#f7eddf]'}`} data-testid={`scene-block-${type}`}>
                <div>
                  <p className="font-mono-ui text-[9px] uppercase tracking-[.16em] text-[#286254]">{type}</p>
                  {block && (
                    <p className="mt-0.5 text-xs font-semibold text-[#292b45]">
                      {formatTimecode(block.startMs)} → {formatTimecode(block.endMs)}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      const existing = snapshot.sceneBlocks.find((b) => b.type === type);
                      const next = existing
                        ? snapshot.sceneBlocks.filter((b) => b.type !== type)
                        : [...snapshot.sceneBlocks, { id: crypto.randomUUID(), type, startMs: 0, endMs: 0 }];
                      onChange({ ...snapshot, sceneBlocks: next });
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${block ? 'bg-[#292b45] text-[#fff4e6]' : 'bg-[#286254] text-[#fff4e6]'}`}
                  >
                    {block ? 'Remove' : 'Add block'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version history + submit
// ---------------------------------------------------------------------------

type StudioLeg = 'SELECTS' | 'CUT' | 'SOUND' | 'FINISH';

export function HistoryPanel({
  projectId,
  leg,
  versions,
  currentVersion,
  canSubmit,
}: {
  projectId: string;
  leg: StudioLeg;
  versions: VideoTimelineVersionSummary[];
  currentVersion: number | null;
  canSubmit: boolean;
}) {
  const queryClient = useQueryClient();
  const rollback = useRollbackVideoTimeline();
  const submit = useCreateVideoSubmission();
  const [note, setNote] = useState('');

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
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">Snapshot history</span>
        <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">v{currentVersion ?? 0}</span>
      </div>
      {versions.length === 0 ? (
        <p className="mt-4 text-sm text-[#77717a]">No snapshots yet — save your first select pass above.</p>
      ) : (
        <div className="mt-4 max-h-56 space-y-2 overflow-y-auto pr-1">
          {versions.map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] px-3 py-2.5" data-testid={`version-${version.version}`}>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#292b45]">
                  v{version.version}
                  {version.version === currentVersion && <span className="ml-2 rounded-full bg-[#e5f1e8] px-2 py-0.5 font-mono-ui text-[8px] uppercase tracking-[.14em] text-[#286254]">head</span>}
                </p>
                {version.message && <p className="truncate text-xs text-[#77717a]">{version.message}</p>}
              </div>
              {canSubmit && version.version !== currentVersion && (
                <button
                  type="button"
                  onClick={() => onRollback(version.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-[#292b45] px-3 py-1.5 text-xs font-bold text-[#fff4e6] hover:bg-[#286254]"
                  title="Restore this snapshot as the new head"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canSubmit && (
        <div className="mt-5 border-t-2 border-[#e5d7c5] pt-4">
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">Submit for review</span>
          <p className="mt-1 text-xs leading-relaxed text-[#77717a]">Pins the current head snapshot and hands the leg to the Captain.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note for the Captain (optional)"
              maxLength={2000}
              className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
              data-testid="input-submit-note"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={submit.isPending}
              className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#e55b4c] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#c7473c] disabled:cursor-wait disabled:opacity-60"
              data-testid="button-submit-leg"
            >
              <Send className="h-4 w-4" />
              {submit.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
          {submit.isError && (
            <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
              {submitError?.response?.data?.error || 'The submission could not be created.'}
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

export function CommentsPanel({ projectId, leg = 'SELECTS' }: { projectId: string; leg?: StudioLeg }) {
  const queryClient = useQueryClient();
  const comments = useListVideoComments(projectId);
  const create = useCreateVideoComment();
  const resolve = useResolveVideoComment();
  const [body, setBody] = useState('');
  const [timecodeMs, setTimecodeMs] = useState<number | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim()) return;
    create.mutate(
      { projectId, data: { leg, body: body.trim(), timecodeMs: timecodeMs ?? undefined } },
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
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
        <MessageSquare className="h-4 w-4" />
        Timecode notes
      </div>
      <form className="mt-4 space-y-2" onSubmit={submit} data-testid="form-comment">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Pinned note — e.g. the lighting shift at 02:14 is jarring, can we grade this?"
          maxLength={4000}
          rows={2}
          required
          className="focus-house w-full resize-none rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
          data-testid="input-comment"
        />
        <div className="flex items-center gap-2">
          <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">Pin at</span>
          <input
            value={timecodeMs == null ? '' : formatTimecode(timecodeMs)}
            readOnly
            placeholder="playhead time"
            className="w-28 rounded-lg border-2 border-[#e5d7c5] bg-[#f7eddf] px-2 py-1.5 text-center font-mono-ui text-[11px] text-[#292b45]"
          />
          <button
            type="submit"
            disabled={create.isPending || !body.trim()}
            className="focus-house ml-auto inline-flex items-center gap-1.5 rounded-xl bg-[#292b45] px-4 py-2 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-add-comment"
          >
            <Plus className="h-4 w-4" />
            {create.isPending ? 'Pinning…' : 'Pin note'}
          </button>
        </div>
      </form>

      {comments.data && comments.data.length > 0 ? (
        <div className="mt-5 space-y-2">
          {comments.data.map((comment) => (
            <div key={comment.id} className={`rounded-xl border-2 px-3 py-2.5 ${comment.resolvedAt ? 'border-[#e5d7c5] bg-[#f1e8da] opacity-70' : 'border-[#8dc2ad] bg-[#e5f1e8]'}`} data-testid={`comment-${comment.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#286254]">
                  {comment.timecodeMs != null ? formatTimecode(comment.timecodeMs) : 'project note'}
                </span>
                <button
                  type="button"
                  onClick={() => onResolve(comment.id, !comment.resolvedAt)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${comment.resolvedAt ? 'bg-[#292b45] text-[#f0c85c]' : 'bg-[#fff4e6] text-[#286254]'}`}
                  title={comment.resolvedAt ? 'Reopen' : 'Resolve'}
                >
                  <Check className="h-3 w-3" />
                  {comment.resolvedAt ? 'Reopen' : 'Resolve'}
                </button>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-[#292b45]">{comment.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[#77717a]">No notes yet — pin feedback to a moment in the footage.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContentCreatorsStudioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [leg, setLeg] = useState<StudioLeg>('SELECTS');
  // Live: comments, submissions, and timeline saves stream in per leg.
  useProjectRealtime(projectId, leg);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState<WorkingSnapshot>(EMPTY_SNAPSHOT);
  const [dirty, setDirty] = useState(false);

  const project = useGetVideoProject(projectId);
  const asset = useGetVideoAsset(projectId, assetId ?? '', {
    query: { queryKey: getGetVideoAssetQueryKey(projectId, assetId ?? ''), enabled: Boolean(assetId) },
  });
  const timeline = useGetVideoTimeline(projectId, leg);
  const save = useSaveVideoTimeline();
  const submissions = useListVideoSubmissions(projectId);

  // Seed working state from the timeline head whenever it changes.
  useEffect(() => {
    if (timeline.data?.snapshot) {
      const snapshot = timeline.data.snapshot as unknown as WorkingSnapshot;
      setWorking({
        clips: Array.isArray(snapshot.clips) ? snapshot.clips : [],
        sceneBlocks: Array.isArray(snapshot.sceneBlocks) ? snapshot.sceneBlocks : [],
        markers: Array.isArray(snapshot.markers) ? snapshot.markers : [],
      });
      setDirty(false);
    }
  }, [timeline.data?.snapshot, timeline.data?.version]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === LEG_ROLES[leg];
  const canSubmit = canEdit;

  // Default the player to the first asset once the project loads.
  useEffect(() => {
    if (!assetId && project.data?.assets && project.data.assets.length > 0) {
      setAssetId(project.data.assets[0].id);
    }
  }, [project.data?.assets, assetId]);

  const proxyUrl = assetId ? `/api/video/projects/${projectId}/assets/${assetId}/proxy` : null;
  const hasProxy = (asset.data?.files ?? []).some((file) => file.kind === 'PROXY');

  const onSeek = (ms: number) => {
    setPlayheadMs(ms);
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      void videoRef.current.play().catch(() => {});
    }
  };

  const onSelectFromTranscript = (segment: VideoTranscriptSegment) => {
    const clip: Clip = { id: crypto.randomUUID(), assetId: assetId ?? '', inMs: segment.startMs, outMs: segment.endMs };
    setWorking((prev) => ({ ...prev, clips: [...prev.clips, clip] }));
    setDirty(true);
  };

  const onCommentFromTranscript = (segment: VideoTranscriptSegment) => {
    setPlayheadMs(segment.startMs);
    if (videoRef.current) videoRef.current.currentTime = segment.startMs / 1000;
  };

  const onSave = () => {
    save.mutate(
      { projectId, leg, data: { snapshot: working as unknown as Record<string, unknown>, message: message.trim() || undefined } },
      {
        onSuccess: () => {
          setMessage('');
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, leg) });
        },
      },
    );
  };

  const saveError = save.error as { response?: { data?: { error?: string } } } | null;

  const legStatus = submissions.data?.find((s) => s.leg === leg);

  if (project.isLoading) {
    return (
      <div className="mx-auto max-w-[1180px]">
        <div className="h-40 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" />
        <div className="mt-6 h-96 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" />
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <SectionEyebrow>Studio closed</SectionEyebrow>
        <h1 className="mt-5 text-6xl font-extrabold tracking-[-0.08em]">This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">
          <ArrowLeft className="h-4 w-4" />
          Back to the vault
        </Link>
      </div>
    );
  }

  const p = project.data;

  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/projects/${p.id}`} className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-studio-back-vault">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the vault
        </Link>
        <Link href={`/projects/${p.id}/selects`} className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-[#77717a] hover:text-[#292b45]">
          <ArrowUpRight className="h-3.5 w-3.5" />
          {p.name}
        </Link>
      </div>

      <div className="reveal mt-4 flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-7 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Content creators / the studio</SectionEyebrow>
          <h1 className="mt-3 text-4xl font-extrabold leading-[.92] tracking-[-0.06em] text-[#292b45] sm:text-6xl">The selects studio.</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {LEGS.map((item) => {
            const Icon = item.icon;
            const active = item.leg === leg;
            const status = submissions.data?.find((s) => s.leg === item.leg);
            const inner = (
              <>
                <Icon className="h-4 w-4" />
                {item.role}
                {status && (
                  <span className={`rounded-full px-2 py-0.5 font-mono-ui text-[8px] uppercase tracking-[.12em] ${status.status === 'APPROVED' ? 'bg-[#e5f1e8] text-[#286254]' : status.status === 'REJECTED' ? 'bg-[#ffe9df] text-[#a33d31]' : 'bg-[#f0c85c] text-[#292b45]'}`}>
                    {status.status}
                  </span>
                )}
              </>
            );
            const tabClass = `focus-house inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-bold transition-colors ${active ? 'border-[#292b45] bg-[#292b45] text-[#fff4e6]' : 'border-[#d6cbb9] bg-[#fff4e6] text-[#625f6d] hover:border-[#8dc2ad]'}`;
            const href =
              item.leg === 'CUT'
                ? `/projects/${p.id}/cut`
                : item.leg === 'SOUND'
                  ? `/projects/${p.id}/sound`
                  : item.leg === 'FINISH'
                    ? `/projects/${p.id}/finish`
                    : null;
            if (href) {
              return (
                <Link
                  key={item.leg}
                  href={href}
                  className={tabClass}
                  data-testid={`tab-leg-${item.leg}`}
                >
                  {inner}
                </Link>
              );
            }
            return (
              <button
                key={item.leg}
                type="button"
                onClick={() => setLeg(item.leg)}
                className={tabClass}
                data-testid={`tab-leg-${item.leg}`}
              >
                {inner}
              </button>
            );
          })}
        </div>
      </div>

      {leg !== 'SELECTS' ? (
        <div className="mt-10 rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-10 text-center shadow-[8px_10px_0_rgba(41,43,69,.07)]">
          <Clapperboard className="mx-auto h-8 w-8 text-[#e55b4c]" />
          <p className="mt-6 font-display text-4xl italic">This leg is next in the relay.</p>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-[1.8] text-[#77717a]">
            The {LEGS.find((l) => l.leg === leg)?.role} studio arrives in the next milestone. Story Architect selects are the first pass — get them right and the cut is easy.
          </p>
          <button type="button" onClick={() => setLeg('SELECTS')} className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6] hover:bg-[#286254]">
            <Film className="h-4 w-4" />
            Open the selects studio
          </button>
        </div>
      ) : (
        <div className="reveal reveal-1 mt-8 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <div className="space-y-4">
            <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">Proxy player</span>
                {p.assets.length > 1 && (
                  <select
                    value={assetId ?? ''}
                    onChange={(event) => setAssetId(event.target.value || null)}
                    className="focus-house rounded-lg border-2 border-[#e5d7c5] bg-[#f7eddf] px-3 py-1.5 text-xs text-[#292b45]"
                    data-testid="select-player-asset"
                  >
                    {p.assets.map((a) => (
                      <option key={a.id} value={a.id}>{a.fileName}</option>
                    ))}
                  </select>
                )}
              </div>

              {assetId ? (
                hasProxy ? (
                  <video
                    ref={videoRef}
                    key={assetId}
                    src={proxyUrl ?? undefined}
                    controls
                    preload="metadata"
                    className="mt-4 aspect-video w-full rounded-xl border-2 border-[#292b45] bg-black"
                    onTimeUpdate={(event) => setPlayheadMs(Math.floor((event.target as HTMLVideoElement).currentTime * 1000))}
                    data-testid="proxy-player"
                  />
                ) : (
                  <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf]">
                    <div className="text-center">
                      <Sparkles className="mx-auto h-7 w-7 animate-pulse text-[#e55b4c]" />
                      <p className="mt-3 text-sm font-semibold text-[#625f6d]">Building the proxy…</p>
                      <p className="mt-1 text-xs text-[#98909a]">Refresh in a moment — processing runs in the background.</p>
                    </div>
                  </div>
                )
              ) : (
                <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf]">
                  <div className="text-center">
                    <Play className="mx-auto h-7 w-7 text-[#98909a]" />
                    <p className="mt-3 text-sm font-semibold text-[#625f6d]">No footage in the vault yet.</p>
                    <Link href={`/projects/${p.id}`} className="focus-house mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#e55b4c] hover:text-[#a33d31]">
                      Upload raw footage <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              )}

              <p className="mt-3 flex items-center gap-2 text-xs text-[#77717a]">
                <LockKeyhole className="h-3.5 w-3.5 text-[#e55b4c]" />
                Streaming the degraded proxy — the locked original never leaves the server.
              </p>
            </div>

            <ReferenceGuide projectId={p.id} assets={p.assets} onSeek={onSeek} />
            <TranscriptPanel asset={asset.data} onSeek={onSeek} onSelect={onSelectFromTranscript} onComment={onCommentFromTranscript} />
            <CommentsPanel projectId={p.id} />
          </div>

          <div className="space-y-4">
            <SelectsPanel snapshot={working} onChange={setWorking} canEdit={canEdit} dirty={dirty} />

            <div className="rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5">
              <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
                <Save className="h-4 w-4" />
                Save this pass
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[#286254]">
                Every save creates a Git-style snapshot — roll back to any past version, the Captain can always see what changed.
              </p>
              {canEdit ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="What changed in this pass? (optional)"
                    maxLength={500}
                    className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
                    data-testid="input-save-message"
                  />
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={save.isPending || !dirty}
                    className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="button-save-snapshot"
                  >
                    <Save className="h-4 w-4" />
                    {save.isPending ? 'Saving…' : 'Save snapshot'}
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-sm font-semibold text-[#286254]">
                  You&apos;re viewing this leg — only the {LEG_ROLES[leg] === 'ARCHITECT' ? 'Story Architect' : LEG_ROLES[leg]} or the Captain can edit it.
                </p>
              )}
              {save.isError && (
                <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
                  {saveError?.response?.data?.error || 'The snapshot could not be saved.'}
                </p>
              )}
            </div>

            <HistoryPanel
              projectId={p.id}
              leg={leg}
              versions={timeline.data?.versions ?? []}
              currentVersion={timeline.data?.version ?? null}
              canSubmit={canSubmit}
            />

            {legStatus && (
              <p className="flex items-center gap-2 text-xs font-semibold text-[#625f6d]">
                <Sparkles className="h-4 w-4 text-[#e55b4c]" />
                Leg status: {legStatus.status.toLowerCase()}
                {legStatus.decidedAt && ` · decided ${new Date(legStatus.decidedAt).toLocaleDateString()}`}
              </p>
            )}
          </div>
        </div>
      )}

      <p className="reveal reveal-2 mt-10 flex items-center gap-3 border-t-2 border-[#d6cbb9] pt-3 text-xs text-[#77717a]">
        <LockKeyhole className="h-4 w-4 text-[#e55b4c]" />
        Every frame stays locked. Proxies are streamed, transcripts are searchable, and the originals never leave the vault.
      </p>
    </div>
  );
}
