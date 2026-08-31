import { LogOut, Mail, Settings2, UserRound } from 'lucide-react';
import { useClerk, useUser } from '@clerk/react';
import {
  getListWaitlistEntriesQueryKey,
  useListWaitlistEntries,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/protected-shell';
import { tandemCategories } from '@/data/categories';

export default function ProfilePage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const name = user?.fullName || user?.username || 'Tandem member';
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || name.slice(0, 2);
  const email = user?.primaryEmailAddress?.emailAddress || 'No email on file';
  const { data: waitlistEntries, isLoading: isLoadingWaitlist } = useListWaitlistEntries({
    query: {
      enabled: isLoaded && !!user,
      queryKey: getListWaitlistEntriesQueryKey(),
    },
  });
  const joinedCategories = tandemCategories.filter((category) =>
    waitlistEntries?.some((entry) => entry.categorySlug === category.slug),
  );

  if (!isLoaded) {
    return <div className="h-56 animate-pulse rounded-2xl bg-white/5" aria-label="Loading profile" />;
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <SectionEyebrow>Your corner / profile</SectionEyebrow>
      <h1 className="mt-5 text-6xl font-bold leading-[.9] tracking-[-0.04em] text-white sm:text-8xl">
        Your place in the house.
      </h1>
      <div className="card-surface mt-12 overflow-hidden rounded-2xl">
        <div className="border-b border-white/5 bg-gradient-to-br from-[#3b82f6]/10 to-transparent p-7 sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] font-mono-ui text-xl uppercase text-white">
              {initials}
            </div>
            <div>
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#3b82f6]">Tandem member</p>
              <h2 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white">{name}</h2>
              <p className="mt-2 flex items-center gap-2 text-sm text-zinc-400"><Mail className="h-4 w-4" />{email}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7">
          <div className="card-surface rounded-2xl p-5 sm:col-span-2">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#3b82f6]">Your lights on</p>
            <h3 className="mt-3 text-xl font-bold tracking-[-0.03em] text-zinc-100">Rooms you're waiting for</h3>
            {isLoadingWaitlist ? (
              <p className="mt-3 text-sm text-zinc-500">Checking the house plan...</p>
            ) : joinedCategories.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {joinedCategories.map((category) => (
                  <span key={category.slug} className="rounded-full border border-[#3b82f6]/30 bg-[#3b82f6]/10 px-3 py-1.5 text-xs font-semibold text-[#60a5fa]">
                    {category.shortName}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-zinc-500">You haven't joined a launch list yet. Leave a light on when a room calls to you.</p>
            )}
          </div>
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5">
            <Settings2 className="h-5 w-5 text-[#3b82f6]" strokeWidth={1.7} />
            <p className="mt-5 font-semibold text-zinc-100">Settings are being set.</p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">Notification controls and account preferences arrive with the next room.</p>
          </div>
          <button type="button" onClick={() => signOut({ redirectUrl: '/' })} className="focus-house flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-left transition-colors hover:border-red-500/30 hover:bg-red-500/5" data-testid="button-profile-logout">
            <LogOut className="mt-0.5 h-5 w-5 text-red-400" />
            <span>
              <span className="block font-semibold text-zinc-100">Sign out</span>
              <span className="mt-2 block text-sm leading-relaxed text-zinc-500">Sign out of this Tandem session.</span>
            </span>
          </button>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-3 text-xs text-zinc-500">
        <UserRound className="h-4 w-4 text-[#3b82f6]" />
        <span>Your identity is managed securely by Tandem authentication.</span>
      </div>
    </div>
  );
}
