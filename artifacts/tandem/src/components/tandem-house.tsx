import { PiArrowUpRightDuotone, PiCompassRoseDuotone, PiListDuotone, PiMagicWandDuotone, PiXDuotone } from 'react-icons/pi';
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
      className="group inline-flex items-center gap-3"
      data-testid="link-tandem-logo"
    >
      <span
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border ${light ? 'border-white/20' : 'border-white/10'}`}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-[#3b82f6] glow-dot" />
        <span className="absolute h-2.5 w-2.5 translate-x-2.5 rounded-full bg-[#8b5cf6]/70" />
      </span>
      <span className={`text-[1.15rem] font-bold tracking-[-0.04em] ${light ? 'text-white' : 'text-white'}`}>
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
    <>
      {/* Left icon rail — desktop only. Collapsed by default; hover reveals tooltips. */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[72px] flex-col items-center gap-1 border-r border-white/5 bg-[#0a0a0a]/90 py-4 backdrop-blur-xl lg:flex" aria-label="Side navigation">
        <Link href="/" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 transition-colors hover:border-white/25" aria-label="Tandem home">
          <span className="relative flex h-5 w-5 items-center justify-center">
            <span className="h-2 w-2 rounded-full bg-[#3b82f6] glow-dot" />
            <span className="absolute h-2 w-2 translate-x-2 translate-y-1 rounded-full bg-[#8b5cf6]/70" />
          </span>
        </Link>
        <span className="my-1 h-px w-8 bg-white/10" />
        <button type="button" onClick={goToRooms} className="group/icon relative flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 transition-colors duration-200 hover:bg-white/5 hover:text-white" data-testid="button-nav-rooms">
          <PiCompassRoseDuotone className="h-5 w-5" />
          <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#161616] px-2.5 py-1.5 text-xs font-medium text-zinc-200 opacity-0 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)] transition-opacity duration-150 group-hover/icon:opacity-100">
            Explore rooms
          </span>
        </button>
        <button type="button" onClick={goToMethod} className="group/icon relative flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 transition-colors duration-200 hover:bg-white/5 hover:text-white" data-testid="button-nav-method">
          <PiMagicWandDuotone className="h-5 w-5" />
          <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#161616] px-2.5 py-1.5 text-xs font-medium text-zinc-200 opacity-0 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)] transition-opacity duration-150 group-hover/icon:opacity-100">
            The method
          </span>
        </button>
        <span className="flex-1" />
        <span aria-hidden="true" className="flex items-center gap-[3px] pb-1">
          <span className="h-1 w-1 rounded-full bg-[#3b82f6]" />
          <span className="h-1 w-1 rounded-full bg-[#8b5cf6]/80" />
        </span>
      </aside>

      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] w-full max-w-[1240px] items-center gap-4 px-4 sm:px-8 lg:px-10">
          <div className="lg:hidden">
            <TandemLogo />
          </div>
          <Link href="/" className="hidden lg:block">
            <span className="text-[1.15rem] font-bold tracking-[-0.04em] text-white">tandem</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/room/engine" className="group hidden items-center gap-2 rounded-full bg-gradient-to-b from-[#3b82f6] to-[#2563eb] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_24px_-8px_rgba(59,130,246,0.7)] transition-all duration-200 hover:shadow-[0_0_32px_-4px_rgba(59,130,246,0.9)] md:flex" data-testid="link-nav-engine">
              Start at the Engine
              <PiArrowUpRightDuotone className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <span aria-hidden="true" className="hidden items-center gap-[3px] md:flex">
              <span className="h-1 w-1 rounded-full bg-[#3b82f6]" />
              <span className="h-1 w-1 rounded-full bg-[#8b5cf6]/80" />
            </span>
            <Show when="signed-out">
              <Link href="/sign-in" className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-zinc-400 transition-colors duration-200 hover:bg-white/5 hover:text-white md:block" data-testid="link-nav-login">
                Log in
              </Link>
              <Link href="/sign-up" className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-[0_0_20px_-8px_rgba(255,255,255,0.4)] transition-all duration-200 hover:bg-zinc-100 md:block" data-testid="link-nav-signup">
                Sign up
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-[0_0_20px_-8px_rgba(255,255,255,0.4)] transition-all duration-200 hover:bg-zinc-100 md:block" data-testid="link-nav-atrium">
                Open your atrium
              </Link>
            </Show>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="rounded-xl border border-white/10 p-2 text-white transition-colors duration-200 hover:border-white/20 hover:bg-white/5 lg:hidden"
              aria-label={open ? 'Close menu' : 'Open menu'}
              data-testid="button-mobile-menu"
            >
              {open ? <PiXDuotone className="h-5 w-5" /> : <PiListDuotone className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {open && (
          <div className="absolute inset-x-4 top-[68px] rounded-2xl border border-white/10 bg-[#0d0d0d]/95 p-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_24px_60px_-20px_rgba(0,0,0,0.95),0_0_60px_-24px_rgba(59,130,246,0.5)] backdrop-blur-xl sm:inset-x-8 lg:hidden lg:inset-x-10">
            <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#3b82f6]/50 to-transparent" />
            <button type="button" onClick={goToRooms} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white" data-testid="button-mobile-rooms">
              <span className="font-mono-ui text-[10px] tracking-[0.14em] text-[#3b82f6]">01 /</span>
              Explore rooms
            </button>
            <button type="button" onClick={goToMethod} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white" data-testid="button-mobile-method">
              <span className="font-mono-ui text-[10px] tracking-[0.14em] text-[#3b82f6]">02 /</span>
              The method
            </button>
            <div className="my-1 h-px bg-white/5" />
            <Link href="/room/engine" onClick={() => setOpen(false)} className="group flex items-center justify-between rounded-xl bg-gradient-to-b from-[#3b82f6] to-[#2563eb] px-4 py-3 text-sm font-semibold text-white shadow-[0_0_24px_-8px_rgba(59,130,246,0.7)]" data-testid="link-mobile-engine">
              Start at the Engine
              <PiArrowUpRightDuotone className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <Show when="signed-out">
              <Link href="/sign-in" onClick={() => setOpen(false)} className="mt-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white" data-testid="link-mobile-login">
                Log in
              </Link>
              <Link href="/sign-up" onClick={() => setOpen(false)} className="mt-1 block rounded-xl bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-100" data-testid="link-mobile-signup">
                Sign up
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" onClick={() => setOpen(false)} className="mt-2 block rounded-xl bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-100" data-testid="link-mobile-atrium">
                Open your atrium
              </Link>
            </Show>
          </div>
        )}
      </header>
    </>
  );
}

export function RoomDoor({ room, compact = false }: { room: Room; compact?: boolean }) {
  const Icon = room.icon;
  return (
    <Link
      href={`/room/${room.slug}`}
      className={`group relative block overflow-hidden rounded-2xl border card-surface card-surface-hover transition-all duration-300 hover:-translate-y-1 hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] ${toneClasses[room.tone]} ${compact ? 'min-h-[156px] p-5' : 'min-h-[220px] p-6 sm:p-7'}`}
      data-testid={`link-room-${room.slug}`}
    >
      <span className="card-spot" />
      <span className="card-shine" />
      <span className="absolute -right-5 -top-8 h-28 w-28 rounded-full border border-white/5 opacity-20 transition-transform duration-500 group-hover:scale-125" />
      <span className="absolute bottom-4 right-5 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-zinc-300 opacity-50 transition-all duration-300 group-hover:rotate-45 group-hover:border-[#3b82f6]/50 group-hover:text-[#60a5fa] group-hover:opacity-100">
        <PiArrowUpRightDuotone className="h-4 w-4" />
      </span>
      <div className="relative flex h-full min-h-[inherit] flex-col justify-between">
        <div className="flex items-start justify-between">
          <span className="icon-chip h-12 w-12 text-[#e2e8f0]">
            <Icon className="h-6 w-6" />
          </span>
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            {room.foundation ? '01 / 17' : `${String(Number(room.slug.length) % 16 + 2).padStart(2, '0')} / 17`}
          </span>
        </div>
        <div className="mt-9">
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
      <PiCompassRoseDuotone className="h-4 w-4 animate-spin-slow" />
      A house for what happens between people
    </span>
  );
}
