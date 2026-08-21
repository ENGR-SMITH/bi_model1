// ---------------------------------------------------------------------------
// CommitLog — the project-level commit graph (VCS design §8 phase 4: "Merge /
// history"; §4: "Project-level commit log — elevate HistoryPanel to project
// scope"). Rendered in the vault, the Captain's review hub.
//
// Like `git log --all`, it merges every leg's version history into one
// chronological feed — each row is a snapshot (commit) with its leg, author,
// message, and any submission (pull request) that pinned it. Every row opens
// the shared DiffView (text diff + A/B wipe) against that leg's head, so
// "approve = merge" decisions sit right on top of the history.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { GitBranch, GitCompareArrows, GitPullRequest, History } from 'lucide-react';
import {
  useListVideoSubmissions,
  useListVideoTimelineVersions,
} from '@workspace/api-client-react';
import type { VideoSubmission, VideoTimelineVersionSummary } from '@workspace/api-client-react';
import { RELAY_LEGS } from '@/components/shell';
import { DiffView } from '@/components/diff-view';
import { ReviewPanel } from '@/components/review-panel';
import type { StudioLeg } from '@/components/role-oracle';

const LEG_TONES: Record<string, string> = {
  SELECTS: 'gold',
  CUT: 'accent',
  SOUND: 'teal',
  FINISH: 'muted',
  THUMBNAIL: 'accent',
};

const FILTERS: Array<{ value: 'ALL' | StudioLeg; label: string }> = [
  { value: 'ALL', label: 'All legs' },
  ...RELAY_LEGS.map((leg) => ({ value: leg.leg as StudioLeg, label: leg.label })),
];

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

interface CommitRow {
  leg: string;
  version: VideoTimelineVersionSummary;
  submission?: VideoSubmission;
}

export function CommitLog({ projectId }: { projectId: string }) {
  const selects = useListVideoTimelineVersions(projectId, 'SELECTS');
  const cut = useListVideoTimelineVersions(projectId, 'CUT');
  const sound = useListVideoTimelineVersions(projectId, 'SOUND');
  const finish = useListVideoTimelineVersions(projectId, 'FINISH');
  const thumbnail = useListVideoTimelineVersions(projectId, 'THUMBNAIL');

  const submissions = useListVideoSubmissions(projectId);

  const [filter, setFilter] = useState<'ALL' | StudioLeg>('ALL');
  const [compare, setCompare] = useState<{ leg: StudioLeg; headId: string; versionId: string } | null>(null);
  const [review, setReview] = useState<{ submission: VideoSubmission; leg: StudioLeg; headId: string | null } | null>(null);

  const all = useMemo<CommitRow[]>(() => {
    const rows: CommitRow[] = [];
    for (const [leg, query] of [
      ['SELECTS', selects],
      ['CUT', cut],
      ['SOUND', sound],
      ['FINISH', finish],
      ['THUMBNAIL', thumbnail],
    ] as const) {
      for (const version of query.data ?? []) {
        rows.push({
          leg,
          version,
          submission: submissions.data?.find((s) => s.timelineVersionId === version.id),
        });
      }
    }
    return rows.sort((a, b) => {
      const byTime = new Date(b.version.createdAt).getTime() - new Date(a.version.createdAt).getTime();
      return byTime !== 0 ? byTime : b.version.version - a.version.version;
    });
  }, [selects.data, cut.data, sound.data, finish.data, thumbnail.data, submissions.data]);

  const rows = filter === 'ALL' ? all : all.filter((row) => row.leg === filter);

  // Newest row per leg = that leg's head (the version a Compare starts from).
  const headIdFor = (leg: string): string | null =>
    all.find((row) => row.leg === leg)?.version.id ?? null;

  const loading = selects.isLoading || cut.isLoading || sound.isLoading || finish.isLoading || thumbnail.isLoading;
  const hasCommits = all.length > 0;

  return (
    <div className="paper-card mt-5" data-testid="panel-commit-log">
      <div className="inline-heading">
        <span className="eyebrow"><GitBranch size={13} /> The commit log</span>
        <span className="mono-label">{all.length} commit{all.length === 1 ? '' : 's'} · 5 legs</span>
      </div>
      <p className="setting-copy">
        Every snapshot from every leg, newest first — the story of the cut. A submission (PR) rides on the version it pinned; compare any commit against its leg&apos;s head.
      </p>

      <div className="den-chip-list mt-3">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`den-chip ${filter === item.value ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : ''}`}
            onClick={() => setFilter(item.value)}
            data-testid={`commit-log-filter-${item.value}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="panel-empty">Loading the log…</div>
      ) : !hasCommits ? (
        <div className="empty-state" data-testid="commit-log-empty">
          <History size={22} />
          <h3>No commits yet.</h3>
          <p>Save a snapshot in any studio — selects, cut, sound, finish, or thumbnail — and it appears here the moment it lands.</p>
        </div>
      ) : (
        <div className="den-stack mt-3 max-h-[420px] overflow-y-auto pr-1" data-testid="commit-log-list">
          {rows.map((row) => {
            const legMeta = RELAY_LEGS.find((leg) => leg.leg === row.leg);
            const submission = row.submission;
            return (
              <div key={`${row.leg}-${row.version.id}`} className="list-row" data-testid={`commit-${row.leg}-${row.version.version}`}>
                <span className={`den-tag ${LEG_TONES[row.leg]}`}>{legMeta?.label ?? row.leg}</span>
                <span className="min-w-0 flex-1">
                  <b>
                    v{row.version.version}
                    {row.version.message && <span className="ml-1 font-normal text-[hsl(var(--muted-foreground))]">· {row.version.message}</span>}
                  </b>
                  <small>
                    {row.version.createdById.slice(0, 8)} · {timeAgo(row.version.createdAt)}
                    {submission && ` · submitted${submission.note ? ` — “${submission.note.slice(0, 80)}”` : ''}`}
                  </small>
                </span>
                {submission && (
                  <span className={`den-tag ${submission.status === 'APPROVED' ? 'teal' : submission.status === 'REJECTED' ? 'danger' : 'gold'}`} title="Pull request">
                    PR · {submission.status}
                  </span>
                )}
                {submission?.status === 'SUBMITTED' && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setCompare(null);
                      setReview({ submission, leg: row.leg as StudioLeg, headId: headIdFor(row.leg) });
                    }}
                    data-testid={`commit-review-${row.leg}-${row.version.version}`}
                  >
                    <GitPullRequest size={12} /> Review PR
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setReview(null);
                    const headId = headIdFor(row.leg);
                    if (!headId) return;
                    setCompare({ leg: row.leg as StudioLeg, headId, versionId: row.version.id });
                  }}
                  data-testid={`commit-compare-${row.leg}-${row.version.version}`}
                >
                  <GitCompareArrows size={12} /> Compare
                </button>
              </div>
            );
          })}
        </div>
      )}

      {review && (
        <ReviewPanel
          projectId={projectId}
          submission={review.submission}
          headVersionId={review.headId}
          onClose={() => setReview(null)}
        />
      )}

      {!review && compare && (
        <DiffView
          key={`${compare.leg}-${compare.versionId}`}
          projectId={projectId}
          leg={compare.leg}
          initialAId={compare.headId}
          initialBId={compare.versionId}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}
