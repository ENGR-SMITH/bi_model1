import { useAuth, useClerk, useUser } from '@clerk/react';
import {
  Activity,
  ArrowLeft,
  Inbox,
  LayoutGrid,
  LogOut,
  Menu,
  Ticket,
  UserRound,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { TandemLogo } from '@/components/tandem-house';

const desktopNav = [
  { href: '/dashboard', label: 'Atrium', icon: LayoutGrid },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/subscriptions', label: 'Subscriptions', icon: Ticket },
];

const mobileNav = [
  { href: '/dashboard', label: 'Atrium', icon: LayoutGrid },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/subscriptions', label: 'Subscriptions', icon: Ticket },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0a] px-6">
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
      className="focus-house group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
      data-testid="link-profile-chip"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] font-mono-ui text-[10px] font-medium uppercase text-white">
        {initials}
      </span>
      <span className="hidden text-left sm:block">
        <span className="block text-xs font-semibold text-zinc-100" data-testid="text-user-name">{name}</span>
        <span className="block max-w-40 truncate text-[10px] text-zinc-500">{user?.primaryEmailAddress?.emailAddress || 'Tandem member'}</span>
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
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-zinc-100">
      {/* Resend-style top navigation bar */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0a0a0a]/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-[1240px] items-center gap-4 px-5 sm:px-8 lg:px-10">
          <TandemLogo />

          {/* Desktop nav — pill tabs like Resend's dashboard nav */}
          <nav className="hidden min-w-0 flex-1 items-center gap-1 md:flex" aria-label="Private navigation">
            {desktopNav.map((item) => {
              const Icon = item.icon;
              const active = location === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`focus-house flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}
                  data-testid={`link-nav-${item.label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right cluster — authors shortcut, user chip, sign out */}
          <div className="ml-auto flex items-center gap-2">
            <Link href="/categories/authors" className="focus-house hidden items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 lg:flex" data-testid="link-header-authors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Author's Atrium
            </Link>
            <UserChip />
            <button type="button" onClick={logout} className="focus-house hidden items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 sm:flex" data-testid="button-header-logout">
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="focus-house rounded-lg border border-white/10 p-2 md:hidden" aria-label="Open menu" data-testid="button-mobile-profile-menu">
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="absolute inset-x-4 top-[68px] rounded-2xl border border-white/10 bg-[#111111] p-2 shadow-2xl md:hidden">
            {mobileNav.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-zinc-200 hover:bg-white/5" data-testid={`link-mobile-nav-${item.label.toLowerCase()}`}>
                  <Icon className="h-4 w-4 text-zinc-500" />
                  {item.label}
                </Link>
              );
            })}
            <div className="my-1 h-px bg-white/5" />
            <Link href="/categories/authors" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-zinc-200 hover:bg-white/5" data-testid="link-mobile-authors"><ArrowLeft className="h-4 w-4 text-zinc-500" />Author's Atrium</Link>
            <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-zinc-400 hover:bg-white/5" data-testid="button-mobile-logout"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        )}
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-[#0d0d0d]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-lg md:hidden" aria-label="Mobile navigation">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`focus-house flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium ${active ? 'text-[#3b82f6]' : 'text-zinc-500'}`} data-testid={`link-mobile-${item.label.toLowerCase()}`}>
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.7]'}`} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-[1240px] px-5 py-8 sm:px-8 lg:px-10 lg:pb-12">{children}</main>
    </div>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">{children}</p>;
}
