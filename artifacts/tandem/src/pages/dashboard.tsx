import { PiArrowUpRightDuotone, PiCompassRoseDuotone } from 'react-icons/pi';
import { useUser } from '@clerk/react';
import { Link } from 'wouter';
import { tandemCategories } from '@/data/categories';

// Premium dark theme — Resend/Framer inspired
const openDoorClass = 'border-[#3b82f6]/40 bg-gradient-to-br from-[#3b82f6]/15 to-transparent';
const doorClass: Record<string, string> = {
  teal: 'card-surface border-teal-400/20',
  gold: 'card-surface border-amber-400/25',
  ink: 'card-surface',
  plum: 'card-surface border-purple-400/20',
  blue: 'card-surface border-sky-400/25',
  coral: 'card-surface border-rose-400/30',
};
const doorIconTone: Record<string, string> = {
  teal: 'text-teal-300',
  gold: 'text-amber-300',
  ink: 'text-zinc-300',
  plum: 'text-purple-300',
  blue: 'text-sky-300',
  coral: 'text-rose-300',
};
const doorCardTitleClass = 'mt-6 max-w-[13ch] text-3xl font-bold leading-[.98] tracking-[-0.04em] text-zinc-100';

export default function Dashboard() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';

  return (
    <div className="mx-auto max-w-[1320px]">
      <div className="reveal flex flex-col justify-between gap-6 border-b border-white/5 pb-10 md:flex-row md:items-end">
        <div>
          <h1 className="mt-5 max-w-[12ch] text-6xl font-bold leading-[.9] tracking-[-0.05em] text-white sm:text-8xl">Welcome, {name}.</h1>
        </div>
        {/* The footer-card treatment, moved up beside the welcome line. */}
        <div className="grid max-w-md gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <PiCompassRoseDuotone className="h-7 w-7 animate-spin-slow text-[#3b82f6]" />
          <p className="text-sm leading-relaxed text-zinc-500">Every room starts with two. Tandem keeps the contribution visible, the connection human, and the strange route an idea took intact.</p>
        </div>
      </div>

      <div className="reveal reveal-1 mt-14 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {tandemCategories.map((category, index) => {
          const Icon = category.icon;
          const available = category.status === 'Available';
          return (
            <Link
              key={category.slug}
              href={`/categories/${category.slug}`}
              className={`soft-lift focus-house group relative min-h-[300px] overflow-hidden rounded-3xl border p-7 ${available ? openDoorClass + ' glow-accent' : doorClass[category.accent] ?? doorClass.ink}`}
              data-testid={`card-category-${category.slug}`}
            >
              {/* hover spotlight + shine sweep */}
              <span className="card-spot" />
              <span className="card-shine" />
              <span className="absolute -right-10 -top-12 h-36 w-36 rounded-full border border-white/5 opacity-20 transition-transform duration-500 group-hover:scale-125" />
              <span className="absolute right-7 top-7 font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">{String(index + 1).padStart(2, '0')} / {String(tandemCategories.length).padStart(2, '0')}</span>
              <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className={`icon-chip h-14 w-14 ${available ? 'text-[#60a5fa]' : doorIconTone[category.accent] ?? 'text-zinc-300'}`}>
                    <Icon className="h-7 w-7" />
                  </span>
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono-ui text-[9px] uppercase tracking-[0.13em] ${available ? 'badge-glow border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#60a5fa]' : 'border-white/10 bg-white/5 text-zinc-400'}`}>
                    {available && <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-[#3b82f6] glow-dot" />}
                    {available ? 'Open now' : category.status}
                  </span>
                </div>
                <div className="mt-14">
                  <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">{available ? 'The first light' : 'On the blueprint'}</p>
                  <h2 className={doorCardTitleClass}>{category.name}</h2>
                  <p className="mt-4 max-w-[19rem] text-sm leading-relaxed text-zinc-400">{category.description}</p>
                </div>
                <span className="absolute bottom-0 right-0 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-zinc-300 opacity-80 transition-all duration-300 group-hover:rotate-45 group-hover:border-[#3b82f6]/60 group-hover:text-[#60a5fa]">
                  <PiArrowUpRightDuotone className="h-4 w-4" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Footer card — a quiet closing note with the way into the foundation. */}
      <div className="reveal reveal-2 mt-16 overflow-hidden rounded-3xl border border-[#3b82f6]/25 bg-gradient-to-br from-[#3b82f6]/10 to-transparent p-7 sm:p-9">
        <span className="card-spot" />
        <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-start gap-5">
            <span className="icon-chip h-12 w-12 shrink-0 text-[#60a5fa]">
              <PiCompassRoseDuotone className="h-6 w-6 animate-spin-slow" />
            </span>
            <div>
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#3b82f6]">A blueprint for a new kind of making</p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                The Engine is being built first — the other doors are already on the blueprint, waiting for their first lights. Every room starts with two.
              </p>
            </div>
          </div>
          <Link
            href="/room/engine"
            className="focus-house group inline-flex shrink-0 items-center gap-2 rounded-full bg-[#3b82f6] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#2563eb] hover:shadow-[0_0_30px_-5px_rgba(59,130,246,0.5)]"
            data-testid="link-dashboard-footer-engine"
          >
            Visit the foundation
            <PiArrowUpRightDuotone className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
