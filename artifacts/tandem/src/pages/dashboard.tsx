import { ArrowUpRight, Compass } from 'lucide-react';
import { useUser } from '@clerk/react';
import { Link } from 'wouter';
import { SectionEyebrow } from '@/components/protected-shell';
import { tandemCategories } from '@/data/categories';

// Premium dark theme — Resend/Framer inspired
const openDoorClass = 'border-[#3b82f6]/40 bg-gradient-to-br from-[#3b82f6]/15 to-transparent';
const doorClass: Record<string, string> = {
  teal: 'card-surface border-[#3b82f6]/20',
  gold: 'card-surface border-[#8b5cf6]/25',
  ink: 'card-surface',
  plum: 'card-surface border-[#8b5cf6]/20',
  blue: 'card-surface border-[#3b82f6]/25',
  coral: 'card-surface border-[#3b82f6]/30',
};
const doorIconClass = 'card-icon h-11 w-11';
const doorCardTitleClass = 'mt-2 max-w-[13ch] text-3xl font-bold leading-[.98] tracking-[-0.04em] text-zinc-100';

export default function Dashboard() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="tandem-page-header reveal flex flex-col justify-between gap-5 border-b border-white/5 pb-9 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>The private platform / {tandemCategories.length} rooms</SectionEyebrow>
          <h1 className="mt-5 max-w-[12ch] text-6xl font-bold leading-[.9] tracking-[-0.05em] text-white sm:text-8xl">Welcome, {name}.</h1>
        </div>
        <div className="max-w-sm border-l border-white/10 pl-5 text-sm leading-[1.8] text-zinc-400">
          <p>The platform is opening one room at a time. Start where your practice already has a pulse.</p>
        </div>
      </div>

      <div className="reveal reveal-1 mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {tandemCategories.map((category, index) => {
          const Icon = category.icon;
          const available = category.status === 'Available';
          return (
            <Link
              key={category.slug}
              href={`/categories/${category.slug}`}
              className={`soft-lift focus-house group relative min-h-[272px] overflow-hidden rounded-2xl border p-6 ${available ? openDoorClass + ' glow-accent' : doorClass[category.accent] ?? doorClass.ink}`}
              data-testid={`card-category-${category.slug}`}
            >
              <span className="absolute -right-10 -top-12 h-36 w-36 rounded-full border border-white/5 opacity-20 transition-transform duration-500 group-hover:scale-125" />
              <span className="absolute right-6 top-6 font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">{String(index + 1).padStart(2, '0')} / {String(tandemCategories.length).padStart(2, '0')}</span>
              <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className={doorIconClass}>
                    <Icon className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <span className={`rounded-full border border-current px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[0.13em] ${available ? 'badge-glow border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#60a5fa]' : 'border-white/10 bg-white/5 text-zinc-400'}`}>
                    {available ? 'Open now' : category.status}
                  </span>
                </div>
                <div className="mt-12">
                  <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">{available ? 'The first light' : 'On the blueprint'}</p>
                  <h2 className={doorCardTitleClass}>{category.name}</h2>
                  <p className="mt-3 max-w-[19rem] text-sm leading-relaxed text-zinc-400">{category.description}</p>
                </div>
                <span className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 opacity-75 transition-transform group-hover:rotate-45">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="reveal reveal-2 mt-16 grid gap-5 border-t border-white/5 pt-7 sm:grid-cols-[auto_1fr] sm:items-center">
        <Compass className="h-7 w-7 text-[#3b82f6]" strokeWidth={1.5} />
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-500">Every room starts with two. Tandem keeps the contribution visible, the connection human, and the strange route an idea took intact.</p>
      </div>
    </div>
  );
}
