import { PiArrowUpRightDuotone, PiDownloadSimpleDuotone, PiFilmSlateDuotone, PiMicrophoneStageDuotone, PiPaletteDuotone, PiScissorsDuotone } from 'react-icons/pi';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { SectionEyebrow } from '@/components/protected-shell';

const LEGS = [
  { number: '01', role: 'Story Architect', studio: 'Selects & structure', icon: PiFilmSlateDuotone },
  { number: '02', role: 'Visual Editor', studio: 'Precision cutting', icon: PiScissorsDuotone },
  { number: '03', role: 'Sound Designer', studio: 'Restore & score', icon: PiMicrophoneStageDuotone },
  { number: '04', role: 'Motion & Color', studio: 'Finish & polish', icon: PiPaletteDuotone },
];

export default function ContentCreatorsPage() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col justify-between gap-5 lg:h-[calc(100dvh-170px)]">
      <div>
        <Link href="/dashboard" className="focus-house group inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-zinc-500 hover:text-white" data-testid="link-creators-back-dashboard">
          <PiArrowUpRightDuotone className="h-3.5 w-3.5 rotate-[225deg] transition-transform group-hover:-translate-x-1" />
          Back to the atrium
        </Link>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-stretch">
          <div className="flex flex-col justify-center">
            <SectionEyebrow>Content creators / the room</SectionEyebrow>
            <h1 className="mt-3 max-w-[10ch] text-5xl font-extrabold leading-[.9] tracking-[-0.07em] text-white sm:text-6xl">
              Your footage has a room.
            </h1>
            <p className="mt-3 max-w-[30rem] text-sm leading-[1.7] text-zinc-400">
              Welcome in, {name}. This is where raw footage becomes a publish-ready master — four roles, one relay, and the Lock keeps every frame in the vault until the Captain releases it.
            </p>
          </div>

          <div className="flex items-center">
            <div className="w-full rounded-[1.5rem] border border-[#3b82f6]/40 bg-gradient-to-br from-[#3b82f6]/15 to-transparent p-7" data-testid="card-open-creators-den">
              <div className="flex items-center justify-between">
                <span className="icon-chip h-12 w-12 text-[#60a5fa]"><PiFilmSlateDuotone className="h-6 w-6" /></span>
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-100">Your platform</span>
              </div>
              <h2 className="mt-7 max-w-[14ch] text-3xl font-extrabold leading-[.9] tracking-[-0.05em] sm:text-4xl">Open Creators Den</h2>
              <p className="mt-3 max-w-[24rem] text-sm leading-relaxed text-zinc-100">
                The locked room for pre-recorded video — selects, cut, sound, and finish studios.
              </p>
              <a href="/creators-den/" className="focus-house mt-6 inline-flex items-center gap-3 rounded-full border border-white/20 bg-[#111111]/10 px-5 py-2.5 text-sm font-bold text-zinc-100 transition-colors hover:bg-[#111111]/20" data-testid="link-open-creators-den">
                Open Creators Den
                <PiFilmSlateDuotone className="h-4 w-4" />
              </a>
              {(import.meta.env.VITE_AGENT_DOWNLOAD_URL as string | undefined) && (() => {
                const base = (import.meta.env.VITE_AGENT_DOWNLOAD_URL as string).trim().replace(/\.exe$/, '');
                const ext = navigator.userAgent.includes('Mac') ? '.dmg' : '.exe';
                return (
                  <a
                    href={`${base}${ext}`}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-house mt-3 inline-flex items-center gap-3 rounded-full border border-white/15 bg-transparent px-5 py-2.5 text-sm font-bold text-zinc-100 transition-colors hover:bg-[#111111]/10"
                    data-testid="link-download-desktop-agent"
                  >
                    <PiDownloadSimpleDuotone className="h-4 w-4" />
                    Desktop agent for large files
                  </a>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">The relay</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <p className="mt-2 font-display text-2xl italic text-white">Four roles. One locked timeline.</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {LEGS.map((leg) => {
              const Icon = leg.icon;
              return (
                <div key={leg.number} className="soft-lift group overflow-hidden rounded-[1.25rem] card-surface p-5" data-testid={`card-door-leg-${leg.number}`}>
                  <span className="card-spot" />
                  <div className="flex items-center justify-between">
                    <span className="icon-chip h-11 w-11 text-[#3b82f6]"><Icon className="h-5 w-5" /></span>
                    <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-600">{leg.number} / 04</span>
                  </div>
                  <p className="mt-5 font-mono-ui text-[9px] uppercase tracking-[0.16em] text-[#3b82f6]">{leg.studio}</p>
                  <p className="mt-1.5 font-display text-lg italic leading-none">{leg.role}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
