// ---------------------------------------------------------------------------
// SubmissionOverview — the crew's side of the /review page (non-Captains),
// in two scopes:
//   · project scope (/projects/:projectId/review) — every stage submission
//     on THAT project, so the crew can watch the relay clear and open the
//     timeline tree on the side.
//   · global (/review) — the same board across every project the member is
//     on.
// Each row shows the stage, who handed it in, the submitter's description,
// and its state — awaiting the Captain, approved (merged), or sent back with
// the improvement note. Rows the signed-in member submitted are tagged "you".
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileUp,
  GitPullRequest,
  Inbox,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import {
  listVideoSubmissions,
  listVideoTimelineVersions,
  useListVideoProjects,
} from '@workspace/api-client-react';
import type { VideoSubmission } from '@workspace/api-client-react';
import { legHint, RELAY_LEGS } from '@/components/shell';
import { reviewerColor, reviewerLabel } from '@/lib/annotations';
import type { StudioLeg } from '@/components/role-oracle';

/** A submission enriched with its project's name for the board list. */
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

// A file handed in for review (desktop-agent / submit-for-review upload)
// carries an `ASSET:<assetId>` sentinel — its note leads with the file name
// ("golden-take-a.mp4 — Best angle of the hero shot.").
function isFileSubmission(row: MySubmissionRow): boolean {
  return row.timelineVersionId.startsWith('ASSET:');
}

