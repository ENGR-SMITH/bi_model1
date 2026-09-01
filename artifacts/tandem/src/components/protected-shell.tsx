import { useAuth, useClerk, useUser } from '@clerk/react';
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  Inbox,
  LayoutGrid,
  LogOut,
  Menu,
  Settings,
  Ticket,
  UserRound,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { TandemLogo } from '@/components/tandem-house';

const desktopNav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutGrid },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/subscriptions', label: 'Billing', icon: Ticket },
];

const mobileNav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutGrid },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/subscriptions', label: 'Billing', icon: Ticket },
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
      className="focus-house group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-white/5"
      data-testid="link-profile-chip"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] font-mono-ui text-[8px] font-medium uppercase text-white">
        {initials}
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-[10px] font-semibold text-zinc-100" data-testid="text-user-name">{name}</span>
        <span className="block truncate text-[8px] text-zinc-500">{user?.primaryEmailAddress?.emailAddress || 'Tandem member'}</span>
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
    <div className="resend-app min-h-[100dvh] bg-[#000000] text-zinc-100">
      <aside className="resend-sidebar fixed inset-y-0 left-0 z-40 hidden w-[132px] flex-col border-r border-white/[0.08] bg-[#050505] px-2 py-3 md:flex">
        <div className="px-2 pb-4">
          <TandemLogo />
        </div>
        <button type="button" className="focus-house mb-4 flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-2 text-left transition-colors hover:bg-white/[0.06]" aria-label="Current workspace">
          <span>
            <span className="block text-[11px] font-semibold text-white">Tandem</span>
            <span className="mt-0.5 block truncate text-[9px] text-zinc-500">Creative workspace</span>
          </span>
          <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-zinc-500" />
        </button>
        <p className="px-2 pb-1.5 text-[8px] font-medium uppercase tracking-[0.12em] text-zinc-600">Workspace</p>
        <nav className="space-y-0.5" aria-label="Private navigation">
          {desktopNav.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`focus-house flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] font-medium transition-colors ${active ? 'bg-white/[0.09] text-white' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'}`}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                <Icon className="h-3 w-3 shrink-0" strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-5 border-t border-white/[0.08] pt-4">
          <p className="px-2 pb-1.5 text-[8px] font-medium uppercase tracking-[0.12em] text-zinc-600">Rooms</p>
          <Link href="/categories/authors" className="focus-house flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100" data-testid="link-header-authors">
            <ArrowLeft className="h-3 w-3 shrink-0" />
            <span className="truncate">Author's Atrium</span>
          </Link>
        </div>
        <div className="mt-auto border-t border-white/[0.08] pt-2">
          <UserChip />
          <Link href="/profile" className="focus-house mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200"><Settings className="h-3 w-3" />Settings</Link>
          <button type="button" onClick={logout} className="focus-house mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[10px] text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200" data-testid="button-header-logout">
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-h-[100dvh] md:pl-[132px]">
        <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#000000]/90 backdrop-blur-xl">
          <div className="flex h-[32px] items-center justify-end px-3 sm:px-5">
            <div className="flex items-center gap-2">
              <Link href="/#how-it-works" className="hidden rounded-md px-2 py-1 text-[9px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white sm:block">Docs</Link>
              <Link href="/#how-it-works" className="rounded-md border border-white/[0.08] px-2 py-1 text-[9px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">Need help?</Link>
              <button type="button" onClick={() => setMenuOpen((open) => !open)} className="focus-house rounded-lg border border-white/[0.1] p-2 text-zinc-300 md:hidden" aria-label={menuOpen ? 'Close menu' : 'Open menu'} data-testid="button-mobile-profile-menu">
                {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {menuOpen && (
            <div className="absolute inset-x-3 top-[68px] rounded-xl border border-white/[0.1] bg-[#0a0a0c] p-2 shadow-2xl md:hidden">
              {mobileNav.map((item) => {
                const Icon = item.icon;
                return <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06]" data-testid={`link-mobile-nav-${item.label.toLowerCase()}`}><Icon className="h-4 w-4 text-zinc-500" />{item.label}</Link>;
              })}
              <div className="my-1 h-px bg-white/[0.08]" />
              <Link href="/categories/authors" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06]" data-testid="link-mobile-authors"><ArrowLeft className="h-4 w-4 text-zinc-500" />Author's Atrium</Link>
              <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-500 hover:bg-white/[0.06]" data-testid="button-mobile-logout"><LogOut className="h-4 w-4" />Sign out</button>
            </div>
          )}
        </header>
         <main className="mx-auto max-w-[640px] px-5 py-5 sm:px-5 lg:pb-10">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-[#050505]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return <Link key={item.href} href={item.href} className={`focus-house flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium ${active ? 'text-[#3b82f6]' : 'text-zinc-500'}`} data-testid={`link-mobile-${item.label.toLowerCase()}`}><Icon className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.7]'}`} />{item.label}</Link>;
          })}
        </div>
      </nav>
    </div>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">{children}</p>;
}
