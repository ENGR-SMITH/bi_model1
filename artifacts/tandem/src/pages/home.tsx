import { ArrowUpRight, EyeOff, Layers3, Sparkles, WandSparkles } from 'lucide-react';
import { Link } from 'wouter';
import { DoorMark, HouseNav, RoomDoor, TandemLogo } from '@/components/tandem-house';
import { roomGroups, rooms } from '@/data/rooms';

function HouseDiagram() {
  return (
    <div className="house-grid relative mx-auto aspect-[1.08] w-full max-w-[510px] rotate-1 rounded-[2rem] border-2 border-[#292b45] bg-[#e5d7c5] p-3 shadow-[14px_16px_0_rgba(41,43,69,0.14)] sm:p-5">
      <div className="absolute -left-4 top-10 h-20 w-8 rounded-l-full border-2 border-r-0 border-[#e55b4c] bg-[#e55b4c] sm:-left-7 sm:h-28 sm:w-12" />
      <div className="absolute -right-4 bottom-12 h-24 w-8 rounded-r-full border-2 border-l-0 border-[#3e8074] bg-[#3e8074] sm:-right-7 sm:h-32 sm:w-12" />
      <div className="relative grid h-full grid-cols-2 grid-rows-3 gap-2 sm:gap-3">
        <div className="col-span-2 flex items-center justify-between rounded-xl border-2 border-[#292b45] bg-[#e55b4c] p-4 text-[#fff4e6] sm:p-6">
          <div>
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.18em] opacity-80">The foundation</p>
            <p className="mt-2 max-w-[13rem] font-display text-[2rem] leading-[.9] sm:text-[2.8rem]">The Engine</p>
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-current sm:h-14 sm:w-14">
            <Layers3 className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
        </div>
        <div className="flex flex-col justify-between rounded-xl border-2 border-[#292b45] bg-[#f5e9d9] p-3 sm:p-5">
          <span className="font-mono-ui text-[9px] uppercase tracking-[0.18em] text-[#767080]">Room 02</span>
          <span className="font-display text-[1.75rem] leading-[.9] text-[#292b45] sm:text-[2.3rem]">Make</span>
        </div>
        <div className="flex flex-col justify-between rounded-xl border-2 border-[#292b45] bg-[#e1b956] p-3 sm:p-5">
          <span className="font-mono-ui text-[9px] uppercase tracking-[0.18em] text-[#5c4b27]">Room 03</span>
          <span className="font-display text-[1.75rem] leading-[.9] text-[#292b45] sm:text-[2.3rem]">Meet</span>
        </div>
        <div className="flex flex-col justify-between rounded-xl border-2 border-[#292b45] bg-[#3e8074] p-3 text-[#fff4e6] sm:p-5">
          <span className="font-mono-ui text-[9px] uppercase tracking-[0.18em] opacity-75">Room 04</span>
          <span className="font-display text-[1.75rem] leading-[.9] sm:text-[2.3rem]">Play</span>
        </div>
        <div className="relative flex flex-col justify-between rounded-xl border-2 border-[#292b45] bg-[#75617f] p-3 text-[#fff4e6] sm:p-5">
          <span className="font-mono-ui text-[9px] uppercase tracking-[0.18em] opacity-75">Room 05</span>
          <span className="font-display text-[1.75rem] leading-[.9] sm:text-[2.3rem]">Wonder</span>
          <span className="absolute bottom-3 right-3 h-5 w-5 rounded-full border-2 border-[#e1b956] sm:bottom-5 sm:right-5 sm:h-8 sm:w-8" />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="paper-noise min-h-[100dvh] overflow-hidden bg-[#f2e7d8]">
      <HouseNav />
      <section className="relative mx-auto max-w-[1240px] px-5 pb-20 pt-12 sm:px-8 sm:pt-20 lg:px-10 lg:pb-32 lg:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_.98fr] lg:gap-10">
          <div className="reveal max-w-[670px]">
            <DoorMark />
            <h1 className="mt-7 max-w-[12ch] text-[4.4rem] font-extrabold leading-[.88] tracking-[-0.085em] text-[#292b45] sm:text-[6.4rem] lg:text-[7.8rem]">
              What if the best part is <span className="font-display font-normal italic text-[#e55b4c]">the part you bring?</span>
            </h1>
            <p className="reveal reveal-1 mt-8 max-w-[31rem] text-base leading-[1.7] text-[#625f6d] sm:text-lg">
              Tandem is a creative collaboration house for the unseen halves of an idea. Make a blind contribution. Meet its match. See what neither of you could have made alone.
            </p>
            <div className="reveal reveal-2 mt-9 flex flex-wrap items-center gap-4">
              <Link href="/sign-up" className="group inline-flex items-center gap-3 rounded-full bg-[#292b45] px-6 py-3.5 text-sm font-bold text-[#fff4e6] transition-transform hover:-translate-y-1" data-testid="link-home-signup">
                Enter the house
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <a href="#how-it-works" className="inline-flex items-center gap-2 px-3 py-3.5 text-sm font-bold text-[#292b45] underline decoration-[#e1b956] decoration-2 underline-offset-4" data-testid="link-see-method">
                See how it works
              </a>
            </div>
          </div>
          <div className="reveal reveal-2 lg:pl-7">
            <HouseDiagram />
            <p className="mt-5 text-center font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#77717a]">A floor plan for a new kind of making</p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y-2 border-[#d6cbb9] bg-[#ebe0d0]">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[.7fr_1.3fr] lg:px-10 lg:py-28">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">The method</p>
            <h2 className="mt-5 max-w-[10ch] text-5xl font-extrabold leading-[.9] tracking-[-0.07em] text-[#292b45] sm:text-6xl">A little less knowing. A lot more discovering.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="reveal rounded-2xl border-2 border-[#cfc1b0] bg-[#f7eddf] p-6">
              <EyeOff className="h-7 w-7 text-[#e55b4c]" strokeWidth={1.6} />
              <p className="mt-12 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#817879]">01 / Contribute blind</p>
              <h3 className="mt-3 text-xl font-extrabold tracking-[-0.04em]">Bring your half</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#625f6d]">You make without seeing the other person’s work. No adapting. No performing for a brief.</p>
            </div>
            <div className="reveal reveal-1 rounded-2xl border-2 border-[#cfc1b0] bg-[#f7eddf] p-6">
              <WandSparkles className="h-7 w-7 text-[#3e8074]" strokeWidth={1.6} />
              <p className="mt-12 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#817879]">02 / Let the bridge work</p>
              <h3 className="mt-3 text-xl font-extrabold tracking-[-0.04em]">AI as bridge</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#625f6d]">The system holds context, finds the join, and protects the provenance of every contribution.</p>
            </div>
            <div className="reveal reveal-2 rounded-2xl border-2 border-[#cfc1b0] bg-[#f7eddf] p-6">
              <Sparkles className="h-7 w-7 text-[#b7891e]" strokeWidth={1.6} />
              <p className="mt-12 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#817879]">03 / Open the door</p>
              <h3 className="mt-3 text-xl font-extrabold tracking-[-0.04em]">The reveal ceremony</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#625f6d]">Two paths become one visible thing. The moment of recognition is part of the work.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="rooms" className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 lg:px-10 lg:py-32">
        <div className="flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">The rooms</p>
            <h2 className="mt-5 max-w-[10ch] text-6xl font-extrabold leading-[.88] tracking-[-0.08em] text-[#292b45] sm:text-7xl">Every room starts with two.</h2>
          </div>
          <p className="max-w-[20rem] text-sm leading-relaxed text-[#625f6d]">The Engine is being built first. The other doors are already on the blueprint, waiting for their first lights.</p>
        </div>
        <div className="mt-14">
          <Link href="/room/engine" className="group block rounded-[1.5rem] border-2 border-[#c7473c] bg-[#e55b4c] p-7 text-[#fff4e6] transition-all hover:-translate-y-1 hover:shadow-[10px_12px_0_rgba(41,43,69,0.16)] sm:p-10" data-testid="link-featured-engine">
            <div className="flex flex-col justify-between gap-10 sm:flex-row sm:items-end">
              <div>
                <div className="flex items-center gap-3 font-mono-ui text-[10px] uppercase tracking-[0.18em] opacity-80"><span className="h-2 w-2 rounded-full bg-[#f0c85c]" />First light / Foundation room</div>
                <h3 className="mt-6 max-w-[11ch] text-5xl font-extrabold leading-[.88] tracking-[-0.07em] sm:text-7xl">The Tandem Engine</h3>
                <p className="mt-5 max-w-[31rem] text-base leading-relaxed text-[#ffe6d7]">The underlying protocol for making together without collapsing into one voice. Everything else grows from here.</p>
              </div>
              <span className="flex items-center gap-3 text-sm font-bold"><span className="flex h-12 w-12 items-center justify-center rounded-full border border-current transition-transform group-hover:rotate-45"><ArrowUpRight className="h-5 w-5" /></span>Open the foundation</span>
            </div>
          </Link>
        </div>
        {roomGroups.map((group, groupIndex) => {
          const groupRooms = rooms.filter((room) => group.categories.includes(room.category));
          return (
            <div key={group.label} className="mt-16">
              <div className="mb-5 flex items-center gap-4">
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#77717a]">{String(groupIndex + 1).padStart(2, '0')}</span>
                <h3 className="font-display text-3xl italic text-[#292b45]">{group.label}</h3>
                <div className="h-px flex-1 bg-[#d6cbb9]" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groupRooms.map((room) => <RoomDoor key={room.slug} room={room} />)}
              </div>
            </div>
          );
        })}
      </section>

      <section className="bg-[#292b45] text-[#fff4e6]">
        <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_.8fr] lg:items-end lg:px-10 lg:py-28">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#f0c85c]">A note from the house</p>
            <blockquote className="mt-7 max-w-[14ch] font-display text-5xl leading-[.92] sm:text-7xl">“The point is not to disappear into the machine. It is to become more visible to one another.”</blockquote>
          </div>
          <div className="border-l border-[#56576c] pl-6 sm:pl-8">
            <p className="text-sm leading-[1.8] text-[#c7c3c1]">Tandem keeps a clear line back to every hand in the room. No synthetic substitute for a person. No erasing the strange, specific route an idea took to arrive.</p>
            <Link href="/room/engine" className="group mt-8 inline-flex items-center gap-3 text-sm font-bold text-[#f0c85c]" data-testid="link-footer-engine">
              Visit the foundation
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        <footer className="mx-auto flex max-w-[1240px] flex-col gap-4 border-t border-[#56576c] px-5 py-7 text-xs text-[#aaa7ab] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <TandemLogo light />
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em]">A house for creative connection / 2025</span>
        </footer>
      </section>
    </main>
  );
}