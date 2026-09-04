// ---------------------------------------------------------------------------
// SubmissionOverview — the crew's side of the /review page (non-Captains).
// Shows every stage submission the signed-in member has handed in across their
// projects, with its state (awaiting review / approved / rejected + the
// Captain's improvement note), and a relay-flow tree of the selected project's
// whole timeline on the side so the member can see where each stage sits.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  CheckCircle2,
  Clock3,
  GitPullRequest,
  Inbox,
  Send,
  XCircle,
} from 'lucide-react';
import {
  listVideoSubmissions,
  listVideoTimelineVersions,
  useListVideoProjects,
} from '@workspace/api-client-react';
import type { VideoSubmission } from '@workspace/api-client-react';
import { RELAY_LEGS } from '@/components/shell';
import type { StudioLeg } from '@/components/role-oracle';

/** A submission enriched with its project's name for the overview list. */
export interface MySubmissionRow extends VideoSubmission {
  projectName: string;
}

type StatusFilter = 'ALL' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'SUBMITTED', label: 'Awaiting review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Sent back' },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  SUBMITTED: { label: 'Awaiting review', cls: 'gold' },
  APPROVED: { label: 'Approved', cls: 'teal' },
  REJECTED: { label: 'Sent back', cls: 'danger' },
};

const LEG_TONES: Record<string, string> = {
  SELECTS: 'gold',
  CUT: 'accent',
  SOUND: 'teal',
  FINISH: 'muted',
  THUMBNAIL: 'accent',
};

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

function legLabel(leg: string): string {
  return RELAY_LEGS.find((relay) => relay.leg === leg)?.label ?? leg;
}

// ---------------------------------------------------------------------------
// TimelineTree — a relay-flow chart of the whole timeline: each stage
// (Selects → Cut → Sound → Finish → Thumbnail) is a branch whose saved
// versions hang off it, newest on top, with the head marked and the latest
// submission state shown on the branch.
// ---------------------------------------------------------------------------

