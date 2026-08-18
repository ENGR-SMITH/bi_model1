import { useRef, useState } from 'react';
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
  Palette,
  Scissors,
  Sparkles,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getDownloadVideoFileUrl,
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
  useUploadVideoAsset,
} from '@workspace/api-client-react';
import type { VideoAssetUploadInputKind } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';

const LEG_META = {
  SELECTS: { label: 'Selects', role: 'Story Architect', icon: Film },
  CUT: { label: 'Cut', role: 'Visual Editor', icon: Scissors },
  SOUND: { label: 'Sound', role: 'Sound Designer', icon: Mic2 },
  FINISH: { label: 'Finish', role: 'Motion & Color', icon: Palette },
} as const;

const KIND_LABELS: Record<string, string> = {
  RAW_VIDEO: 'Camera footage',
  RAW_AUDIO: 'Separate audio',
  SCREEN_REC: 'Screen recording',
  B_ROLL: 'B-roll',
  REFERENCE: 'Reference video',
  VO_PICKUP: 'Pickup voiceover',
  GRAPHIC: 'Graphic',
};

const ROLE_LABELS: Record<string, string> = {
  CAPTAIN: 'Captain',
  UPLOADER: 'Uploader',
  ARCHITECT: 'Story Architect',
  VISUAL_EDITOR: 'Visual Editor',
  SOUND_DESIGNER: 'Sound Designer',
  MOTION_COLOR: 'Motion & Color',
  VIEWER: 'Viewer',
};

const INVITE_ROLES = ['UPLOADER', 'ARCHITECT', 'VISUAL_EDITOR', 'SOUND_DESIGNER', 'MOTION_COLOR', 'VIEWER'] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function UploadForm({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const upload = useUploadVideoAsset();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<VideoAssetUploadInputKind>('RAW_VIDEO');
  const [fileName, setFileName] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    upload.mutate(
      { projectId, data: { file, kind } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
          if (fileRef.current) fileRef.current.value = '';
          setFileName('');
        },
      },
    );
  };

  const error = upload.error as { response?: { data?: { error?: string } } } | null;

  return (
    <form onSubmit={submit} data-testid="form-upload-asset">
      <div className="field">
        <span>Raw file</span>
        <input
          ref={fileRef}
          name="file"
          type="file"
          required
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
          data-testid="input-asset-file"
        />
      </div>
      <div className="field">
        <span>What is it?</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as VideoAssetUploadInputKind)}
          data-testid="select-asset-kind"
        >
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={upload.isPending || !fileName}
        className="primary-btn"
        data-testid="button-upload-asset"
      >
        <Upload size={14} />
        {upload.isPending ? 'Locking into the vault…' : 'Upload into the vault'}
      </button>
      {upload.isError && (
        <p className="setting-copy mt-2" role="alert">
          {error?.response?.data?.error || 'The upload failed. Try once more.'}
        </p>
      )}
    </form>
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
    <div className="paper-card mt-4" data-testid="panel-job-progress">
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
    <div className="paper-card mt-4" data-testid="panel-download-audit">
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
    <div className="paper-card mt-4" data-testid="panel-submissions">
      <div className="inline-heading">
        <span className="eyebrow"><Film size={13} /> The relay — leg submissions</span>
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
        <p className="setting-copy mt-3">Waiting on the Captain to approve or reject the pending leg.</p>
      )}
    </div>
  );
}

