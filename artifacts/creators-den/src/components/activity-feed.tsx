// ---------------------------------------------------------------------------
// ActivityFeed — the Creator Den project activity feed (VCS design §4:
// "Activity feed | collaboration_activity_events | ✅ exists"). Every save,
// import, rollback, submission, review decision, and vault upload lands here
// as one immutable line, so the team sees "vX saved by… / approved by…"
// without digging through per-leg history.
//
// Inside a studio (leg prop set) the feed defaults to that leg's events and
// offers an "All stages" toggle; the vault shows everything by default.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Check, FileVideo2, GitPullRequest, History, RotateCcw, Upload, X } from 'lucide-react';
import { useListVideoActivity, type VideoActivityLegQueryParameter } from '@workspace/api-client-react';

const EVENT_META: Record<string, { icon: typeof History; tone: string }> = {
  version_saved: { icon: History, tone: 'muted' },
  version_imported: { icon: Upload, tone: 'accent' },
  version_rolled_back: { icon: RotateCcw, tone: 'gold' },
  submission_created: { icon: GitPullRequest, tone: 'gold' },
  submission_approved: { icon: Check, tone: 'teal' },
  submission_rejected: { icon: X, tone: 'danger' },
  asset_uploaded: { icon: FileVideo2, tone: 'accent' },
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

export function ActivityFeed({
  projectId,
  leg,
  className,
}: {
  projectId: string;
  /** Studio leg (SELECTS/CUT/SOUND/FINISH/THUMBNAIL) — defaults the view to that leg's events; omit for the vault (all legs). */
  leg?: string;
  className?: string;
}) {
  // The leg filter is applied server-side (?leg=) so a busy relay never drowns
  // a studio's feed with the other stages' events (VCS design §8 phase 0).
  const [filter, setFilter] = useState<'leg' | 'all'>(leg ? 'leg' : 'all');
  const activity = useListVideoActivity(
    projectId,
    filter === 'leg' && leg ? { leg: leg as VideoActivityLegQueryParameter } : undefined,
  );
  const events = activity.data ?? [];

  return (
    <div className={`paper-card ${className ?? 'mt-4'}`} data-testid="panel-activity">
      <div className="inline-heading">
        <span className="eyebrow"><History size={13} /> Project activity</span>
        {leg && (
          <div className="feed-tabs" role="tablist" aria-label="Activity filter">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'leg'}
              className={`feed-tab ${filter === 'leg' ? 'is-active' : ''}`}
              onClick={() => setFilter('leg')}
            >
              {leg}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={`feed-tab ${filter === 'all' ? 'is-active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All stages
            </button>
          </div>
        )}
      </div>
      {events.length === 0 ? (
        <p className="setting-copy mt-3">
          {filter === 'leg'
            ? `Nothing for ${leg} yet — saves, imports, and pull requests land here as this stage moves.`
            : 'Nothing yet — saves, imports, pull requests, and uploads land here as the relay moves.'}
        </p>
      ) : (
        <div className="den-stack mt-3 max-h-[360px] overflow-y-auto pr-1">
          {events.map((event) => {
            const meta = EVENT_META[event.eventType] ?? { icon: History, tone: 'muted' };
            const Icon = meta.icon;
            return (
              <div key={event.id} className="list-row" data-testid={`activity-${event.eventType}`}>
                <span className={`den-tag ${meta.tone}`}><Icon size={12} /></span>
                <span className="min-w-0 flex-1">
                  <b className="text-xs">{event.summary}</b>
                  <small>{event.actorName ?? event.actorId.slice(0, 8)} · {timeAgo(event.createdAt)}</small>
                </span>
                {event.leg && <span className="den-tag muted shrink-0">{event.leg}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
