import { ArrowUpRight, DoorOpen, Menu, X } from 'lucide-react';
import { Show } from '@clerk/react';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { Room } from '@/data/rooms';

const toneClasses: Record<Room['tone'], string> = {
  coral: 'bg-[#e55b4c] text-[#fff4e6] border-[#c7473c]',
  teal: 'bg-[#3e8074] text-[#fff4e6] border-[#2f675e]',
  gold: 'bg-[#e1b956] text-[#292b45] border-[#c49a38]',
  blue: 'bg-[#657a9c] text-[#fff4e6] border-[#4e6486]',
  plum: 'bg-[#75617f] text-[#fff4e6] border-[#5c4a66]',
};

export function TandemLogo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-3"
      data-testid="link-tandem-logo"
    >
      <span
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border-2 ${
          light ? 'border-[#fff4e6]' : 'border-[#292b45]'
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${light ? 'bg-[#f0c85c]' : 'bg-[#e55b4c]'}`} />
        <span className={`absolute h-2.5 w-2.5 translate-x-2.5 rounded-full ${light ? 'bg-[#8dc2ad]' : 'bg-[#3e8074]'}`} />
      </span>
      <span className={`text-[1.15rem] font-extrabold tracking-[-0.06em] ${light ? 'text-[#fff4e6]' : 'text-[#292b45]'}`}>
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
    <header className="relative z-30 mx-auto flex w-full max-w-[1240px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
      <TandemLogo />
      <nav className="hidden items-center gap-8 md:flex" aria-label="Primary navigation">
        <button type="button" onClick={goToRooms} className="text-sm font-semibold text-[#5e5b6b] transition-colors hover:text-[#e55b4c]" data-testid="button-nav-rooms">
          Explore rooms
        </button>
        <button type="button" onClick={goToMethod} className="text-sm font-semibold text-[#5e5b6b] transition-colors hover:text-[#e55b4c]" data-testid="button-nav-method">
          The method
        </button>
        <Link href="/room/engine" className="group flex items-center gap-2 text-sm font-semibold text-[#292b45]" data-testid="link-nav-engine">
          Start at the Engine
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
        <Show when="signed-out">
          <div className="flex items-center gap-2 border-l border-[#d6cbb9] pl-6">
            <Link href="/sign-in" className="rounded-full px-3 py-2 text-sm font-bold text-[#625f6d] transition-colors hover:bg-[#ebe0d0] hover:text-[#292b45]" data-testid="link-nav-login">
              Log in
            </Link>
            <Link href="/sign-up" className="rounded-full bg-[#e55b4c] px-4 py-2 text-sm font-bold text-[#fff4e6] transition-transform hover:-translate-y-0.5" data-testid="link-nav-signup">
              Sign up
            </Link>
          </div>
        </Show>
        <Show when="signed-in">
          <Link href="/dashboard" className="rounded-full bg-[#292b45] px-4 py-2 text-sm font-bold text-[#fff4e6] transition-transform hover:-translate-y-0.5" data-testid="link-nav-atrium">
            Open your atrium
          </Link>
        </Show>
      </nav>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-full border border-[#d6cbb9] p-2 text-[#292b45] md:hidden"
        aria-label={open ? 'Close menu' : 'Open menu'}
        data-testid="button-mobile-menu"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && (
        <div className="absolute left-5 right-5 top-[76px] rounded-2xl border border-[#d6cbb9] bg-[#fff4e6] p-3 shadow-xl md:hidden">
          <button type="button" onClick={goToRooms} className="block w-full rounded-xl px-4 py-3 text-left text-sm font-semibold hover:bg-[#f1e6d6]" data-testid="button-mobile-rooms">
            Explore rooms
          </button>
          <button type="button" onClick={goToMethod} className="block w-full rounded-xl px-4 py-3 text-left text-sm font-semibold hover:bg-[#f1e6d6]" data-testid="button-mobile-method">
            The method
          </button>
          <Link href="/room/engine" onClick={() => setOpen(false)} className="block rounded-xl bg-[#292b45] px-4 py-3 text-sm font-semibold text-[#fff4e6]" data-testid="link-mobile-engine">
            Start at the Engine
          </Link>
          <Show when="signed-out">
            <Link href="/sign-in" onClick={() => setOpen(false)} className="mt-2 block rounded-xl px-4 py-3 text-sm font-semibold hover:bg-[#f1e6d6]" data-testid="link-mobile-login">
              Log in
            </Link>
            <Link href="/sign-up" onClick={() => setOpen(false)} className="mt-1 block rounded-xl bg-[#e55b4c] px-4 py-3 text-sm font-semibold text-[#fff4e6]" data-testid="link-mobile-signup">
              Sign up
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard" onClick={() => setOpen(false)} className="mt-2 block rounded-xl bg-[#e55b4c] px-4 py-3 text-sm font-semibold text-[#fff4e6]" data-testid="link-mobile-atrium">
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
      className={`group relative block overflow-hidden rounded-[1.25rem] border-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-[8px_10px_0_rgba(41,43,69,0.18)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e1b956] ${toneClasses[room.tone]} ${compact ? 'min-h-[156px] p-5' : 'min-h-[208px] p-6 sm:p-7'}`}
      data-testid={`link-room-${room.slug}`}
    >
      <span className="absolute -right-5 -top-8 h-28 w-28 rounded-full border border-current opacity-20 transition-transform duration-500 group-hover:scale-125" />
      <span className="absolute bottom-4 right-5 flex h-8 w-8 items-center justify-center rounded-full border border-current opacity-70 transition-all group-hover:rotate-45 group-hover:opacity-100">
        <ArrowUpRight className="h-4 w-4" />
      </span>
      <div className="relative flex h-full min-h-[inherit] flex-col justify-between">
        <div className="flex items-start justify-between">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-current bg-black/5">
            <Icon className="h-5 w-5" strokeWidth={1.7} />
          </span>
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] opacity-75">
            {room.foundation ? '01 / 17' : `${String(Number(room.slug.length) % 16 + 2).padStart(2, '0')} / 17`}
          </span>
        </div>
        <div className="mt-8">
          <p className="mb-2 font-mono-ui text-[10px] uppercase tracking-[0.14em] opacity-75">{room.category}</p>
          <h3 className={`${compact ? 'text-xl' : 'text-[1.45rem]'} max-w-[14rem] font-extrabold leading-[1.05] tracking-[-0.05em]`}>
            {room.name}
          </h3>
          {!compact && <p className="mt-3 max-w-[17rem] text-sm leading-relaxed opacity-85">{room.description}</p>}
        </div>
      </div>
    </Link>
  );
}

export function DoorMark() {
  return (
    <span className="inline-flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
      <DoorOpen className="h-4 w-4" />
      A house for what happens between people
    </span>
  );
}