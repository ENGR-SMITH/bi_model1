import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Compass,
  GitCompareArrows,
  LockKeyhole,
  MessageSquare,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
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
  oracleChat,
} from '@workspace/api-client-react';
import type {
  VideoAssetDetail,
  VideoTranscriptSegment,
  VideoTimelineVersionSummary,
} from '@workspace/api-client-react';
import { SectionEyebrow, ColumnSection, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { Timeline, formatTimecode, activeBlockId, type TimelineBlock } from '@/components/timeline';
import { RoleOracle, AiResult, type StudioLeg } from '@/components/role-oracle';
import { AssetPlayer, EmptyPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { CheckoutPanel, ImportFlow } from '@/components/checkout-import';
import { ActivityFeed } from '@/components/activity-feed';
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

interface SelectsSnapshot {
  clips: Clip[];
  sceneBlocks: SceneBlock[];
  markers: Array<{ id: string; label: string; timeMs: number }>;
}

const EMPTY_SNAPSHOT: SelectsSnapshot = { clips: [], sceneBlocks: [], markers: [] };

function parseSnapshot(raw: unknown): SelectsSnapshot {
  const snapshot = raw as Partial<SelectsSnapshot> | null | undefined;
  return {
    clips: Array.isArray(snapshot?.clips) ? snapshot.clips : [],
    sceneBlocks: Array.isArray(snapshot?.sceneBlocks) ? snapshot.sceneBlocks : [],
    markers: Array.isArray(snapshot?.markers) ? snapshot.markers : [],
  };
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
                <small>{formatTimecode(section.startMs)}</small>
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
// Transcript — search + jump to timecode + pin a note (read-only review)
// ---------------------------------------------------------------------------

function TranscriptPanel({
  asset,
  onSeek,
  onNote,
}: {
  asset: VideoAssetDetail | undefined;
  onSeek: (ms: number) => void;
  onNote: (segment: VideoTranscriptSegment) => void;
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
                        onClick={(event) => { event.stopPropagation(); onNote(segment); }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onNote(segment); } }}
                        className="link-btn !text-[10px]"
                        title="Pin a note at this timecode"
                      >
                        <MessageSquare size={11} /> note here
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
// Read-only selects review — the diffable artifact, scrubbed but not edited.
// ---------------------------------------------------------------------------

function SelectsReview({
  snapshot,
  durationMs,
  playheadMs,
  onScrub,
}: {
  snapshot: SelectsSnapshot;
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

  return (
    <div className="space-y-4">
      <Timeline
        title={`Selects — ${snapshot.clips.length} marked`}
        hint="Scrub the ruler to review · selects are edited in an external NLE and imported back"
        blocks={clipBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={false}
        scrubOnly
        onScrub={onScrub}
        activeId={activeBlockId(clipBlocks, playheadMs)}
      />
      <Timeline
        title="Scene blocks · the narrative spine"
        hint="Hook → Setup → Core → Payoff → CTA"
        blocks={sceneBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={false}
        scrubOnly
        onScrub={onScrub}
        activeId={activeBlockId(sceneBlocks, playheadMs)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version history + submit (shared across every stage page)
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
        <p className="setting-copy">No versions yet — import an edited pass to create the first one.</p>
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
// Comments (shared across every stage page)
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

const LEG = 'SELECTS' as const;

export default function ContentCreatorsStudioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useUser();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Live: comments, submissions, and timeline saves stream in per leg.
  useProjectRealtime(projectId, LEG);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  // One-click advisory AI results (suggestions only — nothing edits in-browser).
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const asset = useGetVideoAsset(projectId, assetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId ?? ''),
      enabled: Boolean(assetId),
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });
  const timeline = useGetVideoTimeline(projectId, LEG);
  const submissions = useListVideoSubmissions(projectId);
  const comments = useListVideoComments(projectId);

  const snapshot = useMemo(() => parseSnapshot(timeline.data?.snapshot), [timeline.data?.snapshot]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canPush = role === 'CAPTAIN' || role === LEG_ROLES[LEG];

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

  // Scrub from the timeline ruler without auto-playing.
  const onScrub = (ms: number) => {
    setPlayheadMs(ms);
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  };

  const onNoteFromTranscript = (segment: VideoTranscriptSegment) => {
    setPlayheadMs(segment.startMs);
    if (videoRef.current) videoRef.current.currentTime = segment.startMs / 1000;
  };

  // Scope on-frame annotations to the leg's current head version.
  const headVersionId = timeline.data?.versions.find((v) => v.version === timeline.data?.version)?.id ?? null;

  // Build the AI context: transcript + current selects + scene blocks.
  const oracleContext = useMemo(() => {
    const lines = (asset.data?.transcript?.segments ?? [])
      .map((s) => `${formatTimecode(s.startMs)}–${formatTimecode(s.endMs)}: ${s.text}`)
      .join('\n');
    const selects = snapshot.clips.map((c, i) => `#${i + 1} ${formatTimecode(c.inMs)}–${formatTimecode(c.outMs)}`).join(', ') || 'none yet';
    const spine = snapshot.sceneBlocks.map((b) => `${b.type}@${formatTimecode(b.startMs)}`).join(', ') || 'none yet';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Asset: ${asset.data?.fileName ?? 'unknown'} (duration ${formatTimecode(assetDuration)})`,
      `Transcript:\n${lines.slice(0, 6000) || '(no transcript yet)'}`,
      `Current selects: ${selects}`,
      `Scene blocks: ${spine}`,
    ].join('\n\n').slice(0, 12000);
  }, [asset.data, snapshot, project.data?.name, assetDuration]);

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
      id: 'suggest-selects',
      label: 'Suggest selects from transcript',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion(
          'Mark the strongest moments as selects. Answer ONLY with lines of the form "start–end | reason", one per line, using MM:SS timecodes from the transcript.',
        ).then((body) => {
          if (body) setAiResult({ title: 'Selects suggestions', body, meta: null });
        });
      },
    },
    {
      id: 'suggest-spine',
      label: 'Suggest the 5-beat spine',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion(
          'Suggest the narrative spine on this footage. Answer ONLY with lines of the form "TYPE @ MM:SS" for HOOK, SETUP, CORE, PAYOFF, CTA using timecodes from the transcript.',
        ).then((body) => {
          if (body) setAiResult({ title: 'Spine suggestions', body, meta: null });
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
          <span>Review the selects and the narrative spine (Hook → Setup → Core → Payoff → CTA), pin feedback, and hand the cut off to the external NLE.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Story Architect · selects</SectionEyebrow>
          <h1>The selects studio.</h1>
          <p>Search the transcript, review the marked takes and spine, comment frame-by-frame — then checkout for Premiere/Resolve and import the result back.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-studio-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canPush ? 'teal' : 'muted'}`}>{canPush ? 'Can push & submit' : 'Read-only review'}</span>
        </div>
      </div>

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
          const Icon = item.icon;
          const active = item.leg === LEG;
          const status = submissions.data?.find((s) => s.leg === item.leg);
          const href =
            item.leg === 'SELECTS'
              ? `/projects/${p.id}/selects`
              : item.leg === 'CUT'
                ? `/projects/${p.id}/cut`
                : item.leg === 'SOUND'
                  ? `/projects/${p.id}/sound`
                  : item.leg === 'FINISH'
                    ? `/projects/${p.id}/finish`
                    : `/projects/${p.id}/thumbnail`;
          return (
            <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`tab-leg-${item.leg}`}>
              <Icon size={13} />
              {item.role}
              {status && <span className={`leg-badge ${status.status === 'APPROVED' ? 'text-[#286254]' : status.status === 'REJECTED' ? 'text-[#a33d31]' : ''}`}>{status.status}</span>}
            </Link>
          );
        })}
      </div>

      <div className="den-two-col">
        <div className="space-y-4">
          <ColumnSection
            eyebrow="Review"
            title="Watch & annotate"
            hint="The proxy streams read-only. Scrub, jump the transcript, and drop frame or timecode pins — editing happens in the external NLE."
          />

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
                markers={(comments.data ?? [])
                  .filter((comment) => comment.timecodeMs !== null && comment.assetId === assetId)
                  .map((comment) => ({
                    id: comment.id,
                    ms: comment.timecodeMs as number,
                    tone: comment.kind === 'MARK' ? ('gold' as const) : ('accent' as const),
                    label: comment.label ?? undefined,
                  }))}
                title={asset.data?.fileName}
              >
                <AnnotationCanvas
                  projectId={p.id}
                  leg={LEG}
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

          <SelectsReview snapshot={snapshot} durationMs={assetDuration} playheadMs={playheadMs} onScrub={onScrub} />
          <ReferenceGuide projectId={p.id} assets={p.assets} onSeek={onSeek} />
          <TranscriptPanel asset={asset.data} onSeek={onSeek} onNote={onNoteFromTranscript} />
          <CommentsPanel projectId={p.id} />
        </div>

        <div className="space-y-4">
          <ColumnSection
            eyebrow="Version control"
            title="Checkout, import & review"
            hint="The timeline is the diffable artifact. Checkout to edit externally, import the result as a new version, then submit it for review."
          />

          <CheckoutPanel
            projectId={p.id}
            projectName={p.name}
            leg={LEG}
            savedVersion={timeline.data?.version ?? null}
          />

          <ImportFlow projectId={p.id} leg={LEG} canEdit={canPush} />

          <HistoryPanel
            projectId={p.id}
            leg={LEG}
            versions={timeline.data?.versions ?? []}
            currentVersion={timeline.data?.version ?? null}
            canSubmit={canPush}
          />

          <RoleOracle
            leg={LEG}
            roleName="Story Architect"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canPush}
            placeholder="e.g. Which three transcript lines should open the video?"
          />

          {aiResult && (
            <AiResult
              title={aiResult.title}
              meta={aiResult.meta}
              actions={[
                <button key="dismiss" type="button" className="text-btn" onClick={() => setAiResult(null)}>Dismiss</button>,
              ]}
            >
              {aiResult.body}
            </AiResult>
          )}

          <ActivityFeed projectId={p.id} leg={LEG} className="" />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Every frame stays locked. Proxies are streamed, transcripts are searchable, and the originals never leave the vault.
      </p>
    </div>
  );
}
