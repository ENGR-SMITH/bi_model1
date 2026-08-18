import { Link, Route, Router, Switch } from 'wouter';

import { CreatorsShell, SectionEyebrow } from '@/components/shell';
import RoomPage from '@/pages/room';
import VaultPage from '@/pages/vault';
import SelectsPage from '@/pages/selects';
import CutPage from '@/pages/cut';
import SoundPage from '@/pages/sound';
import FinishPage from '@/pages/finish';

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <SectionEyebrow>Room not found</SectionEyebrow>
      <h1 className="mt-5 text-6xl font-extrabold tracking-[-0.08em]">This door leads nowhere.</h1>
      <Link href="/" className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">
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
          <Route path="/projects/:projectId" component={VaultPage} />
          <Route path="/projects/:projectId/selects" component={SelectsPage} />
          <Route path="/projects/:projectId/cut" component={CutPage} />
          <Route path="/projects/:projectId/sound" component={SoundPage} />
          <Route path="/projects/:projectId/finish" component={FinishPage} />
          <Route component={NotFound} />
        </Switch>
      </CreatorsShell>
    </Router>
  );
}
