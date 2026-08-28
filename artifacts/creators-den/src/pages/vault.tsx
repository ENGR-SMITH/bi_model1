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
  getListVideoSubmissionsQueryKey,
  useAddVideoProjectMember,
  useApproveVideoSubmission,
  useCreateVideoGrant,
  useGetVideoProject,
  useListVideoDownloads,
  useListVideoGrants,
  useListVideoSubmissions,
  useRejectVideoSubmission,
  useRemoveVideoProjectMember,
  useRevokeVideoGrant,
  useUpdateVideoProjectMemberRoles,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { isAudioKind, proxyUrlFor } from '@/components/asset-preview';
import { MemberAvatar } from '@/components/member-avatar';
import { isTandemUid, normalizeTandemUid, tandemUid } from '@/lib/tandem-uid';
import {
  ALL_ROLES,
  CONTENT_ROLES,
  GRANT_ROLES,
  ROLE_LABELS,
  isCaptain,
  rolesLabel,
} from '@/lib/roles';

const LEG_META = {
  SELECTS: { label: 'Selects', role: 'Video', icon: Film },
  CUT: { label: 'Cut', role: 'Video', icon: Scissors },
  SOUND: { label: 'Sound', role: 'Audio', icon: Mic2 },
  FINISH: { label: 'Finish', role: 'Captain', icon: Palette },
  THUMBNAIL: { label: 'Thumbnail', role: 'Thumbnail', icon: Image },
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

const INVITE_ROLES = CONTENT_ROLES;

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
  const [uid, setUid] = useState('');
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>('VIDEO');

  const normalized = normalizeTandemUid(uid);
  const valid = isTandemUid(normalized);
  const touched = uid.trim().length > 0;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    invite.mutate(
      { projectId, data: { uid: normalized, role } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
          setUid('');
        },
      },
    );
  };

  const error = invite.error as { response?: { data?: { error?: string } } } | null;

  return (
    <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]" onSubmit={submit} data-testid="form-invite-member">
      <div className="min-w-0">
        <input
          value={uid}
          onChange={(event) => setUid(event.target.value.toUpperCase())}
          placeholder="TANDEM6EUHY"
          spellCheck={false}
          autoCapitalize="characters"
          className="font-mono uppercase tracking-wider"
          aria-label="Teammate's unique Tandem ID"
          data-testid="input-invite-uid"
        />
        {touched && !valid && (
          <p className="setting-copy !text-[11px] mt-1" role="alert">
            A Tandem ID looks like <span className="mono-label">TANDEM6EUHY</span> — find it on the teammate's profile.
          </p>
        )}
      </div>
      <select value={role} onChange={(event) => setRole(event.target.value as (typeof INVITE_ROLES)[number])} data-testid="select-invite-role">
        {INVITE_ROLES.map((value) => (
          <option key={value} value={value}>{ROLE_LABELS[value]}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={invite.isPending || !valid}
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

// One member row in the vault's Members & roles card. The Captain can edit a
// member's role set (add or remove roles) and remove them from the project.
function MemberRow({
  projectId,
  member,
  canManage,
}: {
  projectId: string;
  member: { id: string; userId: string; roles: string[]; name?: string | null };
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const updateRoles = useUpdateVideoProjectMemberRoles();
  const removeMember = useRemoveVideoProjectMember();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(member.roles ?? []);
  const [confirming, setConfirming] = useState(false);

  const startEdit = () => {
    setDraft(member.roles ?? []);
    setEditing(true);
  };

  const toggleDraft = (role: string) => {
    setDraft((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );
  };

  const save = () => {
    const roles = draft.length > 0 ? draft : ['VIEWER'];
    updateRoles.mutate(
      { projectId, memberId: member.id, data: { roles } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
          setEditing(false);
        },
      },
    );
  };

  const remove = () => {
    removeMember.mutate(
      { projectId, memberId: member.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
        },
      },
    );
  };

  const error = (updateRoles.error ?? removeMember.error) as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="list-row" data-testid={`card-member-${member.userId}`}>
      <MemberAvatar userId={member.userId} name={member.name} size={28} />
      <span className="min-w-0 flex-1">
        <b>{member.name ?? member.userId}</b>
        <small className="flex flex-wrap items-center gap-1.5">
          {(member.roles ?? []).includes('CAPTAIN') ? (
            <span className="den-tag danger">Captain</span>
          ) : (
            (member.roles ?? []).map((role) => (
              <span key={role} className="den-tag accent" data-testid={`role-${role.toLowerCase()}`}>
                {ROLE_LABELS[role] ?? role}
              </span>
            ))
          )}
          <span className="mono-label" title="Unique Tandem ID — share it to invite this member">
            {tandemUid(member.userId)}
          </span>
        </small>
        {error && (
          <small className="text-danger" role="alert">
            {error?.response?.data?.error || 'That could not be saved.'}
          </small>
        )}
      </span>

      {editing && canManage ? (
        <span className="flex flex-col items-end gap-2">
          <span className="member-role-editor" data-testid={`member-roles-editor-${member.userId}`}>
            {CONTENT_ROLES.map((role) => (
              <label key={role} className="member-role-check">
                <input
                  type="checkbox"
                  checked={draft.includes(role)}
                  onChange={() => toggleDraft(role)}
                  data-testid={`member-role-toggle-${role.toLowerCase()}`}
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </span>
          <span className="flex gap-2">
            <button type="button" className="secondary-btn" onClick={save} disabled={updateRoles.isPending} data-testid={`button-save-member-roles-${member.userId}`}>
              {updateRoles.isPending ? 'Saving…' : 'Save roles'}
            </button>
            <button type="button" className="secondary-btn" onClick={() => setEditing(false)}>Cancel</button>
          </span>
        </span>
      ) : canManage ? (
        <span className="flex gap-2 items-center">
          <button type="button" className="secondary-btn" onClick={startEdit} title="Edit roles" data-testid={`button-edit-member-${member.userId}`}>
            <UserPlus size={13} /> Roles
          </button>
          {confirming ? (
            <span className="flex gap-2 items-center">
              <button type="button" className="secondary-btn" onClick={remove} disabled={removeMember.isPending} data-testid={`button-confirm-remove-${member.userId}`}>
                {removeMember.isPending ? 'Removing…' : 'Confirm'}
              </button>
              <button type="button" className="secondary-btn" onClick={() => setConfirming(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="danger-icon" title="Remove from project" onClick={() => setConfirming(true)} data-testid={`button-remove-member-${member.userId}`}>
              <X size={14} />
            </button>
          )}
        </span>
      ) : null}
    </div>
  );
}

function GrantsPanel({ projectId, myRoles, members }: { projectId: string; myRoles: string[]; members: Array<{ id: string; userId: string; roles: string[]; name?: string | null }> }) {
  const queryClient = useQueryClient();
  // Grant rows are Captain-only, so member names are always resolvable here.
  const memberNameById = new Map(members.map((member) => [member.userId, member.name ?? member.userId.slice(0, 8)]));
  const grants = useListVideoGrants(projectId, {
    query: { queryKey: getListVideoGrantsQueryKey(projectId), enabled: isCaptain(myRoles) },
  });
  const create = useCreateVideoGrant();
  const revoke = useRevokeVideoGrant();
  const [memberId, setMemberId] = useState('');
  // Selected roles: either ["ALL"] or a subset of the four content roles.
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(24);

  if (!isCaptain(myRoles)) return null;

  const toggleRole = (role: string) => {
    setSelectedRoles((current) => {
      if (role === ALL_ROLES) return current.includes(ALL_ROLES) ? [] : [ALL_ROLES];
      const withoutAll = current.filter((r) => r !== ALL_ROLES);
      return withoutAll.includes(role)
        ? withoutAll.filter((r) => r !== role)
        : [...withoutAll, role];
    });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memberId || selectedRoles.length === 0) return;
    create.mutate(
      { projectId, data: { memberId, roles: selectedRoles, reason: reason.trim() || undefined, expiresInHours: hours } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoGrantsQueryKey(projectId) });
          setMemberId('');
          setSelectedRoles([]);
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
  const hoursLeft = (expiresAt: string) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));

  return (
    <div className="paper-card accent-card" data-testid="panel-grants">
      <div className="inline-heading">
        <span className="eyebrow"><Download size={13} /> Temporary download grants</span>
        {activeGrants.length > 0 && <span className="den-tag teal">{activeGrants.length} active</span>}
      </div>
      <p className="setting-copy">
        Grant a teammate a timed download of every file version under a role — say, all video files for an external
        edit pass. Pick one role, several roles, or all roles; revoke anytime; every download is still audited.
      </p>
      <form className="grant-form mt-3" onSubmit={submit} data-testid="form-grant">
        <label className="grant-field">
          <span className="mono-label">Teammate</span>
          <select value={memberId} onChange={(event) => setMemberId(event.target.value)} data-testid="grant-select-member">
            <option value="">Choose a teammate…</option>
            {members.filter((m) => !(m.roles ?? []).includes('CAPTAIN')).map((m) => (
              <option key={m.id} value={m.userId}>{m.name ?? m.userId.slice(0, 8)}</option>
            ))}
          </select>
        </label>
        <label className="grant-field grant-field-wide">
          <span className="mono-label">Files by role</span>
          <div className="grant-roles" data-testid="grant-select-roles">
            {GRANT_ROLES.map((role) => {
              const selected = selectedRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  className={`grant-role-chip ${selected ? 'selected' : ''}`}
                  onClick={() => toggleRole(role)}
                  aria-pressed={selected}
                  data-testid={`grant-role-${role.toLowerCase()}`}
                >
                  {role === ALL_ROLES ? 'All roles' : ROLE_LABELS[role]}
                </button>
              );
            })}
          </div>
          {selectedRoles.length === 0 && (
            <span className="grant-roles-hint">Pick at least one role — “All roles” covers every file.</span>
          )}
        </label>
        <label className="grant-field grant-field-wide">
          <span className="mono-label">Reason <i className="grant-optional">optional</i></span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. external edit pass" maxLength={500} data-testid="grant-reason" />
        </label>
        <div className="grant-actions">
          <label className="grant-field grant-hours">
            <span className="mono-label">Expires in</span>
            <span className="grant-hours-row">
              <input value={hours} onChange={(event) => setHours(Number(event.target.value) || 24)} type="number" min={1} max={168} title="Hours until expiry" data-testid="grant-hours" />
              <span>hours</span>
            </span>
          </label>
          <button type="submit" disabled={create.isPending || !memberId || selectedRoles.length === 0} className="secondary-btn grant-submit" data-testid="button-create-grant">
            <Download size={13} />
            {create.isPending ? 'Granting…' : 'Grant download'}
          </button>
        </div>
      </form>
      {create.isError && (
        <p className="setting-copy mt-2" role="alert">
          {createError?.response?.data?.error || 'The grant could not be created.'}
        </p>
      )}

      {(grants.data ?? []).length > 0 && (
        <div className="grant-list mt-3">
          {(grants.data ?? []).map((grant) => {
            const active = !grant.revokedAt && new Date(grant.expiresAt) > new Date();
            const memberName = memberNameById.get(grant.memberId) ?? grant.memberId.slice(0, 8);
            const grantRoles = grant.roles ?? [];
            const scope = grantRoles.includes(ALL_ROLES)
              ? 'All roles · every file'
              : grantRoles.map((role) => ROLE_LABELS[role] ?? role).join(', ');
            return (
              <div key={grant.id} className="grant-row" data-testid={`grant-${grant.id}`}>
                <MemberAvatar userId={grant.memberId} name={memberName} size={30} />
                <div className="grant-row-main">
                  <b>{memberName}</b>
                  <span className="grant-row-file" title={scope}>{scope}</span>
                  {grant.reason && <span className="grant-row-reason">“{grant.reason}”</span>}
                </div>
                <div className="grant-row-end">
                  {active ? (
                    <span className="den-tag teal">{hoursLeft(grant.expiresAt)}h left</span>
                  ) : (
                    <span className="den-tag muted">{grant.revokedAt ? 'revoked' : 'expired'}</span>
                  )}
                  {active && (
                    <button type="button" onClick={() => onRevoke(grant.id)} disabled={revoke.isPending} className="danger-icon" title="Revoke" data-testid={`button-revoke-${grant.id}`}>
                      <X size={14} />
                    </button>
                  )}
                </div>
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

function DownloadAuditPanel({ projectId, myRoles }: { projectId: string; myRoles: string[] }) {
  const downloads = useListVideoDownloads(projectId, {
    query: { queryKey: getListVideoDownloadsQueryKey(projectId), enabled: isCaptain(myRoles) },
  });

  if (!isCaptain(myRoles) || !downloads.data || downloads.data.length === 0) return null;

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

function SubmissionsPanel({ projectId, myRoles }: { projectId: string; myRoles: string[] }) {
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
  const isCaptain = myRoles.includes('CAPTAIN');

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
  const myRoles = p.myRoles ?? [];
  const captain = isCaptain(myRoles);

  // Group assets into rails by kind, in a stable display order.
  const seen = new Set<string>();
  const orderedKinds = [...KIND_ORDER, ...assets.map((a) => a.kind).filter((k) => !KIND_ORDER.includes(k as (typeof KIND_ORDER)[number]))];
  const groups = orderedKinds
    .filter((kind) => (seen.has(kind) ? false : (seen.add(kind), true)))
    .map((kind) => ({ kind, items: assets.filter((a) => a.kind === kind) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="page vault-page">
      <div className="cd-billboard mb-6" data-testid="vault-billboard">
        <div className="cd-billboard-scrim" />
        <div className="cd-billboard-body">
          <SectionEyebrow>The vault · repository</SectionEyebrow>
          <h1>{p.name}</h1>
          {p.description && <p>{p.description}</p>}
          <div className="cd-metarow">
            <span className="den-tag accent"><LockKeyhole size={10} /> {p.status.replaceAll('_', ' ')}</span>
            <span className="cd-metatext">
              <b>{p.assets.length} asset{p.assets.length === 1 ? '' : 's'} · {p.members.length} member{p.members.length === 1 ? '' : 's'}</b>
              <small>you are the {rolesLabel(myRoles)}</small>
            </span>
          </div>
          {/* The whole crew — real avatars + roles, moved up from the chat. */}
          <div className="cd-roster" data-testid="vault-roster">
            {p.members.map((member) => (
              <span
                key={member.id}
                className="cd-roster-pill"
                title={`${member.name ?? member.userId} · ${rolesLabel(member.roles)}`}
                data-testid={`roster-member-${member.userId}`}
              >
                <MemberAvatar userId={member.userId} name={member.name} size={24} />
                <span className="cd-roster-name">{member.name ?? member.userId.slice(0, 8)}</span>
                <span className={`den-tag ${(member.roles ?? []).includes('CAPTAIN') ? 'danger' : 'accent'}`}>
                  {rolesLabel(member.roles)}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Members & roles + temporary download grants sit right under the vault
          card — the repo overview first, then the people and access controls. */}
      <div className="grid gap-4 lg:grid-cols-2 mb-6" data-testid="vault-top-cards">
        <div className="paper-card">
          <div className="inline-heading">
            <span className="eyebrow"><UserPlus size={13} /> Members &amp; roles</span>
            <span className="mono-label">{p.members.length}</span>
          </div>
          <div className="den-stack">
            {p.members.map((member) => (
              <MemberRow
                key={member.id}
                projectId={p.id}
                member={member}
                canManage={captain && !(member.roles ?? []).includes('CAPTAIN')}
              />
            ))}
          </div>

          {captain ? (
            <div className="mt-4 border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }}>
              <span className="eyebrow"><UserPlus size={12} /> Invite a teammate</span>
              <p className="setting-copy mt-1">Assign one of the four roles — Video, Audio, Script, or Thumbnail. Inviting someone who is already a member adds the role to their set; you can edit or remove roles below. Invite with their unique Tandem ID (shown on their profile).</p>
              <InviteForm projectId={p.id} />
            </div>
          ) : (
            <p className="den-footnote mt-3">
              <Sparkles size={13} />
              Only the Captain can invite teammates, change roles, or remove people. When a role is assigned to you, its studio opens from the tabs above.
            </p>
          )}
        </div>
        <GrantsPanel projectId={p.id} myRoles={myRoles} members={p.members} />
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
        </div>

        <div className="cd-watch-rail">
          <SubmissionsPanel projectId={p.id} myRoles={myRoles} />
          <DownloadAuditPanel projectId={p.id} myRoles={myRoles} />
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
