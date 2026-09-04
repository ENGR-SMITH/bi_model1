// ---------------------------------------------------------------------------
// Desktop-agent bridge — how Creator Den talks to the installed Tandem
// Desktop Agent.
//
// The agent runs a tiny loopback control server on 127.0.0.1 (fixed port,
// override with VITE_AGENT_CONTROL_PORT / TANDEM_AGENT_CONTROL_PORT) so the
// web app can:
//   · detect whether the agent is running            GET  /health
//   · hand it the current project + a return URL     POST /launch
//   · watch an upload job until it finishes          GET  /job-status
//
// When the agent is installed but NOT running, no loopback server answers —
// the web app falls back to the `tandem-agent://launch` deep link, which the
// OS hands to the agent (the installer registers the scheme). Launching via
// an in-page iframe keeps the Creator Den page in place, so the return-URL
// hand-off (open the page again after the upload) keeps working.
// ---------------------------------------------------------------------------

/** Custom URL scheme the desktop agent registers (see desktop-agent build). */
export const AGENT_PROTOCOL = 'tandem-agent';

/** Fixed loopback port the agent's control server binds (env-overridable). */
export const AGENT_CONTROL_PORT = Number(import.meta.env.VITE_AGENT_CONTROL_PORT ?? '41737');

/** How long to wait for the agent to come up after a deep link, before giving up. */
export const AGENT_STARTUP_WAIT_MS = 6000;

/** How often the page polls the agent's job status while an upload is running. */
export const AGENT_JOB_POLL_MS = 2000;

/** Timeout for a single fetch against the agent's loopback server. */
export const AGENT_REQUEST_TIMEOUT_MS = 1200;

export interface AgentHealth {
  running: boolean;
  version?: string;
  signedIn?: boolean;
}

export interface AgentJobStatus {
  running: boolean;
  done: boolean;
  error?: string;
  projectId?: string;
  fileName?: string;
  returnUrl?: string;
}

export interface AgentLaunchContext {
  projectId?: string;
  returnUrl?: string;
}

export function agentControlBaseUrl(): string {
  return `http://127.0.0.1:${AGENT_CONTROL_PORT}`;
}

/** The URL the agent should reopen once an upload finishes — the page the
 * user started from, so they land back on Creator Den automatically. */
export function agentReturnUrl(): string {
  return typeof window !== 'undefined' ? window.location.href : '';
}

/** `tandem-agent://launch?projectId=…&returnUrl=…` deep link. */
export function agentLaunchUrl(opts: AgentLaunchContext): string {
  const params = new URLSearchParams();
  if (opts.projectId) params.set('projectId', opts.projectId);
  if (opts.returnUrl) params.set('returnUrl', opts.returnUrl);
  const query = params.toString();
  return `${AGENT_PROTOCOL}://launch${query ? `?${query}` : ''}`;
}

/** Ask the OS to open the agent app without navigating the Creator Den page
 * away: a hidden iframe hands the scheme to the browser's protocol handler
 * (Chromium + Firefox), falling back to a background tab elsewhere. */
export function openAgentDeepLink(opts: AgentLaunchContext): void {
  const url = agentLaunchUrl(opts);
  try {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = url;
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = AGENT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Is the desktop agent up right now? Never throws — unreachable = not running. */
export async function checkAgentHealth(timeoutMs: number = AGENT_REQUEST_TIMEOUT_MS): Promise<AgentHealth> {
  try {
    const res = await fetchWithTimeout(`${agentControlBaseUrl()}/health`, {}, timeoutMs);
    if (!res.ok) return { running: false };
    const body = (await res.json()) as { ok?: boolean; version?: string; signedIn?: boolean };
    return { running: body.ok === true, version: body.version, signedIn: body.signedIn };
  } catch {
    return { running: false };
  }
}

/** Hand the running agent the project context + return URL and focus its
 * window. Returns false when the agent isn't reachable. */
export async function requestAgentLaunch(
  ctx: AgentLaunchContext,
  timeoutMs: number = AGENT_REQUEST_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${agentControlBaseUrl()}/launch`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ctx) },
      timeoutMs,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Latest upload job state from the agent, or null when it can't be reached. */
export async function fetchAgentJobStatus(timeoutMs: number = AGENT_REQUEST_TIMEOUT_MS): Promise<AgentJobStatus | null> {
  try {
    const res = await fetchWithTimeout(`${agentControlBaseUrl()}/job-status`, {}, timeoutMs);
    if (!res.ok) return null;
    return (await res.json()) as AgentJobStatus;
  } catch {
    return null;
  }
}

/** Poll the control server until the agent is up (used after a deep link,
 * where the app takes a moment to boot) or the timeout runs out. */
export async function waitForAgentHealth(timeoutMs: number, intervalMs: number = 400): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await checkAgentHealth();
    if (health.running) return true;
    await sleep(intervalMs);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Agent download link (moved here from agent-upload-modal so the launch UI and
// the modal share one source of truth).
// ---------------------------------------------------------------------------

/** The OS-specific agent download URL (from VITE_AGENT_DOWNLOAD_URL), or
 * null when the app was not given one. */
export function agentDownloadUrl(): string | null {
  const raw = import.meta.env.VITE_AGENT_DOWNLOAD_URL as string | undefined;
  if (!raw || !raw.trim()) return null;
  const base = raw.trim().replace(/\.exe$/, '').replace(/\.dmg$/, '');
  const ext = navigator.userAgent.includes('Mac') ? '.dmg' : '.exe';
  return `${base}${ext}`;
}