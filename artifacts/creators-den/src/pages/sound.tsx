import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  LockKeyhole,
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
import { AssetPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { CheckoutPanel, ImportFlow } from '@/components/checkout-import';

interface MusicTrack {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
  duckUnderSpeech: boolean;
}

interface PickupVo {
  id: string;
  assetId: string;
  timeMs: number;
  note: string;
}

interface SoundSnapshot {
  clips: Array<{ id: string; assetId: string; inMs: number; outMs: number }>;
  music: MusicTrack[];
  pickups: PickupVo[];
  sceneBlocks: Array<{ id: string; type: string; startMs: number; endMs: number }>;
  markers: Array<{ id: string; label: string; timeMs: number }>;
}

const EMPTY_SOUND: SoundSnapshot = { clips: [], music: [], pickups: [], sceneBlocks: [], markers: [] };

function parseSnapshot(raw: unknown): SoundSnapshot {
  const snapshot = raw as Partial<SoundSnapshot> | null | undefined;
  return {
    clips: Array.isArray(snapshot?.clips) ? snapshot.clips : [],
    music: Array.isArray(snapshot?.music) ? snapshot.music : [],
    pickups: Array.isArray(snapshot?.pickups) ? snapshot.pickups : [],
    sceneBlocks: Array.isArray(snapshot?.sceneBlocks) ? snapshot.sceneBlocks : [],
    markers: Array.isArray(snapshot?.markers) ? snapshot.markers : [],
  };
}

// ---------------------------------------------------------------------------
// Monitor — a read-only proxy player so the Sound Designer can actually hear
// the footage while reviewing the mix. Audio kinds render as an <audio> bar.
// ---------------------------------------------------------------------------

function SoundMonitor({
  projectId,
  assets,
  playheadMs,
  onTimeUpdate,
  onSeek,
  headVersionId,
}: {
  projectId: string;
  assets: Array<{ id: string; fileName: string; kind: string }>;
  playheadMs: number;
  onTimeUpdate: (ms: number) => void;
  /** Seek on pin-click (drives the player via its playhead prop). */
  onSeek?: (ms: number) => void;
  /** Scope on-frame pins to the SOUND leg's head snapshot. */
  headVersionId?: string | null;
}) {
  const [assetId, setAssetId] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId && assets.length > 0) {
      const preferred =
        assets.find((a) => a.kind === 'RAW_AUDIO' || a.kind === 'VO_PICKUP') ?? assets[0];
      setAssetId(preferred.id);
    }
  }, [assets, assetId]);

  const detail = useGetVideoAsset(projectId, assetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId ?? ''),
      enabled: Boolean(assetId),
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });

  if (assets.length === 0) return null;
  const asset = assets.find((a) => a.id === assetId) ?? assets[0];
  const isAudio = asset.kind === 'RAW_AUDIO' || asset.kind === 'VO_PICKUP';

  return (
    <div className="paper-card" data-testid="panel-sound-monitor">
      <div className="inline-heading">
        <span className="eyebrow"><AudioLines size={13} /> Monitor</span>
        {assets.length > 1 && (
          <select
            value={assetId ?? ''}
            onChange={(event) => setAssetId(event.target.value || null)}
            className="!w-auto !text-xs"
            data-testid="sound-select-monitor-asset"
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.fileName}</option>
            ))}
          </select>
        )}
      </div>
      <p className="setting-copy">Hear the captured audio while you review — the music and pickup pins below follow this monitor.</p>
      <AssetPlayer
        className="mt-3"
        projectId={projectId}
        assetId={asset.id}
        detail={detail.data}
        audio={isAudio}
        playheadMs={playheadMs}
        onTimeUpdate={onTimeUpdate}
        title={asset.fileName}
      >
        <AnnotationCanvas
          projectId={projectId}
          leg="SOUND"
          assetId={asset.id}
          playheadMs={playheadMs}
          onSeek={onSeek}
          timelineVersionId={headVersionId}
        />
      </AssetPlayer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only sound review — music & pickup layers, scrubbed but not edited.
// ---------------------------------------------------------------------------

