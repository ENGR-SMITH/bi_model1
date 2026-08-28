// ---------------------------------------------------------------------------
// Finish — the export desk.
//
// Five cards, one per deliverable: the LATEST video, the LATEST image, the
// LATEST audio, the LATEST script, and a whole-project ZIP. Only the latest
// asset of each kind is ever exposed here.
//
// Downloads go through the server's Lock/grant gate (the same one the vault's
// Captain grants feed): when the project is RELEASED every member can download;
// before that only members holding an active Captain grant for the file can.
// Each card shows exactly who has that access. Every download is audited.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  LockKeyhole,
  Mic2,
  Package,
  Sparkles,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import {
  downloadVideoFile,
  getListVideoGrantsQueryKey,
  useGetVideoProject,
  useListVideoGrants,
} from '@workspace/api-client-react';
import { useProjectRealtime } from '@/lib/realtime';
import { SectionEyebrow } from '@/components/shell';
import { MemberAvatar } from '@/components/member-avatar';
import { proxyUrlFor } from '@/components/asset-preview';
import { buildZip } from '@/lib/zip';
import { ROLE_LABELS, roleForKind } from '@/lib/roles';
import type { VideoMember } from '@workspace/api-client-react';

const VIDEO_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE']);
const IMAGE_KINDS = new Set(['THUMBNAIL_DESIGN', 'GRAPHIC']);
const AUDIO_KINDS = new Set(['RAW_AUDIO', 'VO_PICKUP']);

