import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  Clapperboard,
  Film,
  Layers,
  Link2,
  LockKeyhole,
  Play,
  RefreshCw,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
  getListVideoJobsQueryKey,
  getListVideoSyncsQueryKey,
  oracleChat,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoJobs,
  useListVideoSyncs,
  useRenderVideoTimeline,
  useSyncVideoAsset,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from '@/components/review-shared';
import { ActivityFeed } from '@/components/activity-feed';
import { Timeline, formatTimecode, formatDuration, activeBlockId, type TimelineBlock } from '@/components/timeline';
import { RoleOracle, AiResult } from '@/components/role-oracle';
import { AssetPlayer, EmptyPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { CheckoutPanel, ImportFlow } from '@/components/checkout-import';

interface CutClip {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
  camera?: string | null;
  /** Source-window start (which part of the asset is shown). Defaults to inMs. */
  srcInMs?: number;
  /** Source-window end (which part of the asset is shown). Defaults to outMs. */
  srcOutMs?: number;
}

interface CutOverlay {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
}

interface CutSnapshot {
  clips: CutClip[];
  overlays: CutOverlay[];
  sceneBlocks: Array<{ id: string; type: string; startMs: number; endMs: number }>;
  markers: Array<{ id: string; label: string; timeMs: number }>;
}

const EMPTY_CUT: CutSnapshot = { clips: [], overlays: [], sceneBlocks: [], markers: [] };

function formatOffset(ms: number): string {
  if (ms === 0) return 'in sync';
  const label = ms > 0 ? 'leads by' : 'lags by';
  return `${label} ${Math.abs(ms) / 1000}s`;
}

// ---------------------------------------------------------------------------
// Cut preview — the read-only filmstrip. Scrub the assembled cut (main track +
// overlay layer) against the selects beats to review pacing and continuity.
// The edit itself happens in a desktop NLE and lands here via import as a new
// version — there is no in-browser trimming.
// ---------------------------------------------------------------------------

function CutPreview({
  projectId,
  snapshot,
  assets,
  syncs,
  beats,
  durationMs,
  playheadMs,
  onSeek,
  headVersionId,
}: {
  projectId: string;
  snapshot: CutSnapshot;
  assets: Array<{ id: string; fileName: string; kind: string; durationMs?: number | null }>;
  syncs: Array<{ primaryAssetId: string; targetAssetId: string; offsetMs: number }>;
  beats: CutSnapshot['sceneBlocks'];
  durationMs: number;
  playheadMs: number;
  onSeek: (ms: number) => void;
  /** Scope on-frame pins to the CUT leg's head snapshot. */
  headVersionId?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Order clips by timeline in-point so scrubbing moves left → right.
  const clips = useMemo(
    () => [...snapshot.clips].sort((a, b) => a.inMs - b.inMs || a.id.localeCompare(b.id)),
    [snapshot.clips],
  );
  const activeClip = useMemo(
    () => clips.find((c) => playheadMs >= c.inMs && playheadMs < Math.max(c.inMs + 1, c.outMs)) ?? null,
    [clips, playheadMs],
  );

  // Manual picker for the no-clips case; once clips exist the scrubber drives it.
  const [fallbackAssetId, setFallbackAssetId] = useState<string | null>(assets[0]?.id ?? null);
  useEffect(() => {
    if (!fallbackAssetId && assets.length > 0) setFallbackAssetId(assets[0].id);
  }, [assets, fallbackAssetId]);

  const previewAssetId = activeClip?.assetId ?? clips[0]?.assetId ?? fallbackAssetId ?? assets[0]?.id ?? null;
  const detail = useGetVideoAsset(projectId, previewAssetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, previewAssetId ?? ''),
      enabled: Boolean(previewAssetId),
      // Keep fetching until the proxy/transcript finish, then stop on its own.
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });

  const seek = (ms: number) => {
    onSeek(ms);
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      void videoRef.current.play().catch(() => {});
    }
  };

  const clipBlocks: TimelineBlock[] = clips.map((clip, index) => {
    const asset = assets.find((a) => a.id === clip.assetId);
    const sync = syncs.find((s) => s.primaryAssetId === clip.assetId || s.targetAssetId === clip.assetId);
    return {
      id: clip.id,
      label: `${index + 1} · ${asset?.fileName ?? clip.assetId}`,
      sublabel: sync ? formatOffset(sync.offsetMs) : formatDuration(clip.outMs - clip.inMs),
      startMs: clip.inMs,
      endMs: Math.max(clip.outMs, clip.inMs + 500),
      tone: 'accent',
    };
  });

  const overlayBlocks: TimelineBlock[] = snapshot.overlays.map((overlay) => ({
    id: overlay.id,
    label: assets.find((a) => a.id === overlay.assetId)?.fileName ?? overlay.assetId,
    sublabel: 'overlay',
    startMs: overlay.inMs,
    endMs: Math.max(overlay.outMs, overlay.inMs + 500),
    tone: 'teal',
  }));

  return (
    <>
      <div className="paper-card" data-testid="panel-cut-preview">
        <div className="inline-heading">
          <span className="eyebrow"><Film size={13} /> Cut preview</span>
          <span className="mono-label">{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
          {clips.length === 0 && assets.length > 1 && (
            <select value={fallbackAssetId ?? ''} onChange={(event) => setFallbackAssetId(event.target.value || null)} className="!w-auto !text-xs" data-testid="cut-select-player-asset">
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.fileName}</option>
              ))}
            </select>
          )}
        </div>

        {previewAssetId ? (
          <AssetPlayer
            className="mt-3"
            projectId={projectId}
            assetId={previewAssetId}
            detail={detail.data}
            videoRef={videoRef}
            playheadMs={playheadMs}
            onTimeUpdate={onSeek}
            title={detail.data?.fileName}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg="CUT"
              assetId={previewAssetId}
              playheadMs={playheadMs}
              onSeek={seek}
              timelineVersionId={headVersionId}
            />
          </AssetPlayer>
        ) : (
          <EmptyPlayer className="mt-3">
            <p className="text-sm font-semibold">No footage in the vault yet.</p>
          </EmptyPlayer>
        )}

        {(clipBlocks.length > 0 || overlayBlocks.length > 0) && (
          <div className="cd-sequence mt-4" data-testid="cut-sequence">
            {clipBlocks.length > 0 && (
              <Timeline
                title={`Main track — ${clips.length} clips`}
                hint="Click or drag the ruler to scrub the assembled cut"
                blocks={clipBlocks}
                durationMs={durationMs}
                playheadMs={playheadMs}
                canEdit={false}
                scrubOnly
                onScrub={onSeek}
                activeId={activeClip?.id ?? activeBlockId(clipBlocks, playheadMs)}
              />
            )}
            {overlayBlocks.length > 0 && (
              <Timeline
                title="Overlay layer — b-roll & screens"
                hint="Read-only · scrub to see where overlays land"
                blocks={overlayBlocks}
                durationMs={durationMs}
                playheadMs={playheadMs}
                canEdit={false}
                scrubOnly
                onScrub={onSeek}
                activeId={activeBlockId(overlayBlocks, playheadMs)}
              />
            )}
          </div>
        )}

        <p className="den-footnote mt-3">
          <LockKeyhole size={13} />
          Streaming the degraded proxy — the locked original never leaves the server.
        </p>
      </div>

      <div className="paper-card">
        <div className="inline-heading">
          <span className="eyebrow"><Layers size={13} /> Beat markers · from the selects pass</span>
        </div>
        {beats.length === 0 ? (
          <p className="setting-copy">No scene blocks yet — the Story Architect marks the spine in the selects studio.</p>
        ) : (
          <div className="den-chip-list mt-2">
            {beats.map((beat) => (
              <button key={beat.id} type="button" onClick={() => seek(beat.startMs)} className="den-chip" data-testid={`cut-beat-${beat.type}`}>
                <Play size={10} />
                {beat.type} · {formatTimecode(beat.startMs)}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sync panel — server-side multi-cam alignment job.
// ---------------------------------------------------------------------------

function SyncPanel({
  projectId,
  assets,
}: {
  projectId: string;
  assets: Array<{ id: string; fileName: string }>;
}) {
  const queryClient = useQueryClient();
  const syncs = useListVideoSyncs(projectId);
  const sync = useSyncVideoAsset();
  const [primary, setPrimary] = useState(assets[0]?.id ?? '');
  const [target, setTarget] = useState(assets[1]?.id ?? assets[0]?.id ?? '');

  const pair = syncs.data?.find((s) => s.primaryAssetId === primary && s.targetAssetId === target);

  const run = () => {
    if (!primary || !target || primary === target) return;
    sync.mutate(
      { projectId, assetId: primary, data: { targetAssetId: target } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoSyncsQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  const syncError = sync.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="paper-card accent-card">
      <div className="inline-heading">
        <span className="eyebrow"><Link2 size={13} /> Multi-cam sync</span>
      </div>
      <p className="setting-copy">
        Align two angles by waveform. The offset shows how the second camera sits against the first, so switches land on the same moment.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select value={primary} onChange={(event) => setPrimary(event.target.value)} data-testid="cut-select-sync-primary">
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.fileName}</option>
          ))}
        </select>
        <select value={target} onChange={(event) => setTarget(event.target.value)} data-testid="cut-select-sync-target">
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.fileName}</option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={sync.isPending || !primary || !target || primary === target} className="secondary-btn" data-testid="button-run-sync">
          <RefreshCw size={14} className={sync.isPending ? 'spin' : ''} />
          {sync.isPending ? 'Syncing…' : 'Sync cameras'}
        </button>
        {pair && (
          <span className="den-tag teal" data-testid="sync-offset">
            <Camera size={11} />
            {formatOffset(pair.offsetMs)} · {pair.method}
          </span>
        )}
      </div>
      {sync.isError && (
        <p className="setting-copy mt-2" role="alert">
          {syncError?.response?.data?.error || 'The sync could not be queued.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Render panel — server-side preview render job.
// ---------------------------------------------------------------------------

function RenderPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const jobs = useListVideoJobs(projectId);
  const render = useRenderVideoTimeline();

  const renders = useMemo(
    () => (jobs.data ?? []).filter((job) => job.type === 'RENDER' && job.params?.leg === 'CUT'),
    [jobs.data],
  );
  const latest = renders[0];

  const queuePreview = () => {
    render.mutate(
      { projectId, leg: 'CUT', data: { format: 'PREVIEW' } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  const renderError = render.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="paper-card accent-card">
      <div className="inline-heading">
        <span className="eyebrow"><Clapperboard size={13} /> Render preview</span>
      </div>
      <p className="setting-copy">
        Render the current cut so the Captain reviews the picture, not the JSON. Opening a pull request also queues a picture-lock render automatically.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canEdit && (
          <button type="button" onClick={queuePreview} disabled={render.isPending} className="primary-btn" data-testid="button-render-preview">
            <Clapperboard size={14} className={render.isPending ? 'animate-pulse' : ''} />
            {render.isPending ? 'Queuing…' : 'Render preview'}
          </button>
        )}
        {latest && (
          <span className={`den-tag ${latest.status === 'SUCCEEDED' ? 'teal' : latest.status === 'FAILED' ? 'danger' : 'gold'}`} data-testid="render-status">
            {latest.status.toLowerCase()} · {String(latest.params?.format ?? 'PREVIEW').replaceAll('_', ' ')}
            {latest.status === 'SUCCEEDED' && Boolean(latest.result?.demo) && ' · demo receipt'}
          </span>
        )}
      </div>
      {render.isError && (
        <p className="setting-copy mt-2" role="alert">
          {renderError?.response?.data?.error || 'The render could not be queued.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContentCreatorsCutPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useUser();

  // Live: render progress, sync results, comments, and submissions.
  useProjectRealtime(projectId, 'CUT');
  const [playheadMs, setPlayheadMs] = useState(0);
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const cutTimeline = useGetVideoTimeline(projectId, 'CUT');
  const selectsTimeline = useGetVideoTimeline(projectId, 'SELECTS');
  const syncs = useListVideoSyncs(projectId);

  // The CUT leg's head snapshot — read-only. New versions arrive via import
  // (push a cut from your NLE) and the review/approve merge, never in-browser.
  const headSnapshot = useMemo<CutSnapshot>(() => {
    const snapshot = cutTimeline.data?.snapshot as unknown as CutSnapshot | undefined;
    return {
      clips: Array.isArray(snapshot?.clips) ? snapshot!.clips : [],
      overlays: Array.isArray(snapshot?.overlays) ? snapshot!.overlays : [],
      sceneBlocks: Array.isArray(snapshot?.sceneBlocks) ? snapshot!.sceneBlocks : [],
      markers: Array.isArray(snapshot?.markers) ? snapshot!.markers : [],
    };
  }, [cutTimeline.data?.snapshot]);

  // Beat markers: pull the Architect's scene blocks into the cut.
  const beats = useMemo(() => {
    const snap = selectsTimeline.data?.snapshot as unknown as CutSnapshot | null;
    return snap && Array.isArray(snap.sceneBlocks) ? snap.sceneBlocks : [];
  }, [selectsTimeline.data?.snapshot]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === 'VISUAL_EDITOR';

  const timelineDuration = Math.max(
    60_000,
    project.data?.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0) ?? 60_000,
  );

  const onScrub = (ms: number) => setPlayheadMs(ms);

  // AI context: current cut + beats + sync offsets, all from the head snapshot.
  const oracleContext = useMemo(() => {
    const clips = headSnapshot.clips.map((c, i) => `clip ${i + 1}: ${formatTimecode(c.inMs)}–${formatTimecode(c.outMs)} (asset ${c.assetId.slice(0, 8)})`).join('\n') || 'none yet';
    const overlays = headSnapshot.overlays.map((o) => `overlay ${o.assetId.slice(0, 8)} @ ${formatTimecode(o.inMs)}–${formatTimecode(o.outMs)}`).join('\n') || 'none yet';
    const spine = beats.map((b) => `${b.type}@${formatTimecode(b.startMs)}`).join(', ') || 'none yet';
    const sync = syncs.data?.map((s) => `${s.primaryAssetId.slice(0, 8)} vs ${s.targetAssetId.slice(0, 8)}: ${formatOffset(s.offsetMs)}`).join('\n') || 'none yet';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Timeline duration: ${formatTimecode(timelineDuration)}`,
      `Beats (from selects): ${spine}`,
      `Main track:\n${clips}`,
      `Overlay layer:\n${overlays}`,
      `Sync pairs:\n${sync}`,
    ].join('\n\n').slice(0, 12000);
  }, [headSnapshot, beats, syncs.data, project.data?.name, timelineDuration]);

  const runOracleSuggestion = async (instruction: string): Promise<string | null> => {
    setAiBusy(true);
    try {
      const result = await oracleChat({ messages: [{ role: 'system', content: 'You are the Visual Editor\'s assistant in a video relay. Be concise and concrete.' }, { role: 'user', content: `${instruction}\n\nContext:\n${oracleContext}` }] });
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
      id: 'review-cut',
      label: 'Review the cut',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Review the current cut for pacing, rhythm, and continuity. Give concrete notes with timecodes. Be concise.').then((body) => {
          if (body) setAiResult({ title: 'Cut review', body, meta: null });
        });
      },
    },
  ];

  if (project.isLoading) {
    return <div className="page"><div className="panel-empty">Opening the cutting room…</div></div>;
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>CUTTING ROOM CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;
  const headVersionId = cutTimeline.data?.versions.find((v) => v.version === cutTimeline.data?.version)?.id ?? null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <SectionEyebrow>Visual Editor · precision cutting</SectionEyebrow>
          <h1>Precision cutting.</h1>
          <p>Scrub the assembled cut against the beats, sync multi-cam angles, and render a preview for review. Editing happens in your desktop NLE — check out, cut, and push it back as a version.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-cut-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canEdit ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canEdit ? 'Visual Editor' : 'Viewing'}
          </span>
        </div>
      </div>

      <div className="cd-watch">
        <div className="cd-watch-main">
          <CutPreview
            projectId={p.id}
            snapshot={headSnapshot}
            assets={p.assets}
            syncs={syncs.data ?? []}
            beats={beats}
            durationMs={timelineDuration}
            playheadMs={playheadMs}
            onSeek={onScrub}
            headVersionId={headVersionId}
          />
          <CommentsPanel projectId={p.id} leg="CUT" />
        </div>

        <div className="cd-watch-rail">
          <SyncPanel projectId={p.id} assets={p.assets} />

          <RenderPanel projectId={p.id} canEdit={canEdit} />

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
            leg="CUT"
            roleName="Visual Editor"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canEdit}
            placeholder="e.g. Where should I switch cameras in the first minute?"
          />

          <HistoryPanel
            projectId={p.id}
            leg="CUT"
            versions={cutTimeline.data?.versions ?? []}
            currentVersion={cutTimeline.data?.version ?? null}
            canSubmit={canEdit}
          />

          <CheckoutPanel
            projectId={p.id}
            projectName={p.name}
            leg="CUT"
            savedVersion={cutTimeline.data?.version ?? null}
          />

          <ImportFlow projectId={p.id} leg="CUT" canEdit={canEdit} />

          <ActivityFeed projectId={p.id} leg="CUT" className="" />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Every frame stays locked. Opening a pull request queues a picture-lock render, and the Captain reviews the rendered cut.
      </p>
    </div>
  );
}
