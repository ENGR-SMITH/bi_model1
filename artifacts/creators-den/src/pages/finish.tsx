import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Captions,
  Check,
  Clapperboard,
  Film,
  ImageIcon,
  Layers,
  LockKeyhole,
  Mic2,
  Palette,
  Play,
  Plus,
  Save,
  Scissors,
  Sparkles,
  Square,
  Type,
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
  useQueueVideoExport,
  useQueueVideoThumbnail,
  useSaveVideoTimeline,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from './selects';

const LUT_PRESETS = ['NONE', 'WARM', 'COOL', 'CINEMA', 'PUNCHY'] as const;
const CAPTION_STYLES = ['BOTTOM_CENTER', 'SPLIT', 'MINIMAL'] as const;
const EXPORT_FORMATS = [
  { format: '16:9', label: '16:9 · YouTube' },
  { format: '9:16', label: '9:16 · Shorts' },
  { format: '1:1', label: '1:1 · Instagram' },
] as const;

interface GradeNode {
  lut: (typeof LUT_PRESETS)[number];
  exposure: number; // -100..100
  warmth: number; // -100..100
}

interface GradeClip {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
  grade: GradeNode;
}

interface LowerThird {
  id: string;
  title: string;
  subtitle: string;
  startMs: number;
  endMs: number;
}

interface FinishSnapshot {
  clips: GradeClip[];
  captions: { enabled: boolean; style: (typeof CAPTION_STYLES)[number] };
  lowerThirds: LowerThird[];
  thumbnail: { assetId: string; timeMs: number } | null;
  sceneBlocks: Array<{ id: string; type: string; startMs: number; endMs: number }>;
  markers: Array<{ id: string; label: string; timeMs: number }>;
}

const EMPTY_FINISH: FinishSnapshot = {
  clips: [],
  captions: { enabled: false, style: 'BOTTOM_CENTER' },
  lowerThirds: [],
  thumbnail: null,
  sceneBlocks: [],
  markers: [],
};

const DEFAULT_GRADE: GradeNode = { lut: 'NONE', exposure: 0, warmth: 0 };

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
// Grade nodes
// ---------------------------------------------------------------------------

