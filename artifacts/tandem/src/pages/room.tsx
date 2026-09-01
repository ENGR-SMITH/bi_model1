import { ArrowLeft, ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { HouseNav, RoomDoor } from '@/components/tandem-house';
import { getRoom, rooms } from '@/data/rooms';

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const room = getRoom(params.slug);

  if (!room) {
    return (
      <main className="min-h-[100dvh] bg-[#0a0a0a]">
        <HouseNav />
        <section className="mx-auto flex min-h-[calc(100dvh-88px)] max-w-[650px] flex-col items-center justify-center px-5 py-20 text-center">
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">No such room on the plan</span>
          <h1 className="mt-6 text-6xl font-bold leading-[.9] tracking-[-0.04em] text-white sm:text-8xl">The door moved.</h1>
          <p className="mt-6 max-w-[26rem] text-sm leading-relaxed text-zinc-400">That room is not on Tandem's current blueprint. The house is still growing.</p>
          <Link href="/" className="mt-9 inline-flex items-center gap-3 rounded-full bg-[#3b82f6] px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#2563eb] hover:shadow-[0_0_30px_-5px_rgba(59,130,246,0.5)]" data-testid="link-return-house-missing">
            <ArrowLeft className="h-4 w-4" /> Return to the house
          </Link>
        </section>
      </main>
    );
  }

  const suggestions = rooms.filter((candidate) => candidate.slug !== room.slug).slice(0, 3);

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#0a0a0a]">
      <div className="hero-glow absolute inset-x-0 top-0 h-[600px]" />
      <HouseNav />
      <section className="relative mx-auto max-w-[1240px] px-5 pb-16 pt-12 sm:px-8 sm:pt-20 lg:px-10 lg:pb-24 lg:pt-24">
        <Link href="/" className="group inline-flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-500 transition-colors hover:text-[#3b82f6]" data-testid="link-return-house">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> Back to the house
        </Link>
        <div className="relative mt-14 grid items-center gap-14 lg:grid-cols-[1fr_.85fr] lg:gap-20">
          <div className="reveal">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">{room.category} / {room.eyebrow}</p>
            <h1 className="mt-6 max-w-[10ch] text-[4.5rem] font-bold leading-[.88] tracking-[-0.05em] text-white sm:text-[7rem]">{room.name}</h1>
            <p className="mt-8 max-w-[30rem] text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-zinc-300 sm:text-4xl">{room.description}</p>
          </div>
          <div className="reveal reveal-1 relative mx-auto w-full max-w-[430px]">
            <div className="absolute -inset-5 rounded-[2rem] border border-dashed border-white/10" />
            <div className="relative rounded-[2rem] border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_0_60px_-15px_rgba(59,130,246,0.2)] sm:p-6">
              <div className="relative rounded-[1.25rem] border border-[#8b5cf6]/30 bg-gradient-to-br from-[#8b5cf6]/15 to-transparent px-6 py-12 text-center sm:px-10 sm:py-16">
                <div className="flex items-start justify-between">
                  <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-500">Blueprint / {room.slug}</span>
                  <span className="card-icon h-5 w-5"><LockKeyhole className="h-5 w-5" strokeWidth={1.6} /></span>
                </div>
                <div className="flex min-h-[240px] flex-col items-center justify-center text-center sm:min-h-[300px]">
                  <span className="card-icon h-20 w-20 sm:h-24 sm:w-24">
                    <Sparkles className="h-9 w-9 text-[#a78bfa]" strokeWidth={1.2} />
                  </span>
                  <p className="mt-7 text-5xl font-bold leading-none text-white">Not yet</p>
                  <p className="mt-3 max-w-[15rem] text-sm leading-relaxed text-zinc-400">This room is drawn. Its first light is still being found.</p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 font-mono-ui text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                  <span>Planned room</span>
                  <span>Awaiting its people</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="border-y border-white/5 bg-[#0d0d0d]">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[.7fr_1.3fr] lg:px-10 lg:py-24">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">A room can wait</p>
            <h2 className="mt-5 max-w-[12ch] text-4xl font-bold leading-[.94] tracking-[-0.04em] text-white sm:text-5xl">The house is open before every door is.</h2>
          </div>
          <div className="max-w-[38rem]">
            <p className="text-base leading-[1.8] text-zinc-400">Tandem's first work is the Engine: the careful foundation that lets two people contribute without losing the shape of either voice. Once that bridge is ready, this room can become real.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/room/engine" className="group inline-flex items-center gap-3 rounded-full bg-[#3b82f6] px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-[#2563eb] hover:shadow-[0_0_30px_-5px_rgba(59,130,246,0.5)]" data-testid="link-visit-engine">
                Visit the Tandem Engine <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white" data-testid="link-all-rooms">
                See all rooms
              </Link>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 lg:px-10 lg:py-24">
        <div className="flex items-end justify-between gap-5">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">Keep wandering</p>
            <h2 className="mt-4 text-4xl font-bold tracking-[-0.03em] text-white">Other doors on the plan</h2>
          </div>
          <Link href="/" className="hidden items-center gap-2 text-sm font-semibold text-zinc-300 sm:flex" data-testid="link-house-plan"><ArrowLeft className="h-4 w-4" /> House plan</Link>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {suggestions.map((suggestion) => <RoomDoor key={suggestion.slug} room={suggestion} compact />)}
        </div>
      </section>
      <footer className="border-t border-white/5 px-5 py-7 text-center font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:px-8">
        Tandem / the house is still taking shape
      </footer>
    </main>
  );
}
