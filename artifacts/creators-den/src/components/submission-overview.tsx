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
import { Link } from 'wouter';
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
import { listVideoSubmissions, useListVideoProjects } from '@workspace/api-client-react';
import type { VideoSubmission } from '@workspace/api-client-react';
import { legHint, RELAY_LEGS } from '@/components/shell';
import { reviewerColor, reviewerLabel } from '@/lib/annotations';

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
// TimelineTree — the project timeline as a VERTICAL branch line that grows
// from down to up, the way the relay actually progresses (older hand-ins at
// the bottom, the latest at the top). Every hand-in for review gets its own
// unique alphabetic tag (A, B, C, … AA, AB…) in the order it was submitted:
//   · approved hand-ins sit ON the main trunk (they merged into the timeline),
//   · hand-ins still awaiting the Captain are open dashed branches above them,
//   · sent-back hand-ins are dead ends that never reached the timeline.
// ---------------------------------------------------------------------------

/** 0 -> A, 1 -> B, … 25 -> Z, 26 -> AA, 27 -> AB … */
function alphaTag(index: number): string {
  let n = index + 1;
  let tag = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    tag = String.fromCharCode(65 + rem) + tag;
    n = Math.floor((n - 1) / 26);
  }
  return tag;
}

const TT_ROW_H = 46;
const TT_TRUNK_X = 8;
const TT_LANE_SP = 22;
const TT_DOT = 11;

const TT_STATUS: Record<string, { label: string; cls: string }> = {
  SUBMITTED: { label: 'awaiting review', cls: 'pending' },
  APPROVED: { label: 'approved', cls: 'on' },
  REJECTED: { label: 'sent back', cls: 'rejected' },
};

