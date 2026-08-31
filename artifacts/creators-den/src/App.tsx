import { Link, Route, Router, Switch } from 'wouter';

import { CreatorsShell, SectionEyebrow } from '@/components/shell';
import RoomPage from '@/pages/room';
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
        Back to the room
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Router base="/creators-den">
      <CreatorsShell>
        <Switch>
          <Route path="/" component={RoomPage} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/profile/:userId" component={ProfilePage} />
          <Route path="/explore" component={ExplorePage} />
          <Route path="/notifications" component={NotificationsPage} />
          <Route path="/review" component={ReviewPage} />
          <Route path="/projects/:projectId" component={VaultPage} />
          <Route path="/projects/:projectId/activity" component={ActivityPage} />
          <Route path="/projects/:projectId/preview" component={PreviewPage} />
          <Route path="/projects/:projectId/preview/video" component={VideoPreviewPage} />
          <Route path="/projects/:projectId/preview/audio" component={AudioPreviewPage} />
          <Route path="/projects/:projectId/preview/thumbnail" component={ThumbnailPreviewPage} />
          <Route path="/projects/:projectId/preview/script" component={ScriptPreviewPage} />
          <Route path="/projects/:projectId/preview/finish" component={FinishPreviewPage} />
          <Route path="/projects/:projectId/role/video" component={RoleVideoPage} />
          <Route path="/projects/:projectId/role/audio" component={RoleAudioPage} />
          <Route path="/projects/:projectId/role/thumbnail" component={RoleThumbnailPage} />
          <Route path="/projects/:projectId/role/script" component={RoleScriptPage} />
          <Route component={NotFound} />
        </Switch>
      </CreatorsShell>
    </Router>
  );
}
