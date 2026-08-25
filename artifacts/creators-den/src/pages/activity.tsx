// ---------------------------------------------------------------------------
// ActivityPage — the Creator Den's split project history view.
//
// Displays the version timeline (snake-and-ladder graph of every saved role
// version and vault upload) on the LEFT, and the activity ledger (day-grouped
// feed of every save, import, rollback, pull request, review, and upload event)
// on the RIGHT — both side by side so the full project history reads at a
// glance without a tab switch.
//
// Data: VersionTimeline calls its own five-leg version + vault queries
// internally. The ledger uses a single useListVideoActivity(projectId) fetch.
// useProjectRealtime keeps both live. EVENT_META mirrors activity-feed.tsx.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  FileVideo2,
  GitPullRequest,
  History,
  Layers,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useListVideoActivity } from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { VersionTimeline } from '@/components/version-timeline';
import { useProjectRealtime } from '@/lib/realtime';

interface LedgerEvent {
  id: string;
  eventType: string;
  summary: string;
  actorName?: string | null;
  actorId: string;
  createdAt: string;
  leg?: string | null;
}

const EVENT_META: Record<string, { icon: typeof History; tone: string; label: string }> = {
  version_saved: { icon: History, tone: 'muted', label: 'Versions saved' },
  version_imported: { icon: Upload, tone: 'accent', label: 'Imports' },
  version_rolled_back: { icon: RotateCcw, tone: 'gold', label: 'Rollbacks' },
  submission_created: { icon: GitPullRequest, tone: 'gold', label: 'Pull requests' },
  submission_approved: { icon: Check, tone: 'teal', label: 'Approvals' },
  submission_rejected: { icon: X, tone: 'danger', label: 'Rejections' },
  asset_uploaded: { icon: FileVideo2, tone: 'accent', label: 'Uploads' },
};

// Rail breakdown renders in this order; unseen types are skipped.
const TYPE_ORDER = [
  'version_saved',
  'version_imported',
  'version_rolled_back',
  'submission_created',
  'submission_approved',
  'submission_rejected',
  'asset_uploaded',
];

