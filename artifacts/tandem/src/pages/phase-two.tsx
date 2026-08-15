import { ArrowLeft, Construction, MessageCircle } from 'lucide-react';
import { Link } from 'wouter';
import { SectionEyebrow } from '@/components/protected-shell';

export default function PhaseTwo({ title, eyebrow, description }: { title: string; eyebrow: string; description: string }) {
  return (
    <div className="mx-auto max-w-[920px]">
      <Link href="/categories/authors" className="focus-house inline-flex items-center gap-2 rounded-full py-2 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-phase-two-back">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Author&apos;s Atrium
      </Link>
      <div className="reveal mt-12 max-w-2xl">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-[#d6cbb9] bg-[#e1b956] text-[#292b45]"><Construction className="h-6 w-6" strokeWidth={1.6} /></span>
        <SectionEyebrow>{eyebrow} / phase 2</SectionEyebrow>
        <h1 className="mt-5 text-6xl font-extrabold leading-[.87] tracking-[-0.08em] text-[#292b45] sm:text-8xl">{title}</h1>
        <p className="mt-7 max-w-xl text-base leading-[1.8] text-[#625f6d]">{description}</p>
      </div>
      <div className="reveal reveal-1 mt-14 flex max-w-2xl items-start gap-4 rounded-3xl border-2 border-dashed border-[#cfc1b0] bg-[#f7eddf] p-6 sm:p-8">
        <MessageCircle className="mt-1 h-5 w-5 shrink-0 text-[#e55b4c]" strokeWidth={1.6} />
        <div>
          <p className="font-bold text-[#292b45]">This room is being set for the next gathering.</p>
          <p className="mt-2 text-sm leading-relaxed text-[#77717a]">We&apos;re keeping it quiet until there&apos;s something useful to put on the table. Check back after the first room has found its rhythm.</p>
        </div>
      </div>
    </div>
  );
}