import { ArrowRight, Inbox as InboxIcon, MessageCircle } from 'lucide-react';
import { Link } from 'wouter';
import { SectionEyebrow } from '@/components/protected-shell';

export default function InboxPage() {
  return (
    <div className="mx-auto max-w-[900px]">
      <SectionEyebrow>Messages / inbox</SectionEyebrow>
      <h1 className="mt-5 max-w-[10ch] text-6xl font-extrabold leading-[.88] tracking-[-0.08em] text-[#292b45] sm:text-8xl">
        A quiet room.
      </h1>
      <div className="mt-12 rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7 shadow-[8px_10px_0_rgba(41,43,69,0.08)] sm:p-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3e8074] text-[#fff4e6]">
          <InboxIcon className="h-6 w-6" strokeWidth={1.6} />
        </div>
        <p className="mt-8 font-display text-4xl italic text-[#292b45]">No messages have found you.</p>
        <p className="mt-4 max-w-xl text-sm leading-[1.8] text-[#77717a]">
          When a room has something to say, invitations and collaboration notes will appear here. For now, the silence is part of the beginning.
        </p>
        <Link href="/dashboard" className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]" data-testid="link-inbox-dashboard">
          Visit the atrium
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-6 flex items-center gap-3 text-xs text-[#98909a]">
        <MessageCircle className="h-4 w-4 text-[#e55b4c]" />
        <span>Messages will stay human, specific, and tied to a room.</span>
      </div>
    </div>
  );
}