import { ArrowLeft, LockKeyhole, VideoOff } from 'lucide-react';
import { Link } from 'wouter';

// ---------------------------------------------------------------------------
// RoleAccessDenied — shown when a member opens a studio they do not hold a
// role for. The nav keeps every studio visible; clicking one you cannot enter
// lands here: two long red film strips crossed in an X, with a clear message
// to ask the Captain for access.
// ---------------------------------------------------------------------------

export function RoleAccessDenied({ role, projectId }: { role: string; projectId: string }) {
  return (
    <div className="page role-denied-page" data-testid="role-access-denied">
      <div className="film-cross" aria-hidden>
        <span className="film-strip film-strip-a" />
        <span className="film-strip film-strip-b" />
        <VideoOff size={44} className="film-cross-icon" />
      </div>
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>STUDIO LOCKED</b>
          <span>The {role} studio is not in your crew role.</span>
        </div>
      </div>
      <h1 style={{ font: '700 clamp(30px, 4vw, 43px) var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>
        You can't access the {role} page.
      </h1>
      <p className="setting-copy" style={{ maxWidth: 520 }}>
        Every studio stays in the navigation, but each one only opens for the crew
        members the Captain has assigned to it. Your roles don't include <b>{role}</b> —
        contact the Captain to be granted access before you can view this page.
      </p>
      <div className="flex flex-wrap gap-3 mt-4">
        <Link href={`/projects/${projectId}`} className="secondary-btn">
          <ArrowLeft size={14} /> Back to the vault
        </Link>
        <Link href={`/projects/${projectId}/preview`} className="secondary-btn">
          <LockKeyhole size={14} /> Go to the preview
        </Link>
      </div>
    </div>
  );
}
