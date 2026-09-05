import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  Clock,
  Eye,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  TrendingUp,
  Youtube,
} from 'lucide-react';
import {
  getGetChannelAnalyticsOverviewQueryKey,
  getGetChannelQueryKey,
  getListChannelAnalyticsVideosQueryKey,
  listChannelAnalyticsVideos,
  useGetChannel,
  useGetChannelAnalyticsOverview,
  useListChannelAnalyticsVideos,
  useRunChannelAnalyticsSync,
  type ChannelAnalyticsVideoRow,
  type ListChannelAnalyticsVideosSort,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import {
  formatCurrency,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatWatchTime,
  pickThumbnailUrl,
  SORT_LABELS,
} from '@/lib/analytics-format';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

function localDay(deltaDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '28 days', days: 28 },
  { label: '90 days', days: 90 },
] as const;

const DAY_CHART_CONFIG = {
  views: { label: 'Views', color: '#e11d48' },
  watchTime: { label: 'Watch time (min)', color: '#6366f1' },
} as const;

function StatCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="cd-stat-card" data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <span className="cd-stat-label">{label}</span>
      <span className="cd-stat-value">{value}</span>
      {icon && <span className="cd-stat-icon">{icon}</span>}
    </div>
  );
}

export default function ChannelAnalyticsPage() {
  const queryClient = useQueryClient();
  const { channelId = '' } = useParams<{ channelId: string }>();
  const channel = useGetChannel(channelId, { query: { queryKey: getGetChannelQueryKey(channelId), enabled: Boolean(channelId) } });
  const data = channel.data;
  const displayName = data?.youtubeTitle || data?.name || 'This channel';

  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [sort, setSort] = useState<ListChannelAnalyticsVideosSort>('publishedAt');
  const [cursor, setCursor] = useState<string | null>(null);
  const [extraRows, setExtraRows] = useState<ChannelAnalyticsVideoRow[]>([]);

  const from = localDay(-(range.days - 1));
  const to = localDay(0);

  const overviewParams = { from, to };
  const overview = useGetChannelAnalyticsOverview(channelId, overviewParams, {
    query: {
      queryKey: getGetChannelAnalyticsOverviewQueryKey(channelId, overviewParams),
      enabled: Boolean(channelId),
    },
  });
  const videoParams = { q: appliedQ || undefined, sort, dir: 'desc' as const, from, to, limit: 25 };
  const videos = useListChannelAnalyticsVideos(channelId, videoParams, {
    query: {
      queryKey: getListChannelAnalyticsVideosQueryKey(channelId, videoParams),
      enabled: Boolean(channelId),
    },
  });
  const sync = useRunChannelAnalyticsSync();

  const kpis = overview.data?.kpis ?? {};
  const series = overview.data?.series ?? [];
  const items = [...(videos.data?.items ?? []), ...extraRows];
  const lastSyncedAt = overview.data?.lastSyncedAt ?? null;
  const syncStatus = overview.data?.status ?? null;
  const syncError = overview.data?.error ?? null;
  const newVideosSeen = overview.data?.newVideosSeen ?? 0;
  const isOwner = data?.myRole === 'OWNER';

  // Average view duration over the window: watch time / views (the snapshot
  // sum alone is meaningless for a ratio).
  const avd = kpis.watchTimeMinutes != null && kpis.views ? (kpis.watchTimeMinutes * 60) / kpis.views : null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetChannelAnalyticsOverviewQueryKey(channelId, { from, to }) });
    queryClient.invalidateQueries({ queryKey: getListChannelAnalyticsVideosQueryKey(channelId) });
  };

  const runSync = () => {
    sync.mutate(
      { channelId },
      {
        onSuccess: () => {
          refresh();
          setExtraRows([]);
          setCursor(null);
        },
        onError: () => refresh(),
      },
    );
  };

  const loadMore = async () => {
    const next = await listChannelAnalyticsVideos(channelId, {
      q: appliedQ || undefined,
      sort,
      dir: 'desc',
      from,
      to,
      limit: 25,
      cursor: cursor ?? undefined,
    });
    setExtraRows((rows) => [...rows, ...next.items]);
    setCursor(next.nextCursor);
  };

  const applyFilters = (nextQ: string, nextSort: string) => {
    setExtraRows([]);
    setCursor(null);
    setAppliedQ(nextQ);
    setSort(nextSort as ListChannelAnalyticsVideosSort);
  };

  // Live search: the video table re-queries as you type (debounced) instead
  // of waiting for Enter — Enter still applies immediately via the form.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setExtraRows([]);
      setCursor(null);
      setAppliedQ(q.trim());
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const chartData = series.map((s) => ({ day: s.day.slice(5), views: s.views ?? 0, watchTime: s.watchTimeMinutes ?? 0 }));

  return (
    <div className="page">
      <div className="cd-billboard mb-6" data-testid="analytics-billboard">
        {data?.youtubeBannerUrl && <img className="cd-billboard-media" src={data.youtubeBannerUrl} alt="" aria-hidden />}
        <div className="cd-billboard-scrim" />
        <div className="cd-billboard-body">
          <SectionEyebrow><BarChart3 size={13} /> Channel analytics</SectionEyebrow>
          <h1>{displayName} — performance.</h1>
          <p>
            Every published video on this channel, tracked: views, watch time, retention, impressions and CTR, traffic
            sources, demographics, devices, and revenue where the channel is monetized.
          </p>
          <div className="cd-billboard-actions">
            <Link href={`/channels/${channelId}`} className="cd-actionbtn">Back to the den</Link>
          </div>
        </div>
      </div>

      {!data?.youtubeConnected ? (
        <div className="paper-card" data-testid="analytics-unlinked">
          <div className="inline-heading">
            <span className="eyebrow"><Link2 size={13} /> Not linked yet</span>
          </div>
          <h2 style={{ font: '700 24px var(--app-font-serif)', letterSpacing: '-.03em', margin: '10px 0 8px' }}>Analytics needs the real channel.</h2>
          <p className="setting-copy">
            Analytics is powered by the YouTube Analytics API, which only releases data for the channel the owner
            links through Google. Link this channel to its YouTube channel — which also brings over its banner,
            logo, and name — to unlock everything here.
          </p>
          <Link href={`/channels/${channelId}`} className="cd-actionbtn mt-3">Back to the den</Link>
        </div>
      ) : (
        <div className="cd-analytics-stack" data-testid="analytics-connected">
          {/* Freshness + sync controls */}
          <div className="cd-analytics-freshness" data-testid="analytics-freshness">
            <span className="cd-freshness-line">
              <Clock size={13} />
              Last synced {lastSyncedAt ? formatDate(lastSyncedAt) : 'never'}
            </span>
            {syncStatus === 'SYNCING' ? (
              <span className="den-tag accent"><Loader2 size={11} className="spin" /> Syncing…</span>
            ) : syncStatus === 'ERROR' ? (
              <span className="den-tag alert" title={syncError ?? ''} data-testid="analytics-sync-error">
                Last sync failed — {syncError ?? 'try again'}
              </span>
            ) : newVideosSeen > 0 ? (
              <span className="den-tag accent" data-testid="analytics-new-uploads">
                {newVideosSeen} new upload{newVideosSeen === 1 ? '' : 's'} detected and now tracked
              </span>
            ) : null}
            {isOwner && (
              <button
                type="button"
                className="cd-freshness-refresh"
                onClick={runSync}
                disabled={sync.isPending || syncStatus === 'SYNCING'}
                data-testid="analytics-refresh"
              >
                <RefreshCw size={12} className={sync.isPending ? 'spin' : ''} />
                {sync.isPending ? 'Syncing…' : 'Refresh now'}
              </button>
            )}
          </div>

          {/* Toolbar */}
          <div className="cd-analytics-toolbar" data-testid="analytics-toolbar">
            <div className="cd-range-chips" role="group" aria-label="Date range">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  className={r.days === range.days ? 'active' : ''}
                  onClick={() => {
                    setExtraRows([]);
                    setCursor(null);
                    setRange(r);
                  }}
                  data-testid={`range-${r.days}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <form
              className="cd-analytics-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                applyFilters(q.trim(), sort);
              }}
            >
              <Search size={13} />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search videos…"
                aria-label="Search videos"
                data-testid="analytics-search"
              />
            </form>
            <div className="cd-analytics-sort">
              <select
                value={sort}
                onChange={(event) => applyFilters(appliedQ, event.target.value)}
                aria-label="Sort videos"
                data-testid="analytics-sort"
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <ChevronDown size={12} />
            </div>
          </div>

          {/* KPI cards */}
          <div className="cd-stat-grid" data-testid="analytics-kpis">
            <StatCard label="Views" value={formatNumber(kpis.views)} icon={<Eye size={15} />} />
            <StatCard label="Watch time" value={formatWatchTime(kpis.watchTimeMinutes)} icon={<Clock size={15} />} />
            <StatCard label="Avg view duration" value={avd != null ? `${Math.round(avd)}s` : '—'} icon={<BarChart3 size={15} />} />
            <StatCard label="Subscribers gained" value={formatNumber(kpis.subscribersGained)} icon={<TrendingUp size={15} />} />
            <StatCard label="Impressions" value={formatNumber(kpis.impressions)} icon={<Eye size={15} />} />
            <StatCard label="Est. revenue" value={formatCurrency(kpis.estimatedRevenueUsd)} icon={<BarChart3 size={15} />} />
          </div>

          {/* Views / watch-time day chart */}
          <div className="paper-card" data-testid="analytics-day-chart">
            <div className="inline-heading">
              <span className="eyebrow">Views &amp; watch time by day</span>
            </div>
            {chartData.length === 0 ? (
              <div className="panel-empty">No daily snapshots yet — run a sync to start tracking.</div>
            ) : (
              <ChartContainer config={DAY_CHART_CONFIG} className="aspect-auto h-64 mt-3">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="views" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => formatNumber(v)} />
                  <YAxis yAxisId="watch" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => formatNumber(v)} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area yAxisId="views" dataKey="views" type="monotone" stroke="var(--color-views)" fill="var(--color-views)" fillOpacity={0.18} strokeWidth={2} />
                  <Area yAxisId="watch" dataKey="watchTime" name="Watch time (min)" type="monotone" stroke="var(--color-watchTime)" fill="var(--color-watchTime)" fillOpacity={0.12} strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            )}
          </div>

          {/* Video table */}
          <div className="paper-card" data-testid="analytics-video-table">
            <div className="inline-heading">
              <span className="eyebrow">Published videos</span>
              <span className="setting-copy" style={{ marginLeft: 'auto' }}>
                {videos.isPending ? 'Loading…' : `${items.length} video${items.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {items.length === 0 ? (
              <div className="panel-empty" data-testid="analytics-no-videos">
                {videos.isPending
                  ? 'Loading your uploads…'
                  : appliedQ
                    ? `No videos match “${appliedQ}”.`
                    : 'Nothing tracked yet — run a sync and your published uploads land here.'}
              </div>
            ) : (
              <>
                <div className="cd-video-table" data-testid="analytics-video-rows">
                  <span className="cd-vt-head">Video</span>
                  <span className="cd-vt-head">Published</span>
                  <span className="cd-vt-head num">Views</span>
                  <span className="cd-vt-head num">Watch time</span>
                  <span className="cd-vt-head num">AVD</span>
                  <span className="cd-vt-head num">Likes</span>
                  <span className="cd-vt-head num">CTR</span>
                  <span className="cd-vt-head num">Retention</span>
                  <span className="cd-vt-head num">Revenue</span>
                  {items.map((video) => (
                    <Link
                      key={video.videoRowId}
                      href={`/channels/${channelId}/analytics/videos/${video.videoRowId}`}
                      className="cd-vt-row"
                      data-testid={`analytics-video-${video.videoRowId}`}
                    >
                      <span className="cd-vt-title">
                        {pickThumbnailUrl(video.thumbnails) ? (
                          <img
                            src={pickThumbnailUrl(video.thumbnails) as string}
                            alt=""
                            className="cd-vt-thumb"
                            loading="lazy"
                          />
                        ) : (
                          <span className="cd-vt-thumb cd-vt-thumb-fallback"><Youtube size={14} /></span>
                        )}
                        <span className="cd-vt-title-text">
                          <b>{video.title}</b>
                          <small>
                            <span className={`den-tag ${video.contentKind === 'SHORT' ? 'accent' : video.contentKind === 'LIVE' ? 'alert' : 'muted'}`}>
                              {video.contentKind === 'SHORT' ? 'Short' : video.contentKind === 'LIVE' ? 'Live' : 'Long form'}
                            </span>
                            {formatDuration(video.durationSeconds)}
                          </small>
                        </span>
                      </span>
                      <span className="cd-vt-cell">{formatDate(video.publishedAt)}</span>
                      <span className="cd-vt-cell num">{formatNumber(video.views)}</span>
                      <span className="cd-vt-cell num">{formatWatchTime(video.watchTimeMinutes)}</span>
                      <span className="cd-vt-cell num">{video.averageViewDurationSeconds != null ? `${Math.round(video.averageViewDurationSeconds)}s` : '—'}</span>
                      <span className="cd-vt-cell num">{formatNumber(video.likes)}</span>
                      <span className="cd-vt-cell num">{formatPercent(video.impressionsClickThroughRate)}</span>
                      <span className="cd-vt-cell num">{formatPercent(video.averageViewPercentage)}</span>
                      <span className="cd-vt-cell num">{formatCurrency(video.estimatedRevenueUsd)}</span>
                    </Link>
                  ))}
                </div>
                {cursor && (
                  <button type="button" className="cd-load-more" onClick={loadMore} data-testid="analytics-load-more">
                    Load more <ArrowRight size={13} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}