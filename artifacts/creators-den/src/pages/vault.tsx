import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Download,
  FileVideo2,
  Film,
  History,
  LockKeyhole,
  Mic2,
  Image,
  Palette,
  Scissors,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVideoProjectQueryKey,
  getListVideoDownloadsQueryKey,
  getListVideoGrantsQueryKey,
  getListVideoJobsQueryKey,
  getListVideoSubmissionsQueryKey,
  useAddVideoProjectMember,
  useApproveVideoSubmission,
  useCreateVideoGrant,
  useGetVideoProject,
  useListVideoDownloads,
  useListVideoGrants,
  useListVideoJobs,
  useListVideoSubmissions,
  useRejectVideoSubmission,
  useRevokeVideoGrant,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { isAudioKind, proxyUrlFor } from '@/components/asset-preview';

const LEG_META = {
  SELECTS: { label: 'Selects', role: 'Story Architect', icon: Film },
  CUT: { label: 'Cut', role: 'Visual Editor', icon: Scissors },
  SOUND: { label: 'Sound', role: 'Sound Designer', icon: Mic2 },
  FINISH: { label: 'Finish', role: 'Motion & Color', icon: Palette },
  THUMBNAIL: { label: 'Thumbnail', role: 'Thumbnail Designer', icon: Image },
} as const;

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

