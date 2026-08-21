import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clapperboard,
  Compass,
  Film,
  GitCompareArrows,
  LockKeyhole,
  MessageSquare,
  Mic2,
  Palette,
  Pin,
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
  oracleChat,
} from '@workspace/api-client-react';
import type {
  VideoAssetDetail,
  VideoTranscriptSegment,
  VideoTimelineVersionSummary,
} from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { Timeline, formatTimecode, activeBlockId, type TimelineBlock } from '@/components/timeline';
import { RoleOracle, AiResult, type StudioLeg } from '@/components/role-oracle';
import { AssetPlayer, EmptyPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { CheckoutPanel, ImportFlow } from '@/components/checkout-import';
import { DiffView, type WipeFilter } from '@/components/diff-view';
import { AnnotationCanvas } from '@/components/annotation-canvas';

const LEG_ROLES: Record<string, string> = {
  SELECTS: 'ARCHITECT',
  CUT: 'VISUAL_EDITOR',
  SOUND: 'SOUND_DESIGNER',
  FINISH: 'MOTION_COLOR',
};

const SCENE_TYPES = ['HOOK', 'SETUP', 'CORE', 'PAYOFF', 'CTA'] as const;
const SCENE_TONES: Record<string, TimelineBlock['tone']> = {
  HOOK: 'gold',
  SETUP: 'teal',
  CORE: 'accent',
  PAYOFF: 'primary',
  CTA: 'danger',
};

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
    <div className="paper-card" data-testid="panel-reference">
      <div className="inline-heading">
        <span className="eyebrow"><Compass size={13} /> Reference guide</span>
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="!w-auto !text-xs" data-testid="select-reference-asset">
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.fileName}</option>
          ))}
        </select>
      </div>
      <p className="setting-copy">
        Import a viral vlog as a reference and its pacing (Hook → Setup → Core → Payoff → CTA) appears here, side-by-side with your own selects.
      </p>

      {reference.data?.status === 'READY' && pacing?.sections ? (
        <div className="den-stack mt-3">
          {pacing.sections.map((section, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onSeek(section.startMs)}
              className="list-row"
              data-testid={`reference-beat-${section.label}`}
            >
              <span className="world-symbol"><Play size={12} /></span>
              <span>
                <b>{section.label}</b>
                <small>{Math.floor(section.startMs / 1000 / 60)}:{String(Math.floor((section.startMs / 1000) % 60)).padStart(2, '0')}</small>
              </span>
            </button>
          ))}
          <p className="mono-label">pacing source · {pacing.source ?? 'DEMO'}</p>
        </div>
      ) : (
        <button type="button" onClick={run} disabled={analyze.isPending || !selectedId} className="secondary-btn mt-3" data-testid="button-analyze-reference">
          <Compass size={14} className={analyze.isPending ? 'spin' : ''} />
          {analyze.isPending ? 'Analyzing…' : 'Analyze pacing'}
        </button>
      )}
      {analyze.isError && (
        <p className="setting-copy mt-2" role="alert">
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
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Search size={13} /> Transcript</span>
        {transcript && (
          <span className={`den-tag ${transcript.status === 'DEMO' ? 'gold' : 'teal'}`}>
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
            className="mb-3"
            data-testid="input-transcript-search"
          />
          <div className="den-stack max-h-[420px] overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="setting-copy">No transcript lines match.</p>
            ) : (
              filtered.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => {
                    setActiveId(segment.id);
                    onSeek(segment.startMs);
                  }}
                  className={`list-row ${activeId === segment.id ? 'selected' : ''}`}
                  data-testid={`transcript-segment-${segment.id}`}
                >
                  <span className="world-symbol"><Play size={12} /></span>
                  <span>
                    <b className="mono-label !text-[9px]">{formatTimecode(segment.startMs)} → {formatTimecode(segment.endMs)}</b>
                    <small className="!text-xs !normal-case">{segment.text}</small>
                    <span className="mt-1 flex gap-2">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); onSelect(segment); }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onSelect(segment); } }}
                        className="link-btn !text-[10px]"
                        title="Mark as a select"
                      >
                        <Plus size={11} /> mark select
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); onComment(segment); }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onComment(segment); } }}
                        className="link-btn !text-[10px]"
                        title="Comment at this timecode"
                      >
                        <MessageSquare size={11} /> comment
                      </span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <p className="den-footnote mt-3">
          <Sparkles size={13} />
          Transcription is still running. Uploads are processed in the background — refresh in a moment.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selects builder (right rail) — direct-manipulation timeline
