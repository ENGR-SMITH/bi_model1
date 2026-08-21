// ---------------------------------------------------------------------------
// External-first bridge (VCS design §8, phases 1–2) — shared for every leg.
//
//   CheckoutPanel — the "clone": download the leg's saved snapshot as a
//                   CMX3600 EDL, FCPXML 1.9 project, or OpenTimelineIO
//                   document (plus the referenced-media manifest) so the
//                   editor can finish it in an external NLE.
//   ImportFlow    — the "push": bring back an edited document as a new
//                   Git-style version, relinked to the vault, and submit it
//                   for review.
//
// Both are leg-parameterised, so the selects / cut / sound / finish studios
// share one implementation instead of each hand-rolling fetch calls.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Check, Download, Film, Package, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getCheckoutVideoTimelineAafUrl,
  getCheckoutVideoTimelineFcpxmlUrl,
  getCheckoutVideoTimelineOtioUrl,
  getCheckoutVideoTimelineUrl,
  getGetVideoTimelineCheckoutManifestQueryKey,
  getGetVideoTimelineQueryKey,
  getListVideoJobsQueryKey,
  getListVideoSubmissionsQueryKey,
  getGetVideoTimelineCheckoutBundleDownloadUrl,
  useExportVideoTimelineCheckout,
  useGetVideoTimelineCheckoutManifest,
  useImportVideoTimeline,
  useListVideoJobs,
} from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';
import { useRealtimeSocket } from '@/lib/realtime';

type InterchangeFormat = 'EDL' | 'FCPXML' | 'OTIO' | 'AAF';

const FORMAT_LABELS: Record<InterchangeFormat, string> = {
  EDL: 'EDL',
  FCPXML: 'FCPXML',
  OTIO: 'OTIO',
  AAF: 'AAF',
};

/** Formats that can be re-imported (AAF is export-only per the design). */
/** Formats the import endpoint accepts (AAF is export-only). */
type ImportFormat = 'EDL' | 'FCPXML' | 'OTIO';
const IMPORT_FORMATS: ImportFormat[] = ['EDL', 'FCPXML', 'OTIO'];

function checkoutFilename(
  projectName: string,
  leg: string,
  version: number | null,
  format: InterchangeFormat,
): string {
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project';
  const ext = format === 'FCPXML' ? 'fcpxml' : format === 'OTIO' ? 'otio' : format === 'AAF' ? 'aaf' : 'edl';
  return `${slug}-${leg.toLowerCase()}-v${version ?? 0}.${ext}`;
}

/**
 * Download the leg's current snapshot as a CMX3600 EDL or FCPXML project to
 * finish in an external NLE, with the referenced source media listed from the
 * server manifest (so the list reflects the saved version, not the unsaved
 * working state).
 */
