import { ArrowUpRight, Compass, Menu, X } from 'lucide-react';
import { Show } from '@clerk/react';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { Room } from '@/data/rooms';

const toneClasses: Record<Room['tone'], string> = {
  coral: 'bg-[#0a0a0c] text-[#fdfdfd] border-white/[0.12]',
  teal: 'bg-[#0a0a0c] text-[#fdfdfd] border-white/[0.1]',
  gold: 'bg-[#0a0a0c] text-[#fdfdfd] border-white/[0.1]',
  blue: 'bg-[#0a0a0c] text-[#fdfdfd] border-white/[0.1]',
  plum: 'bg-[#0a0a0c] text-[#fdfdfd] border-white/[0.1]',
};

export function TandemLogo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-2.5"
      data-testid="link-tandem-logo"
    >
      <span
        className={`relative flex h-6 w-6 items-center justify-center rounded-md border ${light ? 'border-white/30' : 'border-white/[0.16]'}`}
      >
        <span className="h-2 w-2 rounded-sm bg-white" />
        <span className="absolute h-2 w-2 translate-x-1.5 translate-y-1.5 rounded-sm bg-white/35" />
      </span>
      <span className={`text-[1.05rem] font-semibold tracking-[-0.035em] ${light ? 'text-white' : 'text-white'}`}>
        tandem
      </span>
    </Link>
  );
}

export function HouseNav() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  const goToRooms = () => {
    setOpen(false);
    if (window.location.pathname === '/') {
      document.getElementById('rooms')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setLocation('/#rooms');
    }
  };
  const goToMethod = () => {
    setOpen(false);
    if (window.location.pathname === '/') {
      document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setLocation('/#how-it-works');
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#000000]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[60px] w-full max-w-[1240px] items-center justify-between px-5 sm:px-8 lg:px-10">
        <TandemLogo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
          <button type="button" onClick={goToRooms} className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white" data-testid="button-nav-rooms">
            Explore rooms
          </button>
          <button type="button" onClick={goToMethod} className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white" data-testid="button-nav-method">
            The method
          </button>
          <Link href="/room/engine" className="group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:text-white" data-testid="link-nav-engine">
            Start at the Engine
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
          <Show when="signed-out">
            <div className="ml-4 flex items-center gap-2 border-l border-white/[0.1] pl-5">
              <Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white" data-testid="link-nav-login">
                Log in
              </Link>
              <Link href="/sign-up" className="rounded-lg bg-[#fdfdfd] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-zinc-200" data-testid="link-nav-signup">
                Sign up
              </Link>
            </div>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard" className="ml-4 rounded-lg bg-[#fdfdfd] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-zinc-200" data-testid="link-nav-atrium">
              Open your atrium
            </Link>
          </Show>
        </nav>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-white/10 p-2 text-white md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          data-testid="button-mobile-menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="absolute left-5 right-5 top-[76px] rounded-2xl border border-white/10 bg-[#111111] p-3 shadow-2xl md:hidden">
          <button type="button" onClick={goToRooms} className="block w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-white/5" data-testid="button-mobile-rooms">
            Explore rooms
          </button>
          <button type="button" onClick={goToMethod} className="block w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-white/5" data-testid="button-mobile-method">
            The method
          </button>
          <Link href="/room/engine" onClick={() => setOpen(false)} className="block rounded-xl bg-[#3b82f6]/10 px-4 py-3 text-sm font-medium text-[#3b82f6]" data-testid="link-mobile-engine">
            Start at the Engine
          </Link>
          <Show when="signed-out">
            <Link href="/sign-in" onClick={() => setOpen(false)} className="mt-2 block rounded-xl px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-white/5" data-testid="link-mobile-login">
              Log in
            </Link>
            <Link href="/sign-up" onClick={() => setOpen(false)} className="mt-1 block rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900" data-testid="link-mobile-signup">
              Sign up
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard" onClick={() => setOpen(false)} className="mt-2 block rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900" data-testid="link-mobile-atrium">
              Open your atrium
            </Link>
          </Show>
        </div>
      )}
    </header>
  );
}

export function RoomDoor({ room, compact = false }: { room: Room; compact?: boolean }) {
  const Icon = room.icon;
  return (
    <Link
      href={`/room/${room.slug}`}
      className={`group relative block overflow-hidden rounded-2xl border card-surface card-surface-hover transition-all duration-300 hover:-translate-y-1 hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] ${toneClasses[room.tone]} ${compact ? 'min-h-[156px] p-5' : 'min-h-[208px] p-6 sm:p-7'}`}
      data-testid={`link-room-${room.slug}`}
    >
      <span className="absolute -right-5 -top-8 h-28 w-28 rounded-full border border-white/5 opacity-20 transition-transform duration-500 group-hover:scale-125" />
      <span className="absolute bottom-4 right-5 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 opacity-50 transition-all group-hover:rotate-45 group-hover:border-[#3b82f6]/50 group-hover:opacity-100">
        <ArrowUpRight className="h-4 w-4" />
      </span>
      <div className="relative flex h-full min-h-[inherit] flex-col justify-between">
        <div className="relative flex items-start justify-between">
          <span className="card-icon h-12 w-12 rounded-xl border-white/15 shadow-[0_0_24px_-8px_rgba(59,130,246,0.45)]">
            <Icon className="h-[1.35rem] w-[1.35rem] text-[#93c5fd]" />
          </span>
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            {room.foundation ? '01 / 17' : `${String(Number(room.slug.length) % 16 + 2).padStart(2, '0')} / 17`}
          </span>
        </div>
        <div className="mt-8">
          <p className="mb-2 font-mono-ui text-[10px] uppercase tracking-[0.14em] text-zinc-500">{room.category}</p>
          <h3 className={`${compact ? 'text-xl' : 'text-[1.45rem]'} max-w-[14rem] font-bold leading-[1.05] tracking-[-0.03em] text-zinc-100`}>
            {room.name}
          </h3>
          {!compact && <p className="mt-3 max-w-[17rem] text-sm leading-relaxed text-zinc-400">{room.description}</p>}
        </div>
      </div>
    </Link>
  );
}

export function DoorMark() {
  return (
    <span className="inline-flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#3b82f6]">
      <Compass className="h-4 w-4" />
      A house for what happens between people
    </span>
  );
}