export function TimelineTree({
  projectId,
  submissions,
}: {
  projectId: string;
  /** The project's submissions (any leg) — used for the per-stage badges. */
  submissions: MySubmissionRow[];
}) {
  const versionsQuery = useQuery({
    queryKey: ['relay-tree-versions', projectId],
    queryFn: async () => {
      const legs = RELAY_LEGS.map((relay) => relay.leg as StudioLeg);
      const rows = await Promise.all(
        legs.map(async (leg) => {
          const versions = await listVideoTimelineVersions(projectId, leg);
          return { leg, versions: [...versions].sort((a, b) => a.version - b.version) };
        }),
      );
      return new Map(rows.map((row) => [row.leg, row.versions]));
    },
    enabled: Boolean(projectId),
  });

  const latestByLeg = useMemo(() => {
    const map = new Map<string, MySubmissionRow>();
    for (const submission of submissions) {
      const current = map.get(submission.leg);
      if (!current || new Date(submission.createdAt) > new Date(current.createdAt)) {
        map.set(submission.leg, submission);
      }
    }
    return map;
  }, [submissions]);

  const versionsByLeg = versionsQuery.data;

  return (
    <div className="paper-card timeline-tree" data-testid="timeline-tree">
      <div className="inline-heading">
        <span className="eyebrow"><GitPullRequest size={13} /> Project timeline</span>
        <span className="mono-label">relay flow</span>
      </div>
      <div className="relay-flow">
        {RELAY_LEGS.map((relay, index) => {
          const leg = relay.leg as StudioLeg;
          const versions = versionsByLeg?.get(leg) ?? [];
          const latest = latestByLeg.get(leg);
          const badge = latest ? STATUS_META[latest.status] : null;
          const headVersion = versions.length > 0 ? versions[versions.length - 1] : null;
          return (
            <div
              key={leg}
              className={`relay-stage ${index < RELAY_LEGS.length - 1 ? 'has-next' : ''}`}
              data-testid={`relay-stage-${leg.toLowerCase()}`}
            >
              <span className={`relay-stage-head den-tag ${LEG_TONES[leg] ?? 'muted'}`}>{relay.label}</span>
              {badge && (
                <span className={`relay-stage-badge den-tag ${badge.cls}`} title={`Latest submission: ${badge.label}`}>
                  {latest?.status === 'SUBMITTED' ? <Clock3 size={9} /> : latest?.status === 'APPROVED' ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                  {badge.label}
                </span>
              )}
              <div className="relay-versions">
                {versions.length === 0 ? (
                  <span className="relay-empty">no versions yet</span>
                ) : (
                  [...versions]
                    .reverse()
                    .map((version) => (
                      <span
                        key={version.id}
                        className={`relay-version ${version.id === headVersion?.id ? 'is-head' : ''}`}
                        title={`v${version.version}${version.message ? ` — ${version.message}` : ''}`}
                      >
                        <b>v{version.version}</b>
                        {version.id === headVersion?.id && <em>head</em>}
                      </span>
                    ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="den-footnote mt-2">
        Stages flow Selects → Cut → Sound → Finish → Thumbnail. A stage is added to this timeline
        only when the Captain approves its submission.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubmissionOverview
// ---------------------------------------------------------------------------

export function SubmissionOverview() {
  const { user } = useUser();
  const projectsQuery = useListVideoProjects();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);

  const projects = projectsQuery.data ?? [];
  const userId = user?.id;
  const projectKey = projects.map((project) => project.id).join('|');

  const mineQuery = useQuery({
    queryKey: ['my-video-submissions', projectKey],
    enabled: projects.length > 0 && Boolean(userId),
    queryFn: async (): Promise<MySubmissionRow[]> => {
      const nameById = new Map(projects.map((project) => [project.id, project.name]));
      const rows = await Promise.all(
        projects.map(async (project) => {
          const submissions = await listVideoSubmissions(project.id);
          return submissions
            .filter((submission) => submission.submittedById === userId)
            .map((submission) => ({
              ...submission,
              projectName: nameById.get(submission.projectId) ?? 'Untitled project',
            }));
        }),
      );
      return rows
        .flat()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    // Keep states live while the page is open: approvals/rejections arrive
    // from the Captain without a manual refresh.
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const all = mineQuery.data ?? [];
  const rows = filter === 'ALL' ? all : all.filter((row) => row.status === filter);
  const open = all.find((row) => row.id === openId) ?? null;

  // The tree shows the project the member last touched (their most recent
  // submission), switchable when they work across several projects.
  const involvedProjects = useMemo(() => {
    const ids = [...new Set(all.map((row) => row.projectId))];
    return projects.filter((project) => ids.includes(project.id));
  }, [all, projects]);
  const [treeProjectId, setTreeProjectId] = useState<string | null>(null);
  const activeProjectId =
    treeProjectId ?? all[0]?.projectId ?? involvedProjects[0]?.id ?? null;
  const projectSubmissions = all.filter((row) => row.projectId === activeProjectId);

  const pendingCount = all.filter((row) => row.status === 'SUBMITTED').length;

  return (
    <div className="page" data-testid="submission-overview">
      <div className="page-header">
        <div>
          <span className="eyebrow"><Send size={13} /> Your submissions</span>
          <h1>Where your work stands.</h1>
          <p>
            Every stage you hand in lands here. {pendingCount > 0
              ? `${pendingCount} waiting on the Captain${pendingCount === 1 ? '' : 's'} review right now.`
              : 'When the Captain reviews it, the decision — and their improvement note — shows up here.'}
          </p>
        </div>
        {all.length > 0 && (
          <span className="den-tag muted">{all.length} total</span>
        )}
      </div>

      {mineQuery.isLoading && all.length === 0 ? (
        <div className="panel-empty">Gathering your submissions…</div>
      ) : all.length === 0 ? (
        <div className="empty-state" data-testid="submission-overview-empty">
          <Inbox size={22} />
          <h3>Nothing submitted yet.</h3>
          <p>
            Open a stage you work on — Video, Audio, or Thumbnail — describe what you did in the
            &ldquo;Hand this stage in&rdquo; card and submit it. The Captain&apos;s decision appears here.
          </p>
        </div>
      ) : (
        <div className="submission-overview-grid">
          <div className="submission-list-col">
            <div className="submission-filters" role="tablist" aria-label="Filter submissions">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === option.value}
                  className={`submission-filter-btn ${filter === option.value ? 'active' : ''}`}
                  onClick={() => setFilter(option.value)}
                  data-testid={`submission-filter-${option.value.toLowerCase()}`}
                >
                  {option.label}
                  {option.value !== 'ALL' && (
                    <span className="den-tag muted">{all.filter((row) => row.status === option.value).length}</span>
                  )}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="panel-empty">No {filter === 'ALL' ? '' : `${filter.toLowerCase()} `}submissions.</div>
            ) : (
              <div className="den-stack">
                {rows.map((row) => {
                  const meta = STATUS_META[row.status];
                  const expanded = open?.id === row.id;
                  return (
                    <div key={row.id} className="paper-card submission-row-card">
                      <button
                        type="button"
                        className="list-row submission-row"
                        onClick={() => setOpenId(expanded ? null : row.id)}
                        aria-expanded={expanded}
                        data-testid={`submission-row-${row.id}`}
                      >
                        <span className={`den-tag ${LEG_TONES[row.leg] ?? 'muted'}`}>
                          {legLabel(row.leg)}
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <b className="truncate">{row.projectName}</b>
                          <small>
                            {row.note ? `“${row.note.slice(0, 110)}”` : 'No note attached'} · {timeAgo(row.createdAt)}
                          </small>
                        </span>
                        <span className={`den-tag ${meta.cls}`}>{meta.label}</span>
                      </button>
                      {expanded && row.id === open?.id && (
                        <div className="submission-detail" data-testid={`submission-detail-${row.id}`}>
                          <div className="submission-detail-note">
                            <span className="mono-label">What you submitted</span>
                            <p>{row.note || 'No note was attached to this submission.'}</p>
                          </div>
                          {row.status === 'REJECTED' ? (
                            <div className="submission-decision is-rejected">
                              <XCircle size={14} />
                              <div>
                                <b>Sent back by the Captain</b>
                                <p>
                                  {row.decisionNote || 'No note was attached — open the stage and check the review comments.'}
                                </p>
                                {row.decidedAt && <small>{timeAgo(row.decidedAt)}</small>}
                              </div>
                            </div>
                          ) : row.status === 'APPROVED' ? (
                            <div className="submission-decision is-approved">
                              <CheckCircle2 size={14} />
                              <div>
                                <b>Approved — merged into the project timeline</b>
                                {row.decisionNote && <p>{row.decisionNote}</p>}
                              </div>
                            </div>
                          ) : (
                            <div className="submission-decision is-pending">
                              <Clock3 size={14} />
                              <div>
                                <b>Awaiting the Captain&apos;s review</b>
                                <p>Submitted {timeAgo(row.createdAt)}. You&apos;ll see the decision here.</p>
                              </div>
                            </div>
                          )}
                          <a
                            className="link-btn"
                            href={`/projects/${row.projectId}/preview`}
                          >
                            Open the project preview →
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="submission-tree-col">
            {activeProjectId && (
              <>
                {involvedProjects.length > 1 && (
                  <select
                    value={activeProjectId}
                    onChange={(event) => setTreeProjectId(event.target.value)}
                    aria-label="Project to show"
                    className="mb-3 w-full"
                    data-testid="timeline-tree-project"
                  >
                    {involvedProjects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                )}
                <TimelineTree projectId={activeProjectId} submissions={projectSubmissions} />
              </>
            )}
          </aside>
        </div>
      )}

      {all.length > 0 && (
        <p className="den-footnote mt-6">
          Approved stages progress the project timeline — rejected ones are sent back to you with the
          Captain&apos;s improvement note, and the timeline stays untouched until it passes.
        </p>
      )}
    </div>
  );
}
