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
    return <div className="h-56 animate-pulse rounded-[1.75rem] bg-[#e5d7c5]" aria-label="Loading profile" />;
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <SectionEyebrow>Your corner / profile</SectionEyebrow>
      <h1 className="mt-5 text-6xl font-extrabold leading-[.88] tracking-[-0.08em] text-[#292b45] sm:text-8xl">
        Your place in the house.
      </h1>
      <div className="mt-12 overflow-hidden rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] shadow-[8px_10px_0_rgba(41,43,69,0.08)]">
        <div className="bg-[#292b45] p-7 text-[#fff4e6] sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#f0c85c] bg-[#3e8074] font-mono-ui text-xl uppercase text-[#fff4e6]">
              {initials}
            </div>
            <div>
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#f0c85c]">Tandem member</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.05em]">{name}</h2>
              <p className="mt-2 flex items-center gap-2 text-sm text-[#d8d0ce]"><Mail className="h-4 w-4" />{email}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7">
          <div className="rounded-2xl border-2 border-[#d6cbb9] bg-[#f7eddf] p-5 sm:col-span-2">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#3e8074]">Your lights on</p>
            <h3 className="mt-3 text-xl font-extrabold tracking-[-0.04em] text-[#292b45]">Rooms you&apos;re waiting for</h3>
            {isLoadingWaitlist ? (
              <p className="mt-3 text-sm text-[#77717a]">Checking the house plan...</p>
            ) : joinedCategories.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {joinedCategories.map((category) => (
                  <span key={category.slug} className="rounded-full border border-[#8dc2ad] bg-[#e5f1e8] px-3 py-1.5 text-xs font-bold text-[#286254]">
                    {category.shortName}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-[#77717a]">You haven&apos;t joined a launch list yet. Leave a light on when a room calls to you.</p>
            )}
          </div>
          <div className="rounded-2xl border-2 border-dashed border-[#cfc1b0] bg-[#f7eddf] p-5">
            <Settings2 className="h-5 w-5 text-[#e55b4c]" strokeWidth={1.7} />
            <p className="mt-5 font-bold text-[#292b45]">Settings are being set.</p>
            <p className="mt-2 text-sm leading-relaxed text-[#77717a]">Notification controls and account preferences arrive with the next room.</p>
          </div>
          <button type="button" onClick={() => signOut({ redirectUrl: '/' })} className="focus-house flex items-start gap-4 rounded-2xl border-2 border-[#d6cbb9] p-5 text-left transition-colors hover:border-[#e55b4c] hover:bg-[#fbe4dc]" data-testid="button-profile-logout">
            <LogOut className="mt-0.5 h-5 w-5 text-[#e55b4c]" />
            <span>
              <span className="block font-bold text-[#292b45]">Leave the house</span>
              <span className="mt-2 block text-sm leading-relaxed text-[#77717a]">Sign out of this Tandem session.</span>
            </span>
          </button>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-3 text-xs text-[#98909a]">
        <UserRound className="h-4 w-4 text-[#3e8074]" />
        <span>Your identity is managed securely by Tandem authentication.</span>
      </div>
    </div>
  );
}