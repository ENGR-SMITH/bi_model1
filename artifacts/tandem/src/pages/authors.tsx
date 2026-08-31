import { ArrowRight, ArrowUpRight, BookOpen, Inbox, LockKeyhole, PenLine, Search, Users } from 'lucide-react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { SectionEyebrow } from '@/components/protected-shell';

export default function AuthorsPage() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';
  const firstName = user?.firstName || 'writer';

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col justify-between gap-5 lg:h-[calc(100dvh-170px)]">
      <div>
        <Link href="/dashboard" className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-zinc-500 hover:text-white" data-testid="link-authors-back-dashboard">
          <ArrowUpRight className="h-3.5 w-3.5 rotate-[225deg]" />
          Back to the atrium
        </Link>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-stretch">
          <div className="flex flex-col justify-center">
            <SectionEyebrow>Authors &amp; writers / the room</SectionEyebrow>
            <h1 className="mt-3 max-w-[9ch] text-5xl font-extrabold leading-[.9] tracking-[-0.07em] text-white sm:text-6xl">
              Your words have a room.
            </h1>
            <p className="mt-3 max-w-[30rem] text-sm leading-[1.7] text-zinc-400">
              Welcome in, {name}. This is where you write alone — and where the right second voice finds you.
            </p>
          </div>

          <div className="flex items-center">
            <div className="w-full rounded-[1.5rem] border-2 border-[#c7473c] bg-[#3b82f6] p-6 text-[#fff4e6] shadow-[10px_12px_0_rgba(41,43,69,0.12)]" data-testid="card-open-manuscript-studio">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-current"><PenLine className="h-5 w-5" /></span>
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#ffe6d7]">Your studio</span>
              </div>
              <h2 className="mt-6 max-w-[12ch] text-3xl font-extrabold leading-[.9] tracking-[-0.05em] sm:text-4xl">Open Manuscript Studio</h2>
              <p className="mt-2 max-w-[24rem] text-sm leading-relaxed text-[#ffe6d7]">
                Manuscripts, characters, world, plots, and scenes.
              </p>
              <a href="/authors-den/" className="focus-house mt-5 inline-flex items-center gap-3 rounded-full border border-[#fff4e6]/35 bg-[#111111]/10 px-5 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#111111]/20" data-testid="link-open-manuscript-studio">
                Open Authors Den
                <BookOpen className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">The collaboration room</span>
            <div className="h-px flex-1 bg-[#d6cbb9]" />
          </div>
          <p className="mt-2 font-display text-2xl italic text-white">Two voices. One room.</p>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
            <Link href="/authors/pitch-board" className="soft-lift focus-house group relative flex flex-col overflow-hidden rounded-[1.5rem] bg-[#111111] p-6 text-[#fff4e6]" data-testid="link-pitch-board">
              <span className="absolute -right-14 -top-14 h-40 w-40 rounded-full border border-[#f0c85c]/30 transition-transform duration-500 group-hover:scale-125" />
              <div className="flex items-center justify-between">
                <Search className="h-6 w-6 text-[#f0c85c]" />
                <span className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#f0c85c]">01 · The pitch board</span>
              </div>
              <h2 className="mt-4 max-w-[11ch] text-3xl font-extrabold leading-[.95] tracking-[-.05em]">Find a seed worth answering.</h2>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-[#d9d2cb]">Read the brief. Listen for the opening. Respond only when the work asks for your voice.</p>
              <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-[#3b82f6] px-4 py-2 text-xs font-bold">Browse seeds <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></span>
            </Link>
            <div className="grid gap-4">
              <Link href="/authors/collaborations/continuations" className="soft-lift focus-house group rounded-[1.25rem] border-2 border-white/10 bg-[#111111] p-5" data-testid="link-review-desk">
                <div className="flex items-center justify-between"><Inbox className="text-[#3e8074]" /><span className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-zinc-600">02</span></div>
                <h2 className="mt-3 font-display text-2xl italic">Your review desk</h2>
                <p className="mt-1 text-xs text-zinc-500">Continuations waiting on your eye, side by side with the seed that called them.</p>
              </Link>
              <Link href="/authors/work" className="soft-lift focus-house group rounded-[1.25rem] border-2 border-[#f0c85c] bg-[#f0c85c] p-5" data-testid="link-work-in-motion">
                <div className="flex items-center justify-between"><Users className="text-white" /><span className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-white/60">03</span></div>
                <h2 className="mt-3 font-display text-2xl italic">Work in motion</h2>
                <p className="mt-1 text-xs text-white/80">Solo pieces and Tandem projects, together in one room.</p>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-3 text-sm text-zinc-500">
        <LockKeyhole className="h-4 w-4 text-[#3b82f6]" />
        <span>Private by design · visible only to the people in the room · welcome, {firstName}</span>
      </div>
    </div>
  );
}