export function CheckoutPanel({
  projectId,
  projectName,
  leg,
  savedVersion,
}: {
  projectId: string;
  projectName: string;
  leg: StudioLeg;
  /** The leg's saved head version — null before the first snapshot is saved. */
  savedVersion: number | null;
}) {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<InterchangeFormat>('EDL');
  const [includeMedia, setIncludeMedia] = useState(false);
  const [liveProgress, setLiveProgress] = useState<number | null>(null);

  // The latest EXPORT_BUNDLE job for this leg. The server streams job.progress
  // events into the project room and invalidates the jobs list, so this query
  // moves QUEUED → RUNNING → SUCCEEDED without a manual refresh.
  const jobs = useListVideoJobs(projectId);
  const bundleJob = (jobs.data ?? [])
    .filter((job) => job.type === 'EXPORT_BUNDLE' && (job.params as { leg?: string } | null)?.leg === leg)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const exportMutation = useExportVideoTimelineCheckout();

  // Track the live 0–100 percentage straight off the socket (the jobs list
  // only carries status, not the transient progress value).
  const socket = useRealtimeSocket();
  useEffect(() => {
    if (!socket || !bundleJob) return;
    const onProgress = (payload: { projectId: string; jobId: string; progress?: number }) => {
      if (payload.projectId !== projectId || payload.jobId !== bundleJob.id) return;
      if (typeof payload.progress === 'number') setLiveProgress(payload.progress);
    };
    socket.on('job.progress', onProgress);
    return () => {
      socket.off('job.progress', onProgress);
    };
  }, [socket, bundleJob, projectId]);

  const onBuildBundle = () => {
    exportMutation.mutate(
      { projectId, leg, data: { includeMedia } },
      {
        onSuccess: () => {
          setLiveProgress(null);
          // The enqueued job lands in the jobs list; the socket invalidates it live.
          queryClient.invalidateQueries({ queryKey: getListVideoJobsQueryKey(projectId) });
        },
      },
    );
  };

  // Keyed on savedVersion so a fresh save refetches the manifest automatically.
  const manifest = useGetVideoTimelineCheckoutManifest(projectId, leg, {
    query: {
      queryKey: [...getGetVideoTimelineCheckoutManifestQueryKey(projectId, leg), savedVersion],
      enabled: savedVersion != null,
    },
  });

  const media = manifest.data?.media ?? [];
  const ready = savedVersion != null && !manifest.isLoading;
  const downloadUrl =
    format === 'FCPXML'
      ? getCheckoutVideoTimelineFcpxmlUrl(projectId, leg)
      : format === 'OTIO'
        ? getCheckoutVideoTimelineOtioUrl(projectId, leg)
        : format === 'AAF'
          ? getCheckoutVideoTimelineAafUrl(projectId, leg)
          : getCheckoutVideoTimelineUrl(projectId, leg);

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Download size={13} /> Checkout — interchange</span>
        {ready && <span className="mono-label">v{savedVersion}</span>}
      </div>
      <p className="setting-copy">
        Download this {leg.toLowerCase()} pass as a CMX3600 EDL (Premiere, Resolve, Avid), an FCPXML 1.9 project (Final Cut, Premiere), OpenTimelineIO — the canonical interchange every NLE can round-trip — or an AAF handoff (export-only) for Avid/Premiere AMA.
      </p>
      <div className="den-chip-list mt-3">
        {(['EDL', 'FCPXML', 'OTIO', 'AAF'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={`den-chip ${format === option ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : ''}`}
            onClick={() => setFormat(option)}
            data-testid={`checkout-format-${option.toLowerCase()}`}
          >
            {FORMAT_LABELS[option]}
          </button>
        ))}
      </div>
      {ready ? (
        <a
          href={downloadUrl}
          download={checkoutFilename(projectName, leg, savedVersion, format)}
          className="primary-btn mt-3"
          data-testid={`${leg.toLowerCase()}-button-checkout-${format.toLowerCase()}`}
        >
          <Download size={14} />
          Download {format}
        </a>
      ) : (
        <p className="setting-copy mt-3">Save a snapshot first — the checkout exports the saved version of this leg.</p>
      )}
      {media.length > 0 && (
        <div className="mt-3">
          <span className="mono-label">
            {media.length} source file{media.length === 1 ? '' : 's'} referenced
          </span>
          <ul className="mt-2 space-y-1">
            {media.map((item) => (
              <li key={item.assetId} className="den-footnote">
                <Film size={11} /> {item.fileName}
                <span className="mono-label ml-1">
                  {item.kind.replaceAll('_', ' ')} · {item.clipIds.length} clip{item.clipIds.length === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Background export bundle — the whole interchange ladder + manifest in
          one zip, built in the queue with live progress (design §8.5). */}
      <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
        <div className="inline-heading">
          <span className="eyebrow"><Package size={13} /> Export bundle</span>
          {bundleJob && bundleJob.status === 'SUCCEEDED' && <span className="den-tag teal">ready</span>}
          {bundleJob && ['QUEUED', 'RUNNING'].includes(bundleJob.status) && <span className="den-tag gold">{bundleJob.status.toLowerCase()}</span>}
          {bundleJob && bundleJob.status === 'FAILED' && <span className="den-tag">failed</span>}
        </div>
        <p className="setting-copy">
          Build one downloadable zip with every interchange doc (EDL, FCPXML, OTIO, AAF) plus the manifest — optionally embedding the referenced originals for a fully self-contained handoff.
        </p>
        <label className="den-footnote mt-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeMedia}
            onChange={(event) => setIncludeMedia(event.target.checked)}
            disabled={!ready || exportMutation.isPending || (bundleJob != null && ['QUEUED', 'RUNNING'].includes(bundleJob.status))}
            data-testid={`${leg.toLowerCase()}-checkout-bundle-include-media`}
          />
          Include referenced media ({media.length} file{media.length === 1 ? '' : 's'})
        </label>
        {!bundleJob || ['FAILED', 'SUCCEEDED'].includes(bundleJob.status) ? (
          <button
            type="button"
            onClick={onBuildBundle}
            disabled={!ready || exportMutation.isPending}
            className="secondary-btn mt-3"
            data-testid={`${leg.toLowerCase()}-button-checkout-bundle`}
          >
            <Package size={13} />
            {exportMutation.isPending ? 'Enqueuing…' : bundleJob ? 'Rebuild bundle' : 'Build bundle'}
          </button>
        ) : null}
        {bundleJob && ['QUEUED', 'RUNNING'].includes(bundleJob.status) && (
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <span className="den-footnote">{bundleJob.status === 'QUEUED' ? 'Queued behind other jobs…' : 'Building…'}</span>
              <span className="mono-label">{liveProgress != null ? `${liveProgress}%` : '…'}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--border))]">
              <div
                className="h-full bg-[hsl(var(--accent))] transition-all duration-300"
                style={{ width: `${liveProgress ?? 5}%` }}
              />
            </div>
          </div>
        )}
        {bundleJob && bundleJob.status === 'SUCCEEDED' && (
          <a
            href={getGetVideoTimelineCheckoutBundleDownloadUrl(projectId, leg)}
            download={`${checkoutFilename(projectName, leg, savedVersion, format).replace(/\.(edl|fcpxml|otio|aaf)$/, '')}-bundle.zip`}
            className="primary-btn mt-3"
            data-testid={`${leg.toLowerCase()}-button-checkout-bundle-download`}
          >
            <Download size={14} />
            Download bundle (.zip)
          </a>
        )}
        {bundleJob && bundleJob.status === 'FAILED' && (
          <p className="setting-copy mt-2" role="alert">
            {bundleJob.error ?? 'The bundle build failed.'}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Re-import an edited EDL or FCPXML from an external NLE. The server parses
 * it, relinks the sources to vault assets, saves a new version (merging into
 * the existing snapshot so leg-specific fields survive), and submits it for
 * review.
 */
export function ImportFlow({
  projectId,
  leg,
  canEdit,
}: {
  projectId: string;
  leg: StudioLeg;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const importMutation = useImportVideoTimeline();
  const [format, setFormat] = useState<ImportFormat>('EDL');
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<string | null>(null);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(null);
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    documentRef.current = await file.text();
  };

  const onImport = () => {
    const document = documentRef.current;
    if (!document) {
      setError('Choose an interchange file first.');
      return;
    }
    importMutation.mutate(
      { projectId, leg, data: { format, document, message: message.trim() || undefined, submit: true } },
      {
        onSuccess: (data) => {
          setResult(
            `Imported ${data.clips} clip${data.clips === 1 ? '' : 's'} as v${data.version}${data.submissionId ? ' and submitted for review' : ''}`,
          );
          setMessage('');
          setFileName(null);
          documentRef.current = null;
          if (fileRef.current) fileRef.current.value = '';
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, leg) });
          queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
        },
        onError: (err) => {
          const data = (err as { response?: { data?: { error?: string; unresolved?: string[] } } }).response?.data;
          const missing = data?.unresolved?.length ? ` Missing: ${data.unresolved.join(', ')}` : '';
          setError(`${data?.error ?? 'The import could not be completed.'}${missing}`);
        },
      },
    );
  };

  return (
    <div className="paper-card">
      <div className="inline-heading">
        <span className="eyebrow"><Upload size={13} /> Import — interchange</span>
      </div>
      <p className="setting-copy">
        Bring back an edited .edl, .fcpxml, or .otio from Premiere/Resolve/Avid/Final Cut — it becomes a new version of this leg and is submitted for review.
      </p>
      <div className="den-chip-list mt-3">
        {IMPORT_FORMATS.map((option) => (
          <button
            key={option}
            type="button"
            className={`den-chip ${format === option ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : ''}`}
            onClick={() => setFormat(option)}
            data-testid={`import-format-${option.toLowerCase()}`}
          >
            {FORMAT_LABELS[option]}
          </button>
        ))}
      </div>
      {canEdit ? (
        <div className="mt-3 space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept=".edl,.fcpxml,.otio,text/plain,application/xml,application/json,.xml,.json"
            onChange={onPick}
            data-testid={`${leg.toLowerCase()}-input-import-${format.toLowerCase()}`}
          />
          {fileName && <p className="den-footnote"><Film size={11} /> {fileName}</p>}
          <div className="flex gap-2">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What changed in this pass? (optional)"
              maxLength={500}
            />
            <button type="button" onClick={onImport} disabled={importMutation.isPending} className="primary-btn" data-testid={`${leg.toLowerCase()}-button-import-${format.toLowerCase()}`}>
              <Upload size={13} />
              {importMutation.isPending ? 'Importing…' : 'Import & submit'}
            </button>
          </div>
        </div>
      ) : (
        <p className="setting-copy mt-3">Only the leg role or the Captain can import an edited cut.</p>
      )}
      {result && <p className="den-footnote mt-2"><Check size={12} /> {result}</p>}
      {error && (
        <p className="setting-copy mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
