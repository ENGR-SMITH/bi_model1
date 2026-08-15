import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CircleAlert, Download, FileText, History, Hourglass, Inbox, LockKeyhole, MessageCircle, PenLine, Search, Sparkles, Users } from 'lucide-react';
import { Link, Redirect, useLocation, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import {
  getGetCollaborationProjectQueryKey, getGetCollaborationSeedQueryKey, getGetContinuationAdvisoryQueryKey, getGetContinuationQueryKey, getGetContinuationThreadQueryKey, getGetContinuationWriterProfileQueryKey, getGetCollaborationThreadQueryKey, getGetSeedApplicationQueryKey,
  getGetSeedSelectionQueryKey, getListCollaborationActivityQueryKey, getListCollaborationGenealogyQueryKey, getListCollaborationSeedsQueryKey, getListCollaborationStoryBibleQueryKey, getListCollaborationWorkBlocksQueryKey, getListContinuationAnnotationsQueryKey, getListContinuationsQueryKey,
  useApproveCollaborationContract, useApproveCollaborationWorkBlock, useCreateApplicationAdvisory, useCreateCollaborationSeed, useCreateCollaborationStoryBibleEntry, useCreateCollaborationWorkBlock, useCreateSeedApplication, useDeclineContinuation, useGetCollaborationInbox,
  useGetCollaborationProject, useGetCollaborationSeed, useGetContinuation, useGetSeedApplication, useGetSeedSelection, useListCollaborationActivity, useListCollaborationGenealogy, useListCollaborationProjects,
  useGetContinuationAdvisory, useGetContinuationThread, useGetContinuationWriterProfile, useGetCollaborationThread, useListCollaborationSeeds, useListCollaborationStoryBible, useListCollaborationWorkBlocks, useListContinuationAnnotations, useListContinuations, useCreateContinuationAnnotation, useMarkCollaborationNotificationRead, useSaveCollaborationWorkBlockDraft, useSaveSeedApplicationDraft,
  useSelectContinuation, useSendCollaborationMessage, useStartContinuationThread, useSubmitCollaborationWorkBlock, useSubmitSeedApplication,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { SectionEyebrow } from '@/components/protected-shell';

function Frame({ children, eyebrow = 'Author collaboration / private room', title, intro }: { children: ReactNode; eyebrow?: string; title: string; intro?: string }) {
  return <div className="mx-auto max-w-[1180px]">
    <div className="reveal flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-9 md:flex-row md:items-end">
      <div><SectionEyebrow>{eyebrow}</SectionEyebrow><h1 className="mt-5 max-w-[12ch] text-6xl font-extrabold leading-[.86] tracking-[-0.08em] text-[#292b45] sm:text-8xl">{title}</h1></div>
      {intro && <p className="max-w-sm border-l-2 border-[#d6cbb9] pl-5 text-sm leading-[1.8] text-[#625f6d]">{intro}</p>}
    </div>{children}
  </div>;
}
function Loading() { return <div className="mt-10 grid gap-4 md:grid-cols-2"><div className="h-52 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" /><div className="h-52 animate-pulse rounded-[1.5rem] bg-[#e5d7c5]" /></div>; }
function ErrorState({ retry }: { retry?: () => void }) { return <div className="mt-10 rounded-[1.5rem] border-2 border-[#e55b4c]/40 bg-[#fff4e6] p-8"><CircleAlert className="text-[#e55b4c]" /><p className="mt-4 font-display text-3xl italic">The room is having trouble opening.</p><p className="mt-2 text-sm text-[#77717a]">Your work is safe. Try the door again in a moment.</p>{retry && <button onClick={retry} className="focus-house mt-5 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">Try again</button>}</div>; }
function Empty({ title, body, href, action }: { title: string; body: string; href?: string; action?: string }) { return <div className="mt-10 rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-8 shadow-[8px_10px_0_rgba(41,43,69,.07)] sm:p-10"><Sparkles className="h-7 w-7 text-[#e55b4c]" /><p className="mt-7 font-display text-4xl italic">{title}</p><p className="mt-3 max-w-xl text-sm leading-[1.8] text-[#77717a]">{body}</p>{href && <Link href={href} className="focus-house mt-7 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">{action}<ArrowRight className="h-4 w-4" /></Link>}</div>; }
function Pill({ children }: { children: ReactNode }) { return <span className="rounded-full border border-[#d6cbb9] bg-[#f2e7d8] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#625f6d]">{children}</span>; }
function SeedCard({ seed, isOwn }: { seed: any; isOwn?: boolean }) { return <Link href={`/authors/pitch-board/seed/${seed.id}`} className="soft-lift focus-house group block rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-6"><div className="flex items-start justify-between gap-4"><Pill>{seed.genre || 'Open brief'}</Pill><span className="font-mono-ui text-[10px] text-[#98909a]">{seed.respondentCount}/{seed.respondentLimit || '∞'} voices</span></div><h2 className="mt-7 font-display text-3xl italic leading-none">{seed.sourceProjectTitle}</h2><p className="mt-4 line-clamp-3 text-sm leading-[1.8] text-[#625f6d]">{seed.seedText}</p><div className="mt-7 flex items-center justify-between border-t border-[#d6cbb9] pt-4 text-xs text-[#77717a]">{isOwn ? <span className="rounded-full bg-[#f0c85c] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#292b45]">Your seed</span> : <span>{seed.creatorName} · {seed.tone}</span>}<ArrowUpRight className="h-4 w-4 text-[#e55b4c] transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" /></div></Link>; }
function Atrium() {
  const { user } = useUser();
  return <Frame title="Two voices. One room." intro="A considered way to find the right creative counterpart. Seeds stay frozen; the work that follows stays visible.">
    <div className="reveal reveal-1 mt-10 grid gap-5 md:grid-cols-[1.2fr_.8fr]"><Link href="/authors/pitch-board" className="soft-lift focus-house rounded-[1.75rem] bg-[#292b45] p-8 text-[#fff4e6] sm:p-10"><Search className="h-7 w-7 text-[#f0c85c]" /><p className="mt-16 font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#f0c85c]">The pitch board</p><h2 className="mt-3 max-w-[10ch] text-5xl font-extrabold leading-[.9] tracking-[-.07em]">Find a seed worth answering.</h2><p className="mt-5 max-w-sm text-sm leading-relaxed text-[#d9d2cb]">Read the brief. Listen for the opening. Respond only when the work asks for your voice.</p><span className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#e55b4c] px-5 py-3 text-sm font-bold">Browse seeds <ArrowRight className="h-4 w-4" /></span></Link><div className="grid gap-5"><Link href="/authors/collaborations/continuations" className="focus-house rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7"><Inbox className="text-[#3e8074]" /><h2 className="mt-8 font-display text-3xl italic">Your review desk</h2><p className="mt-2 text-sm text-[#77717a]">See the continuations waiting on your eye.</p></Link><Link href="/authors/work" className="focus-house rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#f0c85c] p-7"><Users /><h2 className="mt-8 font-display text-3xl italic">Work in motion</h2><p className="mt-2 text-sm">Solo pieces and Tandem projects, together.</p></Link></div></div>
    <div className="reveal reveal-1 mt-10 grid gap-3 sm:grid-cols-2"><Link href="/inbox" className="soft-lift focus-house rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7"><MessageCircle className="text-[#e55b4c]" /><h2 className="mt-6 font-display text-3xl italic">Your inbox</h2><p className="mt-2 text-sm text-[#77717a]">Urgent work, private threads, and room notes — everything that needs you lives there.</p></Link><Link href="/activity" className="soft-lift focus-house rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7"><FileText className="text-[#3e8074]" /><h2 className="mt-6 font-display text-3xl italic">Your trail</h2><p className="mt-2 text-sm text-[#77717a]">Every publish, submission, selection, and approved pass across your rooms.</p></Link></div>
    <div className="reveal reveal-2 mt-10 flex flex-wrap items-center gap-3 border-t-2 border-[#d6cbb9] pt-6 text-sm text-[#77717a]"><LockKeyhole className="h-4 w-4 text-[#e55b4c]" />Private by design · visible only to the people in the room · welcome, {user?.firstName || 'writer'}</div></Frame>;
}
function CreateSeed() {
  const [, setLocation] = useLocation();
  const create = useCreateCollaborationSeed();
  const [draft] = useState(() => {
    try {
      const raw = localStorage.getItem('tandem-seed-draft');
      return raw ? JSON.parse(raw) as { sourceProjectId?: string; sourceProjectTitle?: string; sourceSceneId?: string | null; sourceVersion?: number; seedText?: string } : {};
    } catch {
      return {};
    }
  });
  const [form, setForm] = useState({
    sourceProjectId: draft.sourceProjectId || 'authors-den-project',
    sourceProjectTitle: draft.sourceProjectTitle || '',
    sourceSceneId: draft.sourceSceneId ?? null,
    sourceVersion: draft.sourceVersion ?? 1,
    seedText: draft.seedText || '',
    unitType: 'scene',
    protocol: 'Continue from the final line',
    genre: 'Literary',
    tone: 'Open and searching',
    language: 'English',
    plotConstraints: '',
    desiredRole: 'Co-author',
    visibility: 'SEED_AND_BRIEF' as 'SEED_AND_BRIEF' | 'SEED_ONLY',
    respondentLimit: 3 as 0 | 3 | 5 | 10,
  });
  const set = (key: keyof typeof form, value: string | number) => setForm(current => ({ ...current, [key]: value }));
  const publish = () => {
    create.mutate({ data: form }, {
      onSuccess: seed => {
        localStorage.removeItem('tandem-seed-draft');
        setLocation(`/authors/pitch-board/seed/${seed.id}`);
      },
    });
  };
  return <Frame eyebrow="Pitch board / publish" title="Leave the door open." intro="Publish a frozen writing seed and a clear brief. Your original project stays yours; this post becomes its own collaboration invitation.">
    <div className="reveal reveal-1 mt-10 grid gap-6 lg:grid-cols-[1fr_.8fr]">
      <section className="rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7 sm:p-9">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Project title</span><input value={form.sourceProjectTitle} onChange={e => set('sourceProjectTitle', e.target.value)} className="mt-2 w-full rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-3 outline-none focus:border-[#e55b4c]" placeholder="The project this seed comes from" /></label>
          <label><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Unit</span><select value={form.unitType} onChange={e => set('unitType', e.target.value)} className="mt-2 w-full rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-3"><option>paragraph</option><option>scene</option><option>chapter</option><option>opening</option><option>ending</option><option>POV</option></select></label>
          <label><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Protocol</span><input value={form.protocol} onChange={e => set('protocol', e.target.value)} className="mt-2 w-full rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-3 outline-none focus:border-[#e55b4c]" /></label>
          <label><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Genre</span><input value={form.genre} onChange={e => set('genre', e.target.value)} className="mt-2 w-full rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-3 outline-none focus:border-[#e55b4c]" /></label>
          <label><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Tone</span><input value={form.tone} onChange={e => set('tone', e.target.value)} className="mt-2 w-full rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-3 outline-none focus:border-[#e55b4c]" /></label>
        </div>
        <label className="mt-5 block"><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Frozen seed</span><textarea value={form.seedText} onChange={e => set('seedText', e.target.value)} className="mt-2 min-h-[260px] w-full rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-4 font-display text-xl leading-relaxed outline-none focus:border-[#e55b4c]" placeholder="The exact passage other writers will see..." /></label>
      </section>
      <aside className="h-fit rounded-[1.5rem] bg-[#3e8074] p-7 text-[#fff4e6] sm:p-9">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#f0c85c]">The brief</p>
        <label className="mt-7 block"><span className="text-sm font-bold">What should a collaborator know?</span><textarea value={form.plotConstraints} onChange={e => set('plotConstraints', e.target.value)} className="mt-3 min-h-[140px] w-full rounded-xl border border-[#fff4e6]/30 bg-[#2f675e] p-4 text-sm leading-relaxed text-[#fff4e6] outline-none placeholder:text-[#d9e7df]/60 focus:border-[#f0c85c]" placeholder="Constraints, characters, or room to explore..." /></label>
        <label className="mt-5 block"><span className="text-sm font-bold">Desired role</span><input value={form.desiredRole} onChange={e => set('desiredRole', e.target.value)} className="mt-3 w-full rounded-xl border border-[#fff4e6]/30 bg-[#2f675e] p-3 text-sm text-[#fff4e6] outline-none focus:border-[#f0c85c]" /></label>
        <label className="mt-5 block"><span className="text-sm font-bold">Respondent limit</span><select value={form.respondentLimit} onChange={e => set('respondentLimit', Number(e.target.value))} className="mt-3 w-full rounded-xl border border-[#fff4e6]/30 bg-[#2f675e] p-3 text-sm text-[#fff4e6]"><option value={3}>3 voices</option><option value={5}>5 voices</option><option value={10}>10 voices</option><option value={0}>Unlimited</option></select></label>
        <label className="mt-5 flex items-center gap-3 text-sm"><input type="checkbox" checked={form.visibility === 'SEED_ONLY'} onChange={e => set('visibility', e.target.checked ? 'SEED_ONLY' : 'SEED_AND_BRIEF')} /> Show only the seed publicly</label>
        {create.isError && <p className="mt-5 rounded-xl bg-[#292b45]/30 p-3 text-sm">This seed could not be published. Check that you are signed in and try again.</p>}
        <button onClick={publish} disabled={create.isPending || !form.sourceProjectTitle.trim() || !form.seedText.trim()} className="focus-house mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#fff4e6] px-5 py-3 text-sm font-bold text-[#292b45] disabled:cursor-not-allowed disabled:opacity-50">{create.isPending ? 'Publishing…' : 'Publish to the pitch board'} <ArrowUpRight className="h-4 w-4" /></button>
      </aside>
    </div>
  </Frame>;
}
type SeedFilters = { genre: string; unit: string; language: string; protocol: string };
function Board() {
  const { user } = useUser();
  const [location] = useLocation();
  const [filters, setFilters] = useState<SeedFilters>(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      genre: params.get('genre') ?? '',
      unit: params.get('unit') ?? '',
      language: params.get('language') ?? '',
      protocol: params.get('protocol') ?? '',
    };
  });
  const params = {
    genre: filters.genre || undefined,
    unit: filters.unit || undefined,
    language: filters.language || undefined,
    protocol: filters.protocol || undefined,
  };
  const q = useListCollaborationSeeds(params, { query: { queryKey: getListCollaborationSeedsQueryKey(params) } });
  const seeds = q.data || [];
  const setFilter = (key: keyof SeedFilters, next: string) => {
    const updated = { ...filters, [key]: next };
    setFilters(updated);
    const search = new URLSearchParams();
    Object.entries(updated).forEach(([name, value]) => { if (value) search.set(name, value); });
    const nextUrl = `${location.split('?')[0]}${search.toString() ? `?${search.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  };
  return <Frame title="The pitch board" intro="Frozen seeds from writers making room for another mind. Filter gently; the right opening is often a quiet one.">
    <div className="mt-8 flex flex-wrap gap-3">
      <label className="sr-only" htmlFor="filter-genre">Filter by genre</label>
      <select id="filter-genre" data-testid="select-filter-genre" value={filters.genre} onChange={e => setFilter('genre', e.target.value)} className="rounded-full border-2 border-[#d6cbb9] bg-[#fff4e6] px-4 py-3 text-sm"><option value="">All genres</option><option>Literary</option><option>Speculative</option><option>Romance</option><option>Crime</option></select>
      <label className="sr-only" htmlFor="filter-unit">Filter by unit</label>
      <select id="filter-unit" data-testid="select-filter-unit" value={filters.unit} onChange={e => setFilter('unit', e.target.value)} className="rounded-full border-2 border-[#d6cbb9] bg-[#fff4e6] px-4 py-3 text-sm"><option value="">Any unit</option><option value="paragraph">Paragraph</option><option value="scene">Scene</option><option value="chapter">Chapter</option><option value="opening">Opening</option><option value="ending">Ending</option><option value="POV">POV</option></select>
      <label className="sr-only" htmlFor="filter-language">Filter by language</label>
      <select id="filter-language" data-testid="select-filter-language" value={filters.language} onChange={e => setFilter('language', e.target.value)} className="rounded-full border-2 border-[#d6cbb9] bg-[#fff4e6] px-4 py-3 text-sm"><option value="">Any language</option><option>English</option><option>Yoruba</option><option>French</option><option>Spanish</option></select>
      <label className="sr-only" htmlFor="filter-protocol">Filter by protocol</label>
      <select id="filter-protocol" data-testid="select-filter-protocol" value={filters.protocol} onChange={e => setFilter('protocol', e.target.value)} className="rounded-full border-2 border-[#d6cbb9] bg-[#fff4e6] px-4 py-3 text-sm"><option value="">Any protocol</option><option value="Continue from the final line">Continue from the final line</option><option value="Write the next scene">Write the next scene</option></select>
      <Link href="/authors/pitch-board/new" className="focus-house inline-flex items-center gap-2 rounded-full bg-[#e55b4c] px-4 py-3 text-sm font-bold text-[#fff4e6]"><PenLine className="h-4 w-4" />Publish a seed</Link>
      <Link href="/authors/atrium" className="focus-house inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold text-[#77717a]"><ArrowLeft className="h-4 w-4" />Atrium</Link>
    </div>
    {q.isLoading ? <Loading /> : q.isError ? <ErrorState retry={q.refetch} /> : seeds.length ? <div className="mt-8 grid gap-5 md:grid-cols-2">{seeds.map(seed => <SeedCard key={seed.id} seed={seed} isOwn={seed.creatorId === user?.id} />)}</div> : <Empty title="The board is between offerings." body="No open seeds match those filters yet. Clear a filter or leave a new brief open for another writer." href="/authors/pitch-board/new" action="Publish the first seed" />}
  </Frame>;
}
function SeedDetail() {
  const { seedId } = useParams<{ seedId: string }>();
  const { user } = useUser();
  const q = useGetCollaborationSeed(seedId || '', { query: { queryKey: getGetCollaborationSeedQueryKey(seedId || '') } });
  if (q.isLoading) return <Frame title="Opening the seed"><Loading /></Frame>;
  if (q.isError || !q.data) return <Frame title="Seed unavailable"><ErrorState retry={q.refetch} /></Frame>;
  const s = q.data;
  const isOwnSeed = Boolean(user && s.creatorId === user.id);
  const available = s.availability === 'OPEN' && (s.respondentLimit === 0 || s.respondentCount < s.respondentLimit);
  return <Frame eyebrow="Pitch board / read only" title={s.sourceProjectTitle} intro={isOwnSeed ? "This is your seed. You cannot answer your own post — its continuation belongs to another writer." : `A seed by ${s.creatorName}. Read it as given; this is the shape the creator is protecting.`}>
    <article className="reveal reveal-1 mt-10 grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-8 sm:p-12"><Pill>{s.unitType} · {s.genre}</Pill><p className="mt-10 whitespace-pre-wrap font-display text-3xl leading-[1.25] text-[#292b45] sm:text-4xl">{s.seedText}</p><div className="mt-12 border-t border-[#d6cbb9] pt-6 text-sm leading-relaxed text-[#625f6d]"><strong className="text-[#292b45]">The brief</strong><p className="mt-2">{s.plotConstraints || 'Bring a clear instinct and leave room for surprise.'}</p></div></div>
      <aside className="h-fit rounded-[1.5rem] bg-[#3e8074] p-7 text-[#fff4e6]"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#f0c85c]">Protocol</p><h2 className="mt-4 font-display text-3xl italic">{s.protocol}</h2><dl className="mt-8 space-y-4 text-sm"><div><dt className="opacity-60">Desired role</dt><dd className="mt-1 font-bold">{s.desiredRole}</dd></div><div><dt className="opacity-60">Tone</dt><dd className="mt-1 font-bold">{s.tone}</dd></div><div><dt className="opacity-60">Language</dt><dd className="mt-1 font-bold">{s.language}</dd></div><div><dt className="opacity-60">Availability</dt><dd className="mt-1 font-bold">{available ? `${s.respondentCount}/${s.respondentLimit || '∞'} voices` : 'Closed or full'}</dd></div></dl>{isOwnSeed ? <div className="mt-9 rounded-xl border border-[#fff4e6]/30 bg-[#2f675e] p-4 text-sm leading-relaxed text-[#d9e7df]">This is your own seed. The pitch board is for other writers to answer; you cannot reply to your own post.</div> : available ? <Link href={`/authors/pitch-board/seed/${s.id}/respond`} className="focus-house mt-9 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#fff4e6] px-4 py-3 text-sm font-bold text-[#292b45]">Answer this seed <PenLine className="h-4 w-4" /></Link> : <div className="mt-9 rounded-xl border border-[#fff4e6]/30 bg-[#2f675e] p-4 text-sm leading-relaxed text-[#d9e7df]">This seed is no longer accepting new continuations. Its published text remains read-only.</div>}</aside>
    </article>
  </Frame>;
}
function Respond() {
  const { seedId } = useParams<{ seedId: string }>();
  const seedQ = useGetCollaborationSeed(seedId || '', { query: { queryKey: getGetCollaborationSeedQueryKey(seedId || '') } });
  const existingApplicationId = seedQ.data?.myApplicationId ?? '';
  const applicationQ = useGetSeedApplication(existingApplicationId, { query: { enabled: Boolean(existingApplicationId), queryKey: getGetSeedApplicationQueryKey(existingApplicationId) } });
  const create = useCreateSeedApplication();
  const save = useSaveSeedApplicationDraft();
  const submit = useSubmitSeedApplication();
  const advisory = useCreateApplicationAdvisory();
  const [applicationId, setApplicationId] = useState('');
  const [text, setText] = useState('');
  const [comments, setComments] = useState('');
  const [advisoryResult, setAdvisoryResult] = useState<any>(null);
  const [submitError, setSubmitError] = useState('');
  const qc = useQueryClient();
  const rememberClone = (application: { id: string; seedId: string; sourceProjectTitle: string; status: string }) => {
    try {
      const current = JSON.parse(localStorage.getItem('tandem-continuation-clones') || '[]') as Array<Record<string, string>>;
      const next = current.filter(item => item.applicationId !== application.id);
      next.unshift({ applicationId: application.id, seedId: application.seedId, sourceProjectTitle: application.sourceProjectTitle, status: application.status, updatedAt: new Date().toISOString() });
      localStorage.setItem('tandem-continuation-clones', JSON.stringify(next.slice(0, 20)));
    } catch {
      // The server remains the source of truth if browser storage is unavailable.
    }
  };
  useEffect(() => {
    if (!applicationQ.data) return;
    setApplicationId(applicationQ.data.id);
    setText(applicationQ.data.draftText);
    setComments(applicationQ.data.draftComments);
    rememberClone(applicationQ.data);
  }, [applicationQ.data]);
  const ensure = (after?: (id: string) => void) => {
    if (applicationId) { after?.(applicationId); return; }
    create.mutate({ seedId: seedId || '', data: { respondentName: 'Writer' } }, { onSuccess: a => { setApplicationId(a.id); rememberClone(a); after?.(a.id); } });
  };
  const saveDraft = () => ensure(id => save.mutate({ applicationId: id, data: { draftText: text, draftComments: comments } }));
  // The server submits the saved draft, so Submit always persists the latest
  // text first, then submits, then refreshes the seed so the page flips to the
  // “in review” state. Errors are surfaced inline instead of failing silently.
  const submitDraft = () => ensure(id => {
    setSubmitError('');
    save.mutate(
      { applicationId: id, data: { draftText: text, draftComments: comments } },
      {
        onSuccess: () => submit.mutate({ applicationId: id }, {
          onSuccess: submission => {
            rememberClone({ id, seedId: submission.seedId, sourceProjectTitle: submission.sourceProjectTitle, status: submission.status });
            qc.invalidateQueries({ queryKey: getGetCollaborationSeedQueryKey(seedId || '') });
            qc.invalidateQueries({ queryKey: getGetSeedApplicationQueryKey(id) });
          },
          onError: (e: any) => setSubmitError(e?.message || 'The submission could not be sent. Your draft is still here.'),
        }),
        onError: (e: any) => setSubmitError(e?.message || 'Your draft could not be saved before submitting.'),
      },
    );
  });
  const runAdvisory = () => ensure(id => advisory.mutate({ applicationId: id }, { onSuccess: result => setAdvisoryResult(result) }));
  const count = text.trim() ? text.trim().split(/\s+/).length : 0;
  const locked = Boolean(seedQ.data?.myApplicationStatus && seedQ.data.myApplicationStatus !== 'DRAFT');
  return <Frame eyebrow="Pitch board / response" title={locked ? "Your continuation is in review." : "Make an opening."} intro={locked ? "This submission is locked while the creator reviews it. The frozen seed remains read-only." : "This is a private draft. Nothing leaves your desk until you choose to submit it."}>
    <div className="reveal reveal-1 mt-10 grid gap-6 lg:grid-cols-[.7fr_1.3fr]">
      <div className="rounded-[1.5rem] bg-[#292b45] p-7 text-[#fff4e6]"><BookOpen className="text-[#f0c85c]" /><p className="mt-8 font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#f0c85c]">Private clone · source seed</p><p className="mt-3 font-display text-3xl italic">{seedQ.data?.sourceProjectTitle || 'Loading seed…'}</p><p className="mt-5 whitespace-pre-wrap text-sm leading-[1.8] text-[#d9d2cb]">{seedQ.data?.seedText}</p><div className="mt-8 border-t border-[#fff4e6]/20 pt-4 text-xs text-[#d9d2cb]">The seed is frozen. Only your continuation and note can change.</div></div>
      <div className="rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7">
        {locked && <div className="mb-6 rounded-xl border border-[#3e8074]/30 bg-[#e4f1eb] p-4 text-sm leading-relaxed text-[#2f675e]">Submitted {seedQ.data?.myApplicationStatus?.toLowerCase().replaceAll('_', ' ')} · waiting for the creator’s decision.</div>}
        <label className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]" htmlFor="continuation-text">Your continuation</label>
        <textarea id="continuation-text" data-testid="input-continuation-text" value={text} disabled={locked} onChange={e => setText(e.target.value)} onFocus={() => ensure()} className="mt-4 min-h-[300px] w-full resize-y rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-4 font-display text-xl leading-relaxed outline-none focus:border-[#e55b4c] disabled:cursor-not-allowed disabled:opacity-70" placeholder="Begin where the seed leaves you..." />
        <div className="mt-2 text-right font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#77717a]">{count} words</div>
        <label className="mt-6 block font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]" htmlFor="draft-comments">A note for the creator</label>
        <textarea id="draft-comments" data-testid="input-draft-comments" value={comments} disabled={locked} onChange={e => setComments(e.target.value)} className="mt-3 min-h-[90px] w-full rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-4 text-sm outline-none focus:border-[#e55b4c] disabled:cursor-not-allowed disabled:opacity-70" />
        <p className="mt-2 text-xs leading-relaxed text-[#77717a]">Voice-note attachments are not enabled in the current studio, so this private handoff uses text comments only.</p>
        {!locked && <div className="mt-6 flex flex-wrap gap-3"><button data-testid="button-advisory-check" onClick={runAdvisory} disabled={advisory.isPending || create.isPending || !text.trim()} className="focus-house inline-flex items-center gap-2 rounded-full border-2 border-[#3e8074] px-5 py-3 text-sm font-bold text-[#2f675e]">{advisory.isPending ? 'Checking…' : <><Sparkles className="h-4 w-4" />Advisory check</>}</button><button onClick={saveDraft} disabled={save.isPending || create.isPending || !text.trim()} className="focus-house rounded-full border-2 border-[#292b45] px-5 py-3 text-sm font-bold">{save.isPending ? 'Saving…' : 'Save draft'}</button><button onClick={submitDraft} disabled={!text.trim() || save.isPending || submit.isPending || create.isPending} className="focus-house rounded-full bg-[#e55b4c] px-5 py-3 text-sm font-bold text-[#fff4e6]">{submit.isPending ? 'Submitting…' : 'Submit continuation'}</button></div>}
        {submitError && <p role="alert" className="mt-4 rounded-xl bg-[#fff0e7] p-3 text-sm text-[#a94437]">{submitError}</p>}
        {advisoryResult && <div data-testid="panel-advisory-result" className="mt-6 rounded-2xl border-2 border-[#d6cbb9] bg-[#f2e7d8] p-5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Advisory observations</p><span className="rounded-full bg-[#3e8074] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#fff4e6]">{advisoryResult.source === 'oracle' ? 'Story Oracle' : 'Local checks'}</span></div><p className="mt-2 text-xs leading-relaxed text-[#77717a]">{advisoryResult.disclaimer}</p>{advisoryResult.note && <p className="mt-2 text-xs leading-relaxed text-[#77717a]">{advisoryResult.note}</p>}<div className="mt-4 space-y-3">{advisoryResult.signals.map((signal: any) => <div key={`${signal.category}-${signal.title}`} className="rounded-xl bg-[#fff4e6] p-4"><div className="flex justify-between gap-3 text-sm font-bold"><span>{signal.title}</span><span className="font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#e55b4c]">{signal.level}</span></div><p className="mt-2 text-xs leading-relaxed text-[#625f6d]">{signal.detail}</p></div>)}</div><p className="mt-4 text-xs leading-relaxed text-[#77717a]">This check never decides for you. Submitting is always yours — ignore or act on these notes as you see fit.</p></div>}
      </div>
    </div>
  </Frame>;
}

function Continuations() {
  const q = useListContinuations({ query: { queryKey: getListContinuationsQueryKey() } });
  const inbox = useGetCollaborationInbox({ query: { queryKey: ['collaboration-inbox'] } });
  const decline = useDeclineContinuation(); const select = useSelectContinuation(); const qc = useQueryClient();
  const rows: any[] = q.data || []; const unread = new Set((inbox.data || []).filter((n: any) => !n.read).map((n: any) => n.resourceId));
  const refresh = () => { qc.invalidateQueries({ queryKey: getListContinuationsQueryKey() }); qc.invalidateQueries({ queryKey: ['collaboration-inbox'] }); };
  return <Frame title="The review desk" intro="A continuation is a generous thing to receive. Read each one slowly, then choose with clarity.">
    <div className="mt-10 space-y-4">{q.isLoading ? <Loading /> : q.isError ? <ErrorState retry={q.refetch} /> : rows.length ? rows.map(c =>
      <article key={c.id} data-testid={`continuation-row-${c.id}`} className={`soft-lift rounded-[1.5rem] border-2 p-6 ${unread.has(c.id) || !c.read ? 'border-[#e55b4c]/50 bg-[#fff4e6]' : 'border-[#d6cbb9] bg-[#fff4e6]'}`}>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><Pill>{c.status.replaceAll('_', ' ')}</Pill>{(!c.read || unread.has(c.id)) && <span className="rounded-full bg-[#e55b4c] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#fff4e6]">New</span>}</div><h2 className="mt-4 font-display text-3xl italic">{c.sourceProjectTitle}</h2><p className="mt-1 text-sm text-[#77717a]">From {c.respondentName} · submitted {new Date(c.submittedAt).toLocaleDateString()}</p></div><Link data-testid={`link-read-continuation-${c.id}`} href={`/authors/collaborations/continuation/${c.id}`} className="focus-house rounded-full border border-[#d6cbb9] px-4 py-2 text-sm font-bold">Read closely <ArrowRight className="ml-1 inline h-4 w-4" /></Link></div>
        <p className="mt-5 line-clamp-2 text-sm leading-relaxed text-[#625f6d]">{c.continuationText}</p><div className="mt-5 flex flex-wrap gap-2"><button data-testid={`button-select-${c.id}`} disabled={select.isPending || c.status !== 'UNDER_REVIEW'} onClick={() => select.mutate({ continuationId: c.id }, { onSuccess: p => setTimeout(() => window.location.assign(`/authors/tandem/${p.id}/contract`), 0) })} className="focus-house rounded-full bg-[#3e8074] px-4 py-2 text-xs font-bold text-[#fff4e6] disabled:opacity-40">{select.isPending ? 'Selecting…' : 'Select'}</button><button data-testid={`button-decline-${c.id}`} disabled={decline.isPending || c.status !== 'UNDER_REVIEW'} onClick={() => decline.mutate({ continuationId: c.id }, { onSuccess: refresh })} className="focus-house rounded-full border border-[#d6cbb9] px-4 py-2 text-xs font-bold text-[#77717a] disabled:opacity-40">{decline.isPending ? 'Archiving…' : 'Decline & archive'}</button></div>
      </article>) : <Empty title="Nothing is waiting on you." body="When a writer answers one of your seeds, their work will arrive here with the seed that called it forward." href="/authors/atrium" action="Back to collaboration" />}</div>
  </Frame>;
}
function SelectionRoom() {
  const { seedId } = useParams<{ seedId: string }>();
  const [, setLocation] = useLocation();
  const q = useGetSeedSelection(seedId || '', { query: { queryKey: getGetSeedSelectionQueryKey(seedId || '') } });
  const select = useSelectContinuation();
  const [view, setView] = useState<'text' | 'comments' | 'voice'>('text');
  const rows: any[] = q.data || [];
  return <Frame eyebrow="Review desk / selection room" title="Choose the next voice." intro="Compare submitted continuations without importing any respondent project into your Studio. Selection remains yours; advisory signals never decide for you.">
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <div className="flex rounded-full border-2 border-[#d6cbb9] bg-[#f2e7d8] p-1" role="tablist" aria-label="Selection views">
        {([['text', 'Their text'], ['comments', 'Their comments'], ['voice', 'Voice notes']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`rounded-full px-4 py-2 text-xs font-bold ${view === id ? 'bg-[#292b45] text-[#fff4e6]' : 'text-[#77717a]'}`}>{label}</button>)}
      </div>
      <Link href="/authors/collaborations/continuations" className="focus-house inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-[#77717a]"><ArrowLeft className="h-4 w-4" />Review desk</Link>
    </div>
    {q.isLoading ? <Loading /> : q.isError ? <ErrorState retry={q.refetch} /> : rows.length ? <div className="mt-8 grid gap-5 lg:grid-cols-2">{rows.map((c) => <article key={c.id} className="rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7"><div className="flex items-start justify-between gap-4"><div><Pill>{c.status}</Pill><h2 className="mt-4 font-display text-3xl italic">{c.respondentName}</h2><p className="mt-1 text-xs text-[#77717a]">Submitted {new Date(c.submittedAt).toLocaleDateString()}</p></div><span className="rounded-full bg-[#f0c85c] px-3 py-1 text-[10px] font-bold uppercase tracking-[.12em]">Human choice</span></div>{view === 'text' && <p className="mt-7 whitespace-pre-wrap font-display text-xl leading-relaxed text-[#292b45]">{c.continuationText}</p>}{view === 'comments' && <div className="mt-7 rounded-xl bg-[#f2e7d8] p-5 text-sm leading-relaxed text-[#625f6d]">{c.comments || 'This writer left no separate note.'}</div>}{view === 'voice' && <div className="mt-7 rounded-xl border border-dashed border-[#d6cbb9] p-5 text-sm leading-relaxed text-[#77717a]">No voice-note attachment is available in the current studio.</div>}<div className="mt-7 flex flex-wrap gap-3 border-t border-[#d6cbb9] pt-5"><Link href={`/authors/collaborations/continuation/${c.id}`} className="focus-house rounded-full border border-[#d6cbb9] px-4 py-2 text-xs font-bold">Open read-only preview</Link><button disabled={c.status !== 'UNDER_REVIEW' || select.isPending} onClick={() => select.mutate({ continuationId: c.id }, { onSuccess: project => setLocation(`/authors/tandem/${project.id}/contract`) })} className="focus-house rounded-full bg-[#3e8074] px-4 py-2 text-xs font-bold text-[#fff4e6] disabled:cursor-not-allowed disabled:opacity-40">{c.status === 'UNDER_REVIEW' ? 'Select & open contract' : 'Selection unavailable'}</button></div></article>)}</div> : <Empty title="No submitted continuations yet." body="The selection room will fill when writers submit responses to this seed." href="/authors/collaborations/continuations" action="Back to review desk" />}
  </Frame>;
}
function AnnotatedText({ text, annotations }: { text: string; annotations: any[] }) {
  const sorted = [...annotations].sort((a, b) => a.rangeStart - b.rangeStart);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const ann of sorted) {
    if (ann.rangeStart > cursor) parts.push(text.slice(cursor, ann.rangeStart));
    if (ann.rangeEnd > ann.rangeStart) {
      parts.push(<mark key={ann.id} title={ann.body} className="rounded bg-[#f0c85c]/70 px-0.5">{text.slice(ann.rangeStart, ann.rangeEnd)}</mark>);
    }
    cursor = Math.max(cursor, ann.rangeEnd);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
function ContinuationDetail() {
  const { continuationId = '' } = useParams<{ continuationId: string }>(); const [, setLocation] = useLocation(); const qc = useQueryClient();
  const q = useGetContinuation(continuationId, { query: { enabled: Boolean(continuationId), queryKey: getGetContinuationQueryKey(continuationId) } });
  const profile = useGetContinuationWriterProfile(continuationId, { query: { enabled: Boolean(continuationId), queryKey: getGetContinuationWriterProfileQueryKey(continuationId) } });
  const advisory = useGetContinuationAdvisory(continuationId, { query: { enabled: Boolean(continuationId), queryKey: getGetContinuationAdvisoryQueryKey(continuationId) } });
  const thread = useGetContinuationThread(continuationId, { query: { enabled: Boolean(continuationId), queryKey: getGetContinuationThreadQueryKey(continuationId) } });
  const annotationsQ = useListContinuationAnnotations(continuationId, { query: { enabled: Boolean(continuationId), queryKey: getListContinuationAnnotationsQueryKey(continuationId) } });
  const createAnnotation = useCreateContinuationAnnotation();
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [annBody, setAnnBody] = useState('');
  const start = useStartContinuationThread(); const select = useSelectContinuation(); const decline = useDeclineContinuation();
  if (q.isLoading) return <Frame title="Opening continuation"><Loading /></Frame>; if (q.isError || !q.data) return <Frame title="Unavailable"><ErrorState retry={q.refetch} /></Frame>;
  const c: any = q.data; const p: any = profile.data; const a: any = advisory.data; const existingThread: any = thread.data;
  const annotations: any[] = annotationsQ.data || [];
  // Capture a text selection as stable plain-text offsets (rangeStart/rangeEnd)
  // so annotations anchor to the immutable submission, never to DOM state.
  const handleSelect = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount < 1) { setSel(null); return; }
    const el = e.currentTarget as HTMLElement;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) { setSel(null); return; }
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    setSel({ start: pre.toString().length, end: pre.toString().length + range.toString().length });
  };
  const saveAnnotation = () => {
    if (!sel || !annBody.trim()) return;
    createAnnotation.mutate({ continuationId, data: { rangeStart: sel.start, rangeEnd: sel.end, body: annBody.trim() } }, {
      onSuccess: () => { setSel(null); setAnnBody(''); qc.invalidateQueries({ queryKey: getListContinuationAnnotationsQueryKey(continuationId) }); },
    });
  };
  const authorLabel = (authorId: string) => authorId === c.creatorId ? 'Creator' : c.respondentName;
  const openThread = () => start.mutate({ continuationId }, { onSuccess: t => { qc.invalidateQueries({ queryKey: getGetContinuationThreadQueryKey(continuationId) }); setLocation(`/authors/collaborations/thread/${t.id}`); } });
  return <Frame eyebrow="Review desk / read only" title={c.sourceProjectTitle} intro={`A response from ${c.respondentName}. The seed and its answer stay side by side. Nothing here changes the submitted text.`}>
    <div className="mt-10 grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><div className="space-y-5"><div className="rounded-[1.5rem] bg-[#f0c85c] p-8"><Pill>Frozen seed</Pill><p data-testid="text-frozen-seed" className="mt-8 whitespace-pre-wrap font-display text-2xl leading-[1.35]">{c.seedText}</p></div><div className="rounded-[1.5rem] bg-[#fff4e6] p-8 shadow-[8px_10px_0_rgba(41,43,69,.07)]"><Pill>Continuation</Pill><p data-testid="text-continuation" onMouseUp={handleSelect} className="mt-8 select-text whitespace-pre-wrap font-display text-2xl leading-[1.35]"><AnnotatedText text={c.continuationText} annotations={annotations} /></p><p className="mt-3 text-xs text-[#77717a]">Select any passage to annotate it. Annotations are anchored to the submitted text and never edit it.</p>{sel && <div className="mt-4 rounded-xl border-2 border-[#f0c85c] bg-[#f2e7d8] p-4"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Annotate characters {sel.start}–{sel.end}</p><textarea value={annBody} onChange={e => setAnnBody(e.target.value)} placeholder="A note for the writer about this passage…" className="mt-3 min-h-[70px] w-full rounded-xl border border-[#d6cbb9] bg-[#fff4e6] p-3 text-sm outline-none focus:border-[#e55b4c]" /><div className="mt-3 flex gap-2"><button data-testid="button-save-annotation" onClick={saveAnnotation} disabled={createAnnotation.isPending || !annBody.trim()} className="focus-house rounded-full bg-[#292b45] px-4 py-2 text-xs font-bold text-[#fff4e6] disabled:opacity-40">{createAnnotation.isPending ? 'Saving…' : 'Save annotation'}</button><button onClick={() => { setSel(null); setAnnBody(''); }} className="focus-house rounded-full border border-[#d6cbb9] px-4 py-2 text-xs font-bold text-[#77717a]">Cancel</button></div></div>}<div className="mt-6 space-y-3">{annotations.length ? annotations.map(ann => <div key={ann.id} data-testid={`annotation-${ann.id}`} className="rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-4 text-sm"><p className="font-bold">{authorLabel(ann.authorId)} <span className="font-normal text-[#77717a]">· characters {ann.rangeStart}–{ann.rangeEnd}</span></p><p className="mt-1 leading-relaxed text-[#625f6d]">“{c.continuationText.slice(ann.rangeStart, ann.rangeEnd)}”</p><p className="mt-2 text-[#292b45]">{ann.body}</p></div>) : <p className="text-xs text-[#98909a]">No annotations yet.</p>}</div><div className="mt-8 border-t border-[#d6cbb9] pt-5 text-sm leading-relaxed text-[#625f6d]"><strong className="text-[#292b45]">A note from the writer</strong><p className="mt-2">{c.comments || 'No separate note was left.'}</p></div></div></div>
      <aside className="space-y-5"><section className="rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-6"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#3e8074] text-lg font-bold text-[#fff4e6]">{(p?.displayName || c.respondentName || 'W').slice(0,1)}</span><div><p className="font-bold">{p?.displayName || c.respondentName}</p><p className="text-xs text-[#77717a]">Writer profile</p></div></div>{p ? <><p className="mt-5 text-sm leading-relaxed text-[#625f6d]">{p.bio || 'This writer has not added a biography yet.'}</p><div className="mt-5 flex flex-wrap gap-2">{[...(p.genres || []), ...(p.tones || [])].map((x: string) => <Pill key={x}>{x}</Pill>)}</div><dl className="mt-6 grid grid-cols-3 gap-2 border-t border-[#d6cbb9] pt-5 text-center"><div><dt className="font-mono-ui text-[9px] uppercase text-[#77717a]">Sent</dt><dd className="mt-1 text-xl font-bold">{p.submittedCount}</dd></div><div><dt className="font-mono-ui text-[9px] uppercase text-[#77717a]">Accepted</dt><dd className="mt-1 text-xl font-bold">{p.acceptedCount}</dd></div><div><dt className="font-mono-ui text-[9px] uppercase text-[#77717a]">Completed</dt><dd className="mt-1 text-xl font-bold">{p.completedCount}</dd></div></dl></> : <div className="mt-5 h-20 animate-pulse rounded-xl bg-[#f2e7d8]" />}</section>
        {a && <section className="rounded-[1.5rem] bg-[#3e8074] p-6 text-[#fff4e6]"><div className="flex items-center justify-between gap-3"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#f0c85c]">Advisory signals</p><span className="rounded-full bg-[#2f675e] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#f0c85c]">{a.source === 'oracle' ? 'Story Oracle' : 'Local checks'}</span></div><p className="mt-3 text-xs leading-relaxed text-[#d9e7df]">{a.disclaimer}</p>{a.note && <p className="mt-2 text-xs leading-relaxed text-[#d9e7df]">{a.note}</p>}<div className="mt-5 space-y-3">{a.signals.map((s: any) => <div key={`${s.category}-${s.title}`} className="rounded-xl bg-[#2f675e] p-4"><div className="flex justify-between gap-3 text-sm font-bold"><span>{s.title}</span><span className="font-mono-ui text-[9px] uppercase text-[#f0c85c]">{s.level}</span></div><p className="mt-2 text-xs leading-relaxed text-[#d9e7df]">{s.detail}</p></div>)}</div></section>}
        <section className="rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#f2e7d8] p-6"><div className="flex items-center gap-3"><MessageCircle className="text-[#e55b4c]" /><div><p className="font-bold">Private conversation</p><p className="text-xs text-[#77717a]">Only the two people in this room can read it.</p></div></div><button data-testid="button-open-thread" onClick={() => existingThread ? setLocation(`/authors/collaborations/thread/${existingThread.id}`) : openThread()} disabled={start.isPending} className="focus-house mt-5 w-full rounded-full bg-[#292b45] px-4 py-3 text-sm font-bold text-[#fff4e6]">{start.isPending ? 'Opening…' : existingThread ? 'Open private thread' : 'Start private thread'}</button></section>
        <div className="flex flex-wrap gap-2"><button data-testid="button-select-continuation" disabled={select.isPending || c.status !== 'UNDER_REVIEW'} onClick={() => select.mutate({ continuationId: c.id }, { onSuccess: p => setLocation(`/authors/tandem/${p.id}/contract`) })} className="focus-house rounded-full bg-[#3e8074] px-5 py-3 text-sm font-bold text-[#fff4e6] disabled:opacity-40">{select.isPending ? 'Selecting…' : 'Select continuation'} <Check className="ml-1 inline h-4 w-4" /></button><button data-testid="button-archive-continuation" disabled={decline.isPending || c.status !== 'UNDER_REVIEW'} onClick={() => decline.mutate({ continuationId }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListContinuationsQueryKey() }); setLocation('/authors/collaborations/continuations'); } })} className="focus-house rounded-full border border-[#d6cbb9] px-5 py-3 text-sm font-bold text-[#77717a]">Decline & archive</button></div></aside></div>
  </Frame>;
}
function ThreadPage() {
  const { threadId = '' } = useParams<{ threadId: string }>(); const [, setLocation] = useLocation(); const { user } = useUser(); const qc = useQueryClient();
  const q = useGetCollaborationThread(threadId, { query: { enabled: Boolean(threadId), queryKey: getGetCollaborationThreadQueryKey(threadId) } });
  const send = useSendCollaborationMessage(); const [body, setBody] = useState('');
  const thread: any = q.data; const messages: any[] = thread?.messages || [];
  const submit = () => { const next = body.trim(); if (!next) return; send.mutate({ threadId, data: { body: next } }, { onSuccess: () => { setBody(''); qc.invalidateQueries({ queryKey: getGetCollaborationThreadQueryKey(threadId) }); } }); };
  if (q.isLoading) return <Frame title="Opening the thread"><Loading /></Frame>;
  if (q.isError || !thread) return <Frame title="Thread unavailable"><ErrorState retry={q.refetch} /></Frame>;
  return <Frame eyebrow="Private room / messages" title="A careful conversation." intro="This thread belongs only to the creator and respondent. Keep the work in the room; project text is never imported here.">
    <div className="reveal reveal-1 mt-10 max-w-3xl rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5 sm:p-8"><div className="flex items-center justify-between border-b border-[#d6cbb9] pb-5"><div className="flex items-center gap-3"><MessageCircle className="text-[#e55b4c]" /><div><p className="font-bold">Private thread</p><p className="text-xs text-[#77717a]">Started {new Date(thread.createdAt).toLocaleDateString()}</p></div></div><Link href={`/authors/collaborations/continuation/${thread.continuationId}`} className="focus-house rounded-full border border-[#d6cbb9] px-3 py-2 text-xs font-bold">Back to submission</Link></div>
      <div className="my-7 min-h-[260px] space-y-4" aria-live="polite">{messages.length ? messages.map(m => <div key={m.id} data-testid={`message-${m.id}`} className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${m.senderId === user?.id ? 'ml-auto bg-[#292b45] text-[#fff4e6]' : 'bg-[#f2e7d8] text-[#625f6d]'}`}><p>{m.body}</p><time className="mt-2 block font-mono-ui text-[9px] opacity-60">{new Date(m.createdAt).toLocaleString()}</time></div>) : <div className="rounded-xl border border-dashed border-[#d6cbb9] p-6 text-center text-sm text-[#77717a]">No messages yet. Begin with a clear question or a generous hello.</div>}</div>
      {send.isError && <p className="mb-3 rounded-xl bg-[#fff0e7] p-3 text-sm text-[#a94437]">That message could not be sent. Your draft is still here.</p>}<div className="border-t border-[#d6cbb9] pt-5"><label htmlFor="thread-message" className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Write to the room</label><textarea id="thread-message" data-testid="input-thread-message" value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }} placeholder="A note, a question, a thought worth sharing…" className="mt-3 min-h-[110px] w-full resize-y rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-4 text-sm leading-relaxed outline-none focus:border-[#e55b4c]" /><div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-[#77717a]">Ctrl or Cmd + Enter to send</span><button data-testid="button-send-message" onClick={submit} disabled={send.isPending || !body.trim()} className="focus-house rounded-full bg-[#e55b4c] px-5 py-3 text-sm font-bold text-[#fff4e6] disabled:opacity-40">{send.isPending ? 'Sending…' : 'Send message'}</button></div></div>
    </div>
  </Frame>;
}

// The account-wide inbox lives at /inbox (notifications + conversation
// threads). Keep the collaboration route as a redirect so both paths agree.
function InboxPage() { return <Redirect to="/inbox" />; }
function WorkSolo() { return <Redirect to="/authors-den/" />; }
function RequestsPage() {
  const q = useGetCollaborationInbox({ query: { queryKey: ['collaboration-requests'] } });
  const mark = useMarkCollaborationNotificationRead(); const [, setLocation] = useLocation();
  const notes: any[] = (q.data || []).filter((n: any) => ['contract_action_required', 'contract_locked', 'respondent_selected'].includes(n.category));
  return <Frame eyebrow="Collaboration / requests" title="Requests waiting on you." intro="Partner invitations, contract approvals, and selection decisions — gathered in one place.">{q.isLoading ? <Loading /> : q.isError ? <ErrorState retry={q.refetch} /> : notes.length ? <div className="mt-10 space-y-3">{notes.map(n => <button key={n.id} data-testid={`request-${n.id}`} onClick={() => { mark.mutate({ notificationId: n.id }); if (n.deepLink) setLocation(n.deepLink); }} className="focus-house flex w-full items-start gap-4 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5 text-left"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#e55b4c]" /><span><span className="block font-bold">{n.title}</span><span className="mt-1 block text-sm leading-relaxed text-[#77717a]">{n.body}</span><span className="mt-2 block font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">{n.category.replaceAll('_', ' ')}</span></span></button>)}</div> : <Empty title="Nothing needs your answer." body="Contract approvals and selection requests will land here when they need your decision." href="/authors/collaborations/continuations" action="Back to review desk" />}</Frame>; }
function SystemPage() {
  return <Frame eyebrow="Collaboration / system" title="The quiet room." intro="Guardian alerts, reminders, and reveal-ready events are advisory in this release — nothing here ever blocks your work."><div className="mt-10 rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-8 sm:p-10"><Sparkles className="h-7 w-7 text-[#e55b4c]" /><p className="mt-7 font-display text-4xl italic">No alerts are active.</p><p className="mt-3 max-w-xl text-sm leading-[1.8] text-[#77717a]">Automated guardian alerts, reminders, and delta reports are future scope. Advisory observations for continuations already appear inside the review desk when you open a submission.</p><Link href="/authors/collaborations/continuations" className="focus-house mt-7 inline-flex items-center gap-2 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">Open review desk <ArrowRight className="h-4 w-4" /></Link></div></Frame>; }
function Work() { const q = useListCollaborationProjects(); return <Frame title="Work in motion." intro="A home for the pieces you make alone and the rooms you build with another writer."><div className="mt-10 grid gap-5 md:grid-cols-2"><a href="/authors-den/" className="soft-lift focus-house rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-8"><PenLine className="text-[#e55b4c]" /><h2 className="mt-12 font-display text-4xl italic">Solo Work</h2><p className="mt-3 text-sm leading-relaxed text-[#77717a]">Return to the Author&apos;s Den for your private manuscripts.</p><span className="mt-7 inline-flex items-center gap-2 text-sm font-bold">Open the Den <ArrowRight className="h-4 w-4" /></span></a><Link href="/authors/work/tandems" className="soft-lift focus-house rounded-[1.5rem] bg-[#292b45] p-8 text-[#fff4e6]"><Users className="text-[#f0c85c]" /><h2 className="mt-12 font-display text-4xl italic">Tandem Projects</h2><p className="mt-3 text-sm leading-relaxed text-[#d9d2cb]">{q.data?.length || 0} shared rooms in motion.</p><span className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#f0c85c]">See projects <ArrowRight className="h-4 w-4" /></span></Link></div></Frame>; }
function Tandems() { const q = useListCollaborationProjects(); const ps: any[] = q.data || []; return <Frame title="Tandem projects" intro="The work after the yes. Shared rooms with a clear record of who brought what through the door.">{q.isLoading ? <Loading /> : q.isError ? <ErrorState retry={q.refetch} /> : ps.length ? <div className="mt-10 grid gap-5 md:grid-cols-2">{ps.map(p => <Link key={p.id} href={`/authors/tandem/${p.id}`} className="soft-lift focus-house rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7"><Pill>{p.status}</Pill><h2 className="mt-7 font-display text-3xl italic">{p.title}</h2><p className="mt-2 text-sm text-[#77717a]">{p.creatorName} and {p.respondentName}</p><div className="mt-8 flex items-center justify-between border-t border-[#d6cbb9] pt-4 text-xs text-[#77717a]"><span>Turn: {p.currentTurn}</span><ArrowRight className="h-4 w-4 text-[#e55b4c]" /></div></Link>)}</div> : <Empty title="No shared rooms yet." body="When a creator selects your continuation, or you select an answer to your seed, the new project will settle here." href="/authors/pitch-board" action="Find a seed" />}</Frame>; }
function ownerName(p: any, ownerId: string) { return ownerId === p.creatorId ? p.creatorName : p.respondentName; }
function roleLabel(p: any, role: string) { return role === 'CREATOR' ? p.creatorName : p.respondentName; }
function kindLabel(kind: string) { return kind === 'SEED' ? 'Seed' : kind === 'CONTINUATION' ? 'Continuation' : 'New pass'; }
function downloadManuscript(p: any, blocks: any[]) {
  const lines: string[] = [
    `# ${p.title}`,
    '',
    `By ${p.creatorName} & ${p.respondentName}`,
    `Status: ${p.status.replaceAll('_', ' ')}`,
    '',
    '---',
    '',
  ];
  const ordered = [...blocks].sort((a, b) => a.turnOrder - b.turnOrder || a.createdAt.localeCompare(b.createdAt));
  ordered.forEach((block, index) => {
    lines.push(`## ${index + 1}. ${kindLabel(block.kind)} — by ${ownerName(p, block.ownerId)}`);
    lines.push('');
    lines.push(block.content);
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${p.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-tandem.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
function ProjectTabs({ projectId, active, threadId }: { projectId: string; active: string; threadId?: string | null }) {
  const base = `/authors/tandem/${projectId}`;
  const tabs: Array<[string, string]> = [
    ['', 'Project'],
    ['/contract', 'Contract'],
    ['/story-bible', 'Story Bible'],
    ['/activity', 'Activity'],
    ['/waiting', 'Waiting room'],
  ];
  if (threadId) tabs.push(['messages', 'Messages']);
  return <nav className="mt-8 flex flex-wrap gap-2" aria-label="Project pages">{tabs.map(([suffix, label]) => <Link key={suffix} href={suffix === 'messages' ? `/authors/collaborations/thread/${threadId}` : `${base}${suffix}`} aria-current={active === suffix ? 'page' : undefined} className={`focus-house rounded-full px-4 py-2 text-xs font-bold ${active === suffix ? 'bg-[#292b45] text-[#fff4e6]' : 'border-2 border-[#d6cbb9] bg-[#fff4e6] text-[#77717a]'}`}>{label}</Link>)}</nav>;
}
function WaitingRoom() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useGetCollaborationProject(projectId || '', { query: { queryKey: getGetCollaborationProjectQueryKey(projectId || '') } });
  if (q.isLoading) return <Frame title="Entering room"><Loading /></Frame>;
  if (q.isError || !q.data) return <Frame title="Room unavailable"><ErrorState retry={q.refetch} /></Frame>;
  const p: any = q.data;
  return <Frame eyebrow="Tandem / waiting room" title="Hold the thread." intro="The other author has the next turn. The room stays private while the work moves."><ProjectTabs projectId={p.id} active="/waiting" threadId={p.threadId} /><div className="mt-10 rounded-[1.75rem] bg-[#3e8074] p-10 text-[#fff4e6]"><Hourglass className="h-8 w-8 text-[#f0c85c]" /><p className="mt-12 font-display text-5xl italic">A considered pause.</p><p className="mt-4 max-w-lg text-sm leading-[1.8] text-[#d9e7df]">You will be notified when {roleLabel(p, p.currentTurn)} has made their pass. While you wait, the Story Bible stays open and your solo work is never far away.</p><div className="mt-8 flex flex-wrap gap-3"><Link href={`/authors/tandem/${p.id}`} className="focus-house inline-flex rounded-full bg-[#fff4e6] px-5 py-3 text-sm font-bold text-[#292b45]">View project</Link><Link href={`/authors/tandem/${p.id}/story-bible`} className="focus-house inline-flex rounded-full border border-[#fff4e6]/40 px-5 py-3 text-sm font-bold text-[#fff4e6]">Open Story Bible</Link><Link href="/authors-den/" className="focus-house inline-flex rounded-full border border-[#fff4e6]/40 px-5 py-3 text-sm font-bold text-[#fff4e6]">Solo Work</Link></div></div></Frame>;
}
function ContractRoom() {
  const { projectId } = useParams<{ projectId: string }>(); const { user } = useUser(); const qc = useQueryClient();
  const q = useGetCollaborationProject(projectId || '', { query: { queryKey: getGetCollaborationProjectQueryKey(projectId || '') } });
  const approve = useApproveCollaborationContract();
  if (q.isLoading) return <Frame title="Entering room"><Loading /></Frame>;
  if (q.isError || !q.data) return <Frame title="Room unavailable"><ErrorState retry={q.refetch} /></Frame>;
  const p: any = q.data;
  const myApproved = p.creatorId === user?.id ? p.creatorApproved : p.respondentApproved;
  const partnerApproved = p.creatorId === user?.id ? p.respondentApproved : p.creatorApproved;
  const locked = p.status === 'ACTIVE';
  return <Frame eyebrow="Tandem / contract" title="Agree on the room." intro="A short contract keeps authorship clear while the writing stays alive. Nothing locks until both authors approve."><ProjectTabs projectId={p.id} active="/contract" threadId={p.threadId} /><div className="mt-10 rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-8 sm:p-12"><div className="flex flex-wrap items-start justify-between gap-4"><div><FileText className="text-[#e55b4c]" /><h2 className="mt-8 font-display text-4xl italic">Contract v{p.contractVersion}</h2><p className="mt-3 max-w-2xl text-sm leading-[1.9] text-[#625f6d]">Both authors remain credited. Each pass is visible. The seed stays frozen; the accepted continuation joins the shared manuscript. Approve when this shared understanding feels right.</p></div>{locked ? <Pill>Locked</Pill> : <Pill>Awaiting approvals</Pill>}</div><dl className="mt-9 grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-[#d6cbb9] bg-[#f2e7d8] p-5"><dt className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#77717a]">{p.creatorName} · creator</dt><dd className="mt-2 flex items-center gap-2 text-sm font-bold">{p.creatorApproved ? <><Check className="h-4 w-4 text-[#3e8074]" />Approved</> : <><CircleAlert className="h-4 w-4 text-[#e55b4c]" />Pending</>}</dd></div><div className="rounded-2xl border border-[#d6cbb9] bg-[#f2e7d8] p-5"><dt className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#77717a]">{p.respondentName} · respondent</dt><dd className="mt-2 flex items-center gap-2 text-sm font-bold">{p.respondentApproved ? <><Check className="h-4 w-4 text-[#3e8074]" />Approved</> : <><CircleAlert className="h-4 w-4 text-[#e55b4c]" />Pending</>}</dd></div></dl>{!locked && !myApproved && <button data-testid="button-approve-contract" onClick={() => approve.mutate({ projectId: p.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCollaborationProjectQueryKey(p.id) }) })} className="focus-house mt-8 rounded-full bg-[#e55b4c] px-5 py-3 text-sm font-bold text-[#fff4e6]">{approve.isPending ? 'Approving…' : 'Approve contract'} <Check className="ml-1 inline h-4 w-4" /></button>}{!locked && myApproved && <div className="mt-8 rounded-2xl bg-[#e4f1eb] p-5 text-sm leading-relaxed text-[#2f675e]">You approved this contract. Waiting for {partnerApproved ? 'the final lock' : p.creatorId === user?.id ? p.respondentName : p.creatorName} to approve before it locks.</div>}{locked && <div className="mt-8 rounded-2xl bg-[#f0c85c] p-5 text-sm leading-relaxed text-[#292b45]"><LockKeyhole className="mr-2 inline h-4 w-4" />This contract is locked. The shared project is open for turns. Amendments and version history are future scope in the current release.</div>}</div></Frame>;
}
function ProjectDetail() {
  const { projectId = '' } = useParams<{ projectId: string }>(); const { user } = useUser(); const qc = useQueryClient();
  const q = useGetCollaborationProject(projectId, { query: { queryKey: getGetCollaborationProjectQueryKey(projectId) } });
  const blocksQ = useListCollaborationWorkBlocks(projectId, { query: { enabled: Boolean(projectId), queryKey: getListCollaborationWorkBlocksQueryKey(projectId) } });
  const genealogyQ = useListCollaborationGenealogy(projectId, { query: { enabled: Boolean(projectId), queryKey: getListCollaborationGenealogyQueryKey(projectId) } });
  const create = useCreateCollaborationWorkBlock(); const save = useSaveCollaborationWorkBlockDraft(); const submit = useSubmitCollaborationWorkBlock(); const approveBlock = useApproveCollaborationWorkBlock();
  const [draftText, setDraftText] = useState('');
  if (q.isLoading) return <Frame title="Entering room"><Loading /></Frame>;
  if (q.isError || !q.data) return <Frame title="Room unavailable"><ErrorState retry={q.refetch} /></Frame>;
  const p: any = q.data;
  const blocks: any[] = blocksQ.data || [];
  const ordered = [...blocks].sort((a, b) => a.turnOrder - b.turnOrder || a.createdAt.localeCompare(b.createdAt));
  const myRole = p.creatorId === user?.id ? 'CREATOR' : 'RESPONDENT';
  const isMyTurn = p.status === 'ACTIVE' && p.currentTurn === myRole;
  const openDraft = blocks.find((b: any) => b.ownerId === user?.id && b.status === 'DRAFT');
  const awaitingApproval = blocks.find((b: any) => b.ownerId !== user?.id && b.status === 'SUBMITTED');
  useEffect(() => { if (openDraft && draftText === '' ) setDraftText(openDraft.content); }, [openDraft]);
  const refresh = () => { qc.invalidateQueries({ queryKey: getListCollaborationWorkBlocksQueryKey(projectId) }); qc.invalidateQueries({ queryKey: getGetCollaborationProjectQueryKey(projectId) }); };
  const ensureBlock = (after?: (id: string) => void) => {
    if (openDraft) {
      if (draftText !== openDraft.content) save.mutate({ projectId, blockId: openDraft.id, data: { content: draftText } }, { onSuccess: () => { refresh(); after?.(openDraft.id); } });
      else after?.(openDraft.id);
      return;
    }
    create.mutate({ projectId, data: { content: draftText } }, { onSuccess: (block: any) => { refresh(); after?.(block.id); } });
  };
  const saveDraft = () => ensureBlock();
  const submitPass = () => ensureBlock(id => submit.mutate({ projectId, blockId: id }, { onSuccess: () => { setDraftText(''); refresh(); } }));
  const approvePass = () => { if (awaitingApproval) approveBlock.mutate({ projectId, blockId: awaitingApproval.id }, { onSuccess: refresh }); };
  return <Frame title={p.title} intro={`${p.creatorName} and ${p.respondentName} are carrying this piece together.`}>
    <ProjectTabs projectId={p.id} active="" threadId={p.threadId} />
    <div className="reveal reveal-1 mt-8 grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        {p.status !== 'ACTIVE' && <div className="rounded-[1.5rem] border-2 border-[#f0c85c] bg-[#f0c85c]/30 p-6 text-sm leading-relaxed text-[#292b45]"><LockKeyhole className="mr-2 inline h-4 w-4" />The contract is not locked yet. Review and approve it together before the manuscript opens for turns. <Link className="underline" href={`/authors/tandem/${p.id}/contract`}>Open the contract room</Link>.</div>}
        {p.status === 'ACTIVE' && !isMyTurn && <div className="rounded-[1.5rem] border-2 border-[#3e8074] bg-[#e4f1eb] p-6 text-sm leading-relaxed text-[#2f675e]"><Hourglass className="mr-2 inline h-4 w-4" />It is {roleLabel(p, p.currentTurn)}’s turn to write. You will be notified when their pass arrives. <Link className="underline" href={`/authors/tandem/${p.id}/waiting`}>Waiting room</Link></div>}
        <div className="space-y-5">{ordered.map((block, index) => {
          const mine = block.ownerId === user?.id;
          const editable = mine && block.status === 'DRAFT';
          return <article key={block.id} data-testid={`work-block-${block.id}`} className={`rounded-[1.5rem] border-2 p-7 ${editable ? 'border-[#e55b4c]/50 bg-[#fff4e6]' : 'border-[#d6cbb9] bg-[#fff4e6]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Pill>{index + 1}</Pill><Pill>{kindLabel(block.kind)}</Pill><Pill>{block.status.replaceAll('_', ' ')}</Pill><span className="text-xs text-[#77717a]">by {ownerName(p, block.ownerId)}{mine ? ' · you' : ''}</span></div>{block.status === 'SUBMITTED' && !mine && isMyTurn && <button data-testid={`button-approve-block-${block.id}`} onClick={approvePass} disabled={approveBlock.isPending} className="focus-house rounded-full bg-[#3e8074] px-4 py-2 text-xs font-bold text-[#fff4e6] disabled:opacity-40">{approveBlock.isPending ? 'Approving…' : 'Approve into manuscript'}</button>}</div>
            {editable ? <textarea data-testid={`input-block-draft-${block.id}`} value={draftText} onChange={e => setDraftText(e.target.value)} className="mt-5 min-h-[220px] w-full resize-y rounded-xl border border-[#d6cbb9] bg-[#f2e7d8] p-4 font-display text-lg leading-relaxed outline-none focus:border-[#e55b4c]" /> : <p className="mt-5 whitespace-pre-wrap font-display text-lg leading-[1.6] text-[#292b45]">{block.content}</p>}
          </article>;
        })}</div>
        {p.status === 'ACTIVE' && isMyTurn && !openDraft && <div className="rounded-[1.5rem] bg-[#292b45] p-7 text-[#fff4e6]"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#f0c85c]">Your turn</p><textarea data-testid="input-new-block" value={draftText} onChange={e => setDraftText(e.target.value)} placeholder="Continue where the work leaves you…" className="mt-4 min-h-[200px] w-full resize-y rounded-xl border border-[#fff4e6]/25 bg-[#2c2e4a] p-4 font-display text-lg leading-relaxed text-[#fff4e6] outline-none placeholder:text-[#d9d2cb]/50 focus:border-[#f0c85c]" /><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><span className="font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#d9d2cb]">{draftText.trim() ? draftText.trim().split(/\s+/).length : 0} words</span><div className="flex gap-2"><button data-testid="button-save-block-draft" onClick={saveDraft} disabled={save.isPending || create.isPending || !draftText.trim()} className="focus-house rounded-full border border-[#fff4e6]/40 px-4 py-2 text-xs font-bold text-[#fff4e6] disabled:opacity-40">Save draft</button><button data-testid="button-submit-block" onClick={submitPass} disabled={submit.isPending || create.isPending || !draftText.trim()} className="focus-house rounded-full bg-[#e55b4c] px-4 py-2 text-xs font-bold text-[#fff4e6] disabled:opacity-40">{submit.isPending ? 'Submitting…' : 'Submit pass'}</button></div></div></div>}
      </div>
      <aside className="h-fit space-y-5">
        <section className="rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-6"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">The room</p><dl className="mt-5 space-y-4 text-sm"><div><dt className="opacity-60">Status</dt><dd className="mt-1 font-bold">{p.status.replaceAll('_', ' ')}</dd></div><div><dt className="opacity-60">Current turn</dt><dd className="mt-1 font-bold">{roleLabel(p, p.currentTurn)}</dd></div><div><dt className="opacity-60">Next action</dt><dd className="mt-1 text-xs leading-relaxed text-[#77717a]">{p.status === 'CONTRACT_PENDING' ? 'Approve the contract' : p.status === 'ACTIVE' ? (isMyTurn ? 'Write your pass' : 'Wait for the next pass') : p.status.replaceAll('_', ' ')}</dd></div><div><dt className="opacity-60">Protocol</dt><dd className="mt-1 font-bold">Continue from the final line</dd></div><div><dt className="opacity-60">Visibility</dt><dd className="mt-1 font-bold">Private to participants</dd></div></dl></section>
        <section className="rounded-[1.5rem] bg-[#3e8074] p-6 text-[#fff4e6]"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#f0c85c]">Manuscript</p><p className="mt-3 text-sm leading-relaxed text-[#d9e7df]">{ordered.length} block(s) carry the shared text. Approved passes are locked; drafts live only in their author’s desk until submitted.</p><button onClick={() => downloadManuscript(p, blocks)} className="focus-house mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#fff4e6] px-4 py-3 text-sm font-bold text-[#292b45]"><Download className="h-4 w-4" />Export manuscript (.md)</button></section>
        <section className="rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-6"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#e55b4c]">Attribution trail</p><p className="mt-3 text-xs leading-relaxed text-[#77717a]">Who wrote what, and what each pass continues from. Never editable, always present.</p>{genealogyQ.isLoading ? <div className="mt-4 h-16 animate-pulse rounded-xl bg-[#f2e7d8]" /> : <ol className="mt-4 space-y-2.5">{(genealogyQ.data || []).length ? (genealogyQ.data as any[]).map((g) => <li key={g.id} className="flex items-center gap-2 text-xs"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3e8074]" /><span className="font-bold">{g.contributorName}</span><span className="text-[#77717a]">— {kindLabel(g.kind)}</span>{g.parentBlockId && <span className="text-[#98909a]">· continues a pass</span>}</li>) : <li className="text-xs text-[#77717a]">Nothing recorded yet.</li>}</ol>}</section>
      </aside>
    </div>
  </Frame>;
}
function StoryBiblePage() {
  const { projectId = '' } = useParams<{ projectId: string }>(); const { user } = useUser(); const qc = useQueryClient();
  const q = useListCollaborationStoryBible(projectId, { query: { enabled: Boolean(projectId), queryKey: getListCollaborationStoryBibleQueryKey(projectId) } });
  const create = useCreateCollaborationStoryBibleEntry();
  const [form, setForm] = useState({ kind: 'note', name: '', content: '', shared: false });
  const entries: any[] = q.data || [];
  const add = () => { if (!form.name.trim() || !form.content.trim()) return; create.mutate({ projectId, data: { kind: form.kind as any, name: form.name, content: form.content, shared: form.shared } }, { onSuccess: () => { setForm({ kind: 'note', name: '', content: '', shared: false }); qc.invalidateQueries({ queryKey: getListCollaborationStoryBibleQueryKey(projectId) }); } }); };
  return <Frame eyebrow="Tandem / story bible" title="The world, kept straight." intro="Shared facts stay visible to both authors. Private notes are scoped to the author who wrote them."><ProjectTabs projectId={projectId} active="/story-bible" /><div className="reveal reveal-1 mt-8 grid gap-5 lg:grid-cols-[1fr_320px]"><div className="space-y-4">{q.isLoading ? <Loading /> : q.isError ? <ErrorState retry={q.refetch} /> : entries.length ? entries.map((entry) => <article key={entry.id} className="rounded-[1.5rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-6"><div className="flex flex-wrap items-center gap-2"><Pill>{entry.kind}</Pill>{entry.shared ? <Pill>Shared</Pill> : <Pill>Private to you</Pill>}</div><h2 className="mt-4 font-display text-3xl italic">{entry.name}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-[1.8] text-[#625f6d]">{entry.content}</p></article>) : <Empty title="No entries yet." body="Add the first shared fact or private note about the world, characters, or rules of this story." />}</div><aside className="h-fit rounded-[1.5rem] bg-[#292b45] p-7 text-[#fff4e6]"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#f0c85c]">Add an entry</p><label className="mt-6 block"><span className="text-sm font-bold">Kind</span><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="mt-2 w-full rounded-xl border border-[#fff4e6]/25 bg-[#2c2e4a] p-3 text-sm text-[#fff4e6]"><option value="character">Character</option><option value="location">Location</option><option value="item">Item</option><option value="rule">Rule</option><option value="note">Note</option></select></label><label className="mt-5 block"><span className="text-sm font-bold">Name</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-2 w-full rounded-xl border border-[#fff4e6]/25 bg-[#2c2e4a] p-3 text-sm text-[#fff4e6] outline-none" placeholder="e.g. The Salt Road" /></label><label className="mt-5 block"><span className="text-sm font-bold">Content</span><textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} className="mt-2 min-h-[120px] w-full rounded-xl border border-[#fff4e6]/25 bg-[#2c2e4a] p-3 text-sm leading-relaxed text-[#fff4e6] outline-none" placeholder="What must stay true about this story…" /></label><label className="mt-5 flex items-center gap-3 text-sm"><input type="checkbox" checked={form.shared} onChange={e => setForm({ ...form, shared: e.target.checked })} /> Share with {user?.id ? 'your collaborator' : 'the room'}</label><button onClick={add} disabled={create.isPending || !form.name.trim() || !form.content.trim()} className="focus-house mt-6 w-full rounded-full bg-[#e55b4c] px-4 py-3 text-sm font-bold text-[#fff4e6] disabled:opacity-40">{create.isPending ? 'Adding…' : 'Add entry'}</button></aside></div></Frame>;
}
function ProjectActivityPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const q = useListCollaborationActivity(projectId, { query: { enabled: Boolean(projectId), queryKey: getListCollaborationActivityQueryKey(projectId) } });
  const events: any[] = q.data || [];
  return <Frame eyebrow="Tandem / activity" title="A clear record." intro="Who did what, when. Summaries only — hidden prose never enters this log."><ProjectTabs projectId={projectId} active="/activity" /><div className="reveal reveal-1 mt-8 max-w-3xl space-y-3">{q.isLoading ? <Loading /> : q.isError ? <ErrorState retry={q.refetch} /> : events.length ? events.map((event) => <div key={event.id} data-testid={`activity-${event.id}`} className="flex items-start gap-4 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5"><History className="mt-0.5 h-4 w-4 shrink-0 text-[#e55b4c]" /><div><p className="text-sm font-bold">{event.summary}</p><span className="mt-1 block font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">{event.eventType.replaceAll('_', ' ')} · {new Date(event.createdAt).toLocaleString()}</span></div></div>) : <Empty title="Nothing recorded yet." body="Contract approvals, submitted passes, and shared bible notes will appear here as the room moves." />}</div></Frame>;
}

export default function CollaborationPage() {
  const [location] = useLocation();
  if (location === '/authors/atrium') return <Atrium />;
  if (location === '/authors/pitch-board/new') return <CreateSeed />;
  if (location === '/authors/pitch-board') return <Board />;
  if (location.endsWith('/respond')) return <Respond />;
  if (location.includes('/collaborations/seed/') && location.endsWith('/select')) return <SelectionRoom />;
  if (location.includes('/collaborations/seed/')) return <SeedDetail />;
  if (location.includes('/pitch-board/seed/')) return <SeedDetail />;
  if (location === '/authors/collaborations/continuations') return <Continuations />;
  if (location.includes('/collaborations/continuation/') || location.includes('/collaborations/selection/')) return <ContinuationDetail />;
  if (location.includes('/collaborations/thread/')) return <ThreadPage />;
  if (location === '/authors/collaborations/inbox') return <InboxPage />;
  if (location === '/authors/collaborations/requests') return <RequestsPage />;
  if (location === '/authors/collaborations/system') return <SystemPage />;
  if (location === '/authors/work' || location === '/authors/work/tandems' || location === '/authors/work/solo') return location.endsWith('tandems') ? <Tandems /> : location.endsWith('solo') ? <WorkSolo /> : <Work />;
  if (location.endsWith('/story-bible')) return <StoryBiblePage />;
  if (location.endsWith('/activity')) return <ProjectActivityPage />;
  if (location.endsWith('/contract')) return <ContractRoom />;
  if (location.endsWith('/waiting')) return <WaitingRoom />;
  return <ProjectDetail />;
}