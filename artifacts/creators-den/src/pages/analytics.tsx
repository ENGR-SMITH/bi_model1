import { BarChart3, Link2, Youtube } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useGetChannel } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';

// ---------------------------------------------------------------------------
// Channel Analytics (placeholder shell for the analytics milestone).
//
// The full product — the video table with filters and the per-video analytics
// pages (retention curves, traffic sources, demographics, devices, revenue) —
// builds on this route in the analytics milestone. Until a channel is linked
// to its real YouTube channel, this page explains exactly why there is no
// data yet instead of inventing numbers.
// ---------------------------------------------------------------------------

export default function ChannelAnalyticsPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const channel = useGetChannel(channelId);
  const data = channel.data;
  const displayName = data?.youtubeTitle || data?.name || 'This channel';

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

      {data?.youtubeConnected ? (
        <div className="paper-card" data-testid="analytics-placeholder">
          <div className="inline-heading">
            <span className="eyebrow"><Youtube size={13} /> Ready to track</span>
          </div>
          <p className="setting-copy mt-2">
            This channel is linked to its YouTube channel. The video table, filters, and per-video analytics dashboards
            land in the next analytics milestone — the sync pipeline and the data model behind them are already in place.
          </p>
        </div>
      ) : (
        <div className="paper-card" data-testid="analytics-unlinked">
          <div className="inline-heading">
            <span className="eyebrow"><Link2 size={13} /> Not linked yet</span>
          </div>
          <h2 style={{ font: '700 24px var(--app-font-serif)', letterSpacing: '-.03em', margin: '10px 0 8px' }}>Analytics needs the real channel.</h2>
          <p className="setting-copy">
            Analytics is powered by the YouTube Analytics API, which only releases data for the channel the owner
            links through Google. Linking this channel to its YouTube channel — which also brings over its banner,
            logo, and name — unlocks everything here.
          </p>
          <Link href={`/channels/${channelId}`} className="cd-actionbtn mt-3">Back to the den</Link>
        </div>
      )}
    </div>
  );
}
