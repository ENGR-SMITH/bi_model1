import { useAuth, useClerk, useUser } from '@clerk/react';
import {
  PiChartLineUpDuotone,
  PiListDuotone,
  PiSignOutDuotone,
  PiSquaresFourDuotone,
  PiTicketDuotone,
  PiTrayDuotone,
  PiUserCircleDuotone,
  PiXDuotone,
} from 'react-icons/pi';
import { type ReactNode, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { TandemLogo } from '@/components/tandem-house';

const desktopNav = [
  { href: '/dashboard', label: 'Atrium', icon: PiSquaresFourDuotone },
  { href: '/activity', label: 'Activity', icon: PiChartLineUpDuotone },
  { href: '/inbox', label: 'Inbox', icon: PiTrayDuotone },
  { href: '/subscriptions', label: 'Subscriptions', icon: PiTicketDuotone },
];

const mobileNav = [
  { href: '/dashboard', label: 'Atrium', icon: PiSquaresFourDuotone },
  { href: '/activity', label: 'Activity', icon: PiChartLineUpDuotone },
  { href: '/inbox', label: 'Inbox', icon: PiTrayDuotone },
  { href: '/subscriptions', label: 'Subscriptions', icon: PiTicketDuotone },
  { href: '/profile', label: 'Profile', icon: PiUserCircleDuotone },
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
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] font-mono-ui text-[10px] font-medium uppercase text-white shadow-[0_0_18px_-4px_rgba(59,130,246,0.7)]">
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
      {/* Floating pill nav — same treatment as the home page's HouseNav: the
          bar is a rounded, blurred, border-lit card floating under the top
          edge instead of a full-width strip. */}
      <header className="sticky top-0 z-30">
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-3 sm:px-5 sm:pt-4 lg:px-6">
          <div className="relative flex h-[72px] items-center gap-4 rounded-2xl border border-white/10 bg-[#0d0d0d]/85 px-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_12px_40px_-16px_rgba(0,0,0,0.9),0_0_50px_-20px_rgba(59,130,246,0.45)] backdrop-blur-xl sm:px-5">
            <span className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#3b82f6]/40 to-transparent" />
            <TandemLogo />

            {/* Desktop nav — home-style text tabs with the gradient underline */}
            <nav className="hidden min-w-0 flex-1 items-center gap-1 md:flex" aria-label="Private navigation">
              {desktopNav.map((item) => {
                const Icon = item.icon;
                const active = location === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`focus-house group relative flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${active ? 'text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                    data-testid={`link-nav-${item.label.toLowerCase()}`}
                  >
                    <Icon className={`h-4 w-4 ${active ? 'text-[#60a5fa]' : 'text-zinc-500 group-hover:text-zinc-200'}`} />
                    {item.label}
                    <span className={`absolute inset-x-4 bottom-0.5 h-px bg-gradient-to-r from-[#3b82f6]/80 to-[#8b5cf6]/80 transition-opacity duration-200 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                  </Link>
                );
              })}
            </nav>

            {/* Right cluster — user chip, sign out */}
            <div className="ml-auto flex items-center gap-2">
              <UserChip />
              <button type="button" onClick={logout} className="focus-house group hidden items-center gap-2 rounded-full border border-red-500/40 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:border-red-400 hover:bg-red-500/10 hover:text-red-300 sm:flex" data-testid="button-header-logout">
                <PiSignOutDuotone className="h-3.5 w-3.5 text-red-400 transition-transform group-hover:-translate-x-0.5 group-hover:translate-y-0.5" />
                Sign out
              </button>
              <button type="button" onClick={() => setMenuOpen((open) => !open)} className="focus-house rounded-lg border border-white/10 p-2 md:hidden" aria-label="Open menu" data-testid="button-mobile-profile-menu">
                {menuOpen ? <PiXDuotone className="h-4 w-4" /> : <PiListDuotone className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Mobile dropdown menu — same card treatment as the home page */}
          {menuOpen && (
            <div className="absolute inset-x-4 top-[88px] rounded-2xl border border-white/10 bg-[#0d0d0d]/95 p-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_24px_60px_-20px_rgba(0,0,0,0.95),0_0_60px_-24px_rgba(59,130,246,0.5)] backdrop-blur-xl sm:inset-x-8 md:hidden lg:inset-x-10">
              <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#3b82f6]/50 to-transparent" />
              {mobileNav.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white" data-testid={`link-mobile-nav-${item.label.toLowerCase()}`}>
                    <Icon className="h-4 w-4 text-zinc-500" />
                    {item.label}
                  </Link>
                );
              })}
              <div className="my-1 h-px bg-white/5" />
              <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-white/5 hover:text-red-300" data-testid="button-mobile-logout"><PiSignOutDuotone className="h-4 w-4 text-red-400" />Sign out</button>
            </div>
          )}
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-[#0d0d0d]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-lg md:hidden" aria-label="Mobile navigation">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`focus-house flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium ${active ? 'text-[#3b82f6]' : 'text-zinc-500'}`} data-testid={`link-mobile-${item.label.toLowerCase()}`}>
                <Icon className={`h-5 w-5 ${active ? 'text-[#3b82f6]' : 'text-zinc-500'}`} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-[1400px] px-4 py-10 sm:px-5 lg:px-6 lg:pb-14">{children}</main>
    </div>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">{children}</p>;
}
