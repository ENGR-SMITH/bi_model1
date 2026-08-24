import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  LockKeyhole,
  Music4,
  Sparkles,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
  getListVideoJobsQueryKey,
  oracleChat,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoJobs,
  useQueueAudioPass,
} from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from '@/components/review-shared';
import { ActivityFeed } from '@/components/activity-feed';
import { Timeline, formatTimecode, activeBlockId, type TimelineBlock } from '@/components/timeline';
import { RoleOracle, AiResult } from '@/components/role-oracle';
import { AssetPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { CheckoutPanel, ImportFlow } from '@/components/checkout-import';

const AUDIO_ACTIONS = [
  { action: 'NOISE_REDUCTION', label: 'Noise reduction', blurb: 'Hum, echo, wind, room tone.' },
  { action: 'EQ', label: 'EQ & compression', blurb: 'Smooth voice inconsistencies across takes.' },
  { action: 'DUCKING', label: 'Music ducking', blurb: 'Sidechain music under speech.' },
  { action: 'LEVELING', label: 'Level balancing', blurb: 'Host intro matches subject body.' },
] as const;

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

// ---------------------------------------------------------------------------
// Monitor — a live proxy player so reviewers can actually hear the footage
// while scrubbing. Audio kinds render as an <audio> bar. Pins scope to the
// SOUND leg's head snapshot. Read-only: the mix itself happens in a DAW and
// lands here via import as a new version.
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

  // Default to an audio asset (or the first file) once the project loads.
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

  if (assets.length === 0) {
    return (
      <div className="paper-card" data-testid="panel-sound-monitor">
        <div className="inline-heading">
          <span className="eyebrow"><AudioLines size={13} /> Monitor</span>
        </div>
        <p className="setting-copy">No audio or footage in the vault yet — upload takes to start reviewing the mix.</p>
      </div>
    );
  }

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
      <p className="setting-copy">Hear the captured audio while you scrub — drop pins on the frame to flag notes for the mixer.</p>
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
      <p className="den-footnote mt-3">
        <LockKeyhole size={13} />
        Streaming the degraded proxy — the locked original never leaves the server.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mix layers — read-only view of the head version's score & pickup pins.
// Scrub to review where music and re-records land. Placement is done in the
// DAW and imported; nothing here is draggable.
// ---------------------------------------------------------------------------

function MixLayers({
  snapshot,
  assets,
  durationMs,
  playheadMs,
  onScrub,
}: {
  snapshot: SoundSnapshot;
  assets: Array<{ id: string; fileName: string }>;
  durationMs: number;
  playheadMs: number;
  onScrub: (ms: number) => void;
}) {
  const name = (id: string) => assets.find((a) => a.id === id)?.fileName ?? id;

  const musicBlocks: TimelineBlock[] = snapshot.music.map((track) => ({
    id: track.id,
    label: name(track.assetId),
    sublabel: track.duckUnderSpeech ? 'duck under speech' : 'full mix',
    startMs: track.inMs,
    endMs: Math.max(track.outMs, track.inMs + 500),
    tone: 'accent',
  }));

  const pickupBlocks: TimelineBlock[] = snapshot.pickups.map((pickup) => ({
    id: pickup.id,
    label: name(pickup.assetId),
    sublabel: 'pickup VO',
    startMs: Math.max(0, pickup.timeMs - 500),
    endMs: pickup.timeMs + 500,
    tone: 'danger',
  }));

  if (musicBlocks.length === 0 && pickupBlocks.length === 0) return null;

  return (
    <div className="paper-card" data-testid="panel-mix-layers">
      <div className="inline-heading">
        <span className="eyebrow"><Music4 size={13} /> Mix layers · from the head version</span>
        <span className="mono-label">{formatTimecode(playheadMs)}</span>
      </div>
      {(musicBlocks.length > 0 || pickupBlocks.length > 0) && (
        <div className="cd-sequence mt-3" data-testid="sound-sequence">
          {musicBlocks.length > 0 && (
            <Timeline
              title={`Score & music — ${musicBlocks.length} track${musicBlocks.length === 1 ? '' : 's'}`}
              hint="Read-only · scrub to review where the score plays"
              blocks={musicBlocks}
              durationMs={durationMs}
              playheadMs={playheadMs}
              canEdit={false}
              scrubOnly
              onScrub={onScrub}
              activeId={activeBlockId(musicBlocks, playheadMs)}
            />
          )}
          {pickupBlocks.length > 0 && (
            <Timeline
              title={`Pickup VO — ${pickupBlocks.length} pin${pickupBlocks.length === 1 ? '' : 's'}`}
              hint="Read-only · scrub to hear where re-records land"
              blocks={pickupBlocks}
              durationMs={durationMs}
              playheadMs={playheadMs}
              canEdit={false}
              scrubOnly
              onScrub={onScrub}
              activeId={activeBlockId(pickupBlocks, playheadMs)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio pass panel — server-side restoration jobs. "Applied" is read back
// from the job queue, not from any in-browser edit.
// ---------------------------------------------------------------------------

function AudioPassPanel({
  statusByAction,
  onRun,
  running,
  canEdit,
}: {
  statusByAction: Record<string, string>;
  onRun: (action: string) => void;
  running: boolean;
  canEdit: boolean;
}) {
  const appliedCount = Object.values(statusByAction).filter((status) => status === 'SUCCEEDED').length;

  return (
    <div className="paper-card accent-card">
      <div className="inline-heading">
        <span className="eyebrow"><AudioLines size={13} /> Audio passes</span>
        <span className="mono-label">{appliedCount} applied</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 mt-3">
        {AUDIO_ACTIONS.map((item) => {
          const status = statusByAction[item.action];
          return (
            <button
              key={item.action}
              type="button"
              onClick={() => onRun(item.action)}
              disabled={running || !canEdit}
              className="list-row"
              data-testid={`audio-pass-${item.action}`}
            >
              <span className="world-symbol"><AudioLines size={13} /></span>
              <span>
                <b>{item.label}</b>
                <small>{item.blurb}</small>
              </span>
              {status === 'SUCCEEDED' && <span className="den-tag teal">applied</span>}
              {(status === 'QUEUED' || status === 'RUNNING') && <span className="den-tag gold">running</span>}
              {status === 'FAILED' && <span className="den-tag danger">failed</span>}
            </button>
          );
        })}
      </div>
      <p className="den-footnote mt-3">
        <Sparkles size={13} />
        Passes run in the background worker — the honest demo receipt appears when no audio tooling is installed.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContentCreatorsSoundPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Live: audio-pass progress, comments, and submissions.
  useProjectRealtime(projectId, 'SOUND');
  const [playheadMs, setPlayheadMs] = useState(0);
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const soundTimeline = useGetVideoTimeline(projectId, 'SOUND');
  const jobs = useListVideoJobs(projectId);
  const audio = useQueueAudioPass();

  // The SOUND leg's head snapshot — read-only. New versions arrive via import
  // (push a mix from your DAW) and the review/approve merge.
  const headSnapshot = useMemo<SoundSnapshot>(() => {
    const snapshot = soundTimeline.data?.snapshot as unknown as SoundSnapshot | undefined;
    return {
      clips: Array.isArray(snapshot?.clips) ? snapshot!.clips : [],
      music: Array.isArray(snapshot?.music) ? snapshot!.music : [],
      pickups: Array.isArray(snapshot?.pickups) ? snapshot!.pickups : [],
      sceneBlocks: Array.isArray(snapshot?.sceneBlocks) ? snapshot!.sceneBlocks : [],
      markers: Array.isArray(snapshot?.markers) ? snapshot!.markers : [],
    };
  }, [soundTimeline.data?.snapshot]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === 'SOUND_DESIGNER';

  const timelineDuration = Math.max(
    60_000,
    project.data?.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0) ?? 60_000,
  );

  const onScrub = (ms: number) => setPlayheadMs(ms);

  // "Applied" passes are read from the job queue (newest job per action wins).
  const statusByAction = useMemo(() => {
    const map: Record<string, string> = {};
    for (const job of jobs.data ?? []) {
      if (job.type !== 'AUDIO') continue;
      const action = job.params?.action;
      if (typeof action === 'string' && !map[action]) map[action] = job.status;
    }
    return map;
  }, [jobs.data]);

  const onRunAudio = (action: string) => {
    audio.mutate(
      { projectId, data: { action: action as 'NOISE_REDUCTION' | 'EQ' | 'DUCKING' | 'LEVELING' } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  const audioError = audio.error as { response?: { data?: { error?: string } } } | null;

  function assetsName(assetId: string): string {
    return project.data?.assets.find((a) => a.id === assetId)?.fileName ?? assetId;
  }

  const oracleContext = useMemo(() => {
    const passes = Object.entries(statusByAction).filter(([, status]) => status === 'SUCCEEDED').map(([action]) => action).join(', ') || 'none yet';
    const music = headSnapshot.music.map((t) => `${assetsName(t.assetId)} @ ${formatTimecode(t.inMs)}–${formatTimecode(t.outMs)}${t.duckUnderSpeech ? ' (duck)' : ''}`).join('\n') || 'none yet';
    const pickups = headSnapshot.pickups.map((p) => `${assetsName(p.assetId)} @ ${formatTimecode(p.timeMs)}`).join('\n') || 'none yet';
    const assetsList = (project.data?.assets ?? []).map((a) => `${a.fileName} (${a.kind}, ${a.durationMs ? formatTimecode(a.durationMs) : 'unknown'})`).join('\n') || 'none';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Timeline duration: ${formatTimecode(timelineDuration)}`,
      `Assets:\n${assetsList}`,
      `Audio passes applied: ${passes}`,
      `Music:\n${music}`,
      `Pickup VO pins:\n${pickups}`,
    ].join('\n\n').slice(0, 12000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headSnapshot, statusByAction, project.data, timelineDuration]);

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
  const headVersionId = soundTimeline.data?.versions.find((v) => v.version === soundTimeline.data?.version)?.id ?? null;
  const audioRunning = jobs.data?.some((job) => job.type === 'AUDIO' && ['QUEUED', 'RUNNING'].includes(job.status)) ?? false;

  return (
    <div className="page">
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>CONTENT CREATORS · THE MIX ROOM</b>
          <span>Review the mix, run restoration passes on the server, compare versions, and open a pull request — the mix itself happens in your DAW.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Sound Designer · restore &amp; score</SectionEyebrow>
          <h1>Audio restoration &amp; score.</h1>
          <p>Monitor the captured audio, queue server-side restoration passes, and review where the score and pickups land. Mixing happens in your DAW — check out, mix, and push it back as a version.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-sound-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canEdit ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canEdit ? 'Sound Designer' : 'Viewing'}
          </span>
        </div>
      </div>

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
          const Icon = item.icon;
          const active = item.leg === 'SOUND';
          const href = `/projects/${p.id}/${item.slug}`;
          return (
            <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`sound-tab-leg-${item.leg}`}>
              <Icon size={13} />
              {item.role}
            </Link>
          );
        })}
      </div>

      <div className="cd-watch">
        <div className="cd-watch-main">
          <SoundMonitor
            projectId={p.id}
            assets={p.assets}
            playheadMs={playheadMs}
            onTimeUpdate={onScrub}
            onSeek={onScrub}
            headVersionId={headVersionId}
          />

          <MixLayers
            snapshot={headSnapshot}
            assets={p.assets}
            durationMs={timelineDuration}
            playheadMs={playheadMs}
            onScrub={onScrub}
          />

          <CommentsPanel projectId={p.id} leg="SOUND" />
        </div>

        <div className="cd-watch-rail">
          <AudioPassPanel
            statusByAction={statusByAction}
            onRun={onRunAudio}
            running={audioRunning || audio.isPending}
            canEdit={canEdit}
          />
          {audio.isError && (
            <p className="setting-copy" role="alert">
              {audioError?.response?.data?.error || 'The audio pass could not be queued.'}
            </p>
          )}

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
            leg="SOUND"
            roleName="Sound Designer"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canEdit}
            placeholder="e.g. Where should the music duck under the host?"
          />

          <HistoryPanel
            projectId={p.id}
            leg="SOUND"
            versions={soundTimeline.data?.versions ?? []}
            currentVersion={soundTimeline.data?.version ?? null}
            canSubmit={canEdit}
          />

          <CheckoutPanel
            projectId={p.id}
            projectName={p.name}
            leg="SOUND"
            savedVersion={soundTimeline.data?.version ?? null}
          />

          <ImportFlow projectId={p.id} leg="SOUND" canEdit={canEdit} />

          <ActivityFeed projectId={p.id} leg="SOUND" className="" />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Clean audio marries the locked picture — open a pull request and the Motion &amp; Color Director takes the relay.
      </p>
    </div>
  );
}