function fileSubmissionParts(row: MySubmissionRow): { fileName: string; message: string | null } {
  const note = row.note ?? '';
  const fileName = note.split(' — ')[0] || 'File submission';
  return {
    fileName,
    message: note.includes(' — ') ? note.slice(note.indexOf(' — ') + 3).trim() : null,
  };
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
              <span className={`relay-stage-head den-tag ${LEG_TONES[leg] ?? 'muted'}`} title={relay.hint}>
                {relay.label}
              </span>
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

export function SubmissionOverview({ projectId }: { projectId?: string }) {
  const { user } = useUser();
  const projectsQuery = useListVideoProjects();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const [treeProjectId, setTreeProjectId] = useState<string | null>(null);

  const allProjects = projectsQuery.data ?? [];
  const projects = useMemo(
    () => (projectId ? allProjects.filter((project) => project.id === projectId) : allProjects),
    [allProjects, projectId],
  );
  const userId = user?.id;
  const projectKey = projects.map((project) => project.id).join('|');
  const scopeProject = projectId ? allProjects.find((project) => project.id === projectId) ?? null : null;

  const boardQuery = useQuery({
    // userId is part of the key so switching accounts can never show another
    // member's cached submissions.
    queryKey: ['review-board', userId, projectId ?? 'all', projectKey],
    enabled: Boolean(userId) && (projects.length > 0 || Boolean(projectId)),
    queryFn: async (): Promise<{ rows: MySubmissionRow[]; skippedProjects: number }> => {
      // Project-scoped mode boards exactly one project (by id, even if it has
      // drifted out of the projects list); global mode boards every project
      // the member is on. Each is settled on its own: one unreachable project
      // (a 403/404 drift, a server hiccup) must never blank the whole page
      // into a fake "Nothing submitted yet." — its rows are skipped and
      // surfaced instead.
      const nameById = new Map(projects.map((project) => [project.id, project.name]));
      const targets = projectId
        ? [{ id: projectId, name: nameById.get(projectId) ?? scopeProject?.name ?? 'Untitled project' }]
        : projects;
      const settled = await Promise.all(
        targets.map(async (project) => {
          try {
            const submissions = await listVideoSubmissions(project.id);
            return {
              ok: true as const,
              rows: submissions.map((submission) => ({
                ...submission,
                projectName: nameById.get(submission.projectId) ?? project.name ?? 'Untitled project',
              })),
            };
          } catch {
            return { ok: false as const, rows: [] as MySubmissionRow[] };
          }
        }),
      );
      const rows = settled
        .flatMap((result) => result.rows)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return {
        rows,
        skippedProjects: settled.filter((result) => !result.ok).length,
      };
    },
    // Keep states live while the page is open: approvals/rejections arrive
    // from the Captain without a manual refresh.
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const queryData = boardQuery.data;
  const all = queryData?.rows ?? [];
  const skippedProjects = queryData?.skippedProjects ?? 0;
  const queryFailed = boardQuery.isError && !boardQuery.isFetching;
  const rows = filter === 'ALL' ? all : all.filter((row) => row.status === filter);
  const open = all.find((row) => row.id === openId) ?? null;

  const mineCount = all.filter((row) => row.submittedById === userId).length;

  // The tree shows the project in scope — or, globally, the project the
  // member last touched (switchable when they work across several).
  const involvedProjects = useMemo(() => {
    const ids = [...new Set(all.map((row) => row.projectId))];
    return projects.filter((project) => ids.includes(project.id));
  }, [all, projects]);
  const activeProjectId = projectId ?? treeProjectId ?? involvedProjects[0]?.id ?? null;
  const projectSubmissions = all.filter((row) => row.projectId === activeProjectId);

  const eyebrow = projectId
    ? 'Project review board'
    : 'Your review board';
  const heading = projectId ? `${scopeProject?.name ?? 'This project'}'s review board` : 'Every stage, everywhere.';
  const sub = projectId
    ? 'Everything handed in on this project — awaiting the Captain, approved, or sent back. Your own hand-ins are tagged “you”.'
    : 'Every stage handed in across your projects — yours and your teammates’ — and where it stands right now.';

  return (
    <div className="page" data-testid="submission-overview">
      <div className="page-header">
        <div>
          <span className="eyebrow"><Send size={13} /> {eyebrow}</span>
          <h1>{heading}</h1>
          <p>{sub}</p>
        </div>
        {all.length > 0 && (
          <span className="den-tag muted">{all.length} submission{all.length === 1 ? '' : 's'} · {mineCount} yours</span>
        )}
      </div>

      {queryFailed && all.length === 0 ? (
        <div className="empty-state" data-testid="submission-overview-error" role="alert">
          <AlertTriangle size={22} />
          <h3>Couldn&apos;t load the review board.</h3>
          <p>
            The review server didn&apos;t answer. This is a connection problem, not a review problem —
            submitted work is safe on the Captain&apos;s desk.
          </p>
          <button type="button" className="primary-btn" onClick={() => void boardQuery.refetch()} data-testid="submission-overview-retry">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : boardQuery.isLoading && all.length === 0 ? (
        <div className="panel-empty">Gathering the review board…</div>
      ) : (
        <>
          {skippedProjects > 0 && (
            <div className="panel-warning mb-4" role="status" data-testid="submission-overview-partial">
              <AlertTriangle size={14} />
              <span>
                {skippedProjects} project{skippedProjects === 1 ? '' : 's'} couldn&apos;t be reached — their
                submissions aren&apos;t shown here. <button type="button" className="link-btn" onClick={() => void boardQuery.refetch()}>Try again</button>
              </span>
            </div>
          )}
          {all.length === 0 ? (
            <div className="empty-state" data-testid="submission-overview-empty">
              <Inbox size={22} />
              <h3>Nothing submitted yet.</h3>
              <p>
                When a stage is handed in for review — Video, Audio, Thumbnail, or Finish — it lands here
                with its status, and the Captain&apos;s decision (with their REMARK) shows up when it&apos;s made.
              </p>
              <p className="den-footnote">
                If the project&apos;s Captain uploaded while signed in as themselves, their file goes straight
                to the vault unless they choose to submit it for review — so it never appears here.
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
                  const mine = row.submittedById === userId;
                  const expanded = open?.id === row.id;
                  const color = reviewerColor(row.submittedById);
                  return (
                    <div key={row.id} className="paper-card submission-row-card">
                      <button
                        type="button"
                        className="list-row submission-row"
                        onClick={() => setOpenId(expanded ? null : row.id)}
                        aria-expanded={expanded}
                        data-testid={`submission-row-${row.id}`}
                      >
                        <span
                          className={`den-tag ${LEG_TONES[row.leg] ?? 'muted'}`}
                          title={legHint(row.leg)}
                        >
                          {legLabel(row.leg)}
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <b className="truncate">
                            {row.projectName}
                            {mine && <span className="den-tag accent ml-2" title="You submitted this">you</span>}
                          </b>
                          <small>
                            {isFileSubmission(row) ? fileSubmissionParts(row).fileName : row.note ? `“${row.note.slice(0, 110)}”` : 'No note attached'}
                            {' · '}
                            <span style={{ color }}>
                              {reviewerLabel(row.submittedById)} {row.submittedById.slice(0, 8)}
                            </span>
                            {' · '}{timeAgo(row.createdAt)}
                          </small>
                        </span>
                        <span className={`den-tag ${meta.cls}`}>{meta.label}</span>
                      </button>
                      {expanded && row.id === open?.id && (
                        <div className="submission-detail" data-testid={`submission-detail-${row.id}`}>
                          <div className="submission-detail-note">
                            <span className="mono-label">What was submitted{!mine ? ` — by ${reviewerLabel(row.submittedById)} ${row.submittedById.slice(0, 8)}` : ''}</span>
                            {isFileSubmission(row) ? (
                              <>
                                <p className="flex items-center gap-2">
                                  <FileUp size={13} /> <b>{fileSubmissionParts(row).fileName}</b>
                                </p>
                                {fileSubmissionParts(row).message && (
                                  <p>“{fileSubmissionParts(row).message}”</p>
                                )}
                              </>
                            ) : (
                              <p>{row.note || 'No note was attached to this submission.'}</p>
                            )}
                          </div>
                          {row.status === 'REJECTED' ? (
                            <div className="submission-decision is-rejected">
                              <XCircle size={14} />
                              <div>
                                <b>{isFileSubmission(row) ? 'Sent back — file deleted' : 'Sent back by the Captain'}</b>
                                <p>
                                  {row.decisionNote || (isFileSubmission(row)
                                    ? 'The Captain sent the file back — it was removed and the vault was not changed.'
                                    : 'No note was attached — open the stage and check the review comments.')}
                                </p>
                                {row.decidedAt && <small>{timeAgo(row.decidedAt)}</small>}
                              </div>
                            </div>
                          ) : row.status === 'APPROVED' ? (
                            <div className="submission-decision is-approved">
                              <CheckCircle2 size={14} />
                              <div>
                                <b>
                                  {isFileSubmission(row)
                                    ? 'Approved — added to the project vault'
                                    : 'Approved — merged into the project timeline'}
                                </b>
                                {row.decisionNote && <p>{row.decisionNote}</p>}
                              </div>
                            </div>
                          ) : (
                            <div className="submission-decision is-pending">
                              <Clock3 size={14} />
                              <div>
                                <b>Awaiting the Captain&apos;s review</b>
                                <p>Submitted {timeAgo(row.createdAt)}. The decision shows up here when it&apos;s made.</p>
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
                {!projectId && involvedProjects.length > 1 && (
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
        </>
      )}

      {all.length > 0 && (
        <p className="den-footnote mt-6">
          Approved stages progress the project timeline — rejected ones are sent back to the submitter with the
          Captain&apos;s REMARK, and the timeline stays untouched until it passes.
        </p>
      )}
    </div>
  );
}
