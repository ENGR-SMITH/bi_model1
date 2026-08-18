import { useClerk, useUser } from '@clerk/react';
import {
  ArrowUpRight,
  Clapperboard,
  DoorOpen,
  Film,
  LogOut,
  Mic2,
  Palette,
  Scissors,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useProjectPresence, useRealtimeSocket } from '@/lib/realtime';

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">{children}</p>;
}

export const RELAY_LEGS = [
  { slug: 'selects', number: '01', label: 'Selects', role: 'Story Architect', icon: Film },
  { slug: 'cut', number: '02', label: 'Cut', role: 'Visual Editor', icon: Scissors },
  { slug: 'sound', number: '03', label: 'Sound', role: 'Sound Designer', icon: Mic2 },
  { slug: 'finish', number: '04', label: 'Finish', role: 'Motion & Color', icon: Palette },
] as const;

function UserChip() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'Member';
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || name.slice(0, 2);

  return (
    <div className="flex items-center gap-3 rounded-full px-2 py-1.5" data-testid="user-chip">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#292b45] font-mono-ui text-[11px] font-medium uppercase text-[#fff4e6]">
        {initials}
      </span>
      <span className="hidden text-left sm:block">
        <span className="block text-xs font-bold text-[#292b45]" data-testid="text-user-name">{name}</span>
        <span className="block max-w-44 truncate text-[10px] text-[#77717a]">{user?.primaryEmailAddress?.emailAddress || 'Tandem member'}</span>
      </span>
    </div>
  );
}

const LEG_LABELS: Record<string, string> = {
  SELECTS: 'Selects',
  CUT: 'Cut',
  SOUND: 'Sound',
  FINISH: 'Finish',
};

function PresenceStrip({ projectId }: { projectId: string }) {
  const { user } = useUser();
  const socket = useRealtimeSocket();
  const roster = useProjectPresence(projectId);
  const others = roster.filter((entry) => entry.userId !== user?.id);

  if (!socket || others.length === 0) return null;

  return (
    <div className="border-b-2 border-[#d6cbb9] bg-[#e5f1e8]" data-testid="presence-strip">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        {others.map((entry) => (
          <span
            key={entry.userId}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-[#286254]"
            data-testid={`presence-${entry.userId}`}
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#286254]" />
            {entry.name || 'Teammate'}
            {entry.leg && (
              <span className="rounded-full bg-[#fff4e6] px-2 py-0.5 font-mono-ui text-[8px] uppercase tracking-[.14em] text-[#286254]">
                {LEG_LABELS[entry.leg] ?? entry.leg}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function RelayRail({ projectId }: { projectId: string }) {
  const [location] = useLocation();

  return (
    <>
      <nav className="border-b-2 border-[#d6cbb9] bg-[#fff4e6]/80" aria-label="The relay">
      <div className="mx-auto flex max-w-[1180px] items-stretch gap-1 overflow-x-auto px-4 py-2">
        <Link
          href={`/projects/${projectId}`}
          className={`focus-house flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${location === `/projects/${projectId}` ? 'bg-[#292b45] text-[#fff4e6]' : 'text-[#625f6d] hover:bg-[#ebe0d0] hover:text-[#292b45]'}`}
          data-testid="rail-link-vault"
        >
          <DoorOpen className="h-3.5 w-3.5" />
          The vault
        </Link>
        {RELAY_LEGS.map((leg) => {
          const Icon = leg.icon;
          const href = `/projects/${projectId}/${leg.slug}`;
          const active = location === href;
          return (
            <Link
              key={leg.slug}
              href={href}
              className={`focus-house flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${active ? 'bg-[#e55b4c] text-[#fff4e6]' : 'text-[#625f6d] hover:bg-[#ebe0d0] hover:text-[#292b45]'}`}
              data-testid={`rail-link-${leg.slug}`}
            >
              <span className={`font-mono-ui text-[9px] uppercase tracking-[.14em] ${active ? 'text-[#f0c85c]' : 'text-[#98909a]'}`}>{leg.number}</span>
              <Icon className="h-3.5 w-3.5" />
              {leg.label}
            </Link>
          );
        })}
      </div>
      </nav>
      <PresenceStrip projectId={projectId} />
    </>
  );
}

export function CreatorsShell({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const [location] = useLocation();

  const projectMatch = location.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1];

  const logout = () => signOut({ redirectUrl: '/' });

  return (
    <div className="paper-noise atrium-grid min-h-[100dvh] text-[#292b45]">
      <header className="sticky top-0 z-30 border-b-2 border-[#d6cbb9] bg-[#ebe0d0]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="focus-house flex items-center gap-2.5 rounded-xl pr-2" data-testid="link-brand-home">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#292b45] text-[#f0c85c]">
                <Clapperboard className="h-4 w-4" />
              </span>
              <span className="leading-tight">
                <span className="block font-display text-lg italic leading-none">Creators Den</span>
                <span className="block font-mono-ui text-[9px] uppercase tracking-[0.18em] text-[#77717a]">the video room</span>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="focus-house inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-[#77717a] transition-colors hover:bg-[#f2e7d8] hover:text-[#292b45]"
              data-testid="link-back-atrium"
            >
              <ArrowUpRight className="h-3.5 w-3.5 rotate-[225deg]" />
              Back to the atrium
            </a>
            <UserChip />
            <button
              type="button"
              onClick={logout}
              title="Leave the room"
              className="focus-house inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-[#77717a] transition-colors hover:bg-[#f2e7d8] hover:text-[#e55b4c]"
              data-testid="button-creators-logout"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Leave</span>
            </button>
          </div>
        </div>
      </header>

      {projectId && <RelayRail projectId={projectId} />}

      <main>{children}</main>
    </div>
  );
}
