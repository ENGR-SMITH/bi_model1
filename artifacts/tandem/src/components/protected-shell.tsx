import { useAuth, useClerk, useUser } from '@clerk/react';
import {
  Activity,
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
  { href: '/subscriptions', label: 'Plans', testId: 'subscriptions', icon: Ticket },
];

const roomNav = [
  { href: '/categories/authors', label: "Author's room", testId: 'authors', icon: PenLine },
  { href: '/categories/content-creators', label: "Creators' room", testId: 'content-creators', icon: UserRound },
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
  const isActive = (href: string) => location === href || location.startsWith(`${href}/`);
  const allNav = [...primaryNav, ...roomNav];

  return (
    <div className="tandem-app min-h-[100dvh] bg-[#050505] text-zinc-100">
      <header className="tandem-app-header sticky top-0 z-40 border-b border-white/[0.08] bg-[#050505]/85 px-4 backdrop-blur-xl sm:px-6">
        <div className="tandem-header-inner mx-auto flex h-[68px] max-w-[1180px] items-center gap-5">
          <TandemLogo />
          <span className="hidden h-4 w-px bg-white/10 sm:block" />
          <span className="hidden font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-600 sm:block">workspace</span>

          <nav className="tandem-header-nav hidden flex-1 items-center justify-center gap-0.5 md:flex" aria-label="Private navigation">
            {primaryNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href} className={`tandem-header-link focus-house ${active ? 'is-active' : ''}`} data-testid={`link-nav-${item.testId}`}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {item.label}
                  {item.href === '/inbox' && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-[#f973a8]" />}
                </Link>
              );
            })}
            <span className="mx-2 h-4 w-px bg-white/10" />
            {roomNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return <Link key={item.href} href={item.href} className={`tandem-header-link focus-house ${active ? 'is-active' : ''}`} data-testid={`link-room-nav-${item.testId}`}><Icon className="h-3.5 w-3.5" strokeWidth={1.8} />{item.label.replace(' room', '')}</Link>;
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <UserChip />
            <button type="button" onClick={logout} className="tandem-header-action focus-house hidden rounded-lg p-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-100 sm:inline-flex" aria-label="Sign out" data-testid="button-header-logout">
              <LogOut className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="tandem-header-action focus-house rounded-lg p-2 text-zinc-300 transition-colors hover:bg-white/5 md:hidden" aria-label={menuOpen ? 'Close menu' : 'Open menu'} data-testid="button-mobile-profile-menu">
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="tandem-mobile-menu mx-auto max-w-[1180px] border-t border-white/[0.08] py-3 md:hidden" aria-label="Mobile navigation">
            {allNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className={`tandem-mobile-link focus-house ${active ? 'is-active' : ''}`} data-testid={`link-mobile-nav-${item.testId}`}><Icon className="h-4 w-4" />{item.label}</Link>;
            })}
            <button type="button" onClick={logout} className="tandem-mobile-link focus-house mt-1 w-full text-left text-zinc-500"><LogOut className="h-4 w-4" />Sign out</button>
          </nav>
        )}
      </header>

      <main key={location} className="tandem-page mx-auto min-h-[calc(100dvh-68px)] max-w-[1180px] px-4 py-8 pb-16 sm:px-6 lg:px-8 lg:py-12">{children}</main>
    </div>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">{children}</p>;
}
