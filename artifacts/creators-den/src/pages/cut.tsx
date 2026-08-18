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
  Mic2,
  Minus,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Sparkles,
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
  getListVideoSyncsQueryKey,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoJobs,
  useListVideoSyncs,
  useRenderVideoTimeline,
  useSaveVideoTimeline,
  useSyncVideoAsset,
} from '@workspace/api-client-react';
import type { VideoAssetDetail } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from './selects';

const LEG_TABS = [
  { leg: 'SELECTS', role: 'Story Architect', icon: Film },
  { leg: 'CUT', role: 'Visual Editor', icon: Scissors },
  { leg: 'SOUND', role: 'Sound Designer', icon: Mic2 },
  { leg: 'FINISH', role: 'Motion & Color', icon: Palette },
] as const;

interface CutClip {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
  camera?: string | null;
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

const TRIM_STEP_MS = 500;

function formatTimecode(ms: number | null | undefined): string {
  if (ms == null) return '–:––';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatOffset(ms: number): string {
  if (ms === 0) return 'in sync';
  const label = ms > 0 ? 'leads by' : 'lags by';
  return `${label} ${Math.abs(ms) / 1000}s`;
}

// ---------------------------------------------------------------------------
// Player + beat markers (left rail)
// ---------------------------------------------------------------------------

function PlayerRail({
  projectId,
  assets,
  beats,
  onSeek,
}: {
  projectId: string;
  assets: Array<{ id: string; fileName: string }>;
  beats: CutSnapshot['sceneBlocks'];
  onSeek: (ms: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [assetId, setAssetId] = useState<string | null>(assets[0]?.id ?? null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const asset = useGetVideoAsset(projectId, assetId ?? '', {
    query: { queryKey: getGetVideoAssetQueryKey(projectId, assetId ?? ''), enabled: Boolean(assetId) },
  });

  const hasProxy = (asset.data?.files ?? []).some((file) => file.kind === 'PROXY');
  const proxyUrl = assetId ? `/api/video/projects/${projectId}/assets/${assetId}/proxy` : null;

  const seek = (ms: number) => {
    setPlayheadMs(ms);
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      void videoRef.current.play().catch(() => {});
    }
    onSeek(ms);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">Proxy player</span>
          {assets.length > 1 && (
            <select
              value={assetId ?? ''}
              onChange={(event) => setAssetId(event.target.value || null)}
              className="focus-house rounded-lg border-2 border-[#e5d7c5] bg-[#f7eddf] px-3 py-1.5 text-xs text-[#292b45]"
              data-testid="cut-select-player-asset"
            >
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.fileName}</option>
              ))}
            </select>
          )}
        </div>

        {assetId ? (
          hasProxy ? (
            <video
              ref={videoRef}
              key={assetId}
              src={proxyUrl ?? undefined}
              controls
              preload="metadata"
              className="mt-4 aspect-video w-full rounded-xl border-2 border-[#292b45] bg-black"
              onTimeUpdate={(event) => setPlayheadMs(Math.floor((event.target as HTMLVideoElement).currentTime * 1000))}
              data-testid="cut-proxy-player"
            />
          ) : (
            <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf]">
              <div className="text-center">
                <Sparkles className="mx-auto h-7 w-7 animate-pulse text-[#e55b4c]" />
                <p className="mt-3 text-sm font-semibold text-[#625f6d]">Building the proxy…</p>
              </div>
            </div>
          )
        ) : (
          <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf]">
            <p className="text-sm font-semibold text-[#625f6d]">No footage in the vault yet.</p>
          </div>
        )}

        <p className="mt-3 flex items-center gap-2 text-xs text-[#77717a]">
          <LockKeyhole className="h-3.5 w-3.5 text-[#e55b4c]" />
          Streaming the degraded proxy — the locked original never leaves the server.
        </p>
      </div>

      <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
        <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
          <Film className="h-4 w-4" />
          Beat markers · from the selects pass
        </div>
        {beats.length === 0 ? (
          <p className="mt-3 text-sm text-[#77717a]">No scene blocks yet — the Story Architect marks the spine in the selects studio.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {beats.map((beat) => (
              <button
                key={beat.id}
                type="button"
                onClick={() => seek(beat.startMs)}
                className="focus-house inline-flex items-center gap-1.5 rounded-full border-2 border-[#8dc2ad] bg-[#e5f1e8] px-3 py-1.5 text-xs font-bold text-[#286254] hover:border-[#286254]"
                data-testid={`cut-beat-${beat.type}`}
              >
                <Play className="h-3 w-3" />
                {beat.type} · {formatTimecode(beat.startMs)}
              </button>
            ))}
          </div>
        )}
      </div>

      <CommentsPanel projectId={projectId} leg="CUT" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync panel
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
    <div className="rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
        <Link2 className="h-4 w-4" />
        Multi-cam sync
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#286254]">
        Align two angles by waveform. The offset shows how the second camera sits against the first, so your switches land on the same moment.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <select
          value={primary}
          onChange={(event) => setPrimary(event.target.value)}
          className="focus-house rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45]"
          data-testid="cut-select-sync-primary"
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.fileName}</option>
          ))}
        </select>
        <select
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className="focus-house rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45]"
          data-testid="cut-select-sync-target"
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.fileName}</option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={sync.isPending || !primary || !target || primary === target}
          className="focus-house inline-flex items-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-run-sync"
        >
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
          {sync.isPending ? 'Syncing…' : 'Sync cameras'}
        </button>
        {pair && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff4e6] px-3 py-1.5 font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#286254]" data-testid="sync-offset">
            <Camera className="h-3.5 w-3.5" />
            {formatOffset(pair.offsetMs)} · {pair.method}
          </span>
        )}
      </div>
      {sync.isError && (
        <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
          {syncError?.response?.data?.error || 'The sync could not be queued.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cut builder: main track + overlays
// ---------------------------------------------------------------------------

function TrimControl({
  label,
  valueMs,
  onNudge,
  min,
  max,
}: {
  label: string;
  valueMs: number;
  onNudge: (delta: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onNudge(-TRIM_STEP_MS)}
        disabled={min !== undefined && valueMs - TRIM_STEP_MS < min}
        className="rounded-full border border-[#d6cbb9] p-1 text-[#625f6d] hover:bg-[#ffe9df] hover:text-[#a33d31] disabled:opacity-40"
        title={`${label} −0.5s`}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-14 text-center font-mono-ui text-[10px] uppercase tracking-[.1em] text-[#292b45]">{label} {formatTimecode(valueMs)}</span>
      <button
        type="button"
        onClick={() => onNudge(TRIM_STEP_MS)}
        disabled={max !== undefined && valueMs + TRIM_STEP_MS > max}
        className="rounded-full border border-[#d6cbb9] p-1 text-[#625f6d] hover:bg-[#e5f1e8] hover:text-[#286254] disabled:opacity-40"
        title={`${label} +0.5s`}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

function CutBuilder({
  snapshot,
  onChange,
  assets,
  syncs,
  canEdit,
}: {
  snapshot: CutSnapshot;
  onChange: (next: CutSnapshot) => void;
  assets: Array<{ id: string; fileName: string; kind: string }>;
  syncs: Array<{ primaryAssetId: string; targetAssetId: string; offsetMs: number }>;
  canEdit: boolean;
}) {
  const [overlayAssetId, setOverlayAssetId] = useState('');

  const overlayCandidates = assets.filter((a) => ['B_ROLL', 'SCREEN_REC', 'GRAPHIC', 'REFERENCE'].includes(a.kind));
  const videoCandidates = assets.filter((a) => ['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE'].includes(a.kind));

  const updateClip = (id: string, patch: Partial<CutClip>) => {
    onChange({ ...snapshot, clips: snapshot.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const removeClip = (id: string) => {
    onChange({ ...snapshot, clips: snapshot.clips.filter((c) => c.id !== id) });
  };

  const addOverlay = () => {
    if (!overlayAssetId) return;
    const clip: CutOverlay = { id: crypto.randomUUID(), assetId: overlayAssetId, inMs: 0, outMs: 5000 };
    onChange({ ...snapshot, overlays: [...snapshot.overlays, clip] });
  };

  const updateOverlay = (id: string, patch: Partial<CutOverlay>) => {
    onChange({ ...snapshot, overlays: snapshot.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  };

  const removeOverlay = (id: string) => {
    onChange({ ...snapshot, overlays: snapshot.overlays.filter((o) => o.id !== id) });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">Main track — the cut</span>
          <span className="rounded-full bg-[#292b45] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#f0c85c]">{snapshot.clips.length} clips</span>
        </div>

        {snapshot.clips.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-[#77717a]">
            Start from the selects — add clips here, trim their in/out, and switch cameras per cut. (Tip: open the selects studio first to build the spine.)
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {snapshot.clips.map((clip, index) => {
              const sync = syncs.find(
                (s) => (s.primaryAssetId === clip.assetId) || (s.targetAssetId === clip.assetId),
              );
              return (
                <div key={clip.id} className="rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] p-3.5" data-testid={`cut-clip-${clip.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#292b45] font-mono-ui text-[10px] text-[#f0c85c]">{index + 1}</span>
                      {canEdit ? (
                        <select
                          value={clip.assetId}
                          onChange={(event) => updateClip(clip.id, { assetId: event.target.value })}
                          className="focus-house rounded-lg border-2 border-[#d6cbb9] bg-[#fff4e6] px-2.5 py-1.5 text-xs font-bold text-[#292b45]"
                          data-testid={`cut-clip-camera-${clip.id}`}
                        >
                          {videoCandidates.map((a) => (
                            <option key={a.id} value={a.id}>{a.fileName}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm font-bold text-[#292b45]">{assets.find((a) => a.id === clip.assetId)?.fileName ?? clip.assetId}</span>
                      )}
                      {sync && (
                        <span className="rounded-full bg-[#e5f1e8] px-2 py-0.5 font-mono-ui text-[8px] uppercase tracking-[.12em] text-[#286254]" title="Synced pair">
                          {formatOffset(sync.offsetMs)}
                        </span>
                      )}
                    </div>
                    {canEdit && (
                      <button type="button" onClick={() => removeClip(clip.id)} className="rounded-full p-1.5 text-[#98909a] hover:bg-[#ffe9df] hover:text-[#a33d31]" title="Remove clip">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {canEdit && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t-2 border-[#e5d7c5] pt-3">
                      <TrimControl
                        label="in"
                        valueMs={clip.inMs}
                        min={0}
                        max={clip.outMs - 100}
                        onNudge={(delta) => updateClip(clip.id, { inMs: Math.max(0, Math.min(clip.inMs + delta, clip.outMs - 100)) })}
                      />
                      <TrimControl
                        label="out"
                        valueMs={clip.outMs}
                        min={clip.inMs + 100}
                        onNudge={(delta) => updateClip(clip.id, { outMs: Math.max(clip.inMs + 100, clip.outMs + delta) })}
                      />
                      <span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">dur {formatTimecode(clip.outMs - clip.inMs)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
        <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
          <Layers className="h-4 w-4" />
          Overlay layer — b-roll &amp; screens
        </div>
        {overlayCandidates.length === 0 ? (
          <p className="mt-3 text-sm text-[#77717a]">Upload B-roll, screen recordings, or reference footage to layer over the cut.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select
              value={overlayAssetId}
              onChange={(event) => setOverlayAssetId(event.target.value)}
              className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45]"
              data-testid="cut-select-overlay-asset"
            >
              <option value="">Pick footage to layer…</option>
              {overlayCandidates.map((a) => (
                <option key={a.id} value={a.id}>{a.fileName}</option>
              ))}
            </select>
            {canEdit && (
              <button
                type="button"
                onClick={addOverlay}
                disabled={!overlayAssetId}
                className="focus-house inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#286254] px-4 py-2.5 text-sm font-bold text-[#fff4e6] hover:bg-[#1d5048] disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-add-overlay"
              >
                <Plus className="h-4 w-4" />
                Add layer
              </button>
            )}
          </div>
        )}

        {snapshot.overlays.length > 0 && (
          <div className="mt-4 space-y-2">
            {snapshot.overlays.map((overlay) => (
              <div key={overlay.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] px-3.5 py-2.5" data-testid={`cut-overlay-${overlay.id}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#292b45]">{assets.find((a) => a.id === overlay.assetId)?.fileName ?? overlay.assetId}</p>
                  <p className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">overlay</p>
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-3">
                    <TrimControl
                      label="in"
                      valueMs={overlay.inMs}
                      min={0}
                      max={overlay.outMs - 100}
                      onNudge={(delta) => updateOverlay(overlay.id, { inMs: Math.max(0, Math.min(overlay.inMs + delta, overlay.outMs - 100)) })}
                    />
                    <TrimControl
                      label="out"
                      valueMs={overlay.outMs}
                      min={overlay.inMs + 100}
                      onNudge={(delta) => updateOverlay(overlay.id, { outMs: Math.max(overlay.inMs + 100, overlay.outMs + delta) })}
                    />
                    <button type="button" onClick={() => removeOverlay(overlay.id)} className="rounded-full p-1.5 text-[#98909a] hover:bg-[#ffe9df] hover:text-[#a33d31]">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <span className="font-mono-ui text-[10px] text-[#77717a]">{formatTimecode(overlay.inMs)} → {formatTimecode(overlay.outMs)}</span>
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
// Render panel
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
    <div className="rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
        <Clapperboard className="h-4 w-4" />
        Render preview
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#286254]">
        Render the current cut so the Captain reviews the picture, not the JSON. Submitting this leg also queues a picture-lock render automatically.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canEdit && (
          <button
            type="button"
            onClick={queuePreview}
            disabled={render.isPending}
            className="focus-house inline-flex items-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-render-preview"
          >
            <Clapperboard className={`h-4 w-4 ${render.isPending ? 'animate-pulse' : ''}`} />
            {render.isPending ? 'Queuing…' : 'Render preview'}
          </button>
        )}
        {latest && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono-ui text-[10px] uppercase tracking-[.12em] ${
              latest.status === 'SUCCEEDED'
                ? 'bg-[#fff4e6] text-[#286254]'
                : latest.status === 'FAILED'
                  ? 'bg-[#ffe9df] text-[#a33d31]'
                  : 'bg-[#f0c85c] text-[#292b45]'
            }`}
            data-testid="render-status"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${latest.status === 'SUCCEEDED' ? 'bg-[#286254]' : latest.status === 'FAILED' ? 'bg-[#a33d31]' : 'animate-pulse bg-[#292b45]'}`} />
            {latest.status.toLowerCase()} · {String(latest.params?.format ?? 'PREVIEW').replaceAll('_', ' ')}
            {latest.status === 'SUCCEEDED' && Boolean(latest.result?.demo) && ' · demo receipt (no melt installed)'}
          </span>
        )}
      </div>
      {render.isError && (
        <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
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
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Live: render progress, sync results, comments, and submissions.
  useProjectRealtime(projectId, 'CUT');
  const [working, setWorking] = useState<CutSnapshot>(EMPTY_CUT);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');

  const project = useGetVideoProject(projectId);
  const cutTimeline = useGetVideoTimeline(projectId, 'CUT');
  const selectsTimeline = useGetVideoTimeline(projectId, 'SELECTS');
  const syncs = useListVideoSyncs(projectId);
  const save = useSaveVideoTimeline();

  // Seed working state from the CUT head whenever it changes.
  useEffect(() => {
    if (cutTimeline.data?.snapshot) {
      const snapshot = cutTimeline.data.snapshot as unknown as CutSnapshot;
      setWorking({
        clips: Array.isArray(snapshot.clips) ? snapshot.clips : [],
        overlays: Array.isArray(snapshot.overlays) ? snapshot.overlays : [],
        sceneBlocks: Array.isArray(snapshot.sceneBlocks) ? snapshot.sceneBlocks : [],
        markers: Array.isArray(snapshot.markers) ? snapshot.markers : [],
      });
      setDirty(false);
    }
  }, [cutTimeline.data?.snapshot, cutTimeline.data?.version]);

  // Beat markers: pull the Architect's scene blocks into the cut.
  const beats = useMemo(() => {
    const snap = selectsTimeline.data?.snapshot as unknown as CutSnapshot | null;
    return snap && Array.isArray(snap.sceneBlocks) ? snap.sceneBlocks : [];
  }, [selectsTimeline.data?.snapshot]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === 'VISUAL_EDITOR';

  const onSeek = (_ms: number) => {};

  const onSave = () => {
    save.mutate(
      { projectId, leg: 'CUT', data: { snapshot: working as unknown as Record<string, unknown>, message: message.trim() || undefined } },
      {
        onSuccess: () => {
          setMessage('');
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, 'CUT') });
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
        <SectionEyebrow>Cutting room closed</SectionEyebrow>
        <h1 className="mt-5 text-6xl font-extrabold tracking-[-0.08em]">This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">
          <ArrowLeft className="h-4 w-4" />
          Back to the vault
        </Link>
      </div>
    );
  }

  const p = project.data;

  return (
    <div className="mx-auto max-w-[1280px]">
      <Link href={`/projects/${p.id}`} className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-cut-back-vault">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to the vault
      </Link>

      <div className="reveal mt-4 flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-7 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Content creators / the cutting room</SectionEyebrow>
          <h1 className="mt-3 text-4xl font-extrabold leading-[.92] tracking-[-0.06em] text-[#292b45] sm:text-6xl">Precision cutting.</h1>
          <p className="mt-3 max-w-xl text-sm leading-[1.8] text-[#625f6d]">
            Trim every cut, layer B-roll over the audio-heavy beats, and switch between synced cameras — then hand the Captain a picture-locked rough cut.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {LEG_TABS.map((item) => {
            const Icon = item.icon;
            const active = item.leg === 'CUT';
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
                data-testid={`cut-tab-leg-${item.leg}`}
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
        {canEdit ? 'Editing as Visual Editor' : 'Viewing — Visual Editor can edit'}
      </div>

      <div className="reveal reveal-1 mt-8 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-4">
          <PlayerRail
            projectId={p.id}
            assets={p.assets}
            beats={beats}
            onSeek={onSeek}
          />
        </div>

        <div className="space-y-4">
          <SyncPanel projectId={p.id} assets={p.assets} />

          <CutBuilder
            snapshot={working}
            onChange={(next) => {
              setWorking(next);
              setDirty(true);
            }}
            assets={p.assets}
            syncs={syncs.data ?? []}
            canEdit={canEdit}
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
              Save this cut
            </div>
            {canEdit ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="What changed in this pass? (optional)"
                  maxLength={500}
                  className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
                  data-testid="cut-input-save-message"
                />
                <button
                  type="button"
                  onClick={onSave}
                  disabled={save.isPending || !dirty}
                  className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="cut-button-save"
                >
                  <Save className="h-4 w-4" />
                  {save.isPending ? 'Saving…' : 'Save cut'}
                </button>
              </div>
            ) : (
              <p className="mt-4 text-sm font-semibold text-[#286254]">Only the Visual Editor or the Captain can change this cut.</p>
            )}
            {save.isError && (
              <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
                {saveError?.response?.data?.error || 'The cut could not be saved.'}
              </p>
            )}
          </div>

          <RenderPanel projectId={p.id} canEdit={canEdit} />

          <HistoryPanel
            projectId={p.id}
            leg="CUT"
            versions={cutTimeline.data?.versions ?? []}
            currentVersion={cutTimeline.data?.version ?? null}
            canSubmit={canEdit}
          />
        </div>
      </div>

      <p className="reveal reveal-2 mt-10 flex items-center gap-3 border-t-2 border-[#d6cbb9] pt-3 text-xs text-[#77717a]">
        <LockKeyhole className="h-4 w-4 text-[#e55b4c]" />
        Every frame stays locked. When you submit, a picture-lock render is queued and the Captain reviews the rendered cut.
      </p>
    </div>
  );
}
