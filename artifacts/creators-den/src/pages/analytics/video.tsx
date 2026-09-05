import { useEffect } from 'react';
import { Link, useParams } from 'wouter';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Clock,
  Eye,
  Loader2,
  MessageSquare,
  Share2,
  ThumbsUp,
  TrendingUp,
  Youtube,
} from 'lucide-react';
import {
  getGetChannelAnalyticsOverviewQueryKey,
  getGetChannelAnalyticsVideoQueryKey,
  getGetChannelAnalyticsVideoReportQueryKey,
  useGetChannelAnalyticsOverview,
  useGetChannelAnalyticsVideo,
  useGetChannelAnalyticsVideoReport,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import {
  belowMedianPct,
  formatCurrency,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatWatchTime,
  isBelowMedian,
  pickThumbnailUrl,
} from '@/lib/analytics-format';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';

const VIEWS = '#e11d48';
const WATCH = '#6366f1';
const REVENUE = '#10b981';
const PALETTE = ['#0ea5e9', '#f59e0b', '#a855f7', '#10b981', '#f43f5e', '#eab308'];

const DAY_CHART_CONFIG = {
  views: { label: 'Views', color: VIEWS },
  watchTime: { label: 'Watch time (min)', color: WATCH },
} as const;

function StatCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="cd-stat-card" data-testid={`video-stat-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <span className="cd-stat-label">{label}</span>
      <span className="cd-stat-value">{value}</span>
      {icon && <span className="cd-stat-icon">{icon}</span>}
    </div>
  );
}

// A report section that auto-refreshes once when the server says the cache is
// stale (the sync it kicked finishes a few seconds later).
function ReportSection({
  channelId,
  videoRowId,
  kind,
  title,
  children,
}: {
  channelId: string;
  videoRowId: string;
  kind: 'RETENTION' | 'TRAFFIC' | 'PLAYBACK_LOCATION' | 'DEMOGRAPHICS' | 'DEVICES' | 'REVENUE';
  title: string;
  children: (rows: Array<Record<string, string | number | null>>) => React.ReactNode;
}) {
  const report = useGetChannelAnalyticsVideoReport(channelId, videoRowId, { kind }, {
    query: {
      queryKey: getGetChannelAnalyticsVideoReportQueryKey(channelId, videoRowId, { kind }),
      enabled: Boolean(channelId && videoRowId),
    },
  });
  const { refetch } = report;

  useEffect(() => {
    if (!report.data?.stale) return;
    const timer = setTimeout(() => {
      void refetch();
    }, 6000);
    return () => clearTimeout(timer);
  }, [report.data?.stale, refetch]);

  const rows = report.data?.rows ?? [];
  const stale = Boolean(report.data?.stale);

  return (
    <div className="paper-card" data-testid={`report-${kind.toLowerCase()}`}>
      <div className="inline-heading">
        <span className="eyebrow">{title}</span>
        {stale && (
          <span className="den-tag accent" data-testid={`report-${kind.toLowerCase()}-stale`}>
            <Loader2 size={11} className="spin" /> Refreshing…
          </span>
        )}
      </div>
      {report.isPending && !stale ? (
        <div className="panel-empty">Loading…</div>
      ) : rows.length === 0 && !stale ? (
        <div className="panel-empty">No data for this section yet — run a sync and check back.</div>
      ) : (
        <div className="mt-3">{children(rows)}</div>
      )}
    </div>
  );
}

function PercentTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: unknown } }) {
  const value = Number(payload?.value ?? 0);
  return (
    <text x={x} y={y} dy={10} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">
      {Math.round(value * 100)}%
    </text>
  );
}

export default function VideoAnalyticsPage() {
  const { channelId = '', videoRowId = '' } = useParams<{ channelId: string; videoRowId: string }>();
  const detail = useGetChannelAnalyticsVideo(channelId, videoRowId, undefined, {
    query: {
      queryKey: getGetChannelAnalyticsVideoQueryKey(channelId, videoRowId, undefined),
      enabled: Boolean(channelId && videoRowId),
    },
  });
  const channel = useGetChannelAnalyticsOverview(channelId, undefined, {
    query: {
      queryKey: getGetChannelAnalyticsOverviewQueryKey(channelId, undefined),
      enabled: Boolean(channelId),
    },
  });

  const video = detail.data;
  const totals = video?.totals ?? {};
  const series = video?.series ?? [];
  const latest = series[series.length - 1]?.metrics ?? {};
  const medians = video?.channelMedians ?? { impressionsClickThroughRate: null, averageViewDurationSeconds: null };

  const ctr = latest.impressionsClickThroughRate ?? null;
  const avd = latest.averageViewDurationSeconds ?? null;
  const ctrPct = belowMedianPct(ctr, medians.impressionsClickThroughRate);
  const avdPct = belowMedianPct(avd, medians.averageViewDurationSeconds);
  const showAnomaly = isBelowMedian(ctr, medians.impressionsClickThroughRate) || isBelowMedian(avd, medians.averageViewDurationSeconds);

  const dayData = series.map((s) => ({ day: s.day.slice(5), views: s.metrics.views ?? 0, watchTime: s.metrics.watchTimeMinutes ?? 0 }));

  const subsGained = channel.data?.kpis.subscribersGained ?? null;
  const subsLost = channel.data?.kpis.subscribersLost ?? null;

  if (!video) {
    return (
      <div className="page">
        <div className="paper-card">
          {detail.isPending ? (
            <div className="panel-empty">Loading video analytics…</div>
          ) : (
            <div className="panel-empty">This video isn't in this channel's catalog.</div>
          )}
        </div>
      </div>
    );
  }

  const thumbnailUrl = pickThumbnailUrl(video.thumbnails);

  return (
    <div className="page">
      {/* Header */}
      <div className="cd-video-analytics-head" data-testid="video-analytics-head">
        <Link href={`/channels/${channelId}/analytics`} className="cd-analytics-back" data-testid="analytics-back">
          <ArrowLeft size={13} /> All videos
        </Link>
        <div className="cd-va-title-row">
          {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="cd-va-thumb" /> : <span className="cd-va-thumb cd-va-thumb-fallback"><Youtube size={20} /></span>}
          <div className="cd-va-title">
            <SectionEyebrow><BarChart3 size={13} /> Video analytics</SectionEyebrow>
            <h1>{video.title}</h1>
            <span className="cd-va-meta">
              <span className={`den-tag ${video.contentKind === 'SHORT' ? 'accent' : video.contentKind === 'LIVE' ? 'alert' : 'muted'}`}>
                {video.contentKind === 'SHORT' ? 'Short' : video.contentKind === 'LIVE' ? 'Live' : 'Long form'}
              </span>
              <span>{formatDuration(video.durationSeconds)}</span>
              <span>Published {formatDate(video.publishedAt)}</span>
              {subsGained != null && (
                <span className="cd-va-subs" data-testid="video-subs">
                  <TrendingUp size={12} />
                  Subs +{formatNumber(subsGained)}
                  {subsLost != null && subsLost > 0 ? ` / −${formatNumber(subsLost)}` : ''}
                </span>
              )}
            </span>
          </div>
        </div>
        {showAnomaly && (
          <div className="cd-anomaly-banner" data-testid="video-anomaly">
            <AlertTriangle size={14} />
            <span>
              {ctrPct != null && avdPct != null
                ? `CTR (${ctrPct}% below) and average watch time (${avdPct}% below) are both well under this channel's medians.`
                : ctrPct != null
                  ? `CTR is ${ctrPct}% below this channel's median for recent uploads.`
                  : avdPct != null
                    ? `Average watch time is ${avdPct}% below this channel's median for recent uploads.`
                    : 'This video is underperforming compared to the channel median.'}
            </span>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="cd-stat-grid" data-testid="video-kpis">
        <StatCard label="Views" value={formatNumber(totals.views)} icon={<Eye size={15} />} />
        <StatCard label="Watch time" value={formatWatchTime(totals.watchTimeMinutes)} icon={<Clock size={15} />} />
        <StatCard label="Avg view duration" value={avd != null ? `${Math.round(avd)}s` : '—'} icon={<BarChart3 size={15} />} />
        <StatCard label="Likes" value={formatNumber(totals.likes)} icon={<ThumbsUp size={15} />} />
        <StatCard label="Comments" value={formatNumber(totals.comments)} icon={<MessageSquare size={15} />} />
        <StatCard label="Shares" value={formatNumber(totals.shares)} icon={<Share2 size={15} />} />
        <StatCard label="Impressions" value={formatNumber(totals.impressions)} icon={<Eye size={15} />} />
        <StatCard label="CTR" value={formatPercent(ctr)} icon={<BarChart3 size={15} />} />
        <StatCard label="Est. revenue" value={formatCurrency(totals.estimatedRevenueUsd)} icon={<TrendingUp size={15} />} />
      </div>

      {/* Day chart */}
      <div className="paper-card" data-testid="video-day-chart">
        <div className="inline-heading">
          <span className="eyebrow">Views &amp; watch time by day</span>
        </div>
        {dayData.length === 0 ? (
          <div className="panel-empty">No daily snapshots yet — run a sync to start tracking.</div>
        ) : (
          <ChartContainer config={DAY_CHART_CONFIG} className="aspect-auto h-64 mt-3">
            <AreaChart data={dayData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
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

      {/* Report sections */}
      <div className="cd-report-grid">
        <ReportSection channelId={channelId} videoRowId={videoRowId} kind="RETENTION" title="Audience retention">
          {(rows) => {
            const data = rows.map((r) => ({ t: r.elapsedVideoTimeRatio, v: r.averageViewPercentage }));
            return (
              <ChartContainer config={{ retention: { label: 'Avg view %', color: VIEWS } }} className="aspect-auto h-56">
                <LineChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tickLine={false} axisLine={false} tick={<PercentTick />} tickFormatter={(v: unknown) => `${Math.round(Number(v) * 100)}%`} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={40} tickFormatter={(v: number) => `${Math.round(v)}%`} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(label: unknown) => `${Math.round(Number(label) * 100)}% watched`} />} />
                  <Line dataKey="v" name="Average view %" type="monotone" stroke="var(--color-retention)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            );
          }}
        </ReportSection>

        <ReportSection channelId={channelId} videoRowId={videoRowId} kind="TRAFFIC" title="Traffic sources">
          {(rows) => {
            const data = rows.map((r) => ({ name: String(r.insightTrafficSourceType ?? '—'), views: Number(r.views ?? 0) }));
            return (
              <ChartContainer config={{ views: { label: 'Views', color: WATCH } }} className="aspect-auto h-56">
                <BarChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={40} tickFormatter={(v: number) => formatNumber(v)} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="views" name="Views" fill="var(--color-views)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            );
          }}
        </ReportSection>

        <ReportSection channelId={channelId} videoRowId={videoRowId} kind="PLAYBACK_LOCATION" title="Playback locations">
          {(rows) => {
            const data = rows.map((r) => ({ name: String(r.insightPlaybackLocationType ?? '—'), views: Number(r.views ?? 0) }));
            return (
              <ChartContainer config={{ views: { label: 'Views', color: VIEWS } }} className="aspect-auto h-56">
                <BarChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={40} tickFormatter={(v: number) => formatNumber(v)} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="views" name="Views" fill="var(--color-views)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            );
          }}
        </ReportSection>

        <ReportSection channelId={channelId} videoRowId={videoRowId} kind="DEMOGRAPHICS" title="Audience demographics">
          {(rows) => {
            const byAge: Record<string, Record<string, number | string>> = {};
            for (const r of rows) {
              const age = String(r.ageGroup ?? 'unknown');
              const gender = String(r.gender ?? 'unspecified');
              byAge[age] = { ...(byAge[age] ?? {}), ageGroup: age, [gender]: Number(r.viewerPercentage ?? 0) };
            }
            const genders = ['female', 'male', 'unspecified'].filter((g) => rows.some((r) => r.gender === g));
            const data = Object.values(byAge);
            return (
              <ChartContainer config={{ female: { label: 'Female %', color: '#0ea5e9' }, male: { label: 'Male %', color: '#f59e0b' }, unspecified: { label: 'Other %', color: '#a855f7' } }} className="aspect-auto h-56">
                <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="ageGroup" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={40} tickFormatter={(v: number) => `${v}%`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {genders.map((gender, i) => (
                    <Bar key={gender} dataKey={gender} stackId="a" fill={`var(--color-${gender})`} radius={i === genders.length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ChartContainer>
            );
          }}
        </ReportSection>

        <ReportSection channelId={channelId} videoRowId={videoRowId} kind="DEVICES" title="Devices">
          {(rows) => {
            const data = rows.map((r) => ({ name: String(r.deviceType ?? '—'), views: Number(r.views ?? 0) }));
            return (
              <ChartContainer config={{ views: { label: 'Views', color: WATCH } }} className="aspect-auto h-56">
                <BarChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={40} tickFormatter={(v: number) => formatNumber(v)} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="views" name="Views" fill="var(--color-views)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            );
          }}
        </ReportSection>

        <ReportSection channelId={channelId} videoRowId={videoRowId} kind="REVENUE" title="Revenue">
          {(rows) => {
            const data = rows.map((r) => ({ day: String(r.day ?? '').slice(5), revenue: Number(r.estimatedRevenue ?? 0) }));
            const last = rows[rows.length - 1] ?? {};
            const rpm = last.estimatedRpm != null ? Number(last.estimatedRpm) : null;
            const cpm = last.estimatedCpm != null ? Number(last.estimatedCpm) : null;
            return (
              <div>
                {(rpm != null || cpm != null) && (
                  <div className="cd-va-rate-chips" data-testid="revenue-rates">
                    {rpm != null && <span className="den-tag accent">RPM {formatCurrency(rpm)}</span>}
                    {cpm != null && <span className="den-tag accent">CPM {formatCurrency(cpm)}</span>}
                  </div>
                )}
                <ChartContainer config={{ revenue: { label: 'Est. revenue', color: REVENUE } }} className="aspect-auto h-52 mt-2">
                  <LineChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={40} tickFormatter={(v: number) => formatCurrency(v)} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="revenue" name="Est. revenue" type="monotone" stroke="var(--color-revenue)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              </div>
            );
          }}
        </ReportSection>
      </div>
    </div>
  );
}