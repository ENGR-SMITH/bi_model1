import { PiArrowLeftDuotone, PiChatCircleDuotone, PiHardHatDuotone } from 'react-icons/pi';
import { Link } from 'wouter';
import { SectionEyebrow } from '@/components/protected-shell';

export default function PhaseTwo({ title, eyebrow, description }: { title: string; eyebrow: string; description: string }) {
  return (
    <div className="mx-auto max-w-[920px]">
      <Link href="/categories/authors" className="focus-house group inline-flex items-center gap-2 rounded-full py-2 text-xs font-bold text-zinc-500 hover:text-white" data-testid="link-phase-two-back">
        <PiArrowLeftDuotone className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
        Back to Author&apos;s Atrium
      </Link>
      <div className="reveal mt-12 max-w-2xl">
        <span className="icon-chip h-14 w-14 text-[#3b82f6]"><PiHardHatDuotone className="h-6 w-6" /></span>
        <SectionEyebrow>{eyebrow} / phase 2</SectionEyebrow>
        <h1 className="mt-5 text-6xl font-extrabold leading-[.87] tracking-[-0.08em] text-white sm:text-8xl">{title}</h1>
        <p className="mt-7 max-w-xl text-base leading-[1.8] text-zinc-400">{description}</p>
      </div>
      <div className="reveal reveal-1 mt-14 flex max-w-2xl items-start gap-4 rounded-3xl border border-dashed border-white/15 bg-[#111111] p-6 sm:p-8">
        <PiChatCircleDuotone className="mt-1 h-5 w-5 shrink-0 text-[#3b82f6]" />
        <div>
          <p className="font-bold text-white">This room is being set for the next gathering.</p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">We&apos;re keeping it quiet until there&apos;s something useful to put on the table. Check back after the first room has found its rhythm.</p>
        </div>
      </div>
    </div>
  );
}