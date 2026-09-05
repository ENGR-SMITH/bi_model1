import { Link, Route, Router, Switch } from 'wouter';

import { CreatorsShell, SectionEyebrow } from '@/components/shell';
import { LegacyProjectGate } from '@/components/legacy-project-gate';
import CmsPage from '@/pages/cms';
import ChannelHomePage from '@/pages/channel-home';
import ChannelAnalyticsPage from '@/pages/analytics/index';
import VideoAnalyticsPage from '@/pages/analytics/video';
import OauthCallbackPage from '@/pages/oauth-callback';
import VaultPage from '@/pages/vault';
import ActivityPage from '@/pages/activity';
import ProfilePage from '@/pages/profile';
import ExplorePage from '@/pages/explore';
import NotificationsPage from '@/pages/notifications';
import ReviewPage from '@/pages/review';
import PreviewPage from '@/pages/preview';
import VideoPreviewPage from '@/pages/preview-video';
import AudioPreviewPage from '@/pages/preview-audio';
import ThumbnailPreviewPage from '@/pages/preview-thumbnail';
import ScriptPreviewPage from '@/pages/preview-script';
import FinishPreviewPage from '@/pages/preview-finish';
import RoleVideoPage from '@/pages/role-video';
import RoleAudioPage from '@/pages/role-audio';
import RoleThumbnailPage from '@/pages/role-thumbnail';
import RoleScriptPage from '@/pages/role-script';

function NotFound() {
  return (
    <div className="page">
      <div className="page-guide"><span className="guide-pin" /><div><b>ROOM NOT FOUND</b><span>This door leads nowhere.</span></div></div>
      <h1 style={{ font: '700 clamp(30px, 4vw, 43px) var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 24px' }}>This door leads nowhere.</h1>
      <Link href="/" className="primary-btn">
        Back to your channels
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Creator Den routes (multi-channel):
//
//   /                                     — the CMS channel grid
//   /channels/:channelId                  — that channel's den home
//   /channels/:channelId/analytics        — channel analytics
//   /channels/:channelId/projects/:id/…   — every project page lives inside
//                                           its channel
//   /projects/:id/…                       — legacy flat links (old
//                                           notification rows, public
//                                           read-only previews) resolve via
//                                           the gate: members are bounced into
//                                           their channel URL, legacy unlinked
//                                           projects get the attach notice,
//                                           and PUBLIC projects stay viewable
//                                           by non-members.
// ---------------------------------------------------------------------------

const CHANNEL_PROJECT_SUFFIXES: Array<[string, React.ComponentType]> = [
  ['', VaultPage],
  ['/activity', ActivityPage],
  ['/review', ReviewPage],
  ['/notifications', NotificationsPage],
  ['/preview', PreviewPage],
  ['/preview/video', VideoPreviewPage],
  ['/preview/audio', AudioPreviewPage],
  ['/preview/thumbnail', ThumbnailPreviewPage],
  ['/preview/script', ScriptPreviewPage],
  ['/preview/finish', FinishPreviewPage],
  ['/role/video', RoleVideoPage],
  ['/role/audio', RoleAudioPage],
  ['/role/thumbnail', RoleThumbnailPage],
  ['/role/script', RoleScriptPage],
];

// The flat legacy tree mirrors the channel tree so old deep links (inbox rows,
// server notifications) resolve — the gate handles member redirects, the
// unlinked-project notice, and the public read-only path.
const FLAT_SUFFIXES: Array<[string, React.ComponentType]> = [
  ['', LegacyProjectGate],
  ['/activity', LegacyProjectGate],
  ['/review', LegacyProjectGate],
  ['/notifications', LegacyProjectGate],
  ['/preview', LegacyProjectGate],
  ['/preview/video', LegacyProjectGate],
  ['/preview/audio', LegacyProjectGate],
  ['/preview/thumbnail', LegacyProjectGate],
  ['/preview/script', LegacyProjectGate],
  ['/preview/finish', LegacyProjectGate],
  ['/role/video', LegacyProjectGate],
  ['/role/audio', LegacyProjectGate],
  ['/role/thumbnail', LegacyProjectGate],
  ['/role/script', LegacyProjectGate],
];

export default function App() {
  return (
    <Router base="/creators-den">
      {/* The Google OAuth return hop renders standalone (no den chrome): the
          callback page exchanges the code and bounces back to the CMS. */}
      <Route path="/channels/oauth/callback" component={OauthCallbackPage} />
      <CreatorsShell>
        <Switch>
          <Route path="/" component={CmsPage} />
          <Route path="/channels/:channelId" component={ChannelHomePage} />
          <Route path="/channels/:channelId/analytics" component={ChannelAnalyticsPage} />
          <Route path="/channels/:channelId/analytics/videos/:videoRowId" component={VideoAnalyticsPage} />
          {CHANNEL_PROJECT_SUFFIXES.map(([suffix, Page]) => (
            <Route
              key={`c${suffix}`}
              path={`/channels/:channelId/projects/:projectId${suffix}`}
              component={Page}
            />
          ))}

          <Route path="/profile" component={ProfilePage} />
          <Route path="/profile/:userId" component={ProfilePage} />
          <Route path="/explore" component={ExplorePage} />
          <Route path="/notifications" component={NotificationsPage} />
          <Route path="/projects/:projectId" component={LegacyProjectGate} />
          {FLAT_SUFFIXES.map(([suffix, Page]) => (
            <Route key={`f${suffix}`} path={`/projects/:projectId${suffix}`} component={Page} />
          ))}

          <Route component={NotFound} />
        </Switch>
      </CreatorsShell>
    </Router>
  );
}
