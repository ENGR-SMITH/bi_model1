import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Compass,
  Film,
  LockKeyhole,
  MessageSquare,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
  getGetVideoReferenceQueryKey,
  useAnalyzeVideoReference,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoReference,
  useGetVideoTimeline,
  useListVideoComments,
  useListVideoSubmissions,
  oracleChat,
} from '@workspace/api-client-react';
import type {
  VideoAssetDetail,
  VideoTranscriptSegment,
} from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { Timeline, formatTimecode, activeBlockId, type TimelineBlock } from '@/components/timeline';
import { RoleOracle, AiResult } from '@/components/role-oracle';
import { AssetPlayer, EmptyPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { CheckoutPanel, ImportFlow } from '@/components/checkout-import';
import { ActivityFeed } from '@/components/activity-feed';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { CommentsPanel, HistoryPanel } from '@/components/review-shared';

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

// ---------------------------------------------------------------------------
// Reference guide — viral reference pacing, analyzed server-side and shown as
// clickable beats. A review aid, not an editor.
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
// Transcript — searchable, seekable, and commentable. Read-only for the edit
// itself: there is no "mark select" here (selects are marked in the NLE and
// imported), but reviewers can pin timecode notes.
// ---------------------------------------------------------------------------

function TranscriptPanel({
  asset,
  onSeek,
  onComment,
}: {
  asset: VideoAssetDetail | undefined;
  onSeek: (ms: number) => void;
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
                        onClick={(event) => { event.stopPropagation(); onComment(segment); }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onComment(segment); } }}
                        className="link-btn !text-[10px]"
                        title="Jump here and pin a note"
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
// Selects view — read-only filmstrip of the marked selects and the narrative
// spine (Hook → Setup → Core → Payoff → CTA). Scrub to review the paper edit.
// Marking happens in the NLE and lands here via import as a new version.
// ---------------------------------------------------------------------------

function SelectsView({
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
    endMs: Math.max(clip.outMs, clip.inMs + 500),
    tone: 'accent',
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
    <div className="paper-card" data-testid="panel-selects-view">
      <div className="inline-heading">
        <span className="eyebrow"><Film size={13} /> Selects & spine · from the head version</span>
        <span className="mono-label">{clipBlocks.length} marked</span>
      </div>
      {clipBlocks.length > 0 ? (
        <div className="mt-3">
          <Timeline
            title={`Selects — ${clipBlocks.length} marked`}
            hint="Read-only · click or drag the ruler to scrub"
            blocks={clipBlocks}
            durationMs={durationMs}
            playheadMs={playheadMs}
            canEdit={false}
            scrubOnly
            onScrub={onScrub}
            activeId={activeBlockId(clipBlocks, playheadMs)}
          />
        </div>
      ) : (
        <p className="setting-copy mt-2">No selects marked yet — mark them in your editor and import the pass as a version.</p>
      )}

      {sceneBlocks.length > 0 && (
        <div className="mt-3">
          <Timeline
            title="Narrative spine — Hook → Setup → Core → Payoff → CTA"
            hint="Read-only · the spine that drives the cut"
            blocks={sceneBlocks}
            durationMs={durationMs}
            playheadMs={playheadMs}
            canEdit={false}
            scrubOnly
            onScrub={onScrub}
            activeId={activeBlockId(sceneBlocks, playheadMs)}
          />
        </div>
      )}

      <p className="den-footnote mt-3">
        <LockKeyhole size={13} />
        The paper edit is built in your NLE — push it here as a version to compare, review, and approve.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContentCreatorsStudioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useUser();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Live: comments, submissions, and timeline versions stream in for SELECTS.
  useProjectRealtime(projectId, 'SELECTS');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
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
  const timeline = useGetVideoTimeline(projectId, 'SELECTS');
  const submissions = useListVideoSubmissions(projectId);
  const comments = useListVideoComments(projectId);

  // The SELECTS leg's head snapshot — read-only. New versions arrive via
  // import (push a paper edit from your NLE) and the review/approve merge.
  const headSnapshot = useMemo<SelectsSnapshot>(() => {
    const snapshot = timeline.data?.snapshot as unknown as SelectsSnapshot | undefined;
    return {
      clips: Array.isArray(snapshot?.clips) ? snapshot!.clips : EMPTY_SNAPSHOT.clips,
      sceneBlocks: Array.isArray(snapshot?.sceneBlocks) ? snapshot!.sceneBlocks : EMPTY_SNAPSHOT.sceneBlocks,
      markers: Array.isArray(snapshot?.markers) ? snapshot!.markers : EMPTY_SNAPSHOT.markers,
    };
  }, [timeline.data?.snapshot]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === 'ARCHITECT';

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

  const onCommentFromTranscript = (segment: VideoTranscriptSegment) => {
    setPlayheadMs(segment.startMs);
    if (videoRef.current) videoRef.current.currentTime = segment.startMs / 1000;
  };

  const legStatus = submissions.data?.find((s) => s.leg === 'SELECTS');
  // Scope on-frame annotations to the leg's current head version.
  const headVersionId = timeline.data?.versions.find((v) => v.version === timeline.data?.version)?.id ?? null;

  // AI context: transcript + the head selects + scene spine.
  const oracleContext = useMemo(() => {
    const lines = (asset.data?.transcript?.segments ?? [])
      .map((s) => `${formatTimecode(s.startMs)}–${formatTimecode(s.endMs)}: ${s.text}`)
      .join('\n');
    const selects = headSnapshot.clips.map((c, i) => `#${i + 1} ${formatTimecode(c.inMs)}–${formatTimecode(c.outMs)}`).join(', ') || 'none yet';
    const spine = headSnapshot.sceneBlocks.map((b) => `${b.type}@${formatTimecode(b.startMs)}`).join(', ') || 'none yet';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Asset: ${asset.data?.fileName ?? 'unknown'} (duration ${formatTimecode(assetDuration)})`,
      `Transcript:\n${lines.slice(0, 6000) || '(no transcript yet)'}`,
      `Current selects: ${selects}`,
      `Scene blocks: ${spine}`,
    ].join('\n\n').slice(0, 12000);
  }, [asset.data, headSnapshot, project.data?.name, assetDuration]);

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
      id: 'review-selects',
      label: 'Review the selects',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Review the current selects and narrative spine against the transcript. Are the strongest moments marked? Is the Hook → Setup → Core → Payoff → CTA arc well placed? Give concrete notes with timecodes. Be concise.').then((body) => {
          if (body) setAiResult({ title: 'Selects review', body, meta: null });
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
          <span>Review the marked selects and the narrative spine — Hook → Setup → Core → Payoff → CTA — compare versions, and open a pull request. The paper edit happens in your NLE.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Story Architect · selects</SectionEyebrow>
          <h1>The selects studio.</h1>
          <p>Search the transcript, scrub the marked selects against a viral reference, and ask the oracle. Marking and spine-building happen in your editor — check out, mark, and push it back as a version.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-studio-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canEdit ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canEdit ? 'Story Architect' : 'Viewing'}
          </span>
        </div>
      </div>

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
          const Icon = item.icon;
          const active = item.leg === 'SELECTS';
          const href = `/projects/${p.id}/${item.slug}`;
          return (
            <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`tab-leg-${item.leg}`}>
              <Icon size={13} />
              {item.role}
            </Link>
          );
        })}
      </div>

      <div className="cd-watch">
        <div className="cd-watch-main">
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
                  leg="SELECTS"
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

          <SelectsView
            snapshot={headSnapshot}
            durationMs={assetDuration}
            playheadMs={playheadMs}
            onScrub={onScrub}
          />

          <ReferenceGuide projectId={p.id} assets={p.assets} onSeek={onSeek} />
          <TranscriptPanel asset={asset.data} onSeek={onSeek} onComment={onCommentFromTranscript} />
          <CommentsPanel projectId={p.id} leg="SELECTS" />
        </div>

        <div className="cd-watch-rail">
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

          <RoleOracle
            leg="SELECTS"
            roleName="Story Architect"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canEdit}
            placeholder="e.g. Which three transcript lines should open the video?"
          />

          <HistoryPanel
            projectId={p.id}
            leg="SELECTS"
            versions={timeline.data?.versions ?? []}
            currentVersion={timeline.data?.version ?? null}
            canSubmit={canEdit}
          />

          <CheckoutPanel
            projectId={p.id}
            projectName={p.name}
            leg="SELECTS"
            savedVersion={timeline.data?.version ?? null}
          />

          <ImportFlow projectId={p.id} leg="SELECTS" canEdit={canEdit} />

          <ActivityFeed projectId={p.id} leg="SELECTS" className="" />

          {legStatus && (
            <p className="den-footnote">
              <Sparkles size={13} />
              Stage status: {legStatus.status.toLowerCase()}
              {legStatus.decidedAt && ` · decided ${new Date(legStatus.decidedAt).toLocaleDateString()}`}
            </p>
          )}
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Every frame stays locked. Proxies are streamed, transcripts are searchable, and the originals never leave the vault.
      </p>
    </div>
  );
}
