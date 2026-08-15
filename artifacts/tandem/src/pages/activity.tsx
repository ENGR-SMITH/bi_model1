import { Activity as ActivityIcon, ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { SectionEyebrow } from '@/components/protected-shell';

export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-[900px]">
      <SectionEyebrow>Your trail / activity</SectionEyebrow>
      <h1 className="mt-5 max-w-[10ch] text-6xl font-extrabold leading-[.88] tracking-[-0.08em] text-[#292b45] sm:text-8xl">
        Nothing has moved yet.
      </h1>
      <div className="mt-12 rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7 shadow-[8px_10px_0_rgba(41,43,69,0.08)] sm:p-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#292b45] text-[#f0c85c]">
          <ActivityIcon className="h-6 w-6" strokeWidth={1.6} />
        </div>
        <p className="mt-8 font-display text-4xl italic text-[#292b45]">The house keeps the good kind of record.</p>
        <p className="mt-4 max-w-xl text-sm leading-[1.8] text-[#77717a]">
          Your contributions, reveals, and room openings will gather here once you start making in Tandem.
        </p>
        <Link href="/dashboard" className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#e55b4c] px-5 py-3 text-sm font-bold text-[#fff4e6]" data-testid="link-activity-dashboard">
          Find a room
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-6 flex items-center gap-3 text-xs text-[#98909a]">
        <Sparkles className="h-4 w-4 text-[#e1b956]" />
        <span>Activity becomes meaningful after your first contribution.</span>
      </div>
    </div>
  );
}