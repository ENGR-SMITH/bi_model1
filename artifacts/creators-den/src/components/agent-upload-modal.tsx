// ---------------------------------------------------------------------------
// Desktop-agent upload modal + the shared "browser uploads stop at N" gate.
//
// Small files (<500 MB) upload straight from the browser to R2 via the role
// upload cards. Files at or over the cap need the desktop agent (local
// FFmpeg proxy + resumable R2 upload), so this modal steps in when an upload
// would exceed the cap: it shows the blocked file, offers the agent download
// (with a short "preparing…" animation so the click feels like it triggered),
// and lays out the agent workflow next to it.
//
// This module is also the home of the "upload with the desktop agent" path
// that every upload section offers next to the browser upload: the agent is
// launched with the current project + a return URL, and the page polls the
// agent's loopback control server until the job finishes — then the agent
// reopens the Creator Den page (return URL) and the page refreshes its data,
// so the user is automatically back on Creator Den with the file handed in
// for the Captain's review.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  FolderOpen,
  Laptop,
  Loader2,
  MonitorDown,
  Projector,
  ShieldAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  agentDownloadUrl,
  checkAgentHealth,
  fetchAgentJobStatus,
  openAgentDeepLink,
  requestAgentLaunch,
  waitForAgentHealth,
  AGENT_JOB_POLL_MS,
  AGENT_STARTUP_WAIT_MS,
  type AgentJobStatus,
} from '@/lib/agent-bridge';

export { agentDownloadUrl } from '@/lib/agent-bridge';

/** Files this size or larger must go through the desktop agent, not the
 * browser (the browser path is a plain multipart POST — fine for small
 * project files and images, brutal for multi-GB footage). */
export const BROWSER_UPLOAD_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

/** Human-readable cap, e.g. "500 MB". */
export const BROWSER_UPLOAD_MAX_LABEL = '500 MB';

/** Pretty-print a byte count (e.g. 1.4 GB / 512 MB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

/** Does this file need the desktop agent instead of the browser upload? */
export function exceedsBrowserUploadCap(file: Pick<File, 'size'>): boolean {
  return file.size >= BROWSER_UPLOAD_MAX_BYTES;
}

// ---------------------------------------------------------------------------
// useAgentUploadFlow — launch the desktop agent with this project + a return
// URL, then watch the agent's control server until the upload job finishes.
// Used by the always-available "Desktop agent" button on the upload sections
// and by the ≥500 MB modal's "Open the desktop agent" CTA.
// ---------------------------------------------------------------------------

export type AgentFlowPhase = 'idle' | 'launching' | 'waiting' | 'done' | 'unavailable' | 'error';

export interface UseAgentUploadFlowOptions {
  projectId: string;
  /** The Creator Den URL the agent reopens once the upload succeeds. */
  returnUrl?: string;
  onDone?: (fileName?: string) => void;
}

export function useAgentUploadFlow({ projectId, returnUrl, onDone }: UseAgentUploadFlowOptions) {
  const [phase, setPhase] = useState<AgentFlowPhase>('idle');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  // Guard async continuations against unmount / stale runs.
  const stopRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const returnUrlRef = useRef(returnUrl);
  returnUrlRef.current = returnUrl;

  useEffect(
    () => () => {
      stopRef.current = true;
    },
    [],
  );

  const pollJob = useCallback(async () => {
    while (!stopRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, AGENT_JOB_POLL_MS));
      if (stopRef.current) return;
      const status = await fetchAgentJobStatus();
      if (stopRef.current) return;
      // Server hiccup — keep waiting; the agent is still up.
      if (!status) continue;
      // Ignore jobs started for a different project (another tab's launch).
      if (status.projectId && status.projectId !== projectId) continue;
      if (status.error) {
        setError(status.error);
        setPhase('error');
        return;
      }
      if (status.done) {
        setFileName(status.fileName ?? '');
        setPhase('done');
        onDoneRef.current?.(status.fileName);
        return;
      }
    }
  }, [projectId]);

  const begin = useCallback(async () => {
    if (!projectId) return;
    stopRef.current = false;
    setError('');
    setFileName('');
    setPhase('launching');

    const health = await checkAgentHealth();
    if (stopRef.current) return;
    if (!health.running) {
      // Installed but idle (or not installed) — the deep link starts the app
      // when it's there; we then wait for the control server to come up.
      openAgentDeepLink({ projectId, returnUrl: returnUrlRef.current });
      const cameUp = await waitForAgentHealth(AGENT_STARTUP_WAIT_MS);
      if (stopRef.current) return;
      if (!cameUp) {
        setPhase('unavailable');
        return;
      }
    } else {
      const launched = await requestAgentLaunch({ projectId, returnUrl: returnUrlRef.current });
      if (stopRef.current) return;
      if (!launched) {
        // Race: it answered the health check but dropped — try the deep link.
        openAgentDeepLink({ projectId, returnUrl: returnUrlRef.current });
      }
    }

    setPhase('waiting');
    void pollJob();
  }, [projectId, pollJob]);

  return { phase, error, fileName, begin };
}

