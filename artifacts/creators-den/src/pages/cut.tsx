import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  Camera,
  Check,
  ChevronsLeftRight,
  Clapperboard,
  Download,
  Film,
  Layers,
  Link2,
  LockKeyhole,
  Mic2,
  MoveHorizontal,
  MoveRight,
  MousePointer2,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Sparkles,
  Upload,
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
  getListVideoSubmissionsQueryKey,
  getListVideoSyncsQueryKey,
  oracleChat,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoJobs,
  useListVideoSyncs,
  useRenderVideoTimeline,
  useSaveVideoTimeline,
  useSyncVideoAsset,
} from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from './selects';
import { Timeline, formatTimecode, formatDuration, activeBlockId, MIN_CLIP_MS, type TimelineBlock, type TimelineTool } from '@/components/timeline';
import { RoleOracle, AiResult } from '@/components/role-oracle';
import { AssetPlayer, EmptyPlayer, pollWhileProcessing } from '@/components/asset-preview';

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
// Player + beat markers (left rail)
// ---------------------------------------------------------------------------

function PlayerRail({
  projectId,
  assets,
  beats,
  playheadMs,
  onSeek,
}: {
  projectId: string;
  assets: Array<{ id: string; fileName: string }>;
  beats: CutSnapshot['sceneBlocks'];
  playheadMs: number;
  onSeek: (ms: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [assetId, setAssetId] = useState<string | null>(assets[0]?.id ?? null);
  const asset = useGetVideoAsset(projectId, assetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId ?? ''),
      enabled: Boolean(assetId),
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
          />
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
    <div className="paper-card accent-card">
      <div className="inline-heading">
        <span className="eyebrow"><Link2 size={13} /> Multi-cam sync</span>
      </div>
      <p className="setting-copy">
        Align two angles by waveform. The offset shows how the second camera sits against the first, so your switches land on the same moment.
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
// Editing toolbox (Premiere Pro-style tool strip)
// ---------------------------------------------------------------------------

const CUT_TOOLS: Array<{ id: TimelineTool; label: string; key: string; hint: string; icon: typeof MousePointer2 }> = [
  { id: 'select', label: 'Selection', key: 'V', hint: 'Drag to move · pull edges to trim · click the ruler to scrub', icon: MousePointer2 },
  { id: 'razor', label: 'Razor', key: 'B', hint: 'Click inside a clip to split it at that point', icon: Scissors },
  { id: 'ripple', label: 'Ripple trim', key: 'N', hint: 'Pull an edge — every clip that follows shifts to close the gap', icon: MoveRight },
  { id: 'rolling', label: 'Rolling', key: 'C', hint: 'Pull a cut — the two adjacent clips trade time without moving the rest', icon: ArrowRightLeft },
  { id: 'slip', label: 'Slip', key: 'S', hint: 'Drag a clip body — the source window slides underneath, position and duration stay put', icon: ChevronsLeftRight },
  { id: 'slide', label: 'Slide', key: 'Y', hint: 'Drag a clip body — it slides between its neighbors, which trim to make room', icon: MoveHorizontal },
];

function Toolbox({
  tool,
  onToolChange,
  canEdit,
}: {
  tool: TimelineTool;
  onToolChange: (next: TimelineTool) => void;
  canEdit: boolean;
}) {
  return (
    <div className="den-toolbox" role="toolbar" aria-label="Editing tools" data-testid="cut-toolbox">
      {CUT_TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            className={`den-tool-btn ${tool === t.id ? 'active' : ''}`}
            onClick={() => onToolChange(t.id)}
            disabled={!canEdit}
            title={`${t.label} (${t.key}) — ${t.hint}`}
            aria-pressed={tool === t.id}
            data-testid={`cut-tool-${t.id}`}
          >
            <Icon size={14} />
            <span>{t.label}</span>
            <kbd>{t.key}</kbd>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cut builder: main track + overlay layer with drag-and-drop
// ---------------------------------------------------------------------------

function CutBuilder({
  snapshot,
  onChange,
  assets,
  syncs,
  canEdit,
  durationMs,
  playheadMs,
  onScrub,
  tool,
  onToolChange,
}: {
  snapshot: CutSnapshot;
  onChange: (next: CutSnapshot) => void;
  assets: Array<{ id: string; fileName: string; kind: string; durationMs?: number | null }>;
  syncs: Array<{ primaryAssetId: string; targetAssetId: string; offsetMs: number }>;
  canEdit: boolean;
  durationMs: number;
  playheadMs: number;
  onScrub: (ms: number) => void;
  tool: TimelineTool;
  onToolChange: (next: TimelineTool) => void;
}) {
  const [overlayAssetId, setOverlayAssetId] = useState('');

  const overlayCandidates = assets.filter((a) => ['B_ROLL', 'SCREEN_REC', 'GRAPHIC', 'REFERENCE'].includes(a.kind));
  const videoCandidates = assets.filter((a) => ['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE'].includes(a.kind));

  const clipBlocks: TimelineBlock[] = snapshot.clips.map((clip, index) => {
    const asset = assets.find((a) => a.id === clip.assetId);
    const sync = syncs.find((s) => s.primaryAssetId === clip.assetId || s.targetAssetId === clip.assetId);
    return {
      id: clip.id,
      label: `${index + 1} · ${asset?.fileName ?? clip.assetId}`,
      sublabel: sync ? formatOffset(sync.offsetMs) : formatDuration(clip.outMs - clip.inMs),
      startMs: clip.inMs,
      endMs: clip.outMs,
      srcInMs: clip.srcInMs ?? clip.inMs,
      srcOutMs: clip.srcOutMs ?? clip.outMs,
      srcDurationMs: asset?.durationMs ?? durationMs,
      tone: 'accent',
    };
  });

  const overlayBlocks: TimelineBlock[] = snapshot.overlays.map((overlay) => ({
    id: overlay.id,
    label: assets.find((a) => a.id === overlay.assetId)?.fileName ?? overlay.assetId,
    sublabel: 'overlay',
    startMs: overlay.inMs,
    endMs: overlay.outMs,
    tone: 'teal',
  }));

  const onClipsChange = (next: TimelineBlock[]) => {
    const nextClips = snapshot.clips.map((clip) => {
      const block = next.find((b) => b.id === clip.id);
      // Keep the source window (srcInMs/srcOutMs) in sync with the block so
      // slip edits, source-aware trims, and razor splits all survive a save.
      return block
        ? {
            ...clip,
            inMs: block.startMs,
            outMs: block.endMs,
            srcInMs: block.srcInMs ?? clip.srcInMs,
            srcOutMs: block.srcOutMs ?? clip.srcOutMs,
          }
        : clip;
    });
    onChange({ ...snapshot, clips: nextClips });
  };

  const onOverlaysChange = (next: TimelineBlock[]) => {
    const nextOverlays = snapshot.overlays.map((overlay) => {
      const block = next.find((b) => b.id === overlay.id);
      return block ? { ...overlay, inMs: block.startMs, outMs: block.endMs } : overlay;
    });
    onChange({ ...snapshot, overlays: nextOverlays });
  };

  const addOverlay = (assetIdToAdd: string, atMs: number) => {
    const overlay: CutOverlay = { id: crypto.randomUUID(), assetId: assetIdToAdd, inMs: atMs, outMs: atMs + 5000 };
    onChange({ ...snapshot, overlays: [...snapshot.overlays, overlay] });
  };

  const addOverlayViaSelect = () => {
    if (!overlayAssetId) return;
    addOverlay(overlayAssetId, 0);
    setOverlayAssetId('');
  };

  const updateClipAsset = (id: string, assetId: string) => {
    onChange({ ...snapshot, clips: snapshot.clips.map((c) => (c.id === id ? { ...c, assetId } : c)) });
  };

  // Razor: split a clip at the clicked timecode. The source window is cut at the
  // matching source position (sourcePos = srcIn + (timelinePos - in)), so slip
  // offsets survive the split.
  const handleRazor = (ms: number) => {
    const clip = snapshot.clips.find(
      (c) => ms > c.inMs && ms < c.outMs && ms - c.inMs >= MIN_CLIP_MS && c.outMs - ms >= MIN_CLIP_MS,
    );
    if (!clip) return;
    const srcIn = clip.srcInMs ?? clip.inMs;
    const srcOut = clip.srcOutMs ?? clip.outMs;
    const splitSrc = srcIn + (ms - clip.inMs);
    const left: CutClip = { ...clip, outMs: ms, srcOutMs: splitSrc };
    const right: CutClip = { ...clip, id: crypto.randomUUID(), inMs: ms, srcInMs: splitSrc };
    onChange({ ...snapshot, clips: snapshot.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])) });
  };

  const activeTool = CUT_TOOLS.find((t) => t.id === tool) ?? CUT_TOOLS[0];

  return (
    <div className="space-y-4">
      <Toolbox tool={tool} onToolChange={onToolChange} canEdit={canEdit} />

      <Timeline
        title={`Main track — ${snapshot.clips.length} clips`}
        hint={activeTool.hint}
        blocks={clipBlocks}
        durationMs={durationMs}
        playheadMs={playheadMs}
        canEdit={canEdit}
        onChange={onClipsChange}
        onScrub={onScrub}
        activeId={activeBlockId(clipBlocks, playheadMs)}
        tool={tool}
        onRazor={handleRazor}
      />

      <div className="paper-card">
        <div className="inline-heading">
          <span className="eyebrow"><Layers size={13} /> Overlay layer — b-roll &amp; screens</span>
          <span className="mono-label">{snapshot.overlays.length} layered</span>
        </div>
        <p className="setting-copy">Drag a file from the bin onto the overlay timeline to place it — or pick one and add it.</p>

        {overlayCandidates.length > 0 && (
          <div className="den-chip-list mt-3">
            {overlayCandidates.map((a) => (
              <span
                key={a.id}
                draggable={canEdit}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', a.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                className="den-chip cursor-grab"
                title="Drag onto the overlay timeline"
                data-testid={`bin-asset-${a.id}`}
              >
                <Layers size={10} />
                {a.fileName}
              </span>
            ))}
          </div>
        )}

        <div
          className="mt-3"
          onDragOver={(event) => {
            if (!canEdit) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(event) => {
            if (!canEdit) return;
            event.preventDefault();
            const id = event.dataTransfer.getData('text/plain');
            if (!id) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            addOverlay(id, Math.round(ratio * durationMs));
          }}
        >
          <Timeline
            title=""
            hint=""
            blocks={overlayBlocks}
            durationMs={durationMs}
            playheadMs={playheadMs}
            canEdit={canEdit}
            onChange={onOverlaysChange}
            onScrub={onScrub}
            activeId={activeBlockId(overlayBlocks, playheadMs)}
          />
        </div>

        {canEdit && (
          <div className="mt-3 flex gap-2">
            <select value={overlayAssetId} onChange={(event) => setOverlayAssetId(event.target.value)} className="flex-1" data-testid="cut-select-overlay-asset">
              <option value="">Pick footage to layer…</option>
              {overlayCandidates.map((a) => (
                <option key={a.id} value={a.id}>{a.fileName}</option>
              ))}
            </select>
            <button type="button" onClick={addOverlayViaSelect} disabled={!overlayAssetId} className="secondary-btn" data-testid="button-add-overlay">
              <Plus size={13} /> Add layer
            </button>
          </div>
        )}
      </div>

      {canEdit && snapshot.clips.length > 0 && (
        <div className="paper-card">
          <div className="inline-heading">
            <span className="eyebrow">Camera per clip</span>
          </div>
          <div className="den-stack">
            {snapshot.clips.map((clip, index) => (
              <div key={clip.id} className="list-row" data-testid={`cut-clip-${clip.id}`}>
                <span className="world-symbol">{index + 1}</span>
                <span className="!text-xs">
                  <select value={clip.assetId} onChange={(event) => updateClipAsset(clip.id, event.target.value)} className="!w-auto !text-xs" data-testid={`cut-clip-camera-${clip.id}`}>
                    {videoCandidates.map((a) => (
                      <option key={a.id} value={a.id}>{a.fileName}</option>
                    ))}
                  </select>
                </span>
                <button type="button" onClick={() => onChange({ ...snapshot, clips: snapshot.clips.filter((c) => c.id !== clip.id) })} className="danger-icon" title="Remove clip">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
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
    <div className="paper-card accent-card">
      <div className="inline-heading">
        <span className="eyebrow"><Clapperboard size={13} /> Render preview</span>
      </div>
      <p className="setting-copy">
        Render the current cut so the Captain reviews the picture, not the JSON. Submitting this leg also queues a picture-lock render automatically.
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
// Checkout (EDL) — external-first bridge: download the cut as a CMX3600 EDL
// to finish in an external NLE, then re-import the new version.
// ---------------------------------------------------------------------------

function CheckoutPanel({
  projectId,
  projectName,
  clips,
  assets,
}: {
  projectId: string;
  projectName: string;
  clips: CutClip[];
  assets: Array<{ id: string; fileName: string }>;
}) {
  const assetIds = useMemo(
    () => [...new Set(clips.map((clip) => clip.assetId).filter(Boolean))],
    [clips],
  );
  const media = assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is { id: string; fileName: string } => Boolean(asset));

  const downloadName =
    (projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cut') +
    '-cut.edl';

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Download size={13} /> Checkout — EDL</span>
      </div>
      <p className="setting-copy">
        Download this cut as a CMX3600 EDL to finish it in Premiere, Resolve, or Avid, then re-import the new version for review.
      </p>
      <a
        href={`/api/video/projects/${projectId}/timelines/CUT/checkout`}
        download={downloadName}
        className="primary-btn"
        data-testid="cut-button-checkout-edl"
      >
        <Download size={14} />
        Download EDL
      </a>
      {media.length > 0 ? (
        <div className="mt-3">
          <span className="mono-label">{media.length} source file{media.length === 1 ? '' : 's'} referenced</span>
          <ul className="mt-2 space-y-1">
            {media.map((asset) => (
              <li key={asset.id} className="den-footnote"><Film size={11} /> {asset.fileName}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="den-footnote mt-2">No clips on the timeline yet — add clips before checking out.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import (EDL) — the push half: bring back an edited .edl from an external
// NLE as a new version, and submit it for review.
// ---------------------------------------------------------------------------

function ImportPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const edlRef = useRef<string | null>(null);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(null);
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    edlRef.current = await file.text();
  };

  const onImport = async () => {
    const edl = edlRef.current;
    if (!edl) {
      setError('Choose an .edl file first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/video/projects/${projectId}/timelines/CUT/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edl, message: message.trim() || undefined, submit: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        unresolved?: string[];
        version?: number;
        clips?: number;
        submissionId?: string | null;
      };
      if (!res.ok) {
        const missing = Array.isArray(data.unresolved) && data.unresolved.length ? ` Missing: ${data.unresolved.join(', ')}` : '';
        setError(`${data.error ?? 'Import failed'}${missing}`);
        return;
      }
      setResult(
        `Imported ${data.clips ?? 0} clips as v${data.version ?? '?'}${data.submissionId ? ' and submitted for review' : ''}`,
      );
      setMessage('');
      setFileName(null);
      edlRef.current = null;
      if (fileRef.current) fileRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, 'CUT') });
      queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
    } catch {
      setError('The import could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Upload size={13} /> Import — EDL</span>
      </div>
      <p className="setting-copy">
        Bring back an edited .edl from Premiere/Resolve/Avid — it becomes a new version and is submitted for review.
      </p>
      {canEdit ? (
        <div className="mt-3 space-y-2">
          <input ref={fileRef} type="file" accept=".edl,text/plain" onChange={onPick} data-testid="cut-input-import-edl" />
          {fileName && <p className="den-footnote"><Film size={11} /> {fileName}</p>}
          <div className="flex gap-2">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What changed in this pass? (optional)"
              maxLength={500}
            />
            <button type="button" onClick={onImport} disabled={busy} className="primary-btn" data-testid="cut-button-import-edl">
              <Upload size={13} />
              {busy ? 'Importing…' : 'Import & submit'}
            </button>
          </div>
        </div>
      ) : (
        <p className="setting-copy mt-3">Only the Visual Editor or the Captain can import an edited cut.</p>
      )}
      {result && <p className="den-footnote mt-2"><Check size={12} /> {result}</p>}
      {error && <p className="setting-copy mt-2" role="alert">{error}</p>}
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
  const [playheadMs, setPlayheadMs] = useState(0);
  const [tool, setTool] = useState<TimelineTool>('select');
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // Keyboard shortcuts mirror the Premiere Pro toolbox (V/B/N/C/S/Y).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const hit = CUT_TOOLS.find((t) => t.key === event.key.toUpperCase());
      if (hit) {
        event.preventDefault();
        setTool(hit.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const timelineDuration = Math.max(
    60_000,
    project.data?.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0) ?? 60_000,
  );

  const onScrub = (ms: number) => setPlayheadMs(ms);

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

  // AI context: current cut + beats + sync offsets.
  const oracleContext = useMemo(() => {
    const clips = working.clips.map((c, i) => `clip ${i + 1}: ${formatTimecode(c.inMs)}–${formatTimecode(c.outMs)} (asset ${c.assetId.slice(0, 8)})`).join('\n') || 'none yet';
    const overlays = working.overlays.map((o) => `overlay ${o.assetId.slice(0, 8)} @ ${formatTimecode(o.inMs)}–${formatTimecode(o.outMs)}`).join('\n') || 'none yet';
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
  }, [working, beats, syncs.data, project.data?.name, timelineDuration]);

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

  // Parse "clip N: in MM:SS out MM:SS" lines and apply as trims.
  const applyTrimsFromAnswer = (text: string): number => {
    let applied = 0;
    const re = /clip\s+(\d+)[:.)]\s*in\s+(\d{1,2}):(\d{2})\s*out\s+(\d{1,2}):(\d{2})/gi;
    let m: RegExpExecArray | null;
    const nextClips = working.clips.map((c) => ({ ...c }));
    while ((m = re.exec(text)) !== null) {
      const index = Number(m[1]) - 1;
      const clip = nextClips[index];
      if (!clip) continue;
      const inMs = (Number(m[2]) * 60 + Number(m[3])) * 1000;
      const outMs = (Number(m[4]) * 60 + Number(m[5])) * 1000;
      if (outMs > inMs && inMs >= 0 && outMs <= timelineDuration) {
        clip.inMs = inMs;
        clip.outMs = outMs;
        applied += 1;
      }
    }
    if (applied > 0) {
      setWorking((prev) => ({ ...prev, clips: nextClips }));
      setDirty(true);
    }
    return applied;
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
          if (!body) return;
          const count = applyTrimsFromAnswer(body);
          setAiResult({ title: count > 0 ? `Trim suggestions — ${count} applied` : 'Trim suggestions (review below)', body, meta: null });
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
          <span>Trim every cut, layer B-roll over the audio-heavy beats, and switch between synced cameras — then hand the Captain a picture-locked rough cut.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Visual Editor · precision cutting</SectionEyebrow>
          <h1>Precision cutting.</h1>
          <p>Drag clips on the timeline, pull their edges to trim, and drop b-roll straight onto the overlay layer.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-cut-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canEdit ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canEdit ? 'Editing as Visual Editor' : 'Viewing'}
          </span>
        </div>
      </div>

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
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
            <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`cut-tab-leg-${item.leg}`}>
              <Icon size={13} />
              {item.role}
            </Link>
          );
        })}
      </div>

      <div className="den-two-col">
        <div className="space-y-4">
          <PlayerRail
            projectId={p.id}
            assets={p.assets}
            beats={beats}
            playheadMs={playheadMs}
            onSeek={onScrub}
          />
        </div>

        <div className="space-y-4">
          <SyncPanel projectId={p.id} assets={p.assets} />

          <CutBuilder
            snapshot={working}
            onChange={(next) => { setWorking(next); setDirty(true); }}
            assets={p.assets}
            syncs={syncs.data ?? []}
            canEdit={canEdit}
            durationMs={timelineDuration}
            playheadMs={playheadMs}
            onScrub={onScrub}
            tool={tool}
            onToolChange={setTool}
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
            leg="CUT"
            roleName="Visual Editor"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canEdit}
            placeholder="e.g. Where should I switch cameras in the first minute?"
          />

          <div className="paper-card accent-card">
            <div className="inline-heading">
              <span className="eyebrow"><Save size={13} /> Save this cut</span>
            </div>
            {canEdit ? (
              <div className="mt-3 flex gap-2">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="What changed in this pass? (optional)"
                  maxLength={500}
                  data-testid="cut-input-save-message"
                />
                <button type="button" onClick={onSave} disabled={save.isPending || !dirty} className="primary-btn" data-testid="cut-button-save">
                  <Save size={13} />
                  {save.isPending ? 'Saving…' : 'Save cut'}
                </button>
              </div>
            ) : (
              <p className="setting-copy mt-3">Only the Visual Editor or the Captain can change this cut.</p>
            )}
            {dirty && <p className="den-footnote mt-2"><Sparkles size={12} /> Unsaved changes</p>}
            {save.isError && (
              <p className="setting-copy mt-2" role="alert">
                {saveError?.response?.data?.error || 'The cut could not be saved.'}
              </p>
            )}
          </div>

          <RenderPanel projectId={p.id} canEdit={canEdit} />

          <CheckoutPanel projectId={p.id} projectName={p.name} clips={working.clips} assets={p.assets} />

          <ImportPanel projectId={p.id} canEdit={canEdit} />

          <HistoryPanel
            projectId={p.id}
            leg="CUT"
            versions={cutTimeline.data?.versions ?? []}
            currentVersion={cutTimeline.data?.version ?? null}
            canSubmit={canEdit}
          />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Every frame stays locked. When you submit, a picture-lock render is queued and the Captain reviews the rendered cut.
      </p>
    </div>
  );
}
