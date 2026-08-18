import { ArrowUpRight, Clapperboard, Film, Mic2, Palette, Scissors } from 'lucide-react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { SectionEyebrow } from '@/components/protected-shell';

const LEGS = [
  { number: '01', role: 'Story Architect', studio: 'Selects & structure', icon: Film },
  { number: '02', role: 'Visual Editor', studio: 'Precision cutting', icon: Scissors },
  { number: '03', role: 'Sound Designer', studio: 'Restore & score', icon: Mic2 },
  { number: '04', role: 'Motion & Color', studio: 'Finish & polish', icon: Palette },
];

export default function ContentCreatorsPage() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col justify-between gap-5 lg:h-[calc(100dvh-170px)]">
      <div>
        <Link href="/dashboard" className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-creators-back-dashboard">
          <ArrowUpRight className="h-3.5 w-3.5 rotate-[225deg]" />
          Back to the atrium
        </Link>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-stretch">
          <div className="flex flex-col justify-center">
            <SectionEyebrow>Content creators / the room</SectionEyebrow>
            <h1 className="mt-3 max-w-[10ch] text-5xl font-extrabold leading-[.9] tracking-[-0.07em] text-[#292b45] sm:text-6xl">
              Your footage has a room.
            </h1>
            <p className="mt-3 max-w-[30rem] text-sm leading-[1.7] text-[#625f6d]">
              Welcome in, {name}. This is where raw footage becomes a publish-ready master — four roles, one relay, and the Lock keeps every frame in the vault until the Captain releases it.
            </p>
          </div>

          <div className="flex items-center">
            <div className="w-full rounded-[1.5rem] border-2 border-[#c7473c] bg-[#e55b4c] p-6 text-[#fff4e6] shadow-[10px_12px_0_rgba(41,43,69,0.12)]" data-testid="card-open-creators-den">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-current"><Clapperboard className="h-5 w-5" /></span>
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#ffe6d7]">Your platform</span>
              </div>
              <h2 className="mt-6 max-w-[14ch] text-3xl font-extrabold leading-[.9] tracking-[-0.05em] sm:text-4xl">Open Creators Den</h2>
              <p className="mt-2 max-w-[24rem] text-sm leading-relaxed text-[#ffe6d7]">
                The locked room for pre-recorded video — selects, cut, sound, and finish studios.
              </p>
              <a href="/creators-den/" className="focus-house mt-5 inline-flex items-center gap-3 rounded-full border border-[#fff4e6]/35 bg-[#fff4e6]/10 px-5 py-2.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#fff4e6]/20" data-testid="link-open-creators-den">
                Open Creators Den
                <Clapperboard className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">The relay</span>
            <div className="h-px flex-1 bg-[#d6cbb9]" />
          </div>
          <p className="mt-2 font-display text-2xl italic text-[#292b45]">Four roles. One locked timeline.</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {LEGS.map((leg) => {
              const Icon = leg.icon;
              return (
                <div key={leg.number} className="soft-lift rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-4" data-testid={`card-door-leg-${leg.number}`}>
                  <div className="flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#292b45] text-[#f0c85c]"><Icon className="h-4 w-4" /></span>
                    <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-[#98909a]">{leg.number} / 04</span>
                  </div>
                  <p className="mt-4 font-mono-ui text-[9px] uppercase tracking-[0.16em] text-[#e55b4c]">{leg.studio}</p>
                  <p className="mt-1 font-display text-lg italic leading-none">{leg.role}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