function GradePanel({
  snapshot,
  onChange,
  assets,
  canEdit,
}: {
  snapshot: FinishSnapshot;
  onChange: (next: FinishSnapshot) => void;
  assets: Array<{ id: string; fileName: string }>;
  canEdit: boolean;
}) {
  const updateClip = (id: string, patch: Partial<GradeClip>) => {
    onChange({ ...snapshot, clips: snapshot.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const updateGrade = (id: string, patch: Partial<GradeNode>) => {
    onChange({
      ...snapshot,
      clips: snapshot.clips.map((c) => (c.id === id ? { ...c, grade: { ...c.grade, ...patch } } : c)),
    });
  };

  const removeClip = (id: string) => {
    onChange({ ...snapshot, clips: snapshot.clips.filter((c) => c.id !== id) });
  };

  return (
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
        <Layers className="h-4 w-4" />
        Per-clip grade nodes
      </div>
      {snapshot.clips.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-[#77717a]">
          Add clips to grade — each node matches exposure, warmth, and a LUT so rooms shot at different times sit in one look.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {snapshot.clips.map((clip) => (
            <div key={clip.id} className="rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] p-3.5" data-testid={`grade-clip-${clip.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-[#292b45]">{assets.find((a) => a.id === clip.assetId)?.fileName ?? clip.assetId}</span>
                {canEdit && (
                  <button type="button" onClick={() => removeClip(clip.id)} className="rounded-full p-1.5 text-[#98909a] hover:bg-[#ffe9df] hover:text-[#a33d31]">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {canEdit ? (
                <div className="mt-3 grid gap-3 border-t-2 border-[#e5d7c5] pt-3 sm:grid-cols-2">
                  <div>
                    <label className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">LUT preset</label>
                    <select
                      value={clip.grade.lut}
                      onChange={(event) => updateGrade(clip.id, { lut: event.target.value as GradeNode['lut'] })}
                      className="focus-house mt-1 w-full rounded-lg border-2 border-[#d6cbb9] bg-[#fff4e6] px-2.5 py-1.5 text-xs text-[#292b45]"
                      data-testid={`grade-lut-${clip.id}`}
                    >
                      {LUT_PRESETS.map((lut) => (
                        <option key={lut} value={lut}>{lut}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">Exposure · {clip.grade.exposure > 0 ? '+' : ''}{clip.grade.exposure}</label>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={clip.grade.exposure}
                      onChange={(event) => updateGrade(clip.id, { exposure: Number(event.target.value) })}
                      className="mt-2 w-full accent-[#286254]"
                      data-testid={`grade-exposure-${clip.id}`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">Warmth · {clip.grade.warmth > 0 ? '+' : ''}{clip.grade.warmth}</label>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={clip.grade.warmth}
                      onChange={(event) => updateGrade(clip.id, { warmth: Number(event.target.value) })}
                      className="mt-2 w-full accent-[#e55b4c]"
                      data-testid={`grade-warmth-${clip.id}`}
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-2 font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#77717a]">
                  {clip.grade.lut} · exposure {clip.grade.exposure} · warmth {clip.grade.warmth}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Captions + lower thirds
// ---------------------------------------------------------------------------

function CaptionsPanel({
  snapshot,
  onChange,
  canEdit,
}: {
  snapshot: FinishSnapshot;
  onChange: (next: FinishSnapshot) => void;
  canEdit: boolean;
}) {
  const toggle = () => {
    onChange({ ...snapshot, captions: { ...snapshot.captions, enabled: !snapshot.captions.enabled } });
  };

  return (
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
          <Captions className="h-4 w-4" />
          Captions
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={toggle}
            className={`focus-house inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${snapshot.captions.enabled ? 'bg-[#286254] text-[#fff4e6]' : 'bg-[#f7eddf] text-[#625f6d] border-2 border-[#d6cbb9]'}`}
            data-testid="toggle-captions"
          >
            {snapshot.captions.enabled ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {snapshot.captions.enabled ? 'Burning in' : 'Burn in'}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#77717a]">
        Captions are generated from the Leg 1 transcript — never re-transcribed.
      </p>
      {snapshot.captions.enabled && canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          {CAPTION_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => onChange({ ...snapshot, captions: { ...snapshot.captions, style } })}
              className={`focus-house rounded-full px-3 py-1.5 text-xs font-bold ${snapshot.captions.style === style ? 'bg-[#292b45] text-[#fff4e6]' : 'bg-[#f7eddf] text-[#625f6d] border-2 border-[#d6cbb9]'}`}
              data-testid={`caption-style-${style}`}
            >
              {style.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LowerThirdsPanel({
  snapshot,
  onChange,
  canEdit,
}: {
  snapshot: FinishSnapshot;
  onChange: (next: FinishSnapshot) => void;
  canEdit: boolean;
}) {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');

  const add = () => {
    if (!title.trim()) return;
    const lowerThird: LowerThird = {
      id: crypto.randomUUID(),
      title: title.trim(),
      subtitle: subtitle.trim(),
      startMs: 0,
      endMs: 5000,
    };
    onChange({ ...snapshot, lowerThirds: [...snapshot.lowerThirds, lowerThird] });
    setTitle('');
    setSubtitle('');
  };

  const remove = (id: string) => {
    onChange({ ...snapshot, lowerThirds: snapshot.lowerThirds.filter((l) => l.id !== id) });
  };

  return (
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
        <Type className="h-4 w-4" />
        Lower thirds
      </div>
      {canEdit ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Name — e.g. Ada Lovelace"
            maxLength={80}
            className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
            data-testid="lower-third-title"
          />
          <input
            value={subtitle}
            onChange={(event) => setSubtitle(event.target.value)}
            placeholder="Title — e.g. Software Pioneer"
            maxLength={120}
            className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
            data-testid="lower-third-subtitle"
          />
          <button
            type="button"
            onClick={add}
            disabled={!title.trim()}
            className="focus-house inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#286254] px-4 py-2.5 text-sm font-bold text-[#fff4e6] hover:bg-[#1d5048] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-add-lower-third"
          >
            <Plus className="h-4 w-4" />
            Add card
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-[#77717a]">Graphics are placed by the Motion &amp; Color Director.</p>
      )}

      {snapshot.lowerThirds.length > 0 && (
        <div className="mt-4 space-y-2">
          {snapshot.lowerThirds.map((lower) => (
            <div key={lower.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] px-3.5 py-2.5" data-testid={`lower-third-${lower.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#292b45]">{lower.title}{lower.subtitle && <span className="font-normal text-[#77717a]"> · {lower.subtitle}</span>}</p>
                <p className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">{formatTimecode(lower.startMs)} → {formatTimecode(lower.endMs)}</p>
              </div>
              {canEdit && (
                <button type="button" onClick={() => remove(lower.id)} className="rounded-full p-1.5 text-[#98909a] hover:bg-[#ffe9df] hover:text-[#a33d31]">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thumbnail + exports
// ---------------------------------------------------------------------------

function ExportPanel({
  projectId,
  snapshot,
  onThumbnail,
  canEdit,
}: {
  projectId: string;
  snapshot: FinishSnapshot;
  onThumbnail: (timeMs: number, assetId: string) => void;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const jobs = useListVideoJobs(projectId);
  const exportQueue = useQueueVideoExport();
  const thumbQueue = useQueueVideoThumbnail();
  const [selectedFormats, setSelectedFormats] = useState<string[]>(['16:9', '9:16']);

  const thumbTimeMs = snapshot.thumbnail?.timeMs ?? 0;

  const toggleFormat = (format: string) => {
    setSelectedFormats((prev) =>
      prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format],
    );
  };

  const runExports = () => {
    if (selectedFormats.length === 0) return;
    exportQueue.mutate(
      { projectId, data: { formats: selectedFormats as ('16:9' | '9:16' | '1:1')[] } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  const runThumbnail = () => {
    if (!snapshot.thumbnail) return;
    thumbQueue.mutate(
      { projectId, data: { assetId: snapshot.thumbnail.assetId, timeMs: snapshot.thumbnail.timeMs } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  const latestExport = (jobs.data ?? []).filter((job) => job.type === 'EXPORT').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const exportError = exportQueue.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
        <Clapperboard className="h-4 w-4" />
        Multi-format export
      </div>

      <div className="mt-4">
        <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">Thumbnail frame</span>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff4e6] px-3 py-1.5 font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#286254]" data-testid="thumbnail-frame">
            <ImageIcon className="h-3.5 w-3.5" />
            {snapshot.thumbnail ? `frame @ ${formatTimecode(thumbTimeMs)}` : 'no frame marked'}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={runThumbnail}
              disabled={!snapshot.thumbnail || thumbQueue.isPending}
              className="focus-house inline-flex items-center gap-1.5 rounded-full bg-[#292b45] px-3 py-1.5 text-xs font-bold text-[#fff4e6] hover:bg-[#286254] disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-extract-thumbnail"
            >
              <ImageIcon className={`h-3 w-3 ${thumbQueue.isPending ? 'animate-pulse' : ''}`} />
              {thumbQueue.isPending ? 'Extracting…' : 'Extract thumbnail'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 border-t-2 border-[#8dc2ad] pt-4">
        <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">Formats</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXPORT_FORMATS.map((item) => {
            const active = selectedFormats.includes(item.format);
            return (
              <button
                key={item.format}
                type="button"
                onClick={() => canEdit && toggleFormat(item.format)}
                className={`focus-house rounded-full border-2 px-3 py-1.5 text-xs font-bold ${active ? 'border-[#292b45] bg-[#292b45] text-[#fff4e6]' : 'border-[#8dc2ad] bg-[#fff4e6] text-[#286254]'}`}
                data-testid={`export-format-${item.format}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={runExports}
            disabled={exportQueue.isPending || selectedFormats.length === 0}
            className="focus-house mt-4 inline-flex items-center gap-2 rounded-xl bg-[#e55b4c] px-4 py-2.5 text-sm font-bold text-[#fff4e6] hover:bg-[#c7473c] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-run-exports"
          >
            <Clapperboard className={`h-4 w-4 ${exportQueue.isPending ? 'animate-pulse' : ''}`} />
            {exportQueue.isPending ? 'Queuing…' : 'Queue exports'}
          </button>
        )}
        {latestExport && (
          <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#286254]" data-testid="export-status">
            <Sparkles className="h-3.5 w-3.5" />
            Latest export: {latestExport.status.toLowerCase()} · {String(latestExport.params?.format ?? '')}
            {latestExport.status === 'SUCCEEDED' && Boolean(latestExport.result?.demo) && ' · demo receipt'}
          </p>
        )}
        {exportQueue.isError && (
          <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
            {exportError?.response?.data?.error || 'The export could not be queued.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContentCreatorsFinishPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Live: export/thumbnail progress, comments, and submissions.
  useProjectRealtime(projectId, 'FINISH');
  const [working, setWorking] = useState<FinishSnapshot>(EMPTY_FINISH);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');

  const project = useGetVideoProject(projectId);
  const finishTimeline = useGetVideoTimeline(projectId, 'FINISH');
  const save = useSaveVideoTimeline();

  useEffect(() => {
    if (finishTimeline.data?.snapshot) {
      const snapshot = finishTimeline.data.snapshot as unknown as FinishSnapshot;
      setWorking({
        clips: Array.isArray(snapshot.clips) ? snapshot.clips : [],
        captions: snapshot.captions ?? EMPTY_FINISH.captions,
        lowerThirds: Array.isArray(snapshot.lowerThirds) ? snapshot.lowerThirds : [],
        thumbnail: snapshot.thumbnail ?? null,
        sceneBlocks: Array.isArray(snapshot.sceneBlocks) ? snapshot.sceneBlocks : [],
        markers: Array.isArray(snapshot.markers) ? snapshot.markers : [],
      });
      setDirty(false);
    }
  }, [finishTimeline.data?.snapshot, finishTimeline.data?.version]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === 'MOTION_COLOR';

  const onSave = () => {
    save.mutate(
      { projectId, leg: 'FINISH', data: { snapshot: working as unknown as Record<string, unknown>, message: message.trim() || undefined } },
      {
        onSuccess: () => {
          setMessage('');
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, 'FINISH') });
        },
      },
    );
  };

  const saveError = save.error as { response?: { data?: { error?: string } } } | null;

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
        <SectionEyebrow>Finishing suite closed</SectionEyebrow>
        <h1 className="mt-5 text-6xl font-extrabold tracking-[-0.08em]">This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">
          <ArrowLeft className="h-4 w-4" />
          Back to the vault
        </Link>
      </div>
    );
  }

  const p = project.data;
  const released = p.status === 'RELEASED';

  return (
    <div className="mx-auto max-w-[1280px]">
      <Link href={`/projects/${p.id}`} className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-finish-back-vault">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to the vault
      </Link>

      <div className="reveal mt-4 flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-7 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Content creators / the finishing suite</SectionEyebrow>
          <h1 className="mt-3 text-4xl font-extrabold leading-[.92] tracking-[-0.06em] text-[#292b45] sm:text-6xl">Finish &amp; polish.</h1>
          <p className="mt-3 max-w-xl text-sm leading-[1.8] text-[#625f6d]">
            Grade every clip into one look, burn captions from the transcript, place lower thirds, and export every format.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {LEG_TABS.map((item) => {
            const Icon = item.icon;
            const active = item.leg === 'FINISH';
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
                data-testid={`finish-tab-leg-${item.leg}`}
              >
                <Icon className="h-4 w-4" />
                {item.role}
              </Link>
            );
          })}
        </div>
      </div>

      {released && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border-2 border-[#286254] bg-[#e5f1e8] px-5 py-3 text-sm font-bold text-[#286254]" data-testid="banner-released">
          <Check className="h-4 w-4" />
          The Lock is released — the team can download the finals from the vault.
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#286254]">
        <Check className="h-4 w-4" />
        {canEdit ? 'Editing as Motion & Color Director' : 'Viewing — Motion & Color Director can edit'}
      </div>

      <div className="reveal reveal-1 mt-8 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-4">
          <GradePanel snapshot={working} onChange={(next) => { setWorking(next); setDirty(true); }} assets={p.assets} canEdit={canEdit} />
          <CaptionsPanel snapshot={working} onChange={(next) => { setWorking(next); setDirty(true); }} canEdit={canEdit} />
          <LowerThirdsPanel snapshot={working} onChange={(next) => { setWorking(next); setDirty(true); }} canEdit={canEdit} />
          <CommentsPanel projectId={p.id} leg="FINISH" />
        </div>

        <div className="space-y-4">
          <ExportPanel
            projectId={p.id}
            snapshot={working}
            canEdit={canEdit}
            onThumbnail={() => {}}
          />

          {dirty && (
            <p className="flex items-center gap-2 text-xs font-semibold text-[#a33d31]">
              <Sparkles className="h-3.5 w-3.5" />
              Unsaved changes
            </p>
          )}

          <div className="rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5">
            <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
              <Save className="h-4 w-4" />
              Save this finish
            </div>
            {canEdit ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="What changed in this pass? (optional)"
                  maxLength={500}
                  className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
                  data-testid="finish-input-save-message"
                />
                <button
                  type="button"
                  onClick={onSave}
                  disabled={save.isPending || !dirty}
                  className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="finish-button-save"
                >
                  <Save className="h-4 w-4" />
                  {save.isPending ? 'Saving…' : 'Save finish'}
                </button>
              </div>
            ) : (
              <p className="mt-4 text-sm font-semibold text-[#286254]">Only the Motion &amp; Color Director or the Captain can change this finish.</p>
            )}
            {save.isError && (
              <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
                {saveError?.response?.data?.error || 'The finish could not be saved.'}
              </p>
            )}
          </div>

          <HistoryPanel
            projectId={p.id}
            leg="FINISH"
            versions={finishTimeline.data?.versions ?? []}
            currentVersion={finishTimeline.data?.version ?? null}
            canSubmit={canEdit}
          />
        </div>
      </div>

      <p className="reveal reveal-2 mt-10 flex items-center gap-3 border-t-2 border-[#d6cbb9] pt-3 text-xs text-[#77717a]">
        <LockKeyhole className="h-4 w-4 text-[#e55b4c]" />
        Submit the publish-ready master — when the Captain approves, the Lock releases and the whole team can download the finals.
      </p>
    </div>
  );
}
