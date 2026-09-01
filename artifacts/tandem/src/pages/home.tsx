import { PiArrowUpRightDuotone, PiEyeDuotone, PiMagicWandDuotone, PiSparkleDuotone, PiStackDuotone } from 'react-icons/pi';
import { Link } from 'wouter';
import { HouseNav, RoomDoor, TandemLogo } from '@/components/tandem-house';
import { roomGroups, rooms } from '@/data/rooms';

function PlatformDiagram() {
  return (
    <div className="relative mx-auto w-full max-w-[510px] rounded-2xl border border-white/10 bg-[#0d0d0d] p-3 shadow-[0_0_60px_-15px_rgba(59,130,246,0.2)] sm:p-5">
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-white/5 to-transparent" />
      <div className="relative grid h-full grid-cols-2 grid-rows-3 gap-2 sm:gap-3">
        <div className="col-span-2 flex items-center justify-between rounded-xl border border-[#3b82f6]/30 bg-gradient-to-br from-[#3b82f6]/15 to-transparent p-4 sm:p-6">
          <div>
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.18em] text-zinc-500">The foundation</p>
            <p className="mt-2 max-w-[13rem] text-[2rem] font-semibold leading-[.9] text-white sm:text-[2.8rem]">The Engine</p>
          </div>
          <span className="icon-chip h-11 w-11 animate-float-slow text-[#60a5fa] sm:h-14 sm:w-14">
            <PiStackDuotone className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
        </div>
        <div className="card-surface flex flex-col justify-between rounded-xl p-3 sm:p-5">
          <span className="font-mono-ui text-[9px] uppercase tracking-[0.18em] text-zinc-500">Room 02</span>
          <span className="mt-2 text-[1.75rem] font-semibold leading-[.9] text-zinc-100 sm:text-[2.3rem]">Make</span>
        </div>
        <div className="card-surface flex flex-col justify-between rounded-xl p-3 sm:p-5">
          <span className="font-mono-ui text-[9px] uppercase tracking-[0.18em] text-zinc-500">Room 03</span>
          <span className="mt-2 text-[1.75rem] font-semibold leading-[.9] text-zinc-100 sm:text-[2.3rem]">Meet</span>
        </div>
        <div className="card-surface flex flex-col justify-between rounded-xl p-3 sm:p-5">
          <span className="font-mono-ui text-[9px] uppercase tracking-[0.18em] text-zinc-500">Room 04</span>
          <span className="mt-2 text-[1.75rem] font-semibold leading-[.9] text-zinc-100 sm:text-[2.3rem]">Play</span>
        </div>
        <div className="relative card-surface flex flex-col justify-between rounded-xl p-3 sm:p-5">
          <span className="font-mono-ui text-[9px] uppercase tracking-[0.18em] text-zinc-500">Room 05</span>
          <span className="mt-2 text-[1.75rem] font-semibold leading-[.9] text-zinc-100 sm:text-[2.3rem]">Wonder</span>
          <span className="absolute bottom-3 right-3 h-5 w-5 animate-breathe rounded-full border border-[#8b5cf6]/40 shadow-[0_0_14px_-2px_rgba(139,92,246,0.5)] sm:bottom-5 sm:right-5 sm:h-8 sm:w-8" />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-[100dvh] overflow-x-clip bg-[#0a0a0a] lg:pl-[72px]">
      <div className="hero-glow absolute inset-x-0 top-0 h-[600px]" />
      <HouseNav />
      <section className="relative mx-auto max-w-[1400px] px-4 pb-20 pt-12 sm:px-6 sm:pt-20 lg:px-8 lg:pb-32 lg:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_.98fr] lg:gap-10">
          <div className="reveal max-w-[670px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#3b82f6]/30 bg-[#3b82f6]/10 px-3 py-1.5">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-[#3b82f6] glow-dot" />
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#60a5fa]">A platform for creative connection</span>
            </div>
            <h1 className="mt-7 max-w-[12ch] text-[4.4rem] font-bold leading-[.92] tracking-[-0.05em] text-white sm:text-[6.4rem] lg:text-[7.8rem]">
              What if the best part is <span className="text-gradient-accent">the part you bring?</span>
            </h1>
            <p className="reveal reveal-1 mt-8 max-w-[31rem] text-base leading-[1.7] text-zinc-400 sm:text-lg">
              Tandem is a creative collaboration platform for the unseen halves of an idea. Make a blind contribution. Meet its match. See what neither of you could have made alone.
            </p>
            <div className="reveal reveal-2 mt-9 flex flex-wrap items-center gap-4">
              <Link href="/sign-up" className="group inline-flex items-center gap-3 rounded-full bg-[#3b82f6] px-6 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#2563eb] hover:shadow-[0_0_30px_-5px_rgba(59,130,246,0.5)]" data-testid="link-home-signup">
                Get started
                <PiArrowUpRightDuotone className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <a href="#how-it-works" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-6 py-3.5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white" data-testid="link-see-method">
                See how it works
              </a>
            </div>
          </div>
          <div className="reveal reveal-2 lg:pl-7">
            <PlatformDiagram />
            <p className="mt-5 text-center font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-600">A blueprint for a new kind of making</p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-white/5 bg-[#0d0d0d]">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[.7fr_1.3fr] lg:px-8 lg:py-28">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">The method</p>
            <h2 className="mt-5 max-w-[10ch] text-5xl font-bold leading-[.92] tracking-[-0.04em] text-white sm:text-6xl">A little less knowing. A lot more discovering.</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="reveal group card-surface card-surface-hover overflow-hidden rounded-2xl p-7">
              <span className="card-spot" />
              <span className="icon-chip h-14 w-14 text-[#60a5fa]">
                <PiEyeDuotone className="h-6 w-6" />
              </span>
              <p className="mt-14 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-500">01 / Contribute blind</p>
              <h3 className="mt-3 text-xl font-bold tracking-[-0.03em] text-zinc-100">Bring your half</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">You make without seeing the other person's work. No adapting. No performing for a brief.</p>
            </div>
            <div className="reveal reveal-1 group card-surface card-surface-hover overflow-hidden rounded-2xl p-7">
              <span className="card-spot" />
              <span className="icon-chip h-14 w-14 text-[#a78bfa]">
                <PiMagicWandDuotone className="h-6 w-6" />
              </span>
              <p className="mt-14 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-500">02 / Let the bridge work</p>
              <h3 className="mt-3 text-xl font-bold tracking-[-0.03em] text-zinc-100">AI as bridge</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">The system holds context, finds the join, and protects the provenance of every contribution.</p>
            </div>
            <div className="reveal reveal-2 group card-surface card-surface-hover overflow-hidden rounded-2xl p-7">
              <span className="card-spot" />
              <span className="icon-chip h-14 w-14 text-[#fbbf24]">
                <PiSparkleDuotone className="h-6 w-6" />
              </span>
              <p className="mt-14 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-500">03 / Open the door</p>
              <h3 className="mt-3 text-xl font-bold tracking-[-0.03em] text-zinc-100">The reveal ceremony</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">Two paths become one visible thing. The moment of recognition is part of the work.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="rooms" className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8 lg:py-32">
        <div className="flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">The rooms</p>
            <h2 className="mt-5 max-w-[10ch] text-6xl font-bold leading-[.9] tracking-[-0.05em] text-white sm:text-7xl">Every room starts with two.</h2>
          </div>
          <p className="max-w-[20rem] text-sm leading-relaxed text-zinc-400">The Engine is being built first. The other doors are already on the blueprint, waiting for their first lights.</p>
        </div>
        <div className="mt-16">
          <Link href="/room/engine" className="group relative block overflow-hidden rounded-2xl border border-[#3b82f6]/30 bg-gradient-to-br from-[#3b82f6]/15 to-transparent p-7 transition-all hover:-translate-y-1 hover:border-[#3b82f6]/50 hover:shadow-[0_0_50px_-10px_rgba(59,130,246,0.3)] sm:p-10" data-testid="link-featured-engine">
            <span className="card-spot" />
            <span className="card-shine" />
            <div className="relative flex flex-col justify-between gap-10 sm:flex-row sm:items-end">
              <div>
                <div className="flex items-center gap-3 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#60a5fa]"><span className="h-2 w-2 animate-pulse-soft rounded-full bg-[#3b82f6] glow-dot" />First light / Foundation room</div>
                <h3 className="mt-6 max-w-[11ch] text-5xl font-bold leading-[.9] tracking-[-0.05em] text-white sm:text-7xl">The Tandem Engine</h3>
                <p className="mt-5 max-w-[31rem] text-base leading-relaxed text-zinc-400">The underlying protocol for making together without collapsing into one voice. Everything else grows from here.</p>
              </div>
              <span className="flex items-center gap-3 text-sm font-semibold text-white"><span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 text-zinc-200 transition-all duration-300 group-hover:rotate-45 group-hover:border-[#3b82f6]/60 group-hover:text-[#60a5fa]"><PiArrowUpRightDuotone className="h-5 w-5" /></span>Open the foundation</span>
            </div>
          </Link>
        </div>
        {roomGroups.map((group, groupIndex) => {
          const groupRooms = rooms.filter((room) => group.categories.includes(room.category));
          return (
            <div key={group.label} className="mt-16">
              <div className="mb-6 flex items-center gap-4">
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-600">{String(groupIndex + 1).padStart(2, '0')}</span>
                <h3 className="text-3xl font-semibold text-zinc-100">{group.label}</h3>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {groupRooms.map((room) => <RoomDoor key={room.slug} room={room} />)}
              </div>
            </div>
          );
        })}
      </section>

      <section className="border-t border-white/5 bg-[#0d0d0d]">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_.8fr] lg:items-end lg:px-8 lg:py-28">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">A note from the platform</p>
            <blockquote className="mt-7 max-w-[14ch] text-5xl font-semibold leading-[.94] text-white sm:text-7xl">"The point is not to disappear into the machine. It is to become more visible to one another."</blockquote>
          </div>
          <div className="border-l border-white/10 pl-6 sm:pl-8">
            <p className="text-sm leading-[1.8] text-zinc-400">Tandem keeps a clear line back to every hand in the room. No synthetic substitute for a person. No erasing the strange, specific route an idea took to arrive.</p>
            <Link href="/room/engine" className="group mt-8 inline-flex items-center gap-3 text-sm font-semibold text-[#3b82f6]" data-testid="link-footer-engine">
              Visit the foundation
              <PiArrowUpRightDuotone className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        <footer className="mx-auto flex max-w-[1400px] flex-col gap-4 border-t border-white/5 px-4 py-7 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <TandemLogo />
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em]">A platform for creative connection / 2025</span>
        </footer>
      </section>
    </main>
  );
}
