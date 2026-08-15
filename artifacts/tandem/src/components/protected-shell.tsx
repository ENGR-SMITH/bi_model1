import { useAuth, useClerk, useUser } from '@clerk/react';
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  DoorOpen,
  Inbox,
  Handshake,
  LayoutGrid,
  LogOut,
  Settings2,
  UserRound,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { TandemLogo } from '@/components/tandem-house';

const desktopNav = [
  { href: '/dashboard', label: 'Atrium', icon: LayoutGrid },
  { href: '/authors/atrium', label: 'Collaboration', icon: Handshake },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
];

const mobileNav = [
  { href: '/dashboard', label: 'Atrium', icon: LayoutGrid },
  { href: '/authors/atrium', label: 'Collab', icon: Handshake },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="atrium-grid flex min-h-[100dvh] items-center justify-center px-6">
        <div className="w-full max-w-md space-y-4" aria-label="Loading Tandem">
          <div className="h-3 w-24 animate-pulse rounded-full bg-[#d6cbb9]" />
          <div className="h-12 w-4/5 animate-pulse rounded-xl bg-[#e5d7c5]" />
          <div className="h-5 w-full animate-pulse rounded-full bg-[#e5d7c5]" />
          <div className="h-40 rounded-3xl bg-[#e5d7c5]" />
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  return <PrivateShell>{children}</PrivateShell>;
}

function UserChip() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'Member';
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || name.slice(0, 2);

  return (
    <Link
      href="/profile"
      className="focus-house group flex items-center gap-3 rounded-full px-2 py-1.5 transition-colors hover:bg-[#ebe0d0]"
      data-testid="link-profile-chip"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#292b45] font-mono-ui text-[11px] font-medium uppercase text-[#fff4e6]">
        {initials}
      </span>
      <span className="hidden text-left sm:block">
        <span className="block text-xs font-bold text-[#292b45]" data-testid="text-user-name">{name}</span>
        <span className="block max-w-40 truncate text-[10px] text-[#77717a]">{user?.primaryEmailAddress?.emailAddress || 'Tandem member'}</span>
      </span>
      <ChevronRight className="hidden h-4 w-4 text-[#98909a] sm:block" />
    </Link>
  );
}

function PrivateShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut } = useClerk();

  const logout = () => signOut({ redirectUrl: '/' });

  return (
    <div className="paper-noise atrium-grid min-h-[100dvh] text-[#292b45]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1520px]">
        <aside className="hidden w-[244px] shrink-0 flex-col border-r-2 border-[#d6cbb9] bg-[#ebe0d0]/80 px-6 py-7 lg:flex">
          <TandemLogo />
          <div className="mt-12">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">Private house</p>
            <p className="mt-3 font-display text-3xl italic leading-none">The atrium</p>
          </div>
          <nav className="mt-10 space-y-2" aria-label="Private navigation">
            {desktopNav.map((item) => {
              const Icon = item.icon;
              const active = location === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`focus-house flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${active ? 'bg-[#292b45] text-[#fff4e6]' : 'text-[#625f6d] hover:bg-[#f2e7d8] hover:text-[#292b45]'}`}
                  data-testid={`link-sidebar-${item.label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto">
            <div className="mb-5 rounded-2xl border border-[#d6cbb9] bg-[#f7eddf] p-4">
              <DoorOpen className="h-5 w-5 text-[#e55b4c]" strokeWidth={1.7} />
              <p className="mt-5 text-sm font-bold">Six doors lit.</p>
              <p className="mt-1 text-xs leading-relaxed text-[#77717a]">The wider house is still taking shape.</p>
            </div>
            <button type="button" onClick={logout} className="focus-house flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-[#77717a] transition-colors hover:bg-[#f2e7d8] hover:text-[#e55b4c]" data-testid="button-sidebar-logout">
              <LogOut className="h-4 w-4" />
              Leave the house
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b-2 border-[#d6cbb9] bg-[#f2e7d8]/90 px-5 backdrop-blur-md sm:px-8 lg:px-10">
            <div className="lg:hidden">
              <TandemLogo />
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <span className="h-2 w-2 rounded-full bg-[#3e8074]" />
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#77717a]">Your corner of the house</span>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/categories/authors" className="focus-house hidden items-center gap-2 rounded-full px-3 py-2 text-xs font-bold text-[#625f6d] transition-colors hover:bg-[#ebe0d0] sm:flex" data-testid="link-header-authors">
                <ArrowLeft className="h-3.5 w-3.5" />
                Author&apos;s Atrium
              </Link>
              <UserChip />
              <button type="button" onClick={() => setMenuOpen((open) => !open)} className="focus-house rounded-full border border-[#d6cbb9] p-2 lg:hidden" aria-label="Open profile menu" data-testid="button-mobile-profile-menu">
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
            {menuOpen && (
              <div className="absolute right-5 top-[68px] w-48 rounded-2xl border-2 border-[#d6cbb9] bg-[#fff4e6] p-2 shadow-[8px_10px_0_rgba(41,43,69,0.1)] lg:hidden">
                <Link href="/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold hover:bg-[#f2e7d8]" data-testid="link-mobile-profile"><UserRound className="h-4 w-4" />Profile & settings</Link>
                <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold text-[#e55b4c] hover:bg-[#f2e7d8]" data-testid="button-mobile-logout"><LogOut className="h-4 w-4" />Leave the house</button>
              </div>
            )}
          </header>
          <main className="px-5 pb-28 pt-8 sm:px-8 sm:pt-10 lg:px-10 lg:pb-12">{children}</main>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-[#d6cbb9] bg-[#fff4e6]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-lg lg:hidden" aria-label="Mobile navigation">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`focus-house flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-bold ${active ? 'text-[#e55b4c]' : 'text-[#77717a]'}`} data-testid={`link-mobile-${item.label.toLowerCase()}`}>
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.7]'}`} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">{children}</p>;
}