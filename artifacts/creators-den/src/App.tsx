import { Link, Route, Router, Switch } from 'wouter';

import { CreatorsShell, SectionEyebrow } from '@/components/shell';
import RoomPage from '@/pages/room';
import VaultPage from '@/pages/vault';
import ActivityPage from '@/pages/activity';
import SelectsPage from '@/pages/selects';
import CutPage from '@/pages/cut';
import SoundPage from '@/pages/sound';
import FinishPage from '@/pages/finish';
import ThumbnailPage from '@/pages/thumbnail';
import ProfilePage from '@/pages/profile';
import ExplorePage from '@/pages/explore';

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
          <Route path="/projects/:projectId" component={VaultPage} />
          <Route path="/projects/:projectId/activity" component={ActivityPage} />
          <Route path="/projects/:projectId/selects" component={SelectsPage} />
          <Route path="/projects/:projectId/cut" component={CutPage} />
          <Route path="/projects/:projectId/sound" component={SoundPage} />
          <Route path="/projects/:projectId/finish" component={FinishPage} />
          <Route path="/projects/:projectId/thumbnail" component={ThumbnailPage} />
          <Route component={NotFound} />
        </Switch>
      </CreatorsShell>
    </Router>
  );
}
