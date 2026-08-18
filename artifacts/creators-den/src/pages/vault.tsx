import { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
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
    <form className="space-y-4" onSubmit={submit} data-testid="form-upload-asset">
      <div>
        <label htmlFor="asset-file" className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-[#77717a]">Raw file</label>
        <div className="mt-2 flex items-center gap-3 rounded-xl border-2 border-dashed border-[#8dc2ad] bg-[#f7eddf] px-4 py-3">
          <Upload className="h-4 w-4 shrink-0 text-[#286254]" />
          <input
            ref={fileRef}
            id="asset-file"
            name="file"
            type="file"
            required
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
            className="focus-house w-full text-sm text-[#292b45] file:mr-3 file:rounded-full file:border-0 file:bg-[#292b45] file:px-4 file:py-2 file:text-xs file:font-bold file:text-[#fff4e6]"
            data-testid="input-asset-file"
          />
        </div>
      </div>
      <div>
        <label htmlFor="asset-kind" className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-[#77717a]">What is it?</label>
        <select
          id="asset-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as VideoAssetUploadInputKind)}
          className="focus-house mt-2 w-full rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-3 text-sm text-[#292b45]"
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
        className="focus-house inline-flex items-center gap-2 rounded-xl bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-wait disabled:opacity-60"
        data-testid="button-upload-asset"
      >
        {upload.isPending ? 'Locking into the vault...' : 'Upload into the vault'}
      </button>
      {upload.isError && (
        <p className="text-sm font-semibold text-[#a33d31]" role="alert">
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
    <form className="mt-3 flex flex-col gap-3 sm:flex-row" onSubmit={submit} data-testid="form-invite-member">
      <input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        placeholder="teammate@example.com"
        required
        className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
        data-testid="input-invite-email"
      />
      <select
        value={role}
        onChange={(event) => setRole(event.target.value as (typeof INVITE_ROLES)[number])}
        className="focus-house rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45]"
        data-testid="select-invite-role"
      >
        {INVITE_ROLES.map((value) => (
          <option key={value} value={value}>{ROLE_LABELS[value]}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={invite.isPending || !email.trim()}
        className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-wait disabled:opacity-60"
        data-testid="button-invite-member"
      >
        <UserPlus className="h-4 w-4" />
        {invite.isPending ? 'Adding...' : 'Add member'}
      </button>
      {invite.isError && (
        <p className="w-full text-sm font-semibold text-[#a33d31]" role="alert">
          {(error?.response?.data?.error || 'Could not add that member.')}
        </p>
      )}
    </form>
  );
}

function JobProgressStrip({ projectId }: { projectId: string }) {
  const jobs = useListVideoJobs(projectId);
  const active = (jobs.data ?? []).filter((job) => ['QUEUED', 'RUNNING'].includes(job.status));
  const recent = (jobs.data ?? []).slice(0, 5);

  if (!jobs.data || jobs.data.length === 0) return null;

  return (
    <div className="mt-4 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-4" data-testid="panel-job-progress">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">Processing</span>
        {active.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f0c85c] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#292b45]">
            <Sparkles className="h-3 w-3 animate-pulse" />
            {active.length} running
          </span>
        ) : (
          <span className="rounded-full bg-[#e5f1e8] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#286254]">idle</span>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        {recent.map((job) => (
          <div key={job.id} className="flex items-center justify-between gap-3 text-xs" data-testid={`job-${job.id}`}>
            <span className="flex items-center gap-2 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#625f6d]">
              <span className={`h-1.5 w-1.5 rounded-full ${job.status === 'SUCCEEDED' ? 'bg-[#286254]' : job.status === 'FAILED' ? 'bg-[#a33d31]' : 'animate-pulse bg-[#f0c85c]'}`} />
              {job.type.replaceAll('_', ' ')}
            </span>
            <span className={`font-mono-ui text-[9px] uppercase tracking-[.12em] ${job.status === 'FAILED' ? 'text-[#a33d31]' : 'text-[#98909a]'}`}>
              {job.status.toLowerCase()}
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
    <div className="mt-6 rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5" data-testid="panel-grants">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
        <Download className="h-4 w-4" />
        Temporary download grants
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#286254]">
        Grant a teammate a timed download of a specific file — say, an audio stem for an external DAW repair. Revoke anytime; every download is still audited.
      </p>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submit} data-testid="form-grant">
        <select
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
          className="focus-house rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45]"
          data-testid="grant-select-member"
        >
          <option value="">Teammate…</option>
          {members.filter((m) => m.role !== 'CAPTAIN').map((m) => (
            <option key={m.id} value={m.userId}>{m.userId}</option>
          ))}
        </select>
        <select
          value={fileId}
          onChange={(event) => setFileId(event.target.value)}
          className="focus-house rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-3 py-2.5 text-sm text-[#292b45]"
          data-testid="grant-select-file"
        >
          <option value="">File…</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.fileName}</option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason — e.g. DAW repair"
          maxLength={500}
          className="focus-house flex-1 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-2.5 text-sm text-[#292b45] placeholder:text-[#98909a]"
          data-testid="grant-reason"
        />
        <input
          value={hours}
          onChange={(event) => setHours(Number(event.target.value) || 24)}
          type="number"
          min={1}
          max={168}
          title="Hours until expiry"
          className="focus-house w-20 rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-2 py-2.5 text-center text-sm text-[#292b45]"
          data-testid="grant-hours"
        />
        <button
          type="submit"
          disabled={create.isPending || !memberId || !fileId}
          className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#292b45] px-4 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-create-grant"
        >
          <Download className="h-4 w-4" />
          {create.isPending ? 'Granting…' : 'Grant'}
        </button>
      </form>
      {create.isError && (
        <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">
          {createError?.response?.data?.error || 'The grant could not be created.'}
        </p>
      )}

      {(grants.data ?? []).length > 0 && (
        <div className="mt-4 space-y-2">
          {(grants.data ?? []).map((grant) => {
            const active = !grant.revokedAt && new Date(grant.expiresAt) > new Date();
            return (
              <div key={grant.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#8dc2ad] bg-[#fff4e6] px-3.5 py-2.5" data-testid={`grant-${grant.id}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#292b45">{grant.memberId.slice(0, 8)} · {grant.reason || 'download access'}</p>
                  <p className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#286254]">
                    {active ? `expires ${new Date(grant.expiresAt).toLocaleDateString()}` : grant.revokedAt ? 'revoked' : 'expired'}
                  </p>
                </div>
                {active && (
                  <button
                    type="button"
                    onClick={() => onRevoke(grant.id)}
                    disabled={revoke.isPending}
                    className="focus-house inline-flex items-center gap-1 rounded-full bg-[#e55b4c] px-3 py-1.5 text-xs font-bold text-[#fff4e6] hover:bg-[#c7473c] disabled:opacity-60"
                    data-testid={`button-revoke-${grant.id}`}
                  >
                    <X className="h-3 w-3" />
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {activeGrants.length === 0 && (grants.data ?? []).length === 0 && (
        <p className="mt-3 text-xs text-[#286254]">No grants yet — the Lock stays on until you release it.</p>
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
    <div className="mt-6 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5" data-testid="panel-download-audit">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
        <History className="h-4 w-4" />
        Download audit trail
      </div>
      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
        {downloads.data.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] px-3 py-2" data-testid={`download-entry-${entry.id}`}>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-[#292b45]">{entry.fileName}</p>
              <p className="font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">by {entry.memberId.slice(0, 8)}</p>
            </div>
            <span className="shrink-0 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">{new Date(entry.createdAt).toLocaleDateString()}</span>
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
    <div className="mt-6 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5" data-testid="panel-submissions">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
        <Film className="h-4 w-4" />
        The relay — leg submissions
      </div>
      <div className="mt-4 space-y-2">
        {rows.map((submission) => {
          const meta = LEG_META[submission.leg as keyof typeof LEG_META] ?? { label: submission.leg, role: '', icon: Film };
          const Icon = meta.icon;
          const isPending = submission.status === 'SUBMITTED';
          return (
            <div key={submission.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#e5d7c5] bg-[#f7eddf] px-4 py-3" data-testid={`submission-${submission.id}`}>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#292b45] text-[#f0c85c]"><Icon className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-bold text-[#292b45]">{meta.label} — {meta.role}</p>
                  <p className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">
                    {submission.status.replaceAll('_', ' ')} · v{submission.timelineVersionId.slice(0, 8)}
                    {submission.note && ` · “${submission.note.slice(0, 60)}”`}
                  </p>
                </div>
              </div>
              {isPending && isCaptain ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide(submission.id, 'approve')}
                    disabled={approve.isPending || reject.isPending}
                    className="focus-house inline-flex items-center gap-1 rounded-full bg-[#286254] px-3 py-1.5 text-xs font-bold text-[#fff4e6] hover:bg-[#1d5048] disabled:opacity-60"
                    data-testid={`button-approve-${submission.id}`}
                  >
                    <Check className="h-3 w-3" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(submission.id, 'reject')}
                    disabled={approve.isPending || reject.isPending}
                    className="focus-house inline-flex items-center gap-1 rounded-full bg-[#e55b4c] px-3 py-1.5 text-xs font-bold text-[#fff4e6] hover:bg-[#c7473c] disabled:opacity-60"
                    data-testid={`button-reject-${submission.id}`}
                  >
                    <X className="h-3 w-3" />
                    Reject
                  </button>
                </div>
              ) : (
                <span className={`rounded-full px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] ${submission.status === 'APPROVED' ? 'bg-[#e5f1e8] text-[#286254]' : submission.status === 'REJECTED' ? 'bg-[#ffe9df] text-[#a33d31]' : 'bg-[#f0c85c] text-[#292b45]'}`}>
                  {submission.status}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {pending.length > 0 && !isCaptain && (
        <p className="mt-3 text-xs text-[#77717a]">Waiting on the Captain to approve or reject the pending leg.</p>
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
      <div className="mx-auto max-w-[1180px]">
        <div className="h-40 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" />
        <div className="mt-6 h-64 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" />
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <SectionEyebrow>Vault closed</SectionEyebrow>
        <h1 className="mt-5 text-6xl font-extrabold tracking-[-0.08em]">This room is out of reach.</h1>
        <Link href="/" className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">
          <ArrowLeft className="h-4 w-4" />
          Back to content creators
        </Link>
      </div>
    );
  }

  const p = project.data;

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link href="/" className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-project-back-room">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to content creators
      </Link>

      <div className="reveal mt-6 flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-9 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Content creators / the vault</SectionEyebrow>
          <h1 className="mt-4 max-w-[16ch] text-5xl font-extrabold leading-[.9] tracking-[-0.06em] text-[#292b45] sm:text-6xl">{p.name}</h1>
          {p.description && <p className="mt-3 max-w-xl text-sm leading-[1.8] text-[#625f6d]">{p.description}</p>}
        </div>
        <div className="max-w-sm rounded-2xl border-2 border-[#c7473c] bg-[#e55b4c] p-5 text-[#fff4e6]" data-testid="banner-lock">
          <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#ffe6d7]">
            <LockKeyhole className="h-4 w-4" />
            The lock is on
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[#ffe6d7]">
            Raw footage is viewable by the team, downloadable by no one. The lock releases when the Captain approves the final master.
          </p>
        </div>
      </div>

      <div className="reveal reveal-1 mt-10 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section>
          <div className="flex items-center gap-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">The vault</span>
            <div className="h-px flex-1 bg-[#d6cbb9]" />
          </div>

          {p.assets.length > 0 ? (
            <div className="mt-4 space-y-3">
              {p.assets.map((asset) => (
                <div key={asset.id} className="soft-lift flex items-start gap-4 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5" data-testid={`card-asset-${asset.id}`}>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#292b45] text-[#f0c85c]">
                    <FileVideo2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-bold text-[#292b45]">{asset.fileName}</span>
                      <span className="rounded-full bg-[#f0c85c] px-2.5 py-0.5 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#292b45]">{KIND_LABELS[asset.kind] ?? asset.kind}</span>
                    </div>
                    <p className="mt-1 font-mono-ui text-[10px] uppercase tracking-[.14em] text-[#98909a]">
                      {formatBytes(asset.sizeBytes)} · v{asset.version} · {asset.status.replaceAll('_', ' ')}
                    </p>
                    {asset.status === 'PROCESSED' && (
                      <Link
                        href={`/projects/${p.id}/selects`}
                        className="focus-house mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#292b45] px-3 py-1.5 text-xs font-bold text-[#fff4e6] transition-colors hover:bg-[#286254]"
                        data-testid={`link-studio-${asset.id}`}
                      >
                        <Film className="h-3 w-3" />
                        Open the selects studio
                      </Link>
                    )}
                  </div>
                  {p.status === 'RELEASED' ? (
                    <a
                      href={getDownloadVideoFileUrl(p.id, asset.id)}
                      download
                      className="focus-house inline-flex items-center gap-1.5 rounded-full bg-[#286254] px-3 py-1.5 text-xs font-bold text-[#fff4e6] transition-colors hover:bg-[#1d5048]"
                      data-testid={`link-download-${asset.id}`}
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </a>
                  ) : (
                    <span className="rounded-full border border-[#8dc2ad] bg-[#e5f1e8] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#286254]">Locked</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-8 shadow-[8px_10px_0_rgba(41,43,69,.07)]" data-testid="empty-vault">
              <Clapperboard className="h-7 w-7 text-[#e55b4c]" />
              <p className="mt-7 font-display text-4xl italic">The vault is empty.</p>
              <p className="mt-3 max-w-xl text-sm leading-[1.8] text-[#77717a]">Drop in the raw footage — camera files, separate audio, screen recordings, B-roll. Proxies and transcripts follow as the relay begins.</p>
            </div>
          )}

          <div className="mt-6 rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5" data-testid="card-upload">
            <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
              <Upload className="h-4 w-4" />
              Add raw footage
            </div>
            <div className="mt-3">
              <UploadForm projectId={p.id} />
            </div>
          </div>

          <JobProgressStrip projectId={p.id} />
        </section>

        <section>
          <GrantsPanel projectId={p.id} myRole={p.myRole ?? 'VIEWER'} members={p.members} assets={p.assets} />
          <SubmissionsPanel projectId={p.id} myRole={p.myRole ?? 'VIEWER'} />
          <DownloadAuditPanel projectId={p.id} myRole={p.myRole ?? 'VIEWER'} />

          <div className="flex items-center gap-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">The team</span>
            <div className="h-px flex-1 bg-[#d6cbb9]" />
          </div>
          <div className="mt-4 space-y-3">
            {p.members.map((member) => (
              <div key={member.id} className="soft-lift flex items-center justify-between gap-3 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-4" data-testid={`card-member-${member.userId}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3e8074] text-xs font-bold text-[#fff4e6]">
                    {member.userId.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-[#292b45]">{member.userId}</p>
                    <p className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[#98909a]">{ROLE_LABELS[member.role] ?? member.role}</p>
                  </div>
                </div>
                {member.role === 'CAPTAIN' && (
                  <span className="rounded-full bg-[#e55b4c] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#fff4e6]">Captain</span>
                )}
              </div>
            ))}
          </div>

          {p.myRole === 'CAPTAIN' ? (
            <div className="mt-6 rounded-[1.25rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5" data-testid="card-invite">
              <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">
                <UserPlus className="h-4 w-4" />
                Invite a teammate
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[#286254]">Assign the four legs — Architect, Visual Editor, Sound Designer, Motion &amp; Color — or add an uploader.</p>
              <InviteForm projectId={p.id} />
            </div>
          ) : (
            <p className="mt-6 flex items-center gap-2 text-xs text-[#77717a]">
              <Sparkles className="h-4 w-4 text-[#e55b4c]" />
              Only the Captain can invite teammates. When a leg is assigned to you, its studio appears here.
            </p>
          )}
        </section>
      </div>

      <p className="reveal reveal-2 mt-10 flex flex-wrap items-center gap-3 border-t-2 border-[#d6cbb9] pt-3 text-sm text-[#77717a]">
        <LockKeyhole className="h-4 w-4 text-[#e55b4c]" />
        <span>Private by design · raw files never leave the vault · the relay begins once footage lands</span>
        <span className="ml-auto flex items-center gap-1 font-mono-ui text-[10px] uppercase tracking-[.14em] text-[#98909a]">
          <ArrowUpRight className="h-3 w-3" />
          Status: {p.status.replaceAll('_', ' ')}
        </span>
      </p>
    </div>
  );
}
