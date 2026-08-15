import { ArrowUpRight, BookOpen, PenLine, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { SectionEyebrow } from '@/components/protected-shell';

export default function AuthorsPage() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';

  return (
    <div className="mx-auto max-w-[1080px]">
      <Link href="/dashboard" className="focus-house inline-flex items-center gap-2 rounded-full py-2 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-authors-back-dashboard">
        <ArrowUpRight className="h-3.5 w-3.5 rotate-[225deg]" />
        Back to the atrium
      </Link>
      <div className="reveal mt-10 grid gap-12 lg:grid-cols-[.9fr_1.1fr] lg:items-end">
        <div>
          <SectionEyebrow>Authors & writers / first light</SectionEyebrow>
          <h1 className="mt-5 max-w-[9ch] text-6xl font-extrabold leading-[.86] tracking-[-0.08em] text-[#292b45] sm:text-8xl">
            Your words have a room.
          </h1>
          <p className="mt-7 max-w-[28rem] text-base leading-[1.8] text-[#625f6d]">
            Welcome in, {name}. This is the first threshold of Tandem&apos;s author practice. The full studio is being prepared around the work itself, not around a blank dashboard.
          </p>
        </div>
        <div className="rounded-[1.75rem] border-2 border-[#c7473c] bg-[#e55b4c] p-7 text-[#fff4e6] shadow-[10px_12px_0_rgba(41,43,69,0.12)] sm:p-9">
          <div className="flex items-center justify-between">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-current"><PenLine className="h-5 w-5" /></span>
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#ffe6d7]">Room 01 / 06</span>
          </div>
          <h2 className="mt-16 max-w-[10ch] text-4xl font-extrabold leading-[.9] tracking-[-0.06em] sm:text-5xl">Open Manuscript Studio</h2>
          <p className="mt-4 max-w-[24rem] text-sm leading-relaxed text-[#ffe6d7]">
            The door is marked. Manuscripts, pitches, and collaboration will arrive here in the next phase.
          </p>
          <a href="/authors-den/" className="mt-8 inline-flex items-center gap-3 rounded-full border border-[#fff4e6]/35 bg-[#fff4e6]/10 px-5 py-3 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#fff4e6]/20" data-testid="link-open-manuscript-studio">
            Open Authors Den
            <BookOpen className="h-4 w-4" />
          </a>
        </div>
      </div>
      <div className="reveal reveal-1 mt-14 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-[#d6cbb9] bg-[#fff4e6] p-6">
          <Sparkles className="h-5 w-5 text-[#f0c85c]" />
          <p className="mt-8 font-display text-3xl italic text-[#292b45]">A place for the unfinished.</p>
          <p className="mt-3 text-sm leading-relaxed text-[#77717a]">Tandem will protect the route from first sentence to shared shape.</p>
        </div>
        <div className="rounded-2xl border-2 border-dashed border-[#cfc1b0] bg-[#f7eddf] p-6">
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">Coming in phase two</p>
          <p className="mt-8 font-display text-3xl italic text-[#292b45]">Manuscripts, pitches, and a real collaborator.</p>
          <p className="mt-3 text-sm leading-relaxed text-[#77717a]">This threshold is intentionally quiet until the tools are ready to hold your work well.</p>
        </div>
      </div>
    </div>
  );
}