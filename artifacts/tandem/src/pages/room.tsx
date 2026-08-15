import { ArrowLeft, ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { HouseNav, RoomDoor } from '@/components/tandem-house';
import { getRoom, rooms } from '@/data/rooms';

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const room = getRoom(params.slug);

  if (!room) {
    return (
      <main className="paper-noise min-h-[100dvh] bg-[#f2e7d8]">
        <HouseNav />
        <section className="mx-auto flex min-h-[calc(100dvh-88px)] max-w-[650px] flex-col items-center justify-center px-5 py-20 text-center">
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">No such room on the plan</span>
          <h1 className="mt-6 font-display text-6xl italic leading-[.9] text-[#292b45] sm:text-8xl">The door moved.</h1>
          <p className="mt-6 max-w-[26rem] text-sm leading-relaxed text-[#625f6d]">That room is not on Tandem’s current blueprint. The house is still growing.</p>
          <Link href="/" className="mt-9 inline-flex items-center gap-3 rounded-full bg-[#292b45] px-6 py-3.5 text-sm font-bold text-[#fff4e6]" data-testid="link-return-house-missing">
            <ArrowLeft className="h-4 w-4" /> Return to the house
          </Link>
        </section>
      </main>
    );
  }

  const suggestions = rooms.filter((candidate) => candidate.slug !== room.slug).slice(0, 3);

  return (
    <main className="paper-noise min-h-[100dvh] overflow-hidden bg-[#f2e7d8]">
      <HouseNav />
      <section className="mx-auto max-w-[1240px] px-5 pb-16 pt-12 sm:px-8 sm:pt-20 lg:px-10 lg:pb-24 lg:pt-24">
        <Link href="/" className="group inline-flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#77717a] transition-colors hover:text-[#e55b4c]" data-testid="link-return-house">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> Back to the house
        </Link>
        <div className="relative mt-14 grid items-center gap-14 lg:grid-cols-[1fr_.85fr] lg:gap-20">
          <div className="reveal">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">{room.category} / {room.eyebrow}</p>
            <h1 className="mt-6 max-w-[10ch] text-[4.5rem] font-extrabold leading-[.85] tracking-[-0.09em] text-[#292b45] sm:text-[7rem]">{room.name}</h1>
            <p className="mt-8 max-w-[30rem] font-display text-3xl leading-[1.05] text-[#5e5b6b] sm:text-4xl">{room.description}</p>
          </div>
          <div className="reveal reveal-1 relative mx-auto w-full max-w-[430px]">
            <div className="absolute -inset-5 rounded-[2rem] border border-dashed border-[#cfc1b0]" />
            <div className="relative rounded-[2rem] border-2 border-[#292b45] bg-[#e5d7c5] p-4 shadow-[12px_14px_0_rgba(41,43,69,0.14)] sm:p-6">
              <div className="rounded-[1.25rem] border-2 border-[#292b45] bg-[#75617f] px-6 py-12 text-[#fff4e6] sm:px-10 sm:py-16">
                <div className="flex items-start justify-between">
                  <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] opacity-75">Blueprint / {room.slug}</span>
                  <LockKeyhole className="h-5 w-5 text-[#f0c85c]" strokeWidth={1.6} />
                </div>
                <div className="flex min-h-[240px] flex-col items-center justify-center text-center sm:min-h-[300px]">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full border border-[#f0c85c] bg-[#f0c85c]/10 sm:h-24 sm:w-24">
                    <Sparkles className="h-9 w-9 text-[#f0c85c]" strokeWidth={1.2} />
                  </span>
                  <p className="mt-7 font-display text-5xl italic leading-none">Not yet</p>
                  <p className="mt-3 max-w-[15rem] text-sm leading-relaxed text-[#e1d4df]">This room is drawn. Its first light is still being found.</p>
                </div>
                <div className="flex items-center justify-between border-t border-[#aa99ad] pt-4 font-mono-ui text-[9px] uppercase tracking-[0.16em] text-[#d7cbd9]">
                  <span>Planned room</span>
                  <span>Awaiting its people</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="border-y-2 border-[#d6cbb9] bg-[#ebe0d0]">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[.7fr_1.3fr] lg:px-10 lg:py-24">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3e8074]">A room can wait</p>
            <h2 className="mt-5 max-w-[12ch] text-4xl font-extrabold leading-[.92] tracking-[-0.06em] text-[#292b45] sm:text-5xl">The house is open before every door is.</h2>
          </div>
          <div className="max-w-[38rem]">
            <p className="text-base leading-[1.8] text-[#625f6d]">Tandem’s first work is the Engine: the careful foundation that lets two people contribute without losing the shape of either voice. Once that bridge is ready, this room can become real.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/room/engine" className="group inline-flex items-center gap-3 rounded-full bg-[#e55b4c] px-5 py-3 text-sm font-bold text-[#fff4e6]" data-testid="link-visit-engine">
                Visit the Tandem Engine <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link href="/" className="inline-flex items-center gap-2 rounded-full border-2 border-[#292b45] px-5 py-3 text-sm font-bold text-[#292b45] transition-colors hover:bg-[#292b45] hover:text-[#fff4e6]" data-testid="link-all-rooms">
                See all rooms
              </Link>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 lg:px-10 lg:py-24">
        <div className="flex items-end justify-between gap-5">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">Keep wandering</p>
            <h2 className="mt-4 font-display text-4xl italic text-[#292b45]">Other doors on the plan</h2>
          </div>
          <Link href="/" className="hidden items-center gap-2 text-sm font-bold text-[#292b45] sm:flex" data-testid="link-house-plan"><ArrowLeft className="h-4 w-4" /> House plan</Link>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {suggestions.map((suggestion) => <RoomDoor key={suggestion.slug} room={suggestion} compact />)}
        </div>
      </section>
      <footer className="border-t-2 border-[#d6cbb9] px-5 py-7 text-center font-mono-ui text-[10px] uppercase tracking-[0.16em] text-[#77717a] sm:px-8">
        Tandem / the house is still taking shape
      </footer>
    </main>
  );
}