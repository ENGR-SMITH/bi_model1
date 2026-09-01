import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="tandem-public flex min-h-[100dvh] items-center justify-center px-5">
      <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0b0b] p-8 shadow-2xl sm:p-10">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f973a8]/10 text-[#f973a8]">
          <AlertCircle className="h-5 w-5" />
        </span>
        <p className="mt-8 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-500">Tandem / lost route</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-white">That page isn&apos;t on the plan.</h1>
        <p className="mt-4 text-sm leading-relaxed text-zinc-500">The link may have moved, but the house is still here.</p>
        <Link href="/" className="focus-house mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Back to Tandem
        </Link>
      </section>
    </main>
  );
}
