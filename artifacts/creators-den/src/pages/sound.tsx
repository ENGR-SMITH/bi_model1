import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  Film,
  Link2,
  LockKeyhole,
  Mic2,
  Mic,
  Minus,
  Music4,
  Palette,
  Play,
  Plus,
  Save,
  Scissors,
  Sparkles,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoProjectQueryKey,
  getGetVideoTimelineQueryKey,
  getListVideoJobsQueryKey,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoJobs,
  useQueueAudioPass,
  useSaveVideoTimeline,
  useUploadVideoAsset,
} from '@workspace/api-client-react';
import type { VideoAssetDetail } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from './selects';

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

function formatTimecode(ms: number | null | undefined): string {
  if (ms == null) return '–:––';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const LEG_TABS = [
  { leg: 'SELECTS', role: 'Story Architect', icon: Film },
  { leg: 'CUT', role: 'Visual Editor', icon: Scissors },
  { leg: 'SOUND', role: 'Sound Designer', icon: Mic2 },
  { leg: 'FINISH', role: 'Motion & Color', icon: Palette },
] as const;

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
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
        <AudioLines className="h-4 w-4" />
        Audio passes
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {AUDIO_ACTIONS.map((item) => {
          const applied = passes.some((p) => p.action === item.action);
          return (
            <button
              key={item.action}
              type="button"
              onClick={() => onRun(item.action)}
              disabled={running}
              className={`focus-house rounded-xl border-2 px-4 py-3 text-left transition-colors disabled:cursor-wait disabled:opacity-60 ${applied ? 'border-[#8dc2ad] bg-[#e5f1e8]' : 'border-[#e5d7c5] bg-[#f7eddf] hover:border-[#8dc2ad]'}`}
              data-testid={`audio-pass-${item.action}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-[#292b45]">{item.label}</span>
                {applied && (
                  <span className="rounded-full bg-[#286254] px-2 py-0.5 font-mono-ui text-[8px] uppercase tracking-[.12em] text-[#fff4e6]">applied</span>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[#77717a]">{item.blurb}</p>
            </button>
          );
        })}
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-[#77717a]">
        <Sparkles className="h-4 w-4 text-[#e55b4c]" />
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
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
        <Mic2 className="h-4 w-4" />
        Pickup voiceover
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#77717a]">
        Flag a bad take, re-record the line in-browser, and it lands as a VO_PICKUP asset pinned to a timecode.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={timeMs === 0 ? '' : formatTimecode(timeMs)}
          onChange={(event) => {
            const [m, s] = event.target.value.split(':').map((n) => Number(n) || 0);
            setTimeMs((m * 60 + s) * 1000);
          }}
          placeholder="pin at 0:00"
          className="w-32 rounded-lg border-2 border-[#e5d7c5] bg-[#f7eddf] px-2 py-2 text-center font-mono-ui text-[11px] text-[#292b45]"
          data-testid="pickup-timecode"
        />
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="focus-house inline-flex items-center gap-2 rounded-xl bg-[#e55b4c] px-4 py-2.5 text-sm font-bold text-[#fff4e6] hover:bg-[#c7473c]"
            data-testid="button-stop-recording"
          >
            <Square className="h-4 w-4" />
            Stop & upload
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={upload.isPending}
            className="focus-house inline-flex items-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-record-pickup"
          >
            <Mic className="h-4 w-4" />
            {upload.isPending ? 'Uploading…' : 'Record pickup VO'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-[#a33d31]">{error}</p>}
      {upload.isError && (
        <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
          {uploadError?.response?.data?.error || 'The pickup VO could not be uploaded.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Music layer
// ---------------------------------------------------------------------------

function MusicPanel({
  snapshot,
  onChange,
  assets,
  canEdit,
}: {
  snapshot: SoundSnapshot;
  onChange: (next: SoundSnapshot) => void;
  assets: Array<{ id: string; fileName: string }>;
  canEdit: boolean;
}) {
  const [assetId, setAssetId] = useState('');

  const addTrack = () => {
    if (!assetId) return;
    const track: MusicTrack = { id: crypto.randomUUID(), assetId, inMs: 0, outMs: 30000, duckUnderSpeech: true };
    onChange({ ...snapshot, music: [...snapshot.music, track] });
    setAssetId('');
  };

  const updateTrack = (id: string, patch: Partial<MusicTrack>) => {
    onChange({ ...snapshot, music: snapshot.music.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  };

  const removeTrack = (id: string) => {
    onChange({ ...snapshot, music: snapshot.music.filter((t) => t.id !== id) });
  };

  return (
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
        <Music4 className="h-4 w-4" />
        Music &amp; score
      </div>
      {assets.length === 0 ? (
        <p className="mt-3 text-sm text-[#77717a]">Upload a music or SFX file (kind: B-roll or reference) to score the emotional arc.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
            className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45]"
            data-testid="sound-select-music"
          >
            <option value="">Pick a track…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.fileName}</option>
            ))}
          </select>
          {canEdit && (
            <button
              type="button"
              onClick={addTrack}
              disabled={!assetId}
              className="focus-house inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#286254] px-4 py-2.5 text-sm font-bold text-[#fff4e6] hover:bg-[#1d5048] disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-add-music"
            >
              <Plus className="h-4 w-4" />
              Add track
            </button>
          )}
        </div>
      )}

      {snapshot.music.length > 0 && (
        <div className="mt-4 space-y-2">
          {snapshot.music.map((track) => (
            <div key={track.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] px-3.5 py-2.5" data-testid={`music-track-${track.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#292b45]">{assets.find((a) => a.id === track.assetId)?.fileName ?? track.assetId}</p>
                <p className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">{formatTimecode(track.inMs)} → {formatTimecode(track.outMs)}</p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 rounded-full bg-[#e5f1e8] px-3 py-1.5 text-xs font-bold text-[#286254]" title="Sidechain-duck music under speech">
                    <input
                      type="checkbox"
                      checked={track.duckUnderSpeech}
                      onChange={(event) => updateTrack(track.id, { duckUnderSpeech: event.target.checked })}
                      className="accent-[#286254]"
                      data-testid={`music-duck-${track.id}`}
                    />
                    Duck under speech
                  </label>
                  <button type="button" onClick={() => removeTrack(track.id)} className="rounded-full p-1.5 text-[#98909a] hover:bg-[#ffe9df] hover:text-[#a33d31]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pickup list
// ---------------------------------------------------------------------------

function PickupList({
  snapshot,
  onChange,
  assets,
  canEdit,
}: {
  snapshot: SoundSnapshot;
  onChange: (next: SoundSnapshot) => void;
  assets: Array<{ id: string; fileName: string }>;
  canEdit: boolean;
}) {
  const remove = (id: string) => {
    onChange({ ...snapshot, pickups: snapshot.pickups.filter((p) => p.id !== id) });
  };

  if (snapshot.pickups.length === 0) return null;

  return (
    <div className="rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
        <Mic className="h-4 w-4" />
        Pickup VOs in place
      </div>
      <div className="mt-3 space-y-2">
        {snapshot.pickups.map((pickup) => (
          <div key={pickup.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#8dc2ad] bg-[#fff4e6] px-3.5 py-2.5" data-testid={`pickup-${pickup.id}`}>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#292b45]">{assets.find((a) => a.id === pickup.assetId)?.fileName ?? pickup.assetId}</p>
              <p className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#286254]">pinned at {formatTimecode(pickup.timeMs)}</p>
            </div>
            {canEdit && (
              <button type="button" onClick={() => remove(pickup.id)} className="rounded-full p-1.5 text-[#98909a] hover:bg-[#ffe9df] hover:text-[#a33d31]">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
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

  if (project.isLoading) {
    return (
      <div className="mx-auto max-w-[1280px]">
        <div className="h-40 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" />
        <div className="mt-6 h-96 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" />
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <SectionEyebrow>Mix room closed</SectionEyebrow>
        <h1 className="mt-5 text-6xl font-extrabold tracking-[-0.08em]">This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">
          <ArrowLeft className="h-4 w-4" />
          Back to the vault
        </Link>
      </div>
    );
  }

  const p = project.data;
  const audioRunning = jobs.data?.some((job) => job.type === 'AUDIO' && ['QUEUED', 'RUNNING'].includes(job.status)) ?? false;

  return (
    <div className="mx-auto max-w-[1280px]">
      <Link href={`/projects/${p.id}`} className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-sound-back-vault">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to the vault
      </Link>

      <div className="reveal mt-4 flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-7 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Content creators / the mix room</SectionEyebrow>
          <h1 className="mt-3 text-4xl font-extrabold leading-[.92] tracking-[-0.06em] text-[#292b45] sm:text-6xl">Audio restoration &amp; score.</h1>
          <p className="mt-3 max-w-xl text-sm leading-[1.8] text-[#625f6d]">
            Clean the captured audio, duck the score under speech, and re-record bad takes — then hand the Captain a sound-locked cut.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {LEG_TABS.map((item) => {
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
              <Link
                key={item.leg}
                href={href}
                className={`focus-house inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-bold transition-colors ${active ? 'border-[#292b45] bg-[#292b45] text-[#fff4e6]' : 'border-[#d6cbb9] bg-[#fff4e6] text-[#625f6d] hover:border-[#8dc2ad]'}`}
                data-testid={`sound-tab-leg-${item.leg}`}
              >
                <Icon className="h-4 w-4" />
                {item.role}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#286254]">
        <Check className="h-4 w-4" />
        {canEdit ? 'Editing as Sound Designer' : 'Viewing — Sound Designer can edit'}
      </div>

      <div className="reveal reveal-1 mt-8 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-4">
          <AudioPassPanel projectId={p.id} passes={working.passes} onRun={onRunAudio} running={audioRunning || audio.isPending} />
          {audio.isError && (
            <p className="text-sm font-semibold text-[#a33d31]" role="alert">
              {audioError?.response?.data?.error || 'The audio pass could not be queued.'}
            </p>
          )}
          <PickupRecorder projectId={p.id} onPlaced={onPickupPlaced} />
          <CommentsPanel projectId={p.id} leg="SOUND" />
        </div>

        <div className="space-y-4">
          <MusicPanel snapshot={working} onChange={(next) => { setWorking(next); setDirty(true); }} assets={p.assets} canEdit={canEdit} />
          <PickupList snapshot={working} onChange={(next) => { setWorking(next); setDirty(true); }} assets={p.assets} canEdit={canEdit} />

          {dirty && (
            <p className="flex items-center gap-2 text-xs font-semibold text-[#a33d31]">
              <Sparkles className="h-3.5 w-3.5" />
              Unsaved changes
            </p>
          )}

          <div className="rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5">
            <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
              <Save className="h-4 w-4" />
              Save this mix
            </div>
            {canEdit ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="What changed in this pass? (optional)"
                  maxLength={500}
                  className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
                  data-testid="sound-input-save-message"
                />
                <button
                  type="button"
                  onClick={onSave}
                  disabled={save.isPending || !dirty}
                  className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="sound-button-save"
                >
                  <Save className="h-4 w-4" />
                  {save.isPending ? 'Saving…' : 'Save mix'}
                </button>
              </div>
            ) : (
              <p className="mt-4 text-sm font-semibold text-[#286254]">Only the Sound Designer or the Captain can change this mix.</p>
            )}
            {save.isError && (
              <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
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
        </div>
      </div>

      <p className="reveal reveal-2 mt-10 flex items-center gap-3 border-t-2 border-[#d6cbb9] pt-3 text-xs text-[#77717a]">
        <LockKeyhole className="h-4 w-4 text-[#e55b4c]" />
        Clean audio marries the locked picture — when you submit, the Motion &amp; Color Director takes the relay.
      </p>
    </div>
  );
}