// ---------------------------------------------------------------------------

function SelectsBuilder({
  snapshot,
  onChange,
  canEdit,
  durationMs,
  playheadMs,
  onScrub,
}: {
  snapshot: WorkingSnapshot;
  onChange: (next: WorkingSnapshot) => void;
  canEdit: boolean;
  durationMs: number;
  playheadMs: number;
  onScrub: (ms: number) => void;
}) {
  const clipBlocks: TimelineBlock[] = snapshot.clips.map((clip, index) => ({
    id: clip.id,
    label: `#${index + 1}`,
    sublabel: `${formatTimecode(clip.inMs)} → ${formatTimecode(clip.outMs)}`,
    startMs: clip.inMs,
    endMs: clip.outMs,
    tone: 'gold',
  }));

  const sceneBlocks: TimelineBlock[] = snapshot.sceneBlocks.map((block) => ({
    id: block.id,
    label: block.type,
    sublabel: `${formatTimecode(block.startMs)} → ${formatTimecode(block.endMs)}`,
    startMs: block.startMs,
    endMs: Math.max(block.endMs, block.startMs + 1000),
    tone: SCENE_TONES[block.type] ?? 'accent',
  }));

  const onClipsChange = (next: TimelineBlock[]) => {
    const nextClips = snapshot.clips.map((clip) => {
      const block = next.find((b) => b.id === clip.id);
      return block ? { ...clip, inMs: block.startMs, outMs: block.endMs } : clip;
    });
    onChange({ ...snapshot, clips: nextClips });
  };

  const onSceneChange = (next: TimelineBlock[]) => {
    const nextBlocks = snapshot.sceneBlocks.map((block) => {
      const bar = next.find((b) => b.id === block.id);
      return bar ? { ...block, startMs: bar.startMs, endMs: bar.endMs } : block;
    });
    onChange({ ...snapshot, sceneBlocks: nextBlocks });
  };

  return (
    <div className="space-y-4">
      <Timeline
        title={`Selects — ${snapshot.clips.length} marked`}
        hint="Drag to move · pull edges to trim · click the ruler to scrub"
        blocks={clipBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={canEdit}
        onChange={onClipsChange}
        onScrub={onScrub}
        activeId={activeBlockId(clipBlocks, playheadMs)}
      />

      <div className="paper-card">
        <div className="inline-heading">
          <span className="eyebrow">Scene blocks · the narrative spine</span>
          <span className="mono-label">Hook → Setup → Core → Payoff → CTA</span>
        </div>
        <p className="setting-copy mb-3">Drag each beat to place it in the timeline — the spine that drives the cut.</p>
        <Timeline
          title=""
          hint=""
          blocks={sceneBlocks}
          durationMs={durationMs}
          playheadMs={playheadMs}
          canEdit={canEdit}
          onChange={onSceneChange}
          onScrub={onScrub}
          activeId={activeBlockId(sceneBlocks, playheadMs)}
        />
        {canEdit && (
          <div className="den-chip-list mt-3">
            {SCENE_TYPES.map((type) => {
              const exists = snapshot.sceneBlocks.some((b) => b.type === type);
              return (
                <button
                  key={type}
                  type="button"
                  className={`den-chip ${exists ? '' : 'text-[hsl(var(--accent))] border-[hsl(var(--accent)/.5)]'}`}
                  onClick={() => {
                    const existing = snapshot.sceneBlocks.find((b) => b.type === type);
                    const next = existing
                      ? snapshot.sceneBlocks.filter((b) => b.type !== type)
                      : [...snapshot.sceneBlocks, { id: crypto.randomUUID(), type, startMs: 0, endMs: 0 }];
                    onChange({ ...snapshot, sceneBlocks: next });
                  }}
                  data-testid={`scene-block-${type}`}
                >
                  {exists ? <X size={10} /> : <Plus size={10} />}
                  {type} {exists && '· placed'}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

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
          <p className="setting-copy mt-1">Pins the current head snapshot and hands the leg to the Captain.</p>
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

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
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
  // One-click AI results
  const [aiResult, setAiResult] = useState<{ kind: 'selects' | 'spine'; title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const asset = useGetVideoAsset(projectId, assetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId ?? ''),
      enabled: Boolean(assetId),
      // Keep fetching until the proxy/transcript finish, then stop on its own.
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
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

  const assetDuration = asset.data?.durationMs ?? Math.max(60_000, (project.data?.assets[0]?.durationMs ?? 60_000));

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

  // Scrub from the timeline ruler without auto-playing.
  const onScrub = (ms: number) => {
    setPlayheadMs(ms);
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
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
  // Scope on-frame annotations to the leg's current head version.
  const headVersionId = timeline.data?.versions.find((v) => v.version === timeline.data?.version)?.id ?? null;

  // Build the AI context: transcript + current selects + scene blocks.
  const oracleContext = useMemo(() => {
    const lines = (asset.data?.transcript?.segments ?? [])
      .map((s) => `${formatTimecode(s.startMs)}–${formatTimecode(s.endMs)}: ${s.text}`)
      .join('\n');
    const selects = working.clips.map((c, i) => `#${i + 1} ${formatTimecode(c.inMs)}–${formatTimecode(c.outMs)}`).join(', ') || 'none yet';
    const spine = working.sceneBlocks.map((b) => `${b.type}@${formatTimecode(b.startMs)}`).join(', ') || 'none yet';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Asset: ${asset.data?.fileName ?? 'unknown'} (duration ${formatTimecode(assetDuration)})`,
      `Transcript:\n${lines.slice(0, 6000) || '(no transcript yet)'}`,
      `Current selects: ${selects}`,
      `Scene blocks: ${spine}`,
    ].join('\n\n').slice(0, 12000);
  }, [asset.data, working, project.data?.name, assetDuration]);

  // Parse "0:05–0:12" ranges out of an oracle answer and apply them as selects.
  const applySelectsFromAnswer = (text: string) => {
    const ranges = parseTimecodeRanges(text);
    if (ranges.length === 0) return 0;
    const added: Clip[] = ranges
      .filter(([inMs, outMs]) => inMs < outMs)
      .map(([inMs, outMs]) => ({ id: crypto.randomUUID(), assetId: assetId ?? '', inMs, outMs }));
    setWorking((prev) => ({ ...prev, clips: [...prev.clips, ...added] }));
    setDirty(true);
    return added.length;
  };

  // Parse "TYPE @ 0:05" beat placements out of an oracle answer and apply them.
  const applySpineFromAnswer = (text: string) => {
    const placements: Array<{ type: (typeof SCENE_TYPES)[number]; startMs: number }> = [];
    for (const type of SCENE_TYPES) {
      const re = new RegExp(`${type}\\s*[@:]\\s*(\\d{1,2}):(\\d{2})`, 'i');
      const m = text.match(re);
      if (m) placements.push({ type, startMs: (Number(m[1]) * 60 + Number(m[2])) * 1000 });
    }
    if (placements.length === 0) return 0;
    const next = snapshotSceneBlocksWith(working, placements);
    setWorking((prev) => ({ ...prev, sceneBlocks: next }));
    setDirty(true);
    return placements.length;
  };

  // Runs a one-shot oracle prompt for the quick actions and returns the text.
  const runOracleSuggestion = async (instruction: string): Promise<string | null> => {
    setAiBusy(true);
    try {
      const result = await oracleChat({ messages: [{ role: 'system', content: 'You are the Story Architect\'s assistant in a video relay. Be concise and concrete.' }, { role: 'user', content: `${instruction}\n\nContext:\n${oracleContext}` }] });
      setAiResult((prev) => (prev ? { ...prev, meta: { providerId: result.providerId, modelId: result.modelId } } : prev));
      return result.content;
    } catch {
      return null;
    } finally {
      setAiBusy(false);
    }
  };

  const quickActions = [
    {
      id: 'auto-selects',
      label: 'Suggest selects from transcript',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion(
          'Mark the strongest moments as selects. Answer ONLY with lines of the form "start–end | reason", one per line, using MM:SS timecodes from the transcript.',
        ).then((body) => {
          if (!body) return;
          setAiResult({ kind: 'selects', title: 'Selects suggestions (review, then Apply)', body, meta: null });
        });
      },
    },
    {
      id: 'auto-spine',
      label: 'Place the 5-beat spine',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion(
          'Place the narrative spine on this footage. Answer ONLY with lines of the form "TYPE @ MM:SS" for HOOK, SETUP, CORE, PAYOFF, CTA using timecodes from the transcript.',
        ).then((body) => {
          if (!body) return;
          setAiResult({ kind: 'spine', title: 'Spine suggestions (review, then place)', body, meta: null });
        });
      },
    },
  ];

  if (project.isLoading) {
    return <div className="page"><div className="panel-empty">Opening the studio…</div></div>;
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>STUDIO CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;

  return (
    <div className="page">
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>CONTENT CREATORS · THE STUDIO</b>
          <span>Marks the golden takes and builds the narrative spine: Hook → Setup → Core → Payoff → CTA. Drag the timeline, scrub, and ask the oracle.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Story Architect · selects</SectionEyebrow>
          <h1>The selects studio.</h1>
          <p>Hover a transcript line to mark a select, drag clips on the timeline to rework the paper edit, and let the oracle draft the spine.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-studio-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canEdit ? 'teal' : 'muted'}`}>{canEdit ? 'Editing' : 'Viewing'}</span>
        </div>
      </div>

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
          const Icon = item.icon;
          const active = item.leg === leg;
          const status = submissions.data?.find((s) => s.leg === item.leg);
          const href =
            item.leg === 'CUT'
              ? `/projects/${p.id}/cut`
              : item.leg === 'SOUND'
                ? `/projects/${p.id}/sound`
                : item.leg === 'FINISH'
                  ? `/projects/${p.id}/finish`
                  : item.leg === 'THUMBNAIL'
                    ? `/projects/${p.id}/thumbnail`
                    : null;
          const inner = (
            <>
              <Icon size={13} />
              {item.role}
              {status && <span className={`leg-badge ${status.status === 'APPROVED' ? 'text-[#286254]' : status.status === 'REJECTED' ? 'text-[#a33d31]' : ''}`}>{status.status}</span>}
            </>
          );
          if (href) {
            return (
              <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`tab-leg-${item.leg}`}>
                {inner}
              </Link>
            );
          }
          return (
            <button key={item.leg} type="button" className={active ? 'active' : ''} onClick={() => setLeg(item.leg)} data-testid={`tab-leg-${item.leg}`}>
              {inner}
            </button>
          );
        })}
      </div>

      {leg !== 'SELECTS' ? (
        <div className="empty-state">
          <Clapperboard size={24} />
          <h3>This leg is next in the relay.</h3>
          <p>The {RELAY_LEGS.find((l) => l.leg === leg)?.role} studio lives at its own address — use the tabs above to jump between the four rooms.</p>
        </div>
      ) : (
        <div className="den-two-col">
          <div className="space-y-4">
            <div className="paper-card">
              <div className="inline-heading">
                <span className="eyebrow">Proxy player</span>
                {p.assets.length > 1 && (
                  <select value={assetId ?? ''} onChange={(event) => setAssetId(event.target.value || null)} className="!w-auto !text-xs" data-testid="select-player-asset">
                    {p.assets.map((a) => (
                      <option key={a.id} value={a.id}>{a.fileName}</option>
                    ))}
                  </select>
                )}
              </div>

              {assetId ? (
                <AssetPlayer
                  className="mt-3"
                  projectId={p.id}
                  assetId={assetId}
                  detail={asset.data}
                  videoRef={videoRef}
                  onTimeUpdate={setPlayheadMs}
                  title={asset.data?.fileName}
                >
                  <AnnotationCanvas
                    projectId={p.id}
                    leg={leg}
                    assetId={assetId}
                    playheadMs={playheadMs}
                    onSeek={onSeek}
                    timelineVersionId={headVersionId}
                  />
                </AssetPlayer>
              ) : (
                <EmptyPlayer className="mt-3">
                  <p className="text-sm font-semibold">No footage in the vault yet.</p>
                  <Link href={`/projects/${p.id}`} className="link-btn mt-2">
                    Upload raw footage <ArrowUpRight size={12} />
                  </Link>
                </EmptyPlayer>
              )}

              <p className="den-footnote mt-3">
                <LockKeyhole size={13} />
                Streaming the degraded proxy — the locked original never leaves the server.
              </p>
            </div>

            <ReferenceGuide projectId={p.id} assets={p.assets} onSeek={onSeek} />
            <TranscriptPanel asset={asset.data} onSeek={onSeek} onSelect={onSelectFromTranscript} onComment={onCommentFromTranscript} />
            <CommentsPanel projectId={p.id} />
          </div>

          <div className="space-y-4">
            <SelectsBuilder
              snapshot={working}
              onChange={(next) => { setWorking(next); setDirty(true); }}
              canEdit={canEdit}
              durationMs={assetDuration}
              playheadMs={playheadMs}
              onScrub={onScrub}
            />

            {aiResult && (
              <AiResult
                title={aiResult.title}
                meta={aiResult.meta}
                actions={
                  aiResult.kind === 'selects'
                    ? [
                        <button key="apply" type="button" className="secondary-btn" onClick={() => { const n = applySelectsFromAnswer(aiResult.body); setAiResult({ ...aiResult, title: n > 0 ? `Suggestions — ${n} applied` : aiResult.title }); }}>
                          <Plus size={13} /> Apply selects
                        </button>,
                        <button key="dismiss" type="button" className="text-btn" onClick={() => setAiResult(null)}>Dismiss</button>,
                      ]
                    : [
                        <button key="apply" type="button" className="secondary-btn" onClick={() => { const n = applySpineFromAnswer(aiResult.body); setAiResult({ ...aiResult, title: n > 0 ? `Spine — ${n} beats placed` : aiResult.title }); }}>
                          <Plus size={13} /> Place beats
                        </button>,
                        <button key="dismiss" type="button" className="text-btn" onClick={() => setAiResult(null)}>Dismiss</button>,
                      ]
                }
              >
                {aiResult.body}
              </AiResult>
            )}

            <RoleOracle
              leg="SELECTS"
              roleName="Story Architect"
              context={oracleContext}
              quickActions={quickActions}
              disabled={!canEdit}
              placeholder="e.g. Which three transcript lines should open the video?"
            />

            <div className="paper-card accent-card">
              <div className="inline-heading">
                <span className="eyebrow"><Save size={13} /> Save this pass</span>
              </div>
              <p className="setting-copy">
                Every save creates a Git-style snapshot — roll back to any past version, the Captain can always see what changed.
              </p>
              {canEdit ? (
                <div className="mt-3 flex gap-2">
                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="What changed in this pass? (optional)"
                    maxLength={500}
                    data-testid="input-save-message"
                  />
                  <button type="button" onClick={onSave} disabled={save.isPending || !dirty} className="primary-btn" data-testid="button-save-snapshot">
                    <Save size={13} />
                    {save.isPending ? 'Saving…' : 'Save snapshot'}
                  </button>
                </div>
              ) : (
                <p className="setting-copy mt-3">You&apos;re viewing this leg — only the Story Architect or the Captain can edit it.</p>
              )}
              {dirty && <p className="den-footnote mt-2"><Sparkles size={12} /> Unsaved changes</p>}
              {save.isError && (
                <p className="setting-copy mt-2" role="alert">
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

            <CheckoutPanel
              projectId={p.id}
              projectName={p.name}
              leg={leg}
              savedVersion={timeline.data?.version ?? null}
            />

            <ImportFlow projectId={p.id} leg={leg} canEdit={canEdit} />

            {legStatus && (
              <p className="den-footnote">
                <Sparkles size={13} />
                Leg status: {legStatus.status.toLowerCase()}
                {legStatus.decidedAt && ` · decided ${new Date(legStatus.decidedAt).toLocaleDateString()}`}
              </p>
            )}
          </div>
        </div>
      )}

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Every frame stays locked. Proxies are streamed, transcripts are searchable, and the originals never leave the vault.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTimecodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = (Number(m[1]) * 60 + Number(m[2])) * 1000;
    const end = (Number(m[3]) * 60 + Number(m[4])) * 1000;
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}

function snapshotSceneBlocksWith(snapshot: WorkingSnapshot, placements: Array<{ type: (typeof SCENE_TYPES)[number]; startMs: number }>): SceneBlock[] {
  const next = snapshot.sceneBlocks.map((b) => ({ ...b }));
  for (const placement of placements) {
    const index = next.findIndex((b) => b.type === placement.type);
    if (index >= 0) {
      next[index] = { ...next[index], startMs: placement.startMs, endMs: placement.startMs };
    } else {
      next.push({ id: crypto.randomUUID(), type: placement.type, startMs: placement.startMs, endMs: placement.startMs });
    }
  }
  return next;
}