export default function ContentCreatorsProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  // Live: jobs, submissions, grants, and asset processing stream in.
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);

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
        <Link href="/" className="secondary-btn"><ArrowLeft size={14} /> Back to the room</Link>
      </div>
    );
  }

  const p = project.data;
  const myRole = p.myRole ?? 'VIEWER';

  return (
    <div className="page">
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>CONTENT CREATORS · THE VAULT</b>
          <span>Raw footage is viewable by the team, downloadable by no one. The lock releases when the Captain approves the final master.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>The vault</SectionEyebrow>
          <h1>{p.name}</h1>
          {p.description && <p>{p.description}</p>}
        </div>
        <Link href="/" className="secondary-btn" data-testid="link-project-back-room">
          <ArrowLeft size={14} />
          Back to the room
        </Link>
      </div>

      <div className="den-stat-row">
        <div className="den-stat"><small>Assets</small><b>{p.assets.length}</b></div>
        <div className="den-stat"><small>Team</small><b>{p.members.length}</b></div>
        <div className="den-stat"><small>Status</small><b>{p.status.replaceAll('_', ' ')}</b></div>
        <div className="den-stat"><small>Your role</small><b>{ROLE_LABELS[myRole] ?? myRole}</b></div>
      </div>

      <div className="den-two-col-wide mt-5">
        <section className="space-y-4">
          <div className="card-heading">
            <div>
              <span className="eyebrow">The vault</span>
              <h2>Raw footage</h2>
            </div>
            <span className="den-tag accent"><LockKeyhole size={10} /> locked</span>
          </div>

          {p.assets.length > 0 ? (
            <div className="den-stack">
              {p.assets.map((asset) => (
                <div key={asset.id} className="paper-card" style={{ padding: 20 }} data-testid={`card-asset-${asset.id}`}>
                  <div className="flex items-start gap-3">
                    <span className="world-symbol"><FileVideo2 size={14} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="truncate text-sm">{asset.fileName}</b>
                        <span className="den-tag gold">{KIND_LABELS[asset.kind] ?? asset.kind}</span>
                      </div>
                      <p className="mono-label mt-1">
                        {formatBytes(asset.sizeBytes)} · v{asset.version} · {asset.status.replaceAll('_', ' ')}
                      </p>
                      {asset.status === 'PROCESSED' && (
                        <Link href={`/projects/${p.id}/selects`} className="link-btn mt-2" data-testid={`link-studio-${asset.id}`}>
                          <Film size={13} /> Open the selects studio <ArrowLeft size={12} className="rotate-180" />
                        </Link>
                      )}
                    </div>
                    {p.status === 'RELEASED' ? (
                      <a href={getDownloadVideoFileUrl(p.id, asset.id)} download className="secondary-btn" data-testid={`link-download-${asset.id}`}>
                        <Download size={13} /> Download
                      </a>
                    ) : (
                      <span className="den-tag teal">Locked</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" data-testid="empty-vault">
              <Clapperboard size={22} />
              <h3>The vault is empty.</h3>
              <p>Drop in the raw footage — camera files, separate audio, screen recordings, B-roll. Proxies and transcripts follow as the relay begins.</p>
            </div>
          )}

          <div className="paper-card accent-card" data-testid="card-upload">
            <div className="inline-heading">
              <span className="eyebrow"><Upload size={13} /> Add raw footage</span>
            </div>
            <UploadForm projectId={p.id} />
          </div>

          <JobProgressStrip projectId={p.id} />
        </section>

        <section className="space-y-4">
          <GrantsPanel projectId={p.id} myRole={myRole} members={p.members} assets={p.assets} />
          <SubmissionsPanel projectId={p.id} myRole={myRole} />
          <DownloadAuditPanel projectId={p.id} myRole={myRole} />

          <div className="card-heading mt-5">
            <div>
              <span className="eyebrow">The team</span>
              <h2>Members & roles</h2>
            </div>
          </div>
          <div className="den-stack">
            {p.members.map((member) => (
              <div key={member.id} className="list-row" data-testid={`card-member-${member.userId}`}>
                <span className="person-dot" style={{ background: member.role === 'CAPTAIN' ? 'hsl(var(--accent))' : 'hsl(164 33% 45%)' }}>
                  {member.userId.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <b>{member.userId}</b>
                  <small>{ROLE_LABELS[member.role] ?? member.role}</small>
                </span>
                {member.role === 'CAPTAIN' && <span className="den-tag danger">Captain</span>}
              </div>
            ))}
          </div>

          {myRole === 'CAPTAIN' ? (
            <div className="paper-card accent-card mt-5" data-testid="card-invite">
              <div className="inline-heading">
                <span className="eyebrow"><UserPlus size={13} /> Invite a teammate</span>
              </div>
              <p className="setting-copy">Assign the four legs — Architect, Visual Editor, Sound Designer, Motion &amp; Color — or add an uploader.</p>
              <InviteForm projectId={p.id} />
            </div>
          ) : (
            <p className="den-footnote mt-5">
              <Sparkles size={13} />
              Only the Captain can invite teammates. When a leg is assigned to you, its studio appears here.
            </p>
          )}
        </section>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Private by design · raw files never leave the vault · the relay begins once footage lands
        <span className="ml-auto mono-label">Status: {p.status.replaceAll('_', ' ')}</span>
      </p>
    </div>
  );
}
