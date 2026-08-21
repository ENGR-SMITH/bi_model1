import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Film,
  LockKeyhole,
  Play,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoSubmissions,
  oracleChat,
} from '@workspace/api-client-react';
import { SectionEyebrow, ColumnSection, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from './selects';
import { ActivityFeed } from '@/components/activity-feed';
import { Timeline, formatTimecode, activeBlockId, type TimelineBlock } from '@/components/timeline';
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
  srcInMs?: number;
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

function parseSnapshot(raw: unknown): CutSnapshot {
  const snapshot = raw as Partial<CutSnapshot> | null | undefined;
  return {
    clips: Array.isArray(snapshot?.clips) ? snapshot.clips : [],
    overlays: Array.isArray(snapshot?.overlays) ? snapshot.overlays : [],
    sceneBlocks: Array.isArray(snapshot?.sceneBlocks) ? snapshot.sceneBlocks : [],
    markers: Array.isArray(snapshot?.markers) ? snapshot.markers : [],
  };
}

// ---------------------------------------------------------------------------
// Player + beat markers (read-only review rail)
// ---------------------------------------------------------------------------

function PlayerRail({
  projectId,
  assets,
  beats,
  playheadMs,
  onSeek,
  headVersionId,
}: {
  projectId: string;
  assets: Array<{ id: string; fileName: string }>;
  beats: CutSnapshot['sceneBlocks'];
  playheadMs: number;
  onSeek: (ms: number) => void;
  /** Scope on-frame pins to the CUT leg's head snapshot. */
  headVersionId?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [assetId, setAssetId] = useState<string | null>(assets[0]?.id ?? null);
  const asset = useGetVideoAsset(projectId, assetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId ?? ''),
      enabled: Boolean(assetId),
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

  return (
    <div className="space-y-4">
      <div className="paper-card">
        <div className="inline-heading">
          <span className="eyebrow">Proxy player</span>
          {assets.length > 1 && (
            <select value={assetId ?? ''} onChange={(event) => setAssetId(event.target.value || null)} className="!w-auto !text-xs" data-testid="cut-select-player-asset">
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.fileName}</option>
              ))}
            </select>
          )}
        </div>

        {assetId ? (
          <AssetPlayer
            className="mt-3"
            projectId={projectId}
            assetId={assetId}
            detail={asset.data}
            videoRef={videoRef}
            playheadMs={playheadMs}
            onTimeUpdate={onSeek}
            title={asset.data?.fileName}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg="CUT"
              assetId={assetId}
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

        <p className="den-footnote mt-3">
          <LockKeyhole size={13} />
          Streaming the degraded proxy — the locked original never leaves the server.
        </p>
      </div>

      <div className="paper-card">
        <div className="inline-heading">
          <span className="eyebrow"><Film size={13} /> Beat markers · from the selects pass</span>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only cut review — main track + overlay layer, scrubbed but not edited.
// ---------------------------------------------------------------------------

function CutReview({
  snapshot,
  assets,
  durationMs,
  playheadMs,
  onScrub,
}: {
  snapshot: CutSnapshot;
  assets: Array<{ id: string; fileName: string }>;
  durationMs: number;
  playheadMs: number;
  onScrub: (ms: number) => void;
}) {
  const clipBlocks: TimelineBlock[] = snapshot.clips.map((clip, index) => {
    const asset = assets.find((a) => a.id === clip.assetId);
    return {
      id: clip.id,
      label: `${index + 1} · ${asset?.fileName ?? clip.assetId}`,
      sublabel: `${formatTimecode(clip.inMs)} → ${formatTimecode(clip.outMs)}`,
      startMs: clip.inMs,
      endMs: clip.outMs,
      tone: 'accent' as const,
    };
  });

  const overlayBlocks: TimelineBlock[] = snapshot.overlays.map((overlay) => ({
    id: overlay.id,
    label: assets.find((a) => a.id === overlay.assetId)?.fileName ?? overlay.assetId,
    sublabel: 'overlay',
    startMs: overlay.inMs,
    endMs: overlay.outMs,
    tone: 'teal' as const,
  }));

  return (
    <div className="space-y-4">
      <Timeline
        title={`Main track — ${snapshot.clips.length} clips`}
        hint="Scrub the ruler to review · the cut is edited in an external NLE and imported back"
        blocks={clipBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={false}
        scrubOnly
        onScrub={onScrub}
        activeId={activeBlockId(clipBlocks, playheadMs)}
      />
      <Timeline
        title={`Overlay layer — ${snapshot.overlays.length} layered`}
        hint="B-roll & screens, read-only"
        blocks={overlayBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={false}
        scrubOnly
        onScrub={onScrub}
        activeId={activeBlockId(overlayBlocks, playheadMs)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const LEG = 'CUT' as const;

export default function ContentCreatorsCutPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useUser();

  // Live: comments, submissions, and timeline saves stream in per leg.
  useProjectRealtime(projectId, LEG);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const cutTimeline = useGetVideoTimeline(projectId, LEG);
  const selectsTimeline = useGetVideoTimeline(projectId, 'SELECTS');
  const submissions = useListVideoSubmissions(projectId);

  const snapshot = useMemo(() => parseSnapshot(cutTimeline.data?.snapshot), [cutTimeline.data?.snapshot]);

  // Beat markers: pull the Architect's scene blocks into the cut.
  const beats = useMemo(() => {
    const snap = parseSnapshot(selectsTimeline.data?.snapshot);
    return snap.sceneBlocks;
  }, [selectsTimeline.data?.snapshot]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canPush = role === 'CAPTAIN' || role === 'VISUAL_EDITOR';

  const timelineDuration = Math.max(
    60_000,
    project.data?.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0) ?? 60_000,
  );

  const onScrub = (ms: number) => setPlayheadMs(ms);

  // AI context: current cut + beats.
  const oracleContext = useMemo(() => {
    const clips = snapshot.clips.map((c, i) => `clip ${i + 1}: ${formatTimecode(c.inMs)}–${formatTimecode(c.outMs)} (asset ${c.assetId.slice(0, 8)})`).join('\n') || 'none yet';
    const overlays = snapshot.overlays.map((o) => `overlay ${o.assetId.slice(0, 8)} @ ${formatTimecode(o.inMs)}–${formatTimecode(o.outMs)}`).join('\n') || 'none yet';
    const spine = beats.map((b) => `${b.type}@${formatTimecode(b.startMs)}`).join(', ') || 'none yet';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Timeline duration: ${formatTimecode(timelineDuration)}`,
      `Beats (from selects): ${spine}`,
      `Main track:\n${clips}`,
      `Overlay layer:\n${overlays}`,
    ].join('\n\n').slice(0, 12000);
  }, [snapshot, beats, project.data?.name, timelineDuration]);

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
    {
      id: 'suggest-trims',
      label: 'Suggest trims',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Suggest tighter trims. Answer ONLY with lines of the form "clip N: in MM:SS out MM:SS", one per clip you would change, using the clip numbers above.').then((body) => {
          if (body) setAiResult({ title: 'Trim suggestions', body, meta: null });
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

  return (
    <div className="page">
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>CONTENT CREATORS · THE CUTTING ROOM</b>
          <span>Review the cut, pin feedback frame-by-frame, and hand it off to Premiere/Resolve — then import the picture-locked edit back as a new version.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Visual Editor · precision cutting</SectionEyebrow>
          <h1>Precision cutting.</h1>
          <p>Watch the cut, review the timeline, and comment on exact moments. Edits happen in your NLE and come back through the import bridge.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-cut-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canPush ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canPush ? 'Can push & submit' : 'Read-only review'}
          </span>
        </div>
      </div>

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
          const Icon = item.icon;
          const active = item.leg === LEG;
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
            <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`cut-tab-leg-${item.leg}`}>
              <Icon size={13} />
              {item.role}
            </Link>
          );
        })}
      </div>

      <div className="den-two-col">
        <div className="space-y-4">
          <ColumnSection
            eyebrow="Review"
            title="Watch & annotate"
            hint="The proxy streams read-only. Scrub the cut and drop frame or timecode pins — the edit itself happens in the external NLE."
          />

          <PlayerRail
            projectId={p.id}
            assets={p.assets}
            beats={beats}
            playheadMs={playheadMs}
            onSeek={onScrub}
            headVersionId={cutTimeline.data?.versions.find((v) => v.version === cutTimeline.data?.version)?.id ?? null}
          />

          <CutReview
            snapshot={snapshot}
            assets={p.assets}
            durationMs={timelineDuration}
            playheadMs={playheadMs}
            onScrub={onScrub}
          />

          <CommentsPanel projectId={p.id} leg="CUT" />
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
            leg="CUT"
            savedVersion={cutTimeline.data?.version ?? null}
          />

          <ImportFlow projectId={p.id} leg="CUT" canEdit={canPush} />

          <HistoryPanel
            projectId={p.id}
            leg="CUT"
            versions={cutTimeline.data?.versions ?? []}
            currentVersion={cutTimeline.data?.version ?? null}
            canSubmit={canPush}
          />

          <RoleOracle
            leg="CUT"
            roleName="Visual Editor"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canPush}
            placeholder="e.g. Where should I switch cameras in the first minute?"
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

          <ActivityFeed projectId={p.id} leg="CUT" className="" />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Every frame stays locked. When you submit, the Captain reviews the imported picture-locked cut.
      </p>
    </div>
  );
}