// ---------------------------------------------------------------------------
// AgentLaunchButton — the "upload with the desktop agent" affordance shown on
// every upload section next to the browser upload. Renders the trigger button
// and, while the hand-off is active, the matching status note.
// ---------------------------------------------------------------------------

export function AgentLaunchButton({
  projectId,
  label = 'Desktop agent',
  context = 'media file',
  onDone,
}: {
  projectId: string;
  /** e.g. "Desktop agent" / "Upload with the desktop agent". */
  label?: string;
  /** What the upload is for, used in the waiting note ("upload your video
   * file there"). */
  context?: string;
  onDone?: (fileName?: string) => void;
}) {
  const { phase, error, fileName, begin } = useAgentUploadFlow({
    projectId,
    returnUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    onDone,
  });
  const downloadUrl = agentDownloadUrl();

  const busy = phase === 'launching' || phase === 'waiting';

  return (
    <>
      <button
        type="button"
        className="agent-launch-btn"
        onClick={() => void begin()}
        disabled={busy}
        title="Open the desktop agent for this upload — drop your file in and submit it for the Captain's review"
        data-testid="agent-launch-btn"
      >
        {phase === 'launching' ? <Loader2 size={13} className="spin" /> : <Laptop size={13} />}
        {phase === 'waiting' ? 'Agent is open…' : label}
      </button>

      {phase === 'waiting' && (
        <span className="agent-flow-note" data-testid="agent-flow-waiting">
          <Loader2 size={12} className="spin" />
          The desktop agent is open with this project — upload your {context} there. This page updates when it's done.
        </span>
      )}
      {phase === 'done' && (
        <span className="agent-flow-note is-done" data-testid="agent-flow-done">
          <Check size={12} />
          Submitted for review — {fileName ? <b className="truncate">{fileName}</b> : 'your file'} is waiting on the Captain.
        </span>
      )}
      {phase === 'unavailable' && (
        <span className="agent-flow-note is-error" data-testid="agent-flow-unavailable">
          The desktop agent isn't running on this computer.
          {downloadUrl ? (
            <a href={downloadUrl} className="link-btn" data-testid="agent-flow-download">Download it</a>
          ) : null}
          <button type="button" className="link-btn" onClick={() => void begin()}>Try again</button>
        </span>
      )}
      {phase === 'error' && (
        <span className="agent-flow-note is-error" role="alert" data-testid="agent-flow-error">
          {error || "The upload didn't complete."}
          <button type="button" className="link-btn" onClick={() => void begin()}>Try again</button>
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// AgentUploadModal
// ---------------------------------------------------------------------------

export function AgentUploadModal({
  fileName,
  fileSizeBytes,
  context,
  projectId,
  onAgentDone,
  onClose,
}: {
  /** The file that was refused by the browser path. */
  fileName: string;
  fileSizeBytes: number;
  /** What the file was for, e.g. "video file" / "thumbnail design". */
  context: string;
  /** When set, the modal can hand off straight to the running agent instead
   * of only offering the download. */
  projectId?: string;
  onAgentDone?: (fileName?: string) => void;
  onClose: () => void;
}) {
  const downloadUrl = agentDownloadUrl();
  const [downloading, setDownloading] = useState(false);
  const [started, setStarted] = useState(false);
  const timerRef = useRef<number | null>(null);
  // True once we've checked whether the agent is up (so the CTA doesn't flash
  // between "download" and "open the app" on first paint).
  const [agentChecked, setAgentChecked] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const flow = useAgentUploadFlow({
    projectId: projectId ?? '',
    returnUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    onDone: onAgentDone,
  });

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void checkAgentHealth().then((health) => {
      if (cancelled) return;
      setAgentRunning(health.running);
      setAgentChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const onDownloadClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (started) return; // Repeat clicks keep the browser's own download going.
    event.preventDefault();
    setDownloading(true);
    // Play the brief "preparing the download" animation, then hand the actual
    // file over to the browser in a new tab.
    timerRef.current = window.setTimeout(() => {
      setDownloading(false);
      setStarted(true);
      window.open(downloadUrl ?? undefined, '_blank', 'noopener');
    }, 1250);
  };

  const instructions = [
    { icon: MonitorDown, title: 'Download the agent', text: 'Install and open Tandem Desktop Agent on this computer.' },
    { icon: Projector, title: 'Pick the project', text: 'Sign in with the same account, then select this project in the Workspace card.' },
    { icon: FolderOpen, title: 'Drop in the file', text: `Drag & drop "${fileName}" into the app and submit it — the Captain's approval moves it into this project's vault.` },
    { icon: UploadCloud, title: 'It uploads itself', text: 'The agent streams the whole file from your PC in the background — no browser tab to babysit.' },
  ];

  const flowActive = flow.phase === 'launching' || flow.phase === 'waiting';

  return (
    <div className="modal-backdrop agent-upload-backdrop" onClick={onClose}>
      <div
        className="agent-upload-modal"
        role="dialog"
        aria-modal="true"
        aria-label="This file needs the desktop agent"
        onClick={(event) => event.stopPropagation()}
        data-testid="agent-upload-modal"
      >
        <button type="button" className="modal-close agent-upload-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div className="agent-upload-left">
          <div className="agent-upload-alert" aria-hidden>
            <ShieldAlert size={26} strokeWidth={1.7} />
          </div>
          <span className="eyebrow">BROWSER UPLOAD LIMIT</span>
          <h2>This {context} is too big to upload here.</h2>
          <p className="agent-upload-file">
            <b title={fileName}>{fileName}</b>
            <em>{formatBytes(fileSizeBytes)}</em>
          </p>
          <p className="agent-upload-copy">
            Files under <b>{BROWSER_UPLOAD_MAX_LABEL}</b> upload straight from the browser. For anything
            bigger, use the desktop agent — it streams the file from your PC and hands it to the
            Captain&apos;s review desk in the background without choking your browser tab.
          </p>

          <div className="agent-upload-cta">
            {flow.phase === 'done' ? (
              <>
                <button type="button" className="agent-download-btn started" onClick={onClose} data-testid="agent-open-done">
                  <Check size={16} />
                  <span>Submitted for review — back to the project</span>
                </button>
                <span className="agent-download-note">
                  {flow.fileName ? <b>{flow.fileName}</b> : 'Your file'} is waiting on the Captain&apos;s review —
                  approval moves it into the vault.
                </span>
              </>
            ) : flowActive ? (
              <>
                <button type="button" className="agent-download-btn downloading" disabled data-testid="agent-open-waiting">
                  <Loader2 size={16} className="spin" />
                  <span>Waiting for the desktop agent…</span>
                </button>
                <span className="agent-download-note">
                  Upload your {context} in the agent — this page updates when it's done.
                </span>
              </>
            ) : projectId && agentChecked && agentRunning ? (
              <>
                <button
                  type="button"
                  className="agent-download-btn"
                  onClick={() => void flow.begin()}
                  data-testid="agent-open-btn"
                >
                  <Laptop size={16} />
                  <span>Open the desktop agent</span>
                </button>
                <span className="agent-download-note">
                  It's already installed — the app opens with this project and uploads in the background.
                </span>
              </>
            ) : downloadUrl ? (
              <>
                <a
                  href={downloadUrl}
                  onClick={onDownloadClick}
                  className={`agent-download-btn ${downloading ? 'downloading' : ''} ${started ? 'started' : ''}`}
                  data-testid="agent-download-btn"
                >
                  {downloading ? (
                    <Loader2 size={16} className="spin" />
                  ) : started ? (
                    <Check size={16} />
                  ) : (
                    <Download size={16} />
                  )}
                  <span>
                    {downloading ? 'Preparing download…' : started ? 'Download started!' : 'Download the desktop agent'}
                  </span>
                </a>
                <span className="agent-download-note">
                  {started ? 'Check your browser’s downloads — it’s on its way.' : 'Windows · macOS — free'}
                </span>
              </>
            ) : (
              <p className="agent-download-unavailable">
                Ask your workspace admin for the Tandem Desktop Agent installer, then come back and
                retry this upload from the app.
              </p>
            )}
            {projectId && !flowActive && flow.phase !== 'done' && (
              <button
                type="button"
                className="agent-upload-open-link"
                onClick={() => void flow.begin()}
                data-testid="agent-open-deeplink"
              >
                Already downloaded it? Open the desktop agent <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="agent-upload-right">
          <span className="eyebrow">HOW IT WORKS</span>
          <ol className="agent-upload-steps">
            {instructions.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title}>
                  <span className="agent-step-icon"><Icon size={15} /></span>
                  <div>
                    <b><em className="agent-step-num">{index + 1}</em>{step.title}</b>
                    <span>{step.text}</span>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="agent-upload-foot">
            <span className="agent-browser-ok">
              <Laptop size={12} /> Small files ({'<'} {BROWSER_UPLOAD_MAX_LABEL}) keep uploading right here.
            </span>
            <button type="button" className="agent-upload-dismiss" onClick={onClose}>
              I’ll use the agent <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Re-export for callers that only need the download link.
export type { AgentJobStatus };