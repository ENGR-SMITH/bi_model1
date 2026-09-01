import { ArrowUpRight, ChevronDown, Compass, Menu, X } from 'lucide-react';
import { Show } from '@clerk/react';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { Room } from '@/data/rooms';

const toneClasses: Record<Room['tone'], string> = {
  coral: 'bg-[#1a1a2e] text-[#e2e8f0] border-[#3b82f6]/30',
  teal: 'bg-[#0f1729] text-[#e2e8f0] border-[#3b82f6]/20',
  gold: 'bg-[#1e1b2e] text-[#e2e8f0] border-[#8b5cf6]/30',
  blue: 'bg-[#0c1220] text-[#e2e8f0] border-[#3b82f6]/25',
  plum: 'bg-[#161025] text-[#e2e8f0] border-[#8b5cf6]/25',
};

export function TandemLogo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-2.5"
      data-testid="link-tandem-logo"
    >
      <span
        className={`tandem-mark relative flex h-8 w-8 items-center justify-center rounded-[9px] border ${light ? 'border-white/20' : 'border-white/10'}`}
      >
        <span className="h-2.5 w-2.5 rounded-[3px] bg-white transition-transform duration-300 group-hover:rotate-45" />
        <span className="absolute h-2.5 w-2.5 translate-x-1.5 translate-y-1.5 rounded-[3px] bg-[#f973a8] shadow-[0_0_18px_rgba(249,115,168,0.45)] transition-transform duration-300 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
      <span className={`text-[1.05rem] font-semibold tracking-[-0.05em] ${light ? 'text-white' : 'text-white'}`}>
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
    <header className="tandem-public-header sticky top-0 z-40 border-b border-white/[0.08] bg-[#050505]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] w-full max-w-[1180px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <TandemLogo />
        <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary navigation">
          <button type="button" onClick={goToRooms} className="tandem-public-link rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white" data-testid="button-nav-rooms">
            Explore rooms
          </button>
          <button type="button" onClick={goToMethod} className="tandem-public-link rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white" data-testid="button-nav-method">
            The method
          </button>
          <div className="group relative">
            <button type="button" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
              Tandem DNA <ChevronDown className="h-3.5 w-3.5 transition-transform group-hover:rotate-180" />
            </button>
            <div className="pointer-events-none absolute left-0 top-11 w-52 translate-y-1 rounded-xl border border-white/10 bg-[#111111] p-2 opacity-0 shadow-2xl transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
              <Link href="/room/engine" className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/5 hover:text-white">The Engine <ArrowUpRight className="h-3.5 w-3.5" /></Link>
              <button type="button" onClick={goToMethod} className="flex w-full rounded-lg px-3 py-2.5 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-white">How it works</button>
            </div>
          </div>
          <Link href="/room/engine" className="tandem-public-link group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white" data-testid="link-nav-engine">
            Start at the Engine <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
          <Show when="signed-out">
            <div className="ml-3 flex items-center gap-2 border-l border-white/10 pl-4">
              <Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white" data-testid="link-nav-login">
                Log in
              </Link>
              <Link href="/sign-up" className="tandem-button-primary rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200" data-testid="link-nav-signup">
                Sign up
              </Link>
            </div>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard" className="tandem-button-primary ml-3 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200" data-testid="link-nav-atrium">
              Open workspace
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
           <Link href="/room/engine" onClick={() => setOpen(false)} className="block rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black" data-testid="link-mobile-engine">
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
        <div className="flex items-start justify-between">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <Icon className="h-5 w-5 text-zinc-300" strokeWidth={1.7} />
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