function SoundReview({
  snapshot,
  assets,
  durationMs,
  playheadMs,
  onScrub,
}: {
  snapshot: SoundSnapshot;
  assets: Array<{ id: string; fileName: string; kind: string }>;
  durationMs: number;
  playheadMs: number;
  onScrub: (ms: number) => void;
}) {
  const musicBlocks: TimelineBlock[] = snapshot.music.map((track) => ({
    id: track.id,
    label: assets.find((a) => a.id === track.assetId)?.fileName ?? track.assetId,
    sublabel: track.duckUnderSpeech ? 'duck under speech' : 'full mix',
    startMs: track.inMs,
    endMs: track.outMs,
    tone: 'gold' as const,
  }));

  const pickupBlocks: TimelineBlock[] = snapshot.pickups.map((pickup) => ({
    id: pickup.id,
    label: assets.find((a) => a.id === pickup.assetId)?.fileName ?? pickup.assetId,
    sublabel: 'pickup VO',
    startMs: Math.max(0, pickup.timeMs - 500),
    endMs: pickup.timeMs + 500,
    tone: 'danger' as const,
  }));

  return (
    <div className="space-y-4">
      <Timeline
        title={`Music & score — ${snapshot.music.length} tracks`}
        hint="Scrub to review · the mix is edited in an external DAW/NLE and imported back"
        blocks={musicBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={false}
        scrubOnly
        onScrub={onScrub}
        activeId={activeBlockId(musicBlocks, playheadMs)}
      />
      <Timeline
        title={`Pickup VO pins — ${snapshot.pickups.length}`}
        hint="Read-only"
        blocks={pickupBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={false}
        scrubOnly
        onScrub={onScrub}
        activeId={activeBlockId(pickupBlocks, playheadMs)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const LEG = 'SOUND' as const;

export default function ContentCreatorsSoundPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useUser();

  useProjectRealtime(projectId, LEG);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const soundTimeline = useGetVideoTimeline(projectId, LEG);
  const submissions = useListVideoSubmissions(projectId);

  const snapshot = useMemo(() => parseSnapshot(soundTimeline.data?.snapshot), [soundTimeline.data?.snapshot]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canPush = role === 'CAPTAIN' || role === 'SOUND_DESIGNER';

  const timelineDuration = Math.max(
    60_000,
    project.data?.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0) ?? 60_000,
  );

  const onScrub = (ms: number) => setPlayheadMs(ms);

  const oracleContext = useMemo(() => {
    const music = snapshot.music.map((t) => `${assetsName(t.assetId)} @ ${formatTimecode(t.inMs)}–${formatTimecode(t.outMs)}${t.duckUnderSpeech ? ' (duck)' : ''}`).join('\n') || 'none yet';
    const pickups = snapshot.pickups.map((p) => `${assetsName(p.assetId)} @ ${formatTimecode(p.timeMs)}`).join('\n') || 'none yet';
    const assetsList = (project.data?.assets ?? []).map((a) => `${a.fileName} (${a.kind}, ${a.durationMs ? formatTimecode(a.durationMs) : 'unknown'})`).join('\n') || 'none';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Timeline duration: ${formatTimecode(timelineDuration)}`,
      `Assets:\n${assetsList}`,
      `Music:\n${music}`,
      `Pickup VO pins:\n${pickups}`,
    ].join('\n\n').slice(0, 12000);
  }, [snapshot, project.data, timelineDuration]);

  function assetsName(assetId: string): string {
    return project.data?.assets.find((a) => a.id === assetId)?.fileName ?? assetId;
  }

  const runOracleSuggestion = async (instruction: string): Promise<string | null> => {
    setAiBusy(true);
    try {
      const result = await oracleChat({ messages: [{ role: 'system', content: 'You are the Sound Designer\'s assistant in a video relay. Be concise and concrete.' }, { role: 'user', content: `${instruction}\n\nContext:\n${oracleContext}` }] });
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
      id: 'review-mix',
      label: 'Review the mix',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Review the current mix: level balance, music placement, ducking, and pickup needs. Give concrete notes with timecodes. Be concise.').then((body) => {
          if (body) setAiResult({ title: 'Mix review', body, meta: null });
        });
      },
    },
    {
      id: 'suggest-music',
      label: 'Suggest music placement',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Suggest where the score should play. Answer ONLY with lines of the form "MM:SS–MM:SS", one range per music bed, based on the beats and structure.').then((body) => {
          if (body) setAiResult({ title: 'Music placement suggestions', body, meta: null });
        });
      },
    },
  ];

  if (project.isLoading) {
    return <div className="page"><div className="panel-empty">Opening the mix room…</div></div>;
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>MIX ROOM CLOSED</b><span>This room is out of reach.</span></div></div>
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
          <b>CONTENT CREATORS · THE MIX ROOM</b>
          <span>Review the mix and pickup pins, comment on exact moments, and hand the audio off to Pro Tools/Resolve — then import the sound-locked cut back.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Sound Designer · restore &amp; score</SectionEyebrow>
          <h1>Audio restoration &amp; score.</h1>
          <p>Listen to the monitor, review the music and pickup pins, and pin feedback. Cleaning and mixing happen in your DAW and come back through the import bridge.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-sound-back-vault">
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
            <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`sound-tab-leg-${item.leg}`}>
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
            title="Listen & annotate"
            hint="The monitor streams read-only. Scrub the mix and drop frame or timecode pins — the mix itself is edited in the external DAW/NLE."
          />

          <SoundMonitor
            projectId={p.id}
            assets={p.assets}
            playheadMs={playheadMs}
            onTimeUpdate={onScrub}
            onSeek={onScrub}
            headVersionId={soundTimeline.data?.versions.find((v) => v.version === soundTimeline.data?.version)?.id ?? null}
          />

          <SoundReview
            snapshot={snapshot}
            assets={p.assets}
            durationMs={timelineDuration}
            playheadMs={playheadMs}
            onScrub={onScrub}
          />

          <CommentsPanel projectId={p.id} leg="SOUND" />
        </div>

        <div className="space-y-4">
          <ColumnSection
            eyebrow="Version control"
            title="Checkout, import & review"
            hint="The mix is the diffable artifact. Checkout to edit externally, import the result as a new version, then submit it for review."
          />

          <CheckoutPanel
            projectId={p.id}
            projectName={p.name}
            leg="SOUND"
            savedVersion={soundTimeline.data?.version ?? null}
          />

          <ImportFlow projectId={p.id} leg="SOUND" canEdit={canPush} />

          <HistoryPanel
            projectId={p.id}
            leg="SOUND"
            versions={soundTimeline.data?.versions ?? []}
            currentVersion={soundTimeline.data?.version ?? null}
            canSubmit={canPush}
          />

          <RoleOracle
            leg="SOUND"
            roleName="Sound Designer"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canPush}
            placeholder="e.g. Where should the music duck under the host?"
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

          <ActivityFeed projectId={p.id} leg="SOUND" className="" />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Clean audio marries the locked picture — when you submit, the Motion &amp; Color Director takes the relay.
      </p>
    </div>
  );
}