// The order rails appear in on the vault (repo file browser, grouped by kind).
const KIND_ORDER = ['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'RAW_AUDIO', 'VO_PICKUP', 'REFERENCE', 'GRAPHIC', 'THUMBNAIL_DESIGN'] as const;
const IMAGE_KINDS = new Set(['THUMBNAIL_DESIGN', 'GRAPHIC']);

const ROLE_LABELS: Record<string, string> = {
  CAPTAIN: 'Captain',
  UPLOADER: 'Uploader',
  ARCHITECT: 'Story Architect',
  VISUAL_EDITOR: 'Visual Editor',
  SOUND_DESIGNER: 'Sound Designer',
  MOTION_COLOR: 'Motion & Color',
  THUMBNAIL_DESIGNER: 'Thumbnail Designer',
  VIEWER: 'Viewer',
};

const INVITE_ROLES = ['UPLOADER', 'ARCHITECT', 'VISUAL_EDITOR', 'SOUND_DESIGNER', 'MOTION_COLOR', 'THUMBNAIL_DESIGNER', 'VIEWER'] as const;

type AssetSummary = { id: string; fileName: string; kind: string; status: string; sizeBytes: number; version: number; durationMs: number | null; contentHash?: string | null };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** True when an earlier vault asset holds the exact same bytes (Git-LFS dedupe). */
function isDuplicateContent(assets: Array<{ contentHash?: string | null }>, index: number): boolean {
  const hash = assets[index].contentHash;
  if (!hash) return false;
  for (let i = 0; i < index; i++) {
    if (assets[i].contentHash === hash) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// PosterCard — a Netflix-style poster tile for one vault asset. The proxy
// stream doubles as the poster (first frame for video, the image itself for
// designs); an icon shows through while processing or if the frame can't be
// decoded.
// ---------------------------------------------------------------------------

function PosterCard({ projectId, asset, deduplicated }: { projectId: string; asset: AssetSummary; deduplicated: boolean }) {
  const [broken, setBroken] = useState(false);
  const processed = asset.status === 'PROCESSED';
  const audio = isAudioKind(asset.kind);
  const image = IMAGE_KINDS.has(asset.kind);
  const proxy = proxyUrlFor(projectId, asset.id);

  return (
    <div className="cd-card" data-testid={`card-asset-${asset.id}`}>
      <div className="cd-card-thumb">
        {audio ? <Mic2 size={26} /> : <FileVideo2 size={26} />}
        {processed && !broken && (image ? (
          <img src={proxy} alt="" onError={() => setBroken(true)} />
        ) : !audio ? (
          <video src={`${proxy}#t=0.5`} muted playsInline preload="metadata" onError={() => setBroken(true)} />
        ) : null)}
        <span className="cd-card-badge">{KIND_LABELS[asset.kind] ?? asset.kind}</span>
        {!processed && <span className="cd-card-badge right">processing…</span>}
      </div>
      <div className="cd-card-body">
        <span className="cd-card-title">{asset.fileName}</span>
        <span className="cd-card-meta">
          {formatBytes(asset.sizeBytes)} · v{asset.version}
          {deduplicated && ' · deduped'}
        </span>
      </div>
    </div>
  );
}

function InviteForm({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const invite = useAddVideoProjectMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>('ARCHITECT');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;
    invite.mutate(
      { projectId, data: { email: email.trim(), role } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
          setEmail('');
        },
      },
    );
  };

  const error = invite.error as { response?: { data?: { error?: string } } } | null;

  return (
    <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]" onSubmit={submit} data-testid="form-invite-member">
      <input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        placeholder="teammate@example.com"
        required
        data-testid="input-invite-email"
      />
      <select value={role} onChange={(event) => setRole(event.target.value as (typeof INVITE_ROLES)[number])} data-testid="select-invite-role">
        {INVITE_ROLES.map((value) => (
          <option key={value} value={value}>{ROLE_LABELS[value]}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={invite.isPending || !email.trim()}
        className="secondary-btn"
        data-testid="button-invite-member"
      >
        <UserPlus size={14} />
        {invite.isPending ? 'Adding…' : 'Add member'}
      </button>
      {invite.isError && (
        <p className="setting-copy" role="alert">
          {error?.response?.data?.error || 'Could not add that member.'}
        </p>
      )}
    </form>
  );
}

function JobProgressStrip({ projectId }: { projectId: string }) {
  const jobs = useListVideoJobs(projectId);
  const active = (jobs.data ?? []).filter((job) => ['QUEUED', 'RUNNING'].includes(job.status));
  const recent = (jobs.data ?? []).slice(0, 6);

  if (!jobs.data || jobs.data.length === 0) return null;

  return (
    <div className="paper-card" data-testid="panel-job-progress">
      <div className="inline-heading">
        <span className="eyebrow"><Sparkles size={13} /> Processing</span>
        {active.length > 0 ? (
          <span className="den-tag gold">{active.length} running</span>
        ) : (
          <span className="den-tag teal">idle</span>
        )}
      </div>
      <div className="den-stack">
        {recent.map((job) => (
          <div key={job.id} className="list-row" data-testid={`job-${job.id}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${job.status === 'SUCCEEDED' ? 'bg-[#286254]' : job.status === 'FAILED' ? 'bg-[#a33d31]' : 'animate-pulse bg-[#f0c85c]'}`} />
            <span>
              <b>{job.type.replaceAll('_', ' ')}</b>
              <small>{job.status.toLowerCase()}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrantsPanel({ projectId, myRole, members, assets }: { projectId: string; myRole: string; members: Array<{ id: string; userId: string; role: string }>; assets: Array<{ id: string; fileName: string }> }) {
  const queryClient = useQueryClient();
  const grants = useListVideoGrants(projectId, {
    query: { queryKey: getListVideoGrantsQueryKey(projectId), enabled: myRole === 'CAPTAIN' },
  });
  const create = useCreateVideoGrant();
  const revoke = useRevokeVideoGrant();
  const [memberId, setMemberId] = useState('');
  const [fileId, setFileId] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(24);

  if (myRole !== 'CAPTAIN') return null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memberId || !fileId) return;
    create.mutate(
      { projectId, data: { memberId, fileId, reason: reason.trim() || undefined, expiresInHours: hours } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoGrantsQueryKey(projectId) });
          setMemberId('');
          setFileId('');
          setReason('');
        },
      },
    );
  };

  const onRevoke = (grantId: string) => {
    revoke.mutate(
      { projectId, grantId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoGrantsQueryKey(projectId) });
        },
      },
    );
  };

  const createError = create.error as { response?: { data?: { error?: string } } } | null;
  const activeGrants = (grants.data ?? []).filter((g) => !g.revokedAt && new Date(g.expiresAt) > new Date());

  return (
    <div className="paper-card accent-card" data-testid="panel-grants">
      <div className="inline-heading">
        <span className="eyebrow"><Download size={13} /> Temporary download grants</span>
      </div>
      <p className="setting-copy">
        Grant a teammate a timed download of a specific file — say, an audio stem for an external DAW repair. Revoke anytime; every download is still audited.
      </p>
      <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={submit} data-testid="form-grant">
        <select value={memberId} onChange={(event) => setMemberId(event.target.value)} data-testid="grant-select-member">
          <option value="">Teammate…</option>
          {members.filter((m) => m.role !== 'CAPTAIN').map((m) => (
            <option key={m.id} value={m.userId}>{m.userId}</option>
          ))}
        </select>
        <select value={fileId} onChange={(event) => setFileId(event.target.value)} data-testid="grant-select-file">
          <option value="">File…</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.fileName}</option>
          ))}
        </select>
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason — e.g. DAW repair" maxLength={500} data-testid="grant-reason" />
        <div className="flex items-center gap-2">
          <input value={hours} onChange={(event) => setHours(Number(event.target.value) || 24)} type="number" min={1} max={168} title="Hours until expiry" className="w-20" data-testid="grant-hours" />
          <button type="submit" disabled={create.isPending || !memberId || !fileId} className="secondary-btn" data-testid="button-create-grant">
            <Download size={13} />
            {create.isPending ? 'Granting…' : 'Grant'}
          </button>
        </div>
      </form>
      {create.isError && (
        <p className="setting-copy mt-2" role="alert">
          {createError?.response?.data?.error || 'The grant could not be created.'}
        </p>
      )}

      {(grants.data ?? []).length > 0 && (
        <div className="den-stack mt-3">
          {(grants.data ?? []).map((grant) => {
            const active = !grant.revokedAt && new Date(grant.expiresAt) > new Date();
            return (
              <div key={grant.id} className="list-row" data-testid={`grant-${grant.id}`}>
                <span>
                  <b>{grant.memberId.slice(0, 8)} · {grant.reason || 'download access'}</b>
                  <small>{active ? `expires ${new Date(grant.expiresAt).toLocaleDateString()}` : grant.revokedAt ? 'revoked' : 'expired'}</small>
                </span>
                {active && (
                  <button type="button" onClick={() => onRevoke(grant.id)} disabled={revoke.isPending} className="danger-icon" title="Revoke" data-testid={`button-revoke-${grant.id}`}>
                    <X size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {activeGrants.length === 0 && (grants.data ?? []).length === 0 && (
        <p className="setting-copy mt-3">No grants yet — the Lock stays on until you release it.</p>
      )}
    </div>
  );
}

function DownloadAuditPanel({ projectId, myRole }: { projectId: string; myRole: string }) {
  const downloads = useListVideoDownloads(projectId, {
    query: { queryKey: getListVideoDownloadsQueryKey(projectId), enabled: myRole === 'CAPTAIN' },
  });

  if (myRole !== 'CAPTAIN' || !downloads.data || downloads.data.length === 0) return null;

  return (
    <div className="paper-card" data-testid="panel-download-audit">
      <div className="inline-heading">
        <span className="eyebrow"><History size={13} /> Download audit trail</span>
      </div>
      <div className="den-stack">
        {downloads.data.map((entry) => (
          <div key={entry.id} className="list-row" data-testid={`download-entry-${entry.id}`}>
            <span>
              <b>{entry.fileName}</b>
              <small>by {entry.memberId.slice(0, 8)} · {new Date(entry.createdAt).toLocaleDateString()}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubmissionsPanel({ projectId, myRole }: { projectId: string; myRole: string }) {
  const queryClient = useQueryClient();
  const submissions = useListVideoSubmissions(projectId);
  const approve = useApproveVideoSubmission();
  const reject = useRejectVideoSubmission();

  const decide = (submissionId: string, decision: 'approve' | 'reject') => {
    const mutation = decision === 'approve' ? approve : reject;
    mutation.mutate(
      { projectId, submissionId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
        },
      },
    );
  };

  const rows = submissions.data ?? [];
  const pending = rows.filter((s) => s.status === 'SUBMITTED');
  const isCaptain = myRole === 'CAPTAIN';

  if (rows.length === 0) return null;

  return (
    <div className="paper-card" data-testid="panel-submissions">
      <div className="inline-heading">
        <span className="eyebrow"><Film size={13} /> Pull requests</span>
        {pending.length > 0 && <span className="den-tag gold">{pending.length} open</span>}
      </div>
      <div className="den-stack">
        {rows.map((submission) => {
          const meta = LEG_META[submission.leg as keyof typeof LEG_META] ?? { label: submission.leg, role: '', icon: Film };
          const Icon = meta.icon;
          const isPending = submission.status === 'SUBMITTED';
          return (
            <div key={submission.id} className="list-row" data-testid={`submission-${submission.id}`}>
              <span className="world-symbol"><Icon size={13} /></span>
              <span>
                <b>{meta.label} — {meta.role}</b>
                <small>
                  {submission.status.replaceAll('_', ' ')} · v{submission.timelineVersionId.slice(0, 8)}
                  {submission.note && ` · “${submission.note.slice(0, 60)}”`}
                </small>
              </span>
              {isPending && isCaptain ? (
                <span className="flex gap-2">
                  <button type="button" onClick={() => decide(submission.id, 'approve')} disabled={approve.isPending || reject.isPending} className="secondary-btn" data-testid={`button-approve-${submission.id}`}>
                    <Check size={13} /> Approve
                  </button>
                  <button type="button" onClick={() => decide(submission.id, 'reject')} disabled={approve.isPending || reject.isPending} className="secondary-btn" data-testid={`button-reject-${submission.id}`}>
                    <X size={13} /> Reject
                  </button>
                </span>
              ) : (
                <span className={`den-tag ${submission.status === 'APPROVED' ? 'teal' : submission.status === 'REJECTED' ? 'danger' : 'gold'}`}>
                  {submission.status}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {pending.length > 0 && !isCaptain && (
        <p className="setting-copy mt-3">Waiting on the Captain to approve or reject the pending stage.</p>
      )}
    </div>
  );
}

export default function ContentCreatorsProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  // Live: jobs, submissions, grants, and asset processing stream in.
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId, {
    query: {
      queryKey: getGetVideoProjectQueryKey(projectId),
      // While anything is still processing, keep polling so the vault
      // flips to preview-ready on its own.
      refetchInterval: (query) => {
        const data = query.state.data;
        const processing = data?.assets.some((asset) => asset.status !== 'PROCESSED');
        return processing ? 3000 : false;
      },
    },
  });

  const assets = (project.data?.assets ?? []) as AssetSummary[];

  if (project.isLoading) {
    return (
      <div className="page">
        <div className="panel-empty">Opening the vault…</div>
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>VAULT CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href="/" className="secondary-btn"><ArrowLeft size={14} /> Back home</Link>
      </div>
    );
  }

  const p = project.data;
  const myRole = p.myRole ?? 'VIEWER';

  // Group assets into rails by kind, in a stable display order.
  const seen = new Set<string>();
  const orderedKinds = [...KIND_ORDER, ...assets.map((a) => a.kind).filter((k) => !KIND_ORDER.includes(k as (typeof KIND_ORDER)[number]))];
  const groups = orderedKinds
    .filter((kind) => (seen.has(kind) ? false : (seen.add(kind), true)))
    .map((kind) => ({ kind, items: assets.filter((a) => a.kind === kind) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="page">
      <div className="cd-billboard mb-6" data-testid="vault-billboard">
        <div className="cd-billboard-scrim" />
        <div className="cd-billboard-body">
          <SectionEyebrow>The vault · repository</SectionEyebrow>
          <h1>{p.name}</h1>
          {p.description && <p>{p.description}</p>}
          <div className="cd-metarow">
            <span className="den-tag accent"><LockKeyhole size={10} /> {p.status.replaceAll('_', ' ')}</span>
            <span className="flex items-center">
              {p.members.slice(0, 5).map((member, index) => (
                <span
                  key={member.id}
                  className={`cd-avatar ${index > 0 ? 'stack' : ''}`}
                  title={`${member.name ?? member.userId} · ${ROLE_LABELS[member.role] ?? member.role}`}
                  style={member.role === 'CAPTAIN' ? { background: 'hsl(var(--accent) / .28)' } : undefined}
                >
                  {(member.name ?? member.userId).slice(0, 2).toUpperCase()}
                </span>
              ))}
            </span>
            <span className="cd-metatext">
              <b>{p.assets.length} asset{p.assets.length === 1 ? '' : 's'} · {p.members.length} member{p.members.length === 1 ? '' : 's'}</b>
              <small>you are the {ROLE_LABELS[myRole] ?? myRole}</small>
            </span>
          </div>
        </div>
      </div>

      <div className="cd-watch">
        <div className="cd-watch-main">
          {assets.length === 0 && (
            <div className="empty-state" data-testid="empty-vault">
              <Clapperboard size={22} />
              <h3>The vault is empty.</h3>
              <p>Camera files, separate audio, screen recordings, B-roll, and references will land here as the relay begins.</p>
            </div>
          )}

          {groups.map((group) => (
            <div className="cd-rail" key={group.kind}>
              <div className="cd-rail-head">
                <h3>{KIND_LABELS[group.kind] ?? group.kind}</h3>
                <span className="mono-label">{group.items.length}</span>
              </div>
              <div className="cd-rail-track">
                {group.items.map((asset) => (
                  <PosterCard
                    key={asset.id}
                    projectId={p.id}
                    asset={asset}
                    deduplicated={isDuplicateContent(assets, assets.findIndex((a) => a.id === asset.id))}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="paper-card">
            <div className="inline-heading">
              <span className="eyebrow"><UserPlus size={13} /> Members &amp; roles</span>
              <span className="mono-label">{p.members.length}</span>
            </div>
            <div className="den-stack">
              {p.members.map((member) => (
                <div key={member.id} className="list-row" data-testid={`card-member-${member.userId}`}>
                  <span className="person-dot" style={{ background: member.role === 'CAPTAIN' ? 'hsl(var(--accent))' : 'hsl(164 33% 45%)' }}>
                    {(member.name ?? member.userId).slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <b>{member.name ?? member.userId}</b>
                    <small>
                      {ROLE_LABELS[member.role] ?? member.role}
                      {member.name ? ` · ${member.userId}` : ''}
                    </small>
                  </span>
                  {member.role === 'CAPTAIN' && <span className="den-tag danger">Captain</span>}
                </div>
              ))}
            </div>

            {myRole === 'CAPTAIN' ? (
              <div className="mt-4 border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }}>
                <span className="eyebrow"><UserPlus size={12} /> Invite a teammate</span>
                <p className="setting-copy mt-1">Assign the five stages — Architect, Visual Editor, Sound Designer, Motion &amp; Color, Thumbnail — or add an uploader.</p>
                <InviteForm projectId={p.id} />
              </div>
            ) : (
              <p className="den-footnote mt-3">
                <Sparkles size={13} />
                Only the Captain can invite teammates. When a stage is assigned to you, its studio opens from the tabs above.
              </p>
            )}
          </div>
        </div>

        <div className="cd-watch-rail">
          <SubmissionsPanel projectId={p.id} myRole={myRole} />
          <JobProgressStrip projectId={p.id} />
          <GrantsPanel projectId={p.id} myRole={myRole} members={p.members} assets={p.assets} />
          <DownloadAuditPanel projectId={p.id} myRole={myRole} />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Private by design · raw files never leave the vault · the relay begins once footage lands
        <span className="ml-auto mono-label">Status: {p.status.replaceAll('_', ' ')}</span>
      </p>
    </div>
  );
}
