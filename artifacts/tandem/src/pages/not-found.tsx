import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#0a0a0a] px-4">
      <div className="card-surface w-full max-w-md rounded-2xl p-8 text-center sm:p-10">
        <span className="card-icon mx-auto h-14 w-14 rounded-xl border-[#3b82f6]/30">
          <Compass className="h-7 w-7 text-[#60a5fa]" strokeWidth={1.5} />
        </span>
        <p className="mt-7 font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">Door not found</p>
        <h1 className="mt-3 text-5xl font-bold leading-[.9] tracking-[-0.05em] text-white">The door moved.</h1>
        <p className="mt-4 text-sm leading-relaxed text-zinc-500">
          That page is not on Tandem's current blueprint. The house is still growing.
        </p>
        <Link
          href="/"
          className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#3b82f6] px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#2563eb] hover:shadow-[0_0_30px_-5px_rgba(59,130,246,0.5)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Return to the house
        </Link>
      </div>
    </div>
  );
}