const KIND_LABELS: Record<string, string> = {
  RAW_VIDEO: 'Camera footage',
  RAW_AUDIO: 'Separate audio',
  SCREEN_REC: 'Screen recording',
  B_ROLL: 'B-roll',
  REFERENCE: 'Reference video',
  VO_PICKUP: 'Pickup voiceover',
  GRAPHIC: 'Graphic',
  THUMBNAIL_DESIGN: 'Thumbnail design',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const stripHtml = (value: string): string =>
  value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

const words = (value: string): number => {
  const text = stripHtml(value);
  return text ? text.split(/\s+/).length : 0;
};

function scriptStorageKey(projectId: string): string {
  return `creators-den-script-${projectId}`;
}

function scriptNameKey(projectId: string): string {
  return `creators-den-script-name-${projectId}`;
}

/** The latest script saved in THIS browser (the script desk autosaves there). */
function latestScript(projectId: string): { name: string; html: string } | null {
  try {
    const html = localStorage.getItem(scriptStorageKey(projectId)) ?? '';
    if (!html) return null;
    const name = localStorage.getItem(scriptNameKey(projectId)) ?? 'script.html';
    return { name: name.endsWith('.html') ? name : `${name}.html`, html };
  } catch {
    return null;
  }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Pull the server's Lock/grant message out of an ApiError. */
function errorMessage(err: unknown): string {
  const data = (err as { data?: { error?: string } }).data;
  return data?.error || 'The download could not be completed.';
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

interface ExportAsset {
  id: string;
  fileName: string;
  kind: string;
  status: string;
  sizeBytes: number;
  version: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// AccessStrip — who can download this file right now (Captain grants vs the
// released Lock), shown as avatars + a one-line note.
// ---------------------------------------------------------------------------

function AccessStrip({
  members,
  holders,
  released,
}: {
  members: VideoMember[];
  /** Members with an active Captain grant for this exact file (Captain view). */
  holders: VideoMember[];
  released: boolean;
}) {
  if (released) {
    return (
      <div className="finish-access">
        <span className="finish-access-avatars">
          {members.slice(0, 6).map((member) => (
            <MemberAvatar key={member.userId} userId={member.userId} name={member.name} size={22} />
          ))}
          {members.length > 6 && <span className="den-chat-avatar finish-access-more">+{members.length - 6}</span>}
        </span>
        <span className="finish-access-note">
          <Check size={11} /> Lock released — every member can download
        </span>
      </div>
    );
  }
  if (holders.length > 0) {
    return (
      <div className="finish-access">
        <span className="finish-access-avatars">
          {holders.slice(0, 6).map((member) => (
            <MemberAvatar key={member.userId} userId={member.userId} name={member.name} size={22} />
          ))}
          {holders.length > 6 && <span className="den-chat-avatar finish-access-more">+{holders.length - 6}</span>}
        </span>
        <span className="finish-access-note">
          <Check size={11} /> {holders.length} {holders.length === 1 ? 'member has' : 'members have'} a Captain grant
        </span>
      </div>
    );
  }
  return (
    <div className="finish-access">
      <span className="finish-access-note">
        <LockKeyhole size={11} /> Locked — only members with a Captain grant can download
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FinishPreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);
  const myRoles = project.data?.myRoles ?? [];
  const grants = useListVideoGrants(projectId, {
    query: { queryKey: getListVideoGrantsQueryKey(projectId), enabled: myRoles.includes('CAPTAIN') },
  });

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assets = (project.data?.assets ?? []) as ExportAsset[];
  const released = project.data?.status === 'RELEASED';
  const isCaptain = myRoles.includes('CAPTAIN');

  // The newest asset of each kind — the only ones this page ever exposes.
  const latestOf = (kinds: Set<string>): ExportAsset | null =>
    assets
      .filter((a) => kinds.has(a.kind))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  const latestVideo = latestOf(VIDEO_KINDS);
  const latestImage = latestOf(IMAGE_KINDS);
  const latestAudio = latestOf(AUDIO_KINDS);
  const script = latestScript(projectId ?? '');

  const members = useMemo(() => project.data?.members ?? [], [project.data?.members]);
  const membersById = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  );

  // Captain view: active grants that unlock this file (by role or ALL) → the
  // members who hold them.
  const grantHoldersFor = (asset: { id: string; kind: string } | null): VideoMember[] => {
    if (!isCaptain || !asset) return [];
    const fileRole = roleForKind(asset.kind);
    const active = (grants.data ?? []).filter((grant) => {
      if (grant.revokedAt || new Date(grant.expiresAt) <= new Date()) return false;
      const grantRoles = grant.roles ?? [];
      return grantRoles.includes('ALL') || (fileRole !== null && grantRoles.includes(fileRole));
    });
    return active
      .map((grant) => membersById.get(grant.memberId))
      .filter((m): m is VideoMember => Boolean(m));
  };

  const downloadAsset = async (assetId: string, fileName: string) => {
    setBusyId(`asset-${assetId}`);
    setError(null);
    try {
      const blob = await downloadVideoFile(projectId, assetId);
      saveBlob(blob, fileName);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const downloadScript = () => {
    if (!script) return;
    setBusyId('script');
    setError(null);
    try {
      saveBlob(new Blob([script.html], { type: 'text/html;charset=utf-8' }), script.name);
    } finally {
      setBusyId(null);
    }
  };

  // Whole-project ZIP: fetch every latest media file through the same Lock/grant
  // gate, then zip media + script + a manifest.
  const [zipBusy, setZipBusy] = useState<number | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const buildProjectZip = async () => {
    setZipError(null);
    setZipBusy(0);
    const items: Array<{ name: string; fileId: string; fileName: string }> = [];
    if (latestVideo) items.push({ name: 'video', fileId: latestVideo.id, fileName: latestVideo.fileName });
    if (latestImage) items.push({ name: 'image', fileId: latestImage.id, fileName: latestImage.fileName });
    if (latestAudio) items.push({ name: 'audio', fileId: latestAudio.id, fileName: latestAudio.fileName });
    if (items.length === 0) {
      setZipBusy(null);
      setZipError('Nothing to export yet — the vault has no processed media.');
      return;
    }
    try {
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      const encoder = new TextEncoder();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setZipBusy(i + 1);
        const blob = await downloadVideoFile(projectId, item.fileId);
        const buffer = await blob.arrayBuffer();
        entries.push({ name: `media/${item.fileName}`, data: new Uint8Array(buffer) });
      }
      if (script) entries.push({ name: `script/${script.name}`, data: encoder.encode(script.html) });
      entries.push({
        name: 'manifest.json',
        data: encoder.encode(
          JSON.stringify(
            {
              projectId,
              projectName: project.data?.name ?? '',
              status: project.data?.status ?? '',
              generatedAt: new Date().toISOString(),
              exportedBy: myRoles,
              lock: released ? 'released' : 'locked',
              entries: items.map((item) => ({
                kind: item.name,
                fileName: item.fileName,
                sizeBytes:
                  (item.name === 'video'
                    ? latestVideo
                    : item.name === 'image'
                      ? latestImage
                      : latestAudio)?.sizeBytes ?? 0,
              })),
              script: script ? { name: script.name, characters: stripHtml(script.html).length, words: words(script.html) } : null,
              access: released
                ? members.map((m) => ({ userId: m.userId, name: m.name, roles: m.roles }))
                : items.flatMap((item) =>
                    grantHoldersFor({
                      id: item.fileId,
                      kind:
                        item.name === 'video'
                          ? 'RAW_VIDEO'
                          : item.name === 'image'
                            ? 'THUMBNAIL_DESIGN'
                            : 'RAW_AUDIO',
                    }).map((m) => ({
                      userId: m.userId,
                      name: m.name,
                      roles: m.roles,
                      file: item.fileName,
                    })),
                  ),
            },
            null,
            2,
          ),
        ),
      });
      const zip = buildZip(entries);
      const base = `${slugify(project.data?.name ?? 'project')}-finish`;
      saveBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${base}.zip`);
    } catch (err) {
      setZipError(errorMessage(err));
    } finally {
      setZipBusy(null);
    }
  };

  if (project.isLoading) {
    return (
      <div className="page">
        <div className="panel-empty">Opening the export desk…</div>
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>DESK CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;

  const mediaCard = (
    title: string,
    icon: React.ReactNode,
    asset: ExportAsset | null,
    hint: string,
    accent: string,
  ) => {
    const audio = AUDIO_KINDS.has(asset?.kind ?? '');
    const image = IMAGE_KINDS.has(asset?.kind ?? '');
    const proxy = asset ? proxyUrlFor(p.id, asset.id) : '';
    return (
      <div className={`finish-card accent-${accent}`} data-testid={`finish-card-${title.toLowerCase()}`}>
        <div className="finish-card-thumb">
          {asset && !audio ? (
            image ? (
              <img src={proxy} alt="" />
            ) : (
              <video src={`${proxy}#t=0.5`} muted playsInline preload="metadata" />
            )
          ) : (
            <span className="finish-card-thumb-icon">{audio ? <Mic2 size={26} /> : icon}</span>
          )}
          <span className="finish-card-badge">{asset ? (KIND_LABELS[asset.kind] ?? asset.kind) : '—'}</span>
        </div>
        <div className="finish-card-body">
          <div className="finish-card-title">
            <span className="eyebrow">{title}</span>
            <span className="finish-card-name" title={asset?.fileName ?? ''}>
              {asset ? asset.fileName : hint}
            </span>
          </div>
          {asset ? (
            <p className="finish-card-meta">
              {formatBytes(asset.sizeBytes)} · v{asset.version} · {timeAgo(asset.createdAt)}
              {asset.status !== 'PROCESSED' && ' · processing…'}
            </p>
          ) : (
            <p className="finish-card-meta">{hint}</p>
          )}
          <AccessStrip members={members} holders={grantHoldersFor(asset ?? null)} released={released} />
          <button
            type="button"
            className="primary-btn finish-card-btn"
            onClick={() => asset && downloadAsset(asset.id, asset.fileName)}
            disabled={!asset || busyId === `asset-${asset?.id}` || asset.status !== 'PROCESSED'}
            data-testid={`finish-download-${title.toLowerCase()}`}
          >
            <Download size={13} />
            {busyId === `asset-${asset?.id}` ? 'Downloading…' : 'Download latest'}
          </button>
        </div>
      </div>
    );
  };

  const zipEntries = [
    { label: 'Video', file: latestVideo?.fileName ?? null, size: latestVideo?.sizeBytes ?? null },
    { label: 'Image', file: latestImage?.fileName ?? null, size: latestImage?.sizeBytes ?? null },
    { label: 'Audio', file: latestAudio?.fileName ?? null, size: latestAudio?.sizeBytes ?? null },
    { label: 'Script', file: script?.name ?? null, size: script ? stripHtml(script.html).length : null },
  ];
  const anyMedia = Boolean(latestVideo || latestImage || latestAudio);

  return (
    <div className="page pv-page">
      <div className="page-header">
        <div>
          <SectionEyebrow>Finish · export</SectionEyebrow>
          <h1>The export desk.</h1>
          <p>
            The latest video, image, audio, and script — plus the whole project as one ZIP.
            Only the most recent asset of each kind is ever handed out, and downloads obey
            the Captain's grants until the Lock is released.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`den-tag ${released ? 'teal' : 'gold'}`}>
            {released ? <Check size={11} /> : <LockKeyhole size={11} />}
            {released ? 'Lock released — downloads open' : 'Lock on — granted downloads only'}
          </span>
        </div>
      </div>

      <div className="finish-grid" data-testid="finish-grid">
        {mediaCard('Video', <Film size={26} />, latestVideo, 'No video in the vault yet.', 'gold')}
        {mediaCard('Image', <ImageIcon size={26} />, latestImage, 'No design in the vault yet.', 'accent')}
        {mediaCard('Audio', <Mic2 size={26} />, latestAudio, 'No audio in the vault yet.', 'teal')}

        {/* Script — the latest script saved in this browser (the script desk autosaves there). */}
        <div className="finish-card accent-muted" data-testid="finish-card-script">
          <div className="finish-card-thumb">
            <span className="finish-card-thumb-icon"><FileText size={26} /></span>
            <span className="finish-card-badge">Script</span>
          </div>
          <div className="finish-card-body">
            <div className="finish-card-title">
              <span className="eyebrow">Script</span>
              <span className="finish-card-name" title={script?.name ?? ''}>
                {script ? script.name : 'No script in this browser'}
              </span>
            </div>
            {script ? (
              <p className="finish-card-meta">
                {words(script.html)} words · {stripHtml(script.html).length} characters · saved on this device
              </p>
            ) : (
              <p className="finish-card-meta">The script is autosaved in the browser it was written in — open the Script desk there to export it.</p>
            )}
            <div className="finish-access">
              <span className="finish-access-note">
                <Sparkles size={11} /> Everyone on the project can view the script — only this browser holds the text.
              </span>
            </div>
            <button
              type="button"
              className="primary-btn finish-card-btn"
              onClick={downloadScript}
              disabled={!script || busyId === 'script'}
              data-testid="finish-download-script"
            >
              <Download size={13} />
              {busyId === 'script' ? 'Preparing…' : 'Download script'}
            </button>
          </div>
        </div>

        {/* Whole-project ZIP — every latest asset in one archive. */}
        <div className="finish-card accent-primary finish-card-zip" data-testid="finish-card-zip">
          <div className="finish-card-thumb">
            <span className="finish-card-thumb-icon"><Package size={26} /></span>
            <span className="finish-card-badge">ZIP</span>
          </div>
          <div className="finish-card-body">
            <div className="finish-card-title">
              <span className="eyebrow">Whole project</span>
              <span className="finish-card-name">Everything, one ZIP</span>
            </div>
            <ul className="finish-zip-list">
              {zipEntries.map((entry) => (
                <li key={entry.label} data-testid={`finish-zip-entry-${entry.label.toLowerCase()}`}>
                  <span className={entry.file ? 'ok' : ''}>
                    {entry.file ? <Check size={11} /> : <LockKeyhole size={11} />}
                  </span>
                  <b>{entry.label}</b>
                  <span className="finish-zip-file" title={entry.file ?? ''}>
                    {entry.file ?? 'not available'}
                  </span>
                  <span className="mono-label">
                    {entry.size != null ? (entry.label === 'Script' ? `${entry.size} chars` : formatBytes(entry.size)) : '—'}
                  </span>
                </li>
              ))}
            </ul>
            <AccessStrip
              members={members}
              holders={isCaptain ? Array.from(new Map(zipEntries.flatMap((e) => {
                const asset =
                  e.label === 'Video' ? latestVideo : e.label === 'Image' ? latestImage : e.label === 'Audio' ? latestAudio : null;
                return grantHoldersFor(asset);
              }).map((member) => [member.userId, member])).values()) : []}
              released={released}
            />
            {zipBusy != null && (
              <p className="finish-card-meta">
                Fetching {zipBusy}/{zipEntries.filter((e) => e.file && e.label !== 'Script').length} files…
              </p>
            )}
            {zipError && (
              <p className="finish-card-meta finish-error" role="alert" data-testid="finish-zip-error">
                <AlertTriangle size={11} /> {zipError}
              </p>
            )}
            <button
              type="button"
              className="primary-btn finish-card-btn"
              onClick={() => void buildProjectZip()}
              disabled={!anyMedia || zipBusy != null}
              data-testid="finish-download-zip"
            >
              <Package size={13} />
              {zipBusy != null ? 'Building zip…' : 'Download project (.zip)'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="finish-card-meta finish-error mt-3" role="alert" data-testid="finish-error">
          <AlertTriangle size={11} /> {error}
        </p>
      )}

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} /> Every download is audited · raw files only leave the vault once the Lock is released or the Captain grants them
        <span className="ml-auto mono-label">Status: {p.status.replaceAll('_', ' ')}</span>
      </p>
    </div>
  );
}
