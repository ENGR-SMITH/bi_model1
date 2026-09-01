import { PiCompassRoseDuotone } from 'react-icons/pi';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#0a0a0a] px-4">
      <div className="w-full max-w-md">
        <div className="card-raised overflow-hidden rounded-3xl p-8 text-center">
          <span className="icon-chip mx-auto h-16 w-16 text-[#3b82f6]">
            <PiCompassRoseDuotone className="h-8 w-8 animate-spin-slow" />
          </span>
          <p className="mt-8 font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">Off the blueprint / 404</p>
          <h1 className="mt-4 text-5xl font-extrabold leading-[.9] tracking-[-0.06em] text-white">This door moved.</h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-500">
            The room you were looking for is not on Tandem's current plan — or it never was.
          </p>
          <Link
            href="/"
            className="focus-house mt-7 inline-flex items-center gap-2 rounded-full bg-[#3b82f6] px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-[#2563eb] hover:shadow-[0_0_30px_-5px_rgba(59,130,246,0.5)]"
            data-testid="link-return-home-404"
          >
            Return to the house
          </Link>
        </div>
      </div>
    </div>
  );
}
