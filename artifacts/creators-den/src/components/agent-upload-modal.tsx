// ---------------------------------------------------------------------------
// Desktop-agent upload modal + the shared "browser uploads stop at N" gate.
//
// Small files (<500 MB) upload straight from the browser to R2 via the role
// upload cards. Files at or over the cap need the desktop agent (local
// FFmpeg proxy + resumable R2 upload), so this modal steps in when an upload
// would exceed the cap: it shows the blocked file, offers the agent download
// (with a short "preparing…" animation so the click feels like it triggered),
// and lays out the agent workflow next to it.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
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

/** The OS-specific agent download URL (from VITE_AGENT_DOWNLOAD_URL), or
 * null when the app was not given one. Shared by the vault + modal CTAs. */
export function agentDownloadUrl(): string | null {
  const raw = import.meta.env.VITE_AGENT_DOWNLOAD_URL as string | undefined;
  if (!raw || !raw.trim()) return null;
  const base = raw.trim().replace(/\.exe$/, '').replace(/\.dmg$/, '');
  const ext = navigator.userAgent.includes('Mac') ? '.dmg' : '.exe';
  return `${base}${ext}`;
}

// ---------------------------------------------------------------------------
// AgentUploadModal
// ---------------------------------------------------------------------------

export function AgentUploadModal({
  fileName,
  fileSizeBytes,
  context,
  onClose,
}: {
  /** The file that was refused by the browser path. */
  fileName: string;
  fileSizeBytes: number;
  /** What the file was for, e.g. "video file" / "thumbnail design". */
  context: string;
  onClose: () => void;
}) {
  const downloadUrl = agentDownloadUrl();
  const [downloading, setDownloading] = useState(false);
  const [started, setStarted] = useState(false);
  const timerRef = useRef<number | null>(null);
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
    { icon: FolderOpen, title: 'Choose the file', text: `Pick "${fileName}" as the source, and choose where it should land in the vault.` },
    { icon: UploadCloud, title: 'It uploads itself', text: 'The agent encodes a proxy and uploads it to R2 in the background — no browser tab to babysit.' },
  ];

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
            bigger, use the desktop agent — it encodes a lightweight proxy locally and uploads in the
            background without choking your browser tab.
          </p>

          <div className="agent-upload-cta">
            {downloadUrl ? (
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