export function TimelineTree({
  projectId,
  submissions,
}: {
  projectId: string;
  /** The project's submissions (any leg). */
  submissions: MySubmissionRow[];
}) {
  // Oldest hand-in first (the bottom of the trunk) — tags follow that order.
  const ascending = useMemo(
    () =>
      [...submissions].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [submissions],
  );
  // Newest first, top-down — the branch reads bottom → up.
  const rows = useMemo(() => ascending.slice().reverse(), [ascending]);
  const tagBy = useMemo(
    () => new Map(ascending.map((row, index) => [row.id, alphaTag(index)])),
    [ascending],
  );

  const pendingRows = ascending.filter((row) => row.status === 'SUBMITTED');
  const hasRejected = ascending.some((row) => row.status === 'REJECTED');
  const laneCount = pendingRows.length;
  // Each open (awaiting) hand-in owns one dashed lane to the right of the
  // trunk; sent-back dead ends branch into a stub column past the lanes.
  const laneBy = new Map(pendingRows.map((row, index) => [row.id, index + 1]));
  const laneX = (lane: number) => TT_TRUNK_X + lane * TT_LANE_SP;
  const deadEndX = hasRejected ? TT_TRUNK_X + (laneCount + 1) * TT_LANE_SP + 6 : 0;
  const graphWidth = Math.max(
    TT_TRUNK_X * 2 + TT_DOT,
    deadEndX > 0 ? deadEndX + TT_DOT + 6 : 0,
    laneCount > 0 ? laneX(laneCount) + TT_DOT + 2 : 0,
  );
  const topIndexById = new Map(rows.map((row, index) => [row.id, index]));
  const centerY = (id: string) => (topIndexById.get(id)! + 0.5) * TT_ROW_H;

  if (rows.length === 0) {
    return (
      <div className="paper-card timeline-tree" data-testid="timeline-tree">
        <div className="inline-heading">
          <span className="eyebrow"><GitPullRequest size={13} /> Project timeline</span>
          <span className="mono-label">A → …</span>
        </div>
        <p className="setting-copy mt-3">Nothing handed in for review yet.</p>
      </div>
    );
  }

  return (
    <div className="paper-card timeline-tree" data-testid="timeline-tree">
      <div className="inline-heading">
        <span className="eyebrow"><GitPullRequest size={13} /> Project timeline</span>
        <span className="mono-label">{rows.length} hand-in{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="tt-wrap">
        <div className="tt-labels">
          {rows.map((row) => {
            const status = TT_STATUS[row.status];
            const isFile = isFileSubmission(row);
            return (
              <div
                key={row.id}
                className={`tt-row ${status?.cls ?? ''}`}
                title={isFile ? fileSubmissionParts(row).message ?? undefined : row.note || undefined}
              >
                <span className={`tt-letter ${status?.cls ?? ''}`} data-testid={`tt-letter-${row.id}`}>
                  {tagBy.get(row.id)}
                </span>
                <span className="tt-meta">
                  <b className="truncate">{legLabel(row.leg)}</b>
                  <small className="truncate">
                    {isFile ? fileSubmissionParts(row).fileName : status?.label}
                  </small>
                </span>
              </div>
            );
          })}
        </div>

        <div className="tt-graph" style={{ width: graphWidth, height: rows.length * TT_ROW_H }} data-testid="timeline-tree-graph">
          {/* The main trunk — approved hand-ins merged into the timeline. */}
          <span className="tt-line tt-trunk" style={{ left: TT_TRUNK_X, top: 0, height: '100%' }} />
          {/* Open branches: each awaiting hand-in keeps a dashed lane rising
              from its submission point toward the top (still not merged). */}
          {pendingRows.map((row) => {
            const lane = laneBy.get(row.id)!;
            const branchY = centerY(row.id);
            const x = laneX(lane);
            return (
              <span key={row.id}>
                <span className="tt-line tt-lane" style={{ left: x, top: 0, height: branchY }} />
                <span className="tt-elbow tt-elbow-pending" style={{ top: branchY - 1, left: TT_TRUNK_X, width: x - TT_TRUNK_X }} />
                <span className="tt-dot tt-dot-pending" style={{ top: branchY - TT_DOT / 2, left: x - TT_DOT / 2 }} />
              </span>
            );
          })}
          {/* Merged / rejected nodes sit at their own row on the trunk. */}
          {rows.map((row) => {
            const y = centerY(row.id);
            if (row.status === 'APPROVED') {
              return (
                <span
                  key={row.id}
                  className="tt-dot tt-dot-approved"
                  style={{ top: y - TT_DOT / 2, left: TT_TRUNK_X - TT_DOT / 2 }}
                  data-testid={`tt-node-${row.id}`}
                />
              );
            }
            if (row.status === 'REJECTED') {
              return (
                <span key={row.id}>
                  <span className="tt-elbow tt-elbow-rejected" style={{ top: y - 1, left: TT_TRUNK_X, width: deadEndX - TT_TRUNK_X }} />
                  <span className="tt-dead" style={{ top: y - TT_DOT / 2, left: deadEndX - TT_DOT / 2 }}>
                    <XCircle size={9} />
                  </span>
                </span>
              );
            }
            return null;
          })}
        </div>
      </div>
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
  const heading = projectId ? `${scopeProject?.name ?? 'This project'}'s review board` : 'Your review board';

  return (
    <div className="page" data-testid="submission-overview">
      <div className="page-header">
        <div>
          <span className="eyebrow"><Send size={13} /> {eyebrow}</span>
          <h1>{heading}</h1>
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
              <p>When a stage is handed in for review, it lands here with its status and decision.</p>
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
                  const statusCls = row.status === 'APPROVED' ? 'status-approved' : row.status === 'REJECTED' ? 'status-rejected' : 'status-submitted';
                  return (
                    <div key={row.id} className={`paper-card submission-row-card ${statusCls}`}>
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
                                <b>{isFileSubmission(row) ? 'Sent back — file removed' : 'Sent back by the Captain'}</b>
                                {row.decisionNote && <p>{row.decisionNote}</p>}
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
                                <p>Submitted {timeAgo(row.createdAt)}</p>
                              </div>
                            </div>
                          )}
                          <Link
                            className="submission-open-preview"
                            href={`/projects/${row.projectId}/preview`}
                            data-testid={`submission-open-preview-${row.id}`}
                          >
                            Open the project preview →
                          </Link>
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

    </div>
  );
}
