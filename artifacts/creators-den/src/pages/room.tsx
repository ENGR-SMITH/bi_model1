import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Clapperboard,
  Film,
  LockKeyhole,
  Mic2,
  Palette,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListVideoNotificationsQueryKey,
  useCreateVideoProject,
  useListVideoNotifications,
  useListVideoProjects,
  useMarkVideoNotificationRead,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useRealtimeNotifications } from '@/lib/realtime';

function NotificationsPanel() {
  const queryClient = useQueryClient();
  useRealtimeNotifications();
  const notifications = useListVideoNotifications({ query: { queryKey: getListVideoNotificationsQueryKey() } });
  const mark = useMarkVideoNotificationRead();

  const unread = (notifications.data ?? []).filter((n) => !n.readAt);

  const open = (notification: { id: string; deepLink: string }) => {
    mark.mutate(
      { notificationId: notification.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
        },
      },
    );
  };

  if (!notifications.data || notifications.data.length === 0) return null;

  return (
    <div className="rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5" data-testid="panel-notifications">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">
          <Bell className="h-4 w-4" />
          Notices
        </div>
        {unread.length > 0 && (
          <span className="rounded-full bg-[#e55b4c] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#fff4e6]">{unread.length} new</span>
        )}
      </div>
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
        {(notifications.data ?? []).slice(0, 10).map((notification) => (
          <a
            key={notification.id}
            href={notification.deepLink || '/'}
            onClick={() => !notification.readAt && open(notification)}
            className={`block rounded-xl border-2 px-3 py-2.5 transition-colors ${notification.readAt ? 'border-[#e5d7c5] bg-[#f1e8da] opacity-70' : 'border-[#8dc2ad] bg-[#e5f1e8]'}`}
            data-testid={`notification-${notification.id}`}
          >
            <p className="text-sm font-bold text-[#292b45]">{notification.title}</p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[#77717a]">{notification.body}</p>
            <p className="mt-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">{notification.category.replaceAll('_', ' ')} · {new Date(notification.createdAt).toLocaleDateString()}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

const LEGS = [
  { number: '01', role: 'Story Architect', studio: 'Selects & structure', icon: Film, blurb: 'Marks the golden takes and builds the narrative spine: Hook → Setup → Core → Payoff → CTA.' },
  { number: '02', role: 'Visual Editor', studio: 'Precision cutting', icon: Scissors, blurb: 'Tightens every cut, layers B-roll, syncs cameras, and locks the picture.' },
  { number: '03', role: 'Sound Designer', studio: 'Restore & score', icon: Mic2, blurb: 'Cleans captured audio, ducks music under speech, and repairs bad takes.' },
  { number: '04', role: 'Motion & Color', studio: 'Finish & polish', icon: Palette, blurb: 'Grades the footage into one look, burns captions, and exports every format.' },
];

function Empty({ body }: { body: string }) {
  return (
    <div className="rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-8 shadow-[8px_10px_0_rgba(41,43,69,.07)]">
      <Sparkles className="h-7 w-7 text-[#e55b4c]" />
      <p className="mt-7 font-display text-4xl italic">No footage yet.</p>
      <p className="mt-3 max-w-xl text-sm leading-[1.8] text-[#77717a]">{body}</p>
    </div>
  );
}

function NewProjectCard() {
  const [, setLocation] = useLocation();
  const create = useCreateVideoProject();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { data: { name: name.trim(), description: description.trim() || undefined } },
      {
        onSuccess: (project) => setLocation(`/projects/${project.id}`),
      },
    );
  };

  const error = create.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="rounded-[1.5rem] border-2 border-[#8dc2ad] bg-[#e5f1e8] p-6">
      <div className="flex items-center justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#286254] text-[#286254]"><Clapperboard className="h-5 w-5" /></span>
        <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#286254]">Start a project</span>
      </div>
      <h2 className="mt-5 text-3xl font-extrabold leading-[.95] tracking-[-0.05em] text-[#292b45]">New locked room.</h2>
      <p className="mt-2 text-sm leading-relaxed text-[#286254]">Name the project, then drop your raw footage into the vault. Files are viewable by the team — downloadable by no one.</p>
      <form className="mt-5 space-y-3" onSubmit={submit}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Project name — e.g. Interview with Ada"
          maxLength={120}
          required
          data-testid="input-video-project-name"
          className="focus-house w-full rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-3 text-sm text-[#292b45] placeholder:text-[#98909a]"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What are we cutting? (optional)"
          maxLength={2000}
          rows={2}
          data-testid="input-video-project-description"
          className="focus-house w-full resize-none rounded-xl border-2 border-[#8dc2ad] bg-[#f7eddf] px-4 py-3 text-sm text-[#292b45] placeholder:text-[#98909a]"
        />
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          data-testid="button-create-video-project"
          className="focus-house inline-flex items-center gap-2 rounded-xl bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#286254] disabled:cursor-wait disabled:opacity-60"
        >
          {create.isPending ? 'Opening the room...' : 'Create project'}
          <ArrowRight className="h-4 w-4" />
        </button>
        {create.isError && (
          <p className="text-sm font-semibold text-[#a33d31]" role="alert">
            {error?.response?.data?.error || 'We could not open that room just yet.'}
          </p>
        )}
      </form>
    </div>
  );
}

export default function ContentCreatorsPage() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';
  const projects = useListVideoProjects();

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link href="/dashboard" className="focus-house inline-flex items-center gap-2 rounded-full py-1 text-xs font-bold text-[#77717a] hover:text-[#292b45]" data-testid="link-creators-back-dashboard">
        <ArrowUpRight className="h-3.5 w-3.5 rotate-[225deg]" />
        Back to the atrium
      </Link>

      <div className="reveal mt-6 flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-9 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Content creators / the room</SectionEyebrow>
          <h1 className="mt-4 max-w-[13ch] text-5xl font-extrabold leading-[.88] tracking-[-0.07em] text-[#292b45] sm:text-7xl">Your footage has a room.</h1>
        </div>
        <div className="max-w-sm border-l-2 border-[#d6cbb9] pl-5 text-sm leading-[1.8] text-[#625f6d]">
          <p>Welcome in, {name}. Four roles, one relay — selects, cut, sound, finish — working the same locked footage until the Captain releases it.</p>
        </div>
      </div>

      <div className="reveal reveal-1 mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LEGS.map((leg) => {
          const Icon = leg.icon;
          return (
            <div key={leg.number} className="soft-lift rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5" data-testid={`card-leg-${leg.number}`}>
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#292b45] text-[#f0c85c]"><Icon className="h-4 w-4" /></span>
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-[#98909a]">{leg.number} / 04</span>
              </div>
              <p className="mt-5 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#e55b4c]">{leg.studio}</p>
              <h2 className="mt-1 font-display text-2xl italic leading-none">{leg.role}</h2>
              <p className="mt-2 text-xs leading-relaxed text-[#77717a]">{leg.blurb}</p>
            </div>
          );
        })}
      </div>

      <div className="reveal reveal-2 mt-10 grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
        <div className="space-y-4">
          <NotificationsPanel />
          <NewProjectCard />
        </div>
        <div>
          <div className="flex items-center gap-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">Your rooms</span>
            <div className="h-px flex-1 bg-[#d6cbb9]" />
          </div>
          <div className="mt-4 space-y-4">
            {projects.isLoading ? (
              <div className="h-40 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" />
            ) : projects.isError ? (
              <p className="text-sm text-[#a33d31]">The vault could not be opened. Try again in a moment.</p>
            ) : projects.data && projects.data.length > 0 ? (
              projects.data.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="soft-lift focus-house group flex items-start justify-between gap-4 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5"
                  data-testid={`card-video-project-${project.id}`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#f0c85c] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#292b45]">{project.status.replaceAll('_', ' ')}</span>
                      <span className="font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">{new Date(project.createdAt).toLocaleDateString()}</span>
                    </div>
                    <h2 className="mt-3 font-display text-3xl italic leading-none">{project.name}</h2>
                    {project.description && <p className="mt-2 max-w-md text-xs leading-relaxed text-[#77717a]">{project.description}</p>}
                  </div>
                  <ArrowUpRight className="mt-1 h-5 w-5 shrink-0 text-[#e55b4c] transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
                </Link>
              ))
            ) : (
              <Empty body="Create your first project above — then drop in the raw footage and the relay can begin." />
            )}
          </div>
          <p className="mt-6 flex items-center gap-2 text-xs text-[#77717a]">
            <LockKeyhole className="h-4 w-4 text-[#e55b4c]" />
            Every room is private by design. The Lock keeps raw footage in the vault until the Captain approves the final master.
          </p>
        </div>
      </div>
    </div>
  );
}