const FALLBACK_META = { icon: History, tone: 'muted', label: 'Other' } as const;

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

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ActivityPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [leg, setLeg] = useState<string>('all');
  useProjectRealtime(projectId);
  const activity = useListVideoActivity(projectId, undefined);
  const events = (activity.data ?? []) as LedgerEvent[];

  // Counts across the *whole* project — the rail and the filter badges show
  // the full picture even while the main list is narrowed to one stage.
  const legCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ev of events) if (ev.leg) m[ev.leg] = (m[ev.leg] ?? 0) + 1;
    return m;
  }, [events]);

  const typeRows = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ev of events) m[ev.eventType] = (m[ev.eventType] ?? 0) + 1;
    return TYPE_ORDER.filter((t) => m[t]).map((t) => [t, m[t]] as const);
  }, [events]);

  const maxLeg = useMemo(
    () => RELAY_LEGS.reduce((max, l) => Math.max(max, legCounts[l.leg] ?? 0), 0),
    [legCounts],
  );

  // Filter, sort newest-first, then bucket into day groups for the timeline.
  const groups = useMemo(() => {
    const filtered = leg === 'all' ? events : events.filter((ev) => ev.leg === leg);
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const out: Array<{ key: string; label: string; events: LedgerEvent[] }> = [];
    const index = new Map<string, { key: string; label: string; events: LedgerEvent[] }>();
    for (const ev of sorted) {
      const key = dayKey(ev.createdAt);
      let group = index.get(key);
      if (!group) {
        group = { key, label: dayLabel(ev.createdAt), events: [] };
        index.set(key, group);
        out.push(group);
      }
      group.events.push(ev);
    }
    return out;
  }, [events, leg]);

  const activeLegLabel = leg === 'all' ? null : RELAY_LEGS.find((l) => l.leg === leg)?.role ?? leg;
  const filteredCount = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <SectionEyebrow>Project timeline</SectionEyebrow>
          <h1>Version history &amp; activity ledger.</h1>
          <p>
            Every saved version and vault upload on the left, every event — saves,
            imports, rollbacks, pull requests, reviews — on the right. One page,
            the whole picture.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${projectId}`} className="secondary-btn" data-testid="link-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className="den-tag muted">
            <History size={12} />
            {events.length} on record
          </span>
        </div>
      </div>

      <div className="cd-split">
        {/* ---- LEFT: Version timeline (snake-and-ladder graph) ---- */}
        <div className="cd-split-left">
          <VersionTimeline projectId={projectId} />
        </div>

        {/* ---- RIGHT: Activity ledger (day-grouped event feed + filter + summary) ---- */}
        <div className="cd-split-right">
          <div className="role-tabs" role="tablist" aria-label="Filter activity by stage">
            <button
              type="button"
              role="tab"
              aria-selected={leg === 'all'}
              className={leg === 'all' ? 'active' : ''}
              onClick={() => setLeg('all')}
              data-testid="filter-all"
            >
              <Layers size={13} />
              All stages
              <span className="leg-badge">{events.length}</span>
            </button>
            {RELAY_LEGS.map((item) => {
              const Icon = item.icon;
              const count = legCounts[item.leg] ?? 0;
              return (
                <button
                  key={item.leg}
                  type="button"
                  role="tab"
                  aria-selected={leg === item.leg}
                  className={leg === item.leg ? 'active' : ''}
                  onClick={() => setLeg(item.leg)}
                  data-testid={`filter-${item.slug}`}
                >
                  <Icon size={13} />
                  {item.role}
                  <span className="leg-badge">{count}</span>
                </button>
              );
            })}
          </div>

          {activity.isLoading ? (
            <div className="panel-empty" data-testid="ledger-loading">Opening the ledger…</div>
          ) : filteredCount === 0 ? (
            <div className="cd-empty" data-testid="ledger-empty">
              <span className="cd-empty-mark" aria-hidden><History size={20} /></span>
              <p>
                {activeLegLabel
                  ? `Nothing for ${activeLegLabel} yet — this stage hasn't moved.`
                  : 'Nothing yet — saves, imports, pull requests, and uploads land here as the relay moves.'}
              </p>
            </div>
          ) : (
            <>
              <div className="cd-ledger" data-testid="activity-ledger">
                {groups.map((group) => (
                  <section className="cd-ledger-day" key={group.key}>
                    <header className="cd-ledger-daymark">
                      <span className="cd-ledger-daylabel">{group.label}</span>
                      <span className="cd-ledger-dayrule" aria-hidden />
                      <span className="cd-ledger-daycount">{group.events.length}</span>
                    </header>
                    <ol className="cd-ledger-list">
                      {group.events.map((ev) => {
                        const meta = EVENT_META[ev.eventType] ?? FALLBACK_META;
                        const Icon = meta.icon;
                        const legMeta = ev.leg ? RELAY_LEGS.find((l) => l.leg === ev.leg) : undefined;
                        return (
                          <li className="cd-ledger-row" key={ev.id} data-testid={`ledger-${ev.eventType}`}>
                            <span className={`cd-ledger-dot ${meta.tone}`} aria-hidden>
                              <Icon size={13} />
                            </span>
                            <div className="cd-ledger-content">
                              <p className="cd-ledger-summary">{ev.summary}</p>
                              <p className="cd-ledger-meta">
                                <span className="cd-ledger-actor">
                                  {ev.actorName ?? ev.actorId.slice(0, 8)}
                                </span>
                                <span className="cd-ledger-dotsep" aria-hidden />
                                <span className="cd-ledger-time">{timeAgo(ev.createdAt)}</span>
                              </p>
                            </div>
                            {legMeta && <span className="cd-ledger-leg">{legMeta.label}</span>}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </div>

              {/* ---- Compact summary below the ledger ---- */}
              <div className="paper-card cd-summary">
                <div className="inline-heading">
                  <span className="eyebrow"><History size={13} /> Ledger summary</span>
                </div>
                <div className="cd-summary-total">
                  <b>{events.length}</b>
                  <span>events on record</span>
                </div>

                {typeRows.length > 0 && (
                  <div className="cd-summary-breakdown">
                    {typeRows.map(([type, count]) => {
                      const meta = EVENT_META[type] ?? FALLBACK_META;
                      const Icon = meta.icon;
                      return (
                        <div className="cd-summary-row" key={type}>
                          <span className={`den-tag ${meta.tone}`}><Icon size={12} /></span>
                          <span className="cd-summary-label">{meta.label}</span>
                          <span className="cd-summary-count">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="cd-summary-stages">
                  <span className="mono-label">By stage</span>
                  {RELAY_LEGS.map((item) => {
                    const count = legCounts[item.leg] ?? 0;
                    const pct = maxLeg ? Math.round((count / maxLeg) * 100) : 0;
                    return (
                      <div className="cd-summary-stage" key={item.leg} data-testid={`summary-stage-${item.slug}`}>
                        <span className="cd-summary-stage-name">{item.label}</span>
                        <span className="cd-summary-bar" aria-hidden>
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="cd-summary-stage-count">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
