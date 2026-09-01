import { useAuth, useClerk, useUser } from '@clerk/react';
import {
  Activity,
  ChevronDown,
  Inbox,
  LayoutGrid,
  LogOut,
  Menu,
  PenLine,
  Ticket,
  UserRound,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { TandemLogo } from '@/components/tandem-house';

const primaryNav = [
  { href: '/dashboard', label: 'Overview', testId: 'atrium', icon: LayoutGrid },
  { href: '/activity', label: 'Activity', testId: 'activity', icon: Activity },
  { href: '/inbox', label: 'Inbox', testId: 'inbox', icon: Inbox },
  { href: '/subscriptions', label: 'Plans & passes', testId: 'subscriptions', icon: Ticket },
];

const roomNav = [
  { href: '/categories/authors', label: "Author's room", testId: 'authors', icon: PenLine },
  { href: '/categories/content-creators', label: "Creators' room", testId: 'content-creators', icon: UserRound },
];

const mobileNav = [
  { href: '/dashboard', label: 'Overview', testId: 'atrium', icon: LayoutGrid },
  { href: '/activity', label: 'Activity', testId: 'activity', icon: Activity },
  { href: '/inbox', label: 'Inbox', testId: 'inbox', icon: Inbox },
  { href: '/subscriptions', label: 'Plans', testId: 'subscriptions', icon: Ticket },
  { href: '/profile', label: 'Profile', testId: 'profile', icon: UserRound },
];

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="tandem-public flex min-h-[100dvh] items-center justify-center bg-[#0a0a0a] px-6">
        <div className="w-full max-w-md space-y-4" aria-label="Loading Tandem">
          <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />
          <div className="h-12 w-4/5 animate-pulse rounded-xl bg-white/5" />
          <div className="h-5 w-full animate-pulse rounded-full bg-white/5" />
          <div className="h-40 rounded-2xl bg-white/5" />
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
      className="focus-house group flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-white/5"
      data-testid="link-profile-chip"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white font-mono-ui text-[10px] font-medium uppercase text-black">
        {initials}
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-xs font-semibold text-zinc-100" data-testid="text-user-name">{name}</span>
        <span className="block truncate text-[10px] text-zinc-500">{user?.primaryEmailAddress?.emailAddress || 'Tandem member'}</span>
      </span>
    </Link>
  );
}

function PrivateShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut } = useClerk();

  const logout = () => signOut({ redirectUrl: '/' });

  return (
    <div className="tandem-app min-h-[100dvh] bg-[#050505] text-zinc-100">
      <aside className="tandem-sidebar fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col border-r border-white/[0.08] bg-[#080808] px-3 py-4 md:flex">
        <div className="px-3 pb-5">
          <TandemLogo />
        </div>

        <button type="button" className="tandem-workspace-switcher focus-house mx-1 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-3 text-left transition-colors hover:bg-white/[0.06]" data-testid="button-workspace-switcher">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-black">T</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold text-zinc-100">Tandem</span>
            <span className="mt-0.5 block truncate text-[10px] text-zinc-500">Creative connection</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        </button>

        <nav className="mt-7" aria-label="Private navigation">
          <p className="tandem-nav-label">Workspace</p>
          <div className="mt-2 space-y-0.5">
            {primaryNav.map((item) => {
              const Icon = item.icon;
              const active = location === item.href;
              return (
                <Link key={item.href} href={item.href} className={`tandem-sidebar-link focus-house ${active ? 'is-active' : ''}`} data-testid={`link-nav-${item.testId}`}>
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                  {item.label}
                  {item.href === '/inbox' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#f973a8]" />}
                </Link>
              );
            })}
          </div>

          <p className="tandem-nav-label mt-8">Rooms</p>
          <div className="mt-2 space-y-0.5">
            {roomNav.map((item) => {
              const Icon = item.icon;
              const active = location === item.href;
              return <Link key={item.href} href={item.href} className={`tandem-sidebar-link focus-house ${active ? 'is-active' : ''}`} data-testid={`link-room-nav-${item.testId}`}><Icon className="h-4 w-4" strokeWidth={1.8} />{item.label}</Link>;
            })}
          </div>
        </nav>

        <div className="mt-auto border-t border-white/[0.08] pt-3">
          <UserChip />
          <button type="button" onClick={logout} className="tandem-sidebar-link focus-house mt-1 w-full text-left text-zinc-500 hover:text-zinc-200" data-testid="button-header-logout">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <header className="tandem-mobile-header sticky top-0 z-30 border-b border-white/[0.08] bg-[#080808]/90 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="flex items-center justify-between">
          <TandemLogo />
          <button type="button" onClick={() => setMenuOpen((open) => !open)} className="focus-house rounded-lg border border-white/10 p-2" aria-label={menuOpen ? 'Close menu' : 'Open menu'} data-testid="button-mobile-profile-menu">
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
        {menuOpen && (
          <div className="mt-3 rounded-xl border border-white/10 bg-[#111111] p-2 shadow-2xl">
            {[...mobileNav, ...roomNav].map((item) => {
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-zinc-200 hover:bg-white/5" data-testid={`link-mobile-nav-${item.testId}`}><Icon className="h-4 w-4 text-zinc-500" />{item.label}</Link>;
            })}
            <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-zinc-400 hover:bg-white/5"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        )}
      </header>

      <div className="md:pl-[252px]">
        <div className="tandem-private-topbar hidden h-14 items-center justify-between border-b border-white/[0.08] px-8 lg:flex">
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-600">Tandem workspace</span>
          <Link href="/profile" className="text-xs text-zinc-500 transition-colors hover:text-zinc-200">Account settings <span aria-hidden="true">↗</span></Link>
        </div>
        <main key={location} className="tandem-page mx-auto max-w-[1240px] px-5 py-8 pb-24 sm:px-8 lg:px-10 lg:py-12 lg:pb-16">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-[#080808]/95 px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return <Link key={item.href} href={item.href} className={`focus-house flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-medium ${active ? 'text-white' : 'text-zinc-500'}`} data-testid={`link-mobile-${item.testId}`}><Icon className={`h-4 w-4 ${active ? 'text-[#f973a8]' : ''}`} strokeWidth={active ? 2.1 : 1.7} />{item.label}</Link>;
          })}
        </div>
      </nav>
    </div>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">{children}</p>;
}
