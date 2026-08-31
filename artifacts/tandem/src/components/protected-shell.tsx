import { useAuth, useClerk, useUser } from '@clerk/react';
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  Compass,
  Inbox,
  LayoutGrid,
  LogOut,
  Settings2,
  Ticket,
  UserRound,
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
      className="focus-house group flex items-center gap-3 rounded-full px-2 py-1.5 transition-colors hover:bg-white/5"
      data-testid="link-profile-chip"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] font-mono-ui text-[11px] font-medium uppercase text-white">
        {initials}
      </span>
      <span className="hidden text-left sm:block">
        <span className="block text-xs font-bold text-zinc-100" data-testid="text-user-name">{name}</span>
        <span className="block max-w-40 truncate text-[10px] text-zinc-500">{user?.primaryEmailAddress?.emailAddress || 'Tandem member'}</span>
      </span>
      <ChevronRight className="hidden h-4 w-4 text-zinc-600 sm:block" />
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
      <div className="mx-auto flex min-h-[100dvh] max-w-[1520px]">
        <aside className="hidden w-[244px] shrink-0 flex-col border-r border-white/5 bg-[#0d0d0d] px-6 py-7 lg:flex">
          <TandemLogo />
          <div className="mt-12">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">Private platform</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-white">The atrium</p>
          </div>
          <nav className="mt-10 space-y-1" aria-label="Private navigation">
            {desktopNav.map((item) => {
              const Icon = item.icon;
              const active = location === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`focus-house flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${active ? 'bg-[#3b82f6]/10 text-[#3b82f6]' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}
                  data-testid={`link-sidebar-${item.label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto">
            <div className="card-surface mb-5 rounded-2xl p-4">
              <Compass className="h-5 w-5 text-[#3b82f6]" strokeWidth={1.7} />
              <p className="mt-5 text-sm font-semibold text-zinc-100">Six doors lit.</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">The wider platform is still taking shape.</p>
            </div>
            <button type="button" onClick={logout} className="focus-house flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-100" data-testid="button-sidebar-logout">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-white/5 bg-[#0a0a0a]/90 px-5 backdrop-blur-md sm:px-8 lg:px-10">
            <div className="lg:hidden">
              <TandemLogo />
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <span className="h-2 w-2 rounded-full bg-[#34d399] glow-dot" />
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-500">Your corner of the platform</span>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/categories/authors" className="focus-house hidden items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 sm:flex" data-testid="link-header-authors">
                <ArrowLeft className="h-3.5 w-3.5" />
                Author's Atrium
              </Link>
              <UserChip />
              <button type="button" onClick={() => setMenuOpen((open) => !open)} className="focus-house rounded-full border border-white/10 p-2 lg:hidden" aria-label="Open profile menu" data-testid="button-mobile-profile-menu">
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
            {menuOpen && (
              <div className="absolute right-5 top-[68px] w-48 rounded-2xl border border-white/10 bg-[#111111] p-2 shadow-2xl lg:hidden">
                <Link href="/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-zinc-200 hover:bg-white/5" data-testid="link-mobile-profile"><UserRound className="h-4 w-4" />Profile & settings</Link>
                <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-zinc-400 hover:bg-white/5" data-testid="button-mobile-logout"><LogOut className="h-4 w-4" />Sign out</button>
              </div>
            )}
          </header>
          <main className="px-5 pb-28 pt-8 sm:px-8 sm:pt-10 lg:px-10 lg:pb-12">{children}</main>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-[#0d0d0d]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-lg lg:hidden" aria-label="Mobile navigation">
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
    </div>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">{children}</p>;
}
