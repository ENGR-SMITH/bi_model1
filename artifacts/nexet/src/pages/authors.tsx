import { PiArrowUpRightDuotone, PiBookOpenDuotone, PiCheckCircleDuotone, PiEyeDuotone, PiGhostDuotone, PiLockKeyDuotone, PiMegaphoneDuotone, PiPencilLineDuotone, PiPenNibDuotone, PiUsersThreeDuotone } from 'react-icons/pi';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';

// Each seat opens the Writers' Audition Arena already filtered to the matching
// writing role — Co-writer → CO_WRITER, and so on down the desk. Same relay
// logic as the Content Creators page: the room's own roles in one row, the
// cross-den doorway underneath.
const SEATS = [
  { number: '01', role: 'Co-writer', craft: 'Writes beside you', icon: PiUsersThreeDuotone, arenaRole: 'CO_WRITER' },
  { number: '02', role: 'Editor', craft: 'Shapes the draft', icon: PiPencilLineDuotone, arenaRole: 'EDITOR' },
  { number: '03', role: 'Beta reader', craft: 'Reads it cold', icon: PiEyeDuotone, arenaRole: 'BETA_READER' },
  { number: '04', role: 'Ghostwriter', craft: 'Writes in your voice', icon: PiGhostDuotone, arenaRole: 'GHOSTWRITER' },
  { number: '05', role: 'Proofreader', craft: 'Catches the last slips', icon: PiCheckCircleDuotone, arenaRole: 'PROOFREADER' },
];

export default function AuthorsPage() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';
  const firstName = user?.firstName || 'writer';

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col justify-between gap-5 lg:min-h-[calc(100dvh-170px)]">
      <div>
        <Link href="/dashboard" className="focus-house group inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-zinc-500 hover:text-white" data-testid="link-authors-back-dashboard">
          <PiArrowUpRightDuotone className="h-3.5 w-3.5 rotate-[225deg] transition-transform group-hover:-translate-x-1" />
          Back to the atrium
        </Link>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-stretch">
          <div className="flex flex-col justify-center">
            <h1 className="mt-3 max-w-[9ch] text-5xl font-extrabold leading-[.9] tracking-[-0.07em] text-white sm:text-6xl">
              Your words have a room.
            </h1>
            <p className="mt-3 max-w-[30rem] text-sm leading-[1.7] text-zinc-400">
              Welcome in, {name}. This is where you write alone — and where the right second voice finds you.
            </p>
          </div>

          <div className="flex items-center">
            <div className="w-full rounded-[1.5rem] border border-[#3b82f6]/40 bg-gradient-to-br from-[#3b82f6]/15 to-transparent p-7" data-testid="card-open-manuscript-studio">
              <div className="flex items-center justify-between">
                <span className="icon-chip h-12 w-12 text-[#60a5fa]"><PiPenNibDuotone className="h-6 w-6" /></span>
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-100">Your studio</span>
              </div>
              <h2 className="mt-7 max-w-[12ch] text-3xl font-extrabold leading-[.9] tracking-[-0.05em] sm:text-4xl">Open Manuscript Studio</h2>
              <p className="mt-3 max-w-[24rem] text-sm leading-relaxed text-zinc-100">
                Manuscripts, characters, world, plots, and scenes.
              </p>
              <a href="/authors-den/" className="focus-house mt-6 inline-flex items-center gap-3 rounded-full border border-white/20 bg-[#111111]/10 px-5 py-2.5 text-sm font-bold text-zinc-100 transition-colors hover:bg-[#111111]/20" data-testid="link-open-manuscript-studio">
                Open Authors Den
                <PiBookOpenDuotone className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">The writing room</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <p className="mt-2 font-display text-2xl italic text-white">Five seats. One manuscript.</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {SEATS.map((seat) => {
              const Icon = seat.icon;
              return (
                <a
                  key={seat.arenaRole}
                  href={`/authors-den/?arena=1&role=${seat.arenaRole}`}
                  className="soft-lift group overflow-hidden rounded-[1.25rem] card-surface p-5 transition-colors hover:border-[#3b82f6]/50"
                  data-testid={`card-door-seat-${seat.number}`}
                >
                  <span className="card-spot" />
                  <div className="flex items-center justify-between">
                    <span className="icon-chip h-11 w-11 text-[#3b82f6]"><Icon className="h-5 w-5" /></span>
                    <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-600">{seat.number} / 05</span>
                  </div>
                  <p className="mt-5 font-mono-ui text-[9px] uppercase tracking-[0.16em] text-[#3b82f6]">{seat.craft}</p>
                  <p className="mt-1.5 font-display text-lg italic leading-none">{seat.role}</p>
                </a>
              );
            })}
          </div>
        </div>
      </div>

      {/* The collaboration doorway — writers can audition for open writing roles
          straight from the category page. */}
      <div className="mt-8">
        <div className="flex items-center gap-4">
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#a78bfa]">Beyond your desk</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <a
          href="/authors-den/?arena=1"
          className="focus-house soft-lift mt-4 flex flex-col justify-between gap-6 overflow-hidden rounded-[1.5rem] border border-[#a78bfa]/40 bg-gradient-to-br from-[#a78bfa]/15 to-transparent p-7 sm:flex-row sm:items-center"
          data-testid="card-arena-category"
        >
          <div className="flex items-start gap-4">
            <span className="icon-chip h-12 w-12 shrink-0 text-[#c4b5fd]"><PiMegaphoneDuotone className="h-6 w-6" /></span>
            <div>
              <h2 className="max-w-[16ch] text-3xl font-extrabold leading-[.95] tracking-[-0.05em] text-white sm:text-4xl">Writers&apos; Audition Arena</h2>
              <p className="mt-2 max-w-[34rem] text-sm leading-relaxed text-zinc-300">
                Authors across the Den post open seats — co-writers, editors, beta readers and more. Read the frozen
                brief, audition with your voice, and let the work choose its second voice.
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-3 rounded-full border border-[#a78bfa]/50 bg-[#111111]/20 px-5 py-2.5 text-sm font-bold text-zinc-100 transition-colors hover:bg-[#a78bfa]/20">
            Browse open auditions
            <PiArrowUpRightDuotone className="h-4 w-4" />
          </span>
        </a>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/5 pt-4 text-sm text-zinc-500">
          <PiLockKeyDuotone className="h-4 w-4 text-[#3b82f6]" />
          <span>Private by design · visible only to the people in the room · welcome, {firstName}</span>
        </div>
      </div>
    </div>
  );
}
