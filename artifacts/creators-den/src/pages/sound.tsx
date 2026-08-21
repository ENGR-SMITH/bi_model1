import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  Film,
  LockKeyhole,
  Mic2,
  Mic,
  Music4,
  Palette,
  Play,
  Plus,
  Save,
  Scissors,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
  getGetVideoProjectQueryKey,
  getGetVideoTimelineQueryKey,
  getListVideoJobsQueryKey,
  oracleChat,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoJobs,
  useQueueAudioPass,
  useSaveVideoTimeline,
  useUploadVideoAsset,
} from '@workspace/api-client-react';
import type { VideoAssetDetail } from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from './selects';
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

interface SoundPass {
  id: string;
  action: string;
  assetId: string;
}

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
  passes: SoundPass[];
  music: MusicTrack[];
  pickups: PickupVo[];
  sceneBlocks: Array<{ id: string; type: string; startMs: number; endMs: number }>;
  markers: Array<{ id: string; label: string; timeMs: number }>;
}

const EMPTY_SOUND: SoundSnapshot = { clips: [], passes: [], music: [], pickups: [], sceneBlocks: [], markers: [] };

// ---------------------------------------------------------------------------
// Pseudo-waveform (visual only — deterministic per asset id)
// ---------------------------------------------------------------------------

function WaveformStrip({ seed, durationMs, playheadMs, onScrub, canEdit }: { seed: string; durationMs: number; playheadMs: number; onScrub: (ms: number) => void; canEdit: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const bars = useMemo(() => {
    let h = 0;
    const next = () => {
      h = (h * 9301 + 49297) % 233280;
      return h / 233280;
    };
    let s = 0;
    for (const ch of seed) s += ch.charCodeAt(0);
    h = s * 2654435761 % 233280;
    const count = 96;
    return Array.from({ length: count }, (_, i) => {
      const v = next() * 0.55 + 0.22;
      const swell = Math.sin(i / 6 + s) * 0.08;
      return Math.max(0.12, Math.min(0.95, v + swell));
    });
  }, [seed]);

  const msFromX = (clientX: number) => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationMs);
  };

  return (
    <div
      ref={ref}
      className="den-waveform"
      style={{ cursor: canEdit ? 'crosshair' : 'default' }}
      onPointerDown={(event) => {
        if (!canEdit) return;
        onScrub(msFromX(event.clientX));
        const move = (e: PointerEvent) => onScrub(msFromX(e.clientX));
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      data-testid="sound-waveform"
    >
      <div className="den-waveform-bars">
        {bars.map((height, index) => (
          <span key={index} style={{ height: `${height * 100}%` }} />
        ))}
      </div>
      <span className="timeline-playhead" style={{ left: `${durationMs > 0 ? (playheadMs / durationMs) * 100 : 0}%` }}>
        <span className="timeline-playhead-label">{formatTimecode(playheadMs)}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitor — a live proxy player so the Sound Designer can actually hear the
// footage while scrubbing the mix. Audio kinds render as an <audio> bar.
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
      <p className="setting-copy">Hear the captured audio while you scrub — the waveform and pins below follow this monitor.</p>
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
// Audio pass panel
// ---------------------------------------------------------------------------

function AudioPassPanel({
  projectId,
  passes,
  onRun,
  running,
}: {
  projectId: string;
  passes: SoundPass[];
  onRun: (action: string) => void;
  running: boolean;
}) {
  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><AudioLines size={13} /> Audio passes</span>
        <span className="mono-label">{passes.length} applied</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 mt-3">
        {AUDIO_ACTIONS.map((item) => {
          const applied = passes.some((p) => p.action === item.action);
          return (
            <button
              key={item.action}
              type="button"
              onClick={() => onRun(item.action)}
              disabled={running}
              className="list-row"
              data-testid={`audio-pass-${item.action}`}
            >
              <span className="world-symbol"><AudioLines size={13} /></span>
              <span>
                <b>{item.label}</b>
                <small>{item.blurb}</small>
              </span>
              {applied && <span className="den-tag teal">applied</span>}
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
// Pickup VO recorder (browser mic → upload as VO_PICKUP → place at timecode)
// ---------------------------------------------------------------------------

function PickupRecorder({
  projectId,
  onPlaced,
}: {
  projectId: string;
  onPlaced: (asset: VideoAssetDetail, timeMs: number) => void;
}) {
  const queryClient = useQueryClient();
  const upload = useUploadVideoAsset();
  const [recording, setRecording] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [error, setError] = useState('');
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const file = new File([blob], `pickup-vo-${Date.now()}.webm`, { type: blob.type });
        upload.mutate(
          { projectId, data: { file, kind: 'VO_PICKUP' } },
          {
            onSuccess: (asset) => {
              onPlaced(asset as unknown as VideoAssetDetail, timeMs);
              queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
            },
          },
        );
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone access was blocked — check browser permissions.');
    }
  };

  const stop = () => {
    mediaRef.current?.stop();
    setRecording(false);
  };

  const uploadError = upload.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Mic2 size={13} /> Pickup voiceover</span>
      </div>
      <p className="setting-copy">
        Flag a bad take, re-record the line in-browser, and it lands as a VO_PICKUP asset pinned to a timecode.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={timeMs === 0 ? '' : formatTimecode(timeMs)}
          onChange={(event) => {
            const [m, s] = event.target.value.split(':').map((n) => Number(n) || 0);
            setTimeMs((m * 60 + s) * 1000);
          }}
          placeholder="pin at 0:00"
          className="w-32 text-center"
          data-testid="pickup-timecode"
        />
        {recording ? (
          <button type="button" onClick={stop} className="secondary-btn" data-testid="button-stop-recording">
            <Square size={13} />
            Stop & upload
          </button>
        ) : (
          <button type="button" onClick={start} disabled={upload.isPending} className="primary-btn" data-testid="button-record-pickup">
            <Mic size={13} />
            {upload.isPending ? 'Uploading…' : 'Record pickup VO'}
          </button>
        )}
      </div>
      {error && <p className="setting-copy mt-2">{error}</p>}
      {upload.isError && (
        <p className="setting-copy mt-2" role="alert">
          {uploadError?.response?.data?.error || 'The pickup VO could not be uploaded.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Music + pickup layers (direct manipulation on the waveform strip)
// ---------------------------------------------------------------------------

function SoundLayers({
  snapshot,
  onChange,
  assets,
  canEdit,
  durationMs,
  playheadMs,
  onScrub,
}: {
  snapshot: SoundSnapshot;
  onChange: (next: SoundSnapshot) => void;
  assets: Array<{ id: string; fileName: string; kind: string }>;
  canEdit: boolean;
  durationMs: number;
  playheadMs: number;
  onScrub: (ms: number) => void;
}) {
  const [assetId, setAssetId] = useState('');
  const audioSeed = assets.find((a) => a.kind === 'RAW_AUDIO' || a.kind === 'VO_PICKUP')?.id ?? assets[0]?.id ?? 'sound';

  const musicBlocks: TimelineBlock[] = snapshot.music.map((track) => ({
    id: track.id,
    label: assets.find((a) => a.id === track.assetId)?.fileName ?? track.assetId,
    sublabel: track.duckUnderSpeech ? 'duck under speech' : 'full mix',
    startMs: track.inMs,
    endMs: track.outMs,
    tone: 'gold',
  }));

  const pickupBlocks: TimelineBlock[] = snapshot.pickups.map((pickup) => ({
    id: pickup.id,
    label: assets.find((a) => a.id === pickup.assetId)?.fileName ?? pickup.assetId,
    sublabel: 'pickup VO',
    startMs: Math.max(0, pickup.timeMs - 500),
    endMs: pickup.timeMs + 500,
    tone: 'danger',
  }));

  const onMusicChange = (next: TimelineBlock[]) => {
    const nextTracks = snapshot.music.map((track) => {
      const block = next.find((b) => b.id === track.id);
      return block ? { ...track, inMs: block.startMs, outMs: block.endMs } : track;
    });
    onChange({ ...snapshot, music: nextTracks });
  };

  const onPickupChange = (next: TimelineBlock[]) => {
    const nextPickups = snapshot.pickups.map((pickup) => {
      const block = next.find((b) => b.id === pickup.id);
      return block ? { ...pickup, timeMs: block.startMs + 500 } : pickup;
    });
    onChange({ ...snapshot, pickups: nextPickups });
  };

  const addTrack = () => {
    if (!assetId) return;
    const track: MusicTrack = { id: crypto.randomUUID(), assetId, inMs: 0, outMs: Math.min(30000, durationMs), duckUnderSpeech: true };
    onChange({ ...snapshot, music: [...snapshot.music, track] });
    setAssetId('');
  };

  return (
    <div className="space-y-4">
      <div className="paper-card">
        <div className="inline-heading">
          <span className="eyebrow"><AudioLines size={13} /> The mix — waveform scrub</span>
          <span className="mono-label">{formatTimecode(playheadMs)}</span>
        </div>
        <WaveformStrip seed={audioSeed} durationMs={durationMs} playheadMs={playheadMs} onScrub={onScrub} canEdit={canEdit} />
        <p className="den-footnote mt-2">
          <Play size={12} />
          Click or drag the waveform to scrub the mix · music and pickup pins sit on the tracks below.
        </p>
      </div>

      <Timeline
        title={`Music & score — ${snapshot.music.length} tracks`}
        hint="Drag to move · pull edges to trim · duck toggles below"
        blocks={musicBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={canEdit}
        onChange={onMusicChange}
        onScrub={onScrub}
        activeId={activeBlockId(musicBlocks, playheadMs)}
      />

      <Timeline
        title={`Pickup VO pins — ${snapshot.pickups.length}`}
        hint="Drag a pin to move it to a new timecode"
        blocks={pickupBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={canEdit}
        onChange={onPickupChange}
        onScrub={onScrub}
        activeId={activeBlockId(pickupBlocks, playheadMs)}
      />

      <div className="paper-card">
        <div className="inline-heading">
          <span className="eyebrow"><Music4 size={13} /> Add music</span>
        </div>
        {assets.length === 0 ? (
          <p className="setting-copy">Upload a music or SFX file (kind: B-roll or reference) to score the emotional arc.</p>
        ) : (
          <div className="mt-3 flex gap-2">
            <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className="flex-1" data-testid="sound-select-music">
              <option value="">Pick a track…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.fileName}</option>
              ))}
            </select>
            {canEdit && (
              <button type="button" onClick={addTrack} disabled={!assetId} className="secondary-btn" data-testid="button-add-music">
                <Plus size={13} /> Add track
              </button>
            )}
          </div>
        )}

        {snapshot.music.length > 0 && (
          <div className="den-stack mt-4">
            {snapshot.music.map((track) => (
              <div key={track.id} className="list-row" data-testid={`music-track-${track.id}`}>
                <span className="world-symbol"><Music4 size={13} /></span>
                <span>
                  <b>{assets.find((a) => a.id === track.assetId)?.fileName ?? track.assetId}</b>
                  <small>{formatTimecode(track.inMs)} → {formatTimecode(track.outMs)}</small>
                </span>
                {canEdit && (
                  <>
                    <label className="den-tag teal cursor-pointer" title="Sidechain-duck music under speech">
                      <input
                        type="checkbox"
                        checked={track.duckUnderSpeech}
                        onChange={(event) => onChange({ ...snapshot, music: snapshot.music.map((t) => (t.id === track.id ? { ...t, duckUnderSpeech: event.target.checked } : t)) })}
                        className="mr-1 accent-[hsl(164_33%_45%)]"
                        data-testid={`music-duck-${track.id}`}
                      />
                      Duck
                    </label>
                    <button type="button" onClick={() => onChange({ ...snapshot, music: snapshot.music.filter((t) => t.id !== track.id) })} className="danger-icon" title="Remove track">
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
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
  const [working, setWorking] = useState<SoundSnapshot>(EMPTY_SOUND);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [playheadMs, setPlayheadMs] = useState(0);
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const soundTimeline = useGetVideoTimeline(projectId, 'SOUND');
  const jobs = useListVideoJobs(projectId);
  const save = useSaveVideoTimeline();
  const audio = useQueueAudioPass();

  useEffect(() => {
    if (soundTimeline.data?.snapshot) {
      const snapshot = soundTimeline.data.snapshot as unknown as SoundSnapshot;
      setWorking({
        clips: Array.isArray(snapshot.clips) ? snapshot.clips : [],
        passes: Array.isArray(snapshot.passes) ? snapshot.passes : [],
        music: Array.isArray(snapshot.music) ? snapshot.music : [],
        pickups: Array.isArray(snapshot.pickups) ? snapshot.pickups : [],
        sceneBlocks: Array.isArray(snapshot.sceneBlocks) ? snapshot.sceneBlocks : [],
        markers: Array.isArray(snapshot.markers) ? snapshot.markers : [],
      });
      setDirty(false);
    }
  }, [soundTimeline.data?.snapshot, soundTimeline.data?.version]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === 'SOUND_DESIGNER';

  const timelineDuration = Math.max(
    60_000,
    project.data?.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0) ?? 60_000,
  );

  const onScrub = (ms: number) => setPlayheadMs(ms);

  const onRunAudio = (action: string) => {
    audio.mutate(
      { projectId, data: { action: action as 'NOISE_REDUCTION' | 'EQ' | 'DUCKING' | 'LEVELING' } },
      {
        onSuccess: () => {
          const pass: SoundPass = { id: crypto.randomUUID(), action, assetId: project.data?.assets[0]?.id ?? '' };
          setWorking((prev) => ({ ...prev, passes: [...prev.passes.filter((p) => p.action !== action), pass] }));
          setDirty(true);
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  const onPickupPlaced = (asset: VideoAssetDetail, timeMs: number) => {
    const pickup = { id: crypto.randomUUID(), assetId: asset.id, timeMs, note: '' };
    setWorking((prev) => ({ ...prev, pickups: [...prev.pickups, pickup] }));
    setDirty(true);
  };

  const onSave = () => {
    save.mutate(
      { projectId, leg: 'SOUND', data: { snapshot: working as unknown as Record<string, unknown>, message: message.trim() || undefined } },
      {
        onSuccess: () => {
          setMessage('');
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, 'SOUND') });
        },
      },
    );
  };

  const saveError = save.error as { response?: { data?: { error?: string } } } | null;
  const audioError = audio.error as { response?: { data?: { error?: string } } } | null;

  const oracleContext = useMemo(() => {
    const passes = working.passes.map((p) => p.action).join(', ') || 'none yet';
    const music = working.music.map((t) => `${assetsName(t.assetId)} @ ${formatTimecode(t.inMs)}–${formatTimecode(t.outMs)}${t.duckUnderSpeech ? ' (duck)' : ''}`).join('\n') || 'none yet';
    const pickups = working.pickups.map((p) => `${assetsName(p.assetId)} @ ${formatTimecode(p.timeMs)}`).join('\n') || 'none yet';
    const assetsList = (project.data?.assets ?? []).map((a) => `${a.fileName} (${a.kind}, ${a.durationMs ? formatTimecode(a.durationMs) : 'unknown'})`).join('\n') || 'none';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Timeline duration: ${formatTimecode(timelineDuration)}`,
      `Assets:\n${assetsList}`,
      `Audio passes applied: ${passes}`,
      `Music:\n${music}`,
      `Pickup VO pins:\n${pickups}`,
    ].join('\n\n').slice(0, 12000);
  }, [working, project.data, timelineDuration]);

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

  const applyMusicFromAnswer = (text: string): number => {
    const re = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/g;
    const ranges: Array<[number, number]> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const inMs = (Number(m[1]) * 60 + Number(m[2])) * 1000;
      const outMs = (Number(m[3]) * 60 + Number(m[4])) * 1000;
      if (outMs > inMs && outMs <= timelineDuration) ranges.push([inMs, outMs]);
    }
    if (ranges.length === 0) return 0;
    const fallbackAsset = project.data?.assets[0]?.id ?? '';
    const tracks = working.music.map((t) => ({ ...t }));
    let applied = 0;
    for (let i = 0; i < ranges.length; i += 1) {
      const [inMs, outMs] = ranges[i];
      if (tracks[i]) {
        tracks[i] = { ...tracks[i], inMs, outMs };
      } else {
        tracks.push({ id: crypto.randomUUID(), assetId: fallbackAsset, inMs, outMs, duckUnderSpeech: true });
      }
      applied += 1;
    }
    setWorking((prev) => ({ ...prev, music: tracks }));
    setDirty(true);
    return applied;
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
          if (!body) return;
          const count = applyMusicFromAnswer(body);
          setAiResult({ title: count > 0 ? `Music — ${count} range${count === 1 ? '' : 's'} placed` : 'Music suggestions (review below)', body, meta: null });
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
  const audioRunning = jobs.data?.some((job) => job.type === 'AUDIO' && ['QUEUED', 'RUNNING'].includes(job.status)) ?? false;

  return (
    <div className="page">
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>CONTENT CREATORS · THE MIX ROOM</b>
          <span>Clean the captured audio, duck the score under speech, and re-record bad takes — then hand the Captain a sound-locked cut.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Sound Designer · restore &amp; score</SectionEyebrow>
          <h1>Audio restoration &amp; score.</h1>
          <p>Scrub the waveform, drag the score into place, and pin pickup lines where the originals fell short.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-sound-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canEdit ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canEdit ? 'Editing as Sound Designer' : 'Viewing'}
          </span>
        </div>
      </div>

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
          const Icon = item.icon;
          const active = item.leg === 'SOUND';
          const href =
            item.leg === 'SELECTS'
              ? `/projects/${p.id}/selects`
              : item.leg === 'CUT'
                ? `/projects/${p.id}/cut`
                : item.leg === 'SOUND'
                  ? `/projects/${p.id}/sound`
                  : `/projects/${p.id}/finish`;
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
          <SoundMonitor
            projectId={p.id}
            assets={p.assets}
            playheadMs={playheadMs}
            onTimeUpdate={onScrub}
            onSeek={onScrub}
            headVersionId={soundTimeline.data?.versions.find((v) => v.version === soundTimeline.data?.version)?.id ?? null}
          />
          <AudioPassPanel projectId={p.id} passes={working.passes} onRun={onRunAudio} running={audioRunning || audio.isPending} />
          {audio.isError && (
            <p className="setting-copy" role="alert">
              {audioError?.response?.data?.error || 'The audio pass could not be queued.'}
            </p>
          )}
          <PickupRecorder projectId={p.id} onPlaced={onPickupPlaced} />
          <CommentsPanel projectId={p.id} leg="SOUND" />
        </div>

        <div className="space-y-4">
          <SoundLayers
            snapshot={working}
            onChange={(next) => { setWorking(next); setDirty(true); }}
            assets={p.assets}
            canEdit={canEdit}
            durationMs={timelineDuration}
            playheadMs={playheadMs}
            onScrub={onScrub}
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

          <RoleOracle
            leg="SOUND"
            roleName="Sound Designer"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canEdit}
            placeholder="e.g. Where should the music duck under the host?"
          />

          <div className="paper-card accent-card">
            <div className="inline-heading">
              <span className="eyebrow"><Save size={13} /> Save this mix</span>
            </div>
            {canEdit ? (
              <div className="mt-3 flex gap-2">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="What changed in this pass? (optional)"
                  maxLength={500}
                  data-testid="sound-input-save-message"
                />
                <button type="button" onClick={onSave} disabled={save.isPending || !dirty} className="primary-btn" data-testid="sound-button-save">
                  <Save size={13} />
                  {save.isPending ? 'Saving…' : 'Save mix'}
                </button>
              </div>
            ) : (
              <p className="setting-copy mt-3">Only the Sound Designer or the Captain can change this mix.</p>
            )}
            {dirty && <p className="den-footnote mt-2"><Sparkles size={12} /> Unsaved changes</p>}
            {save.isError && (
              <p className="setting-copy mt-2" role="alert">
                {saveError?.response?.data?.error || 'The mix could not be saved.'}
              </p>
            )}
          </div>

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
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Clean audio marries the locked picture — when you submit, the Motion &amp; Color Director takes the relay.
      </p>
    </div>
  );
}
