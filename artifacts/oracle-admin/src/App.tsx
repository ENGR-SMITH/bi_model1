import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Menu,
  Network,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  X,
  Zap,
} from 'lucide-react';
import {
  getGetAdminSessionQueryKey,
  getListAdminProvidersQueryKey,
  useAdminLogin,
  useAdminLogout,
  useCheckAdminProvider,
  useGetAdminSession,
  useListAdminProviders,
  useOracleChat,
  useUpdateAdminProvider,
} from '@workspace/api-client-react';
import type { ProviderStatus, ProviderUpdate } from '@workspace/api-client-react';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();

type ProviderId = 'groq' | 'openrouter' | 'ollama' | 'lmstudio' | 'freebuff';

const providerMeta: Record<ProviderId, { eyebrow: string; description: string; tone: string }> = {
  groq: { eyebrow: 'CLOUD / PRIMARY', description: 'Fast inference for everyday oracle sessions.', tone: 'amber' },
  openrouter: { eyebrow: 'CLOUD / FALLBACK', description: 'A broad model relay for resilient overflow.', tone: 'teal' },
  ollama: { eyebrow: 'LOCAL / PRIVATE', description: 'Optional local runtime on the authoring machine.', tone: 'slate' },
  lmstudio: { eyebrow: 'LOCAL / PRIVATE', description: 'Optional desktop inference endpoint.', tone: 'plum' },
  freebuff: { eyebrow: 'LOCAL / GATEWAY', description: 'Freebuff model gateway on the authoring machine.', tone: 'teal' },
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ErrorBoundary resetKey={window.location.pathname}>
            <Switch>
              <Route path="/" component={OracleAdmin} />
              <Route path="/oracle-admin/" component={OracleAdmin} />
              <Route component={OracleAdmin} />
            </Switch>
          </ErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function OracleAdmin() {
  const session = useGetAdminSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAuthenticated = Boolean(session.data?.authenticated);

  if (session.isLoading) return <LoadingScreen />;
  if (!isAuthenticated) {
    return <LoginScreen sessionError={session.isError} onRetry={() => session.refetch()} />;
  }
  return <ControlRoom mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />;
}

function LoadingScreen() {
  return (
    <main className="min-h-[100dvh] bg-background p-5 sm:p-8">
      <div className="mx-auto max-w-[1440px] animate-pulse">
        <div className="h-8 w-44 rounded bg-secondary" />
        <div className="mt-14 h-12 w-2/3 rounded bg-secondary" />
        <div className="mt-4 h-5 w-1/2 rounded bg-secondary" />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <div className="h-80 rounded-2xl bg-secondary" />
          <div className="h-80 rounded-2xl bg-secondary" />
        </div>
      </div>
    </main>
  );
}

function LoginScreen({ sessionError, onRetry }: { sessionError: boolean; onRetry: () => void }) {
  const login = useAdminLogin();
  const [accessCode, setAccessCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [message, setMessage] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessCode.trim()) {
      setMessage('Enter the private access code to continue.');
      return;
    }
    setMessage('');
    login.mutate({ data: { accessCode: accessCode.trim() } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() });
        setAccessCode('');
      },
      onError: () => setMessage('That access code was not accepted. Check it and try again.'),
    });
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center overflow-hidden bg-background px-5 py-8 sm:px-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-xl lg:grid-cols-[1.1fr_.9fr]">
        <section className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
          <div className="absolute right-[-90px] top-[110px] h-72 w-72 rounded-full border border-sidebar-accent/50" />
          <div className="absolute right-[-10px] top-[180px] h-48 w-48 rounded-full border border-sidebar-accent/30" />
          <Brand light />
          <div className="relative max-w-md">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-sidebar-primary">Private operator surface</p>
            <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-[-0.055em]">A clear signal before the first sentence.</h1>
            <p className="mt-6 max-w-sm text-sm leading-7 text-sidebar-foreground/65">
              Configure the Story Oracle behind the scenes. Credentials stay sealed; live checks tell you what authors can trust.
            </p>
          </div>
          <div className="relative flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">
            <span className="h-2 w-2 rounded-full bg-sidebar-primary" /> encrypted operator session
          </div>
        </section>
        <section className="flex min-h-[620px] flex-col justify-center p-7 sm:p-12">
          <div className="lg:hidden"><Brand /></div>
          <div className="mt-12 max-w-sm lg:mt-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Story Oracle / Admin</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-foreground">Enter the control room.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">This workspace is intentionally separate from the author experience.</p>
            <form onSubmit={submit} className="mt-9 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Private access code</span>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    data-testid="input-access-code"
                    autoComplete="current-password"
                    type={showCode ? 'text' : 'password'}
                    value={accessCode}
                    onChange={(event) => setAccessCode(event.target.value)}
                    placeholder="Enter access code"
                    className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-11 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <button data-testid="button-toggle-access-code" type="button" onClick={() => setShowCode((value) => !value)} className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:text-foreground">
                    {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
              {(message || sessionError) && (
                <div data-testid="status-login-error" className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{message || 'The admin session could not be checked. Retry or sign in below.'}</span>
                </div>
              )}
              <button data-testid="button-admin-login" disabled={login.isPending} className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">
                {login.isPending ? 'Verifying access…' : 'Open control room'}
                {!login.isPending && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
              </button>
              {sessionError && <button data-testid="button-retry-session" type="button" onClick={onRetry} className="flex w-full items-center justify-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /> Retry session check</button>}
            </form>
            <p className="mt-10 flex items-center gap-2 text-[11px] leading-5 text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" /> Keys are never displayed after they are saved.</p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div data-testid="brand-oracle-admin" className="flex items-center gap-3">
      <div className={`grid h-9 w-9 place-items-center rounded-xl ${light ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-primary text-primary-foreground'}`}><Sparkles className="h-4 w-4" /></div>
      <div>
        <p className={`text-sm font-extrabold tracking-[-0.03em] ${light ? 'text-sidebar-foreground' : 'text-foreground'}`}>Story Oracle</p>
        <p className={`font-mono text-[9px] uppercase tracking-[0.2em] ${light ? 'text-sidebar-foreground/50' : 'text-muted-foreground'}`}>private admin</p>
      </div>
    </div>
  );
}

function ControlRoom({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (value: boolean) => void }) {
  const session = useGetAdminSession();
  const providers = useListAdminProviders();
  const logout = useAdminLogout();
  const [activeSection, setActiveSection] = useState<'overview' | 'providers'>('overview');

  const providerList = useMemo(() => providers.data || [], [providers.data]);
  const connectedCount = providerList.filter((provider) => provider.status === 'connected').length;
  const configuredCount = providerList.filter((provider) => provider.configured).length;

  const signOut = () => logout.mutate(undefined, {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() }),
  });

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:hidden">
        <Brand />
        <button data-testid="button-mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} className="rounded-lg border border-border p-2 text-foreground">{mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </header>
      <div className="mx-auto flex max-w-[1600px]">
        <aside className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col bg-sidebar p-6 text-sidebar-foreground transition-transform lg:sticky lg:top-0 lg:h-[100dvh] lg:translate-x-0`}>
          <Brand light />
          <div className="mt-14">
            <p className="px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/40">Workspace</p>
            <nav className="mt-3 space-y-1">
              <button data-testid="button-nav-overview" onClick={() => { setActiveSection('overview'); setMobileOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${activeSection === 'overview' ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}`}><Activity className="h-4 w-4" /> System overview</button>
              <button data-testid="button-nav-providers" onClick={() => { setActiveSection('providers'); setMobileOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${activeSection === 'providers' ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}`}><SlidersHorizontal className="h-4 w-4" /> Provider routing</button>
            </nav>
          </div>
          <div className="mt-auto">
            <div className="mb-5 rounded-2xl border border-sidebar-border bg-sidebar-accent/40 p-4">
              <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/50">Session</span><span className="h-2 w-2 rounded-full bg-sidebar-primary" /></div>
              <p className="mt-3 text-xs text-sidebar-foreground/70">Private operator mode</p>
              <p className="mt-1 font-mono text-[10px] text-sidebar-foreground/40">credentials sealed</p>
            </div>
            <button data-testid="button-admin-logout" onClick={signOut} disabled={logout.isPending} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50"><LogOut className="h-4 w-4" /> {logout.isPending ? 'Closing session…' : 'Close session'}</button>
          </div>
        </aside>
        {mobileOpen && <button data-testid="button-mobile-overlay" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" aria-label="Close menu" />}
        <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 sm:py-10 lg:px-14 lg:py-12">
          {activeSection === 'overview' ? (
            <Overview providers={providerList} isLoading={providers.isLoading} isError={providers.isError} onRetry={() => providers.refetch()} connectedCount={connectedCount} configuredCount={configuredCount} onConfigure={() => setActiveSection('providers')} />
          ) : (
            <ProvidersSection providers={providerList} isLoading={providers.isLoading} isError={providers.isError} onRetry={() => providers.refetch()} session={session.data?.authenticated ?? false} />
          )}
        </main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.055em] text-foreground sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Overview({ providers, isLoading, isError, onRetry, connectedCount, configuredCount, onConfigure }: { providers: ProviderStatus[]; isLoading: boolean; isError: boolean; onRetry: () => void; connectedCount: number; configuredCount: number; onConfigure: () => void }) {
  const chat = useOracleChat();
  const [probeResult, setProbeResult] = useState('');
  const [probeOpen, setProbeOpen] = useState(false);

  const runProbe = () => {
    setProbeOpen(true);
    setProbeResult('');
    chat.mutate({ data: { messages: [{ role: 'user', content: 'Reply with the single word READY.' }], temperature: 0 } }, {
      onSuccess: (result) => setProbeResult(`Oracle responded through ${result.providerId} / ${result.modelId}.`),
      onError: () => setProbeResult('The live probe did not receive a response. Review provider health below.'),
    });
  };

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="animate-in"><PageHeading eyebrow="Control room / system overview" title="The Oracle is on watch." description="A private, operational view of the models available to the Story Oracle. Check the signal before authors begin." action={<button data-testid="button-live-probe" onClick={runProbe} disabled={chat.isPending || providers.length === 0} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"><Zap className="h-4 w-4" /> {chat.isPending ? 'Probing…' : 'Run live probe'}</button>} /></div>
      {probeOpen && <div data-testid="status-live-probe" className={`mt-7 flex items-center gap-3 rounded-xl border p-4 text-sm ${chat.isError ? 'border-destructive/25 bg-destructive/5 text-destructive' : probeResult ? 'border-primary/25 bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground'}`}><div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-background">{chat.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : chat.isError ? <CircleAlert className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />}</div><span>{probeResult || (chat.isPending ? 'Sending a quiet test message through the configured routing chain…' : 'Probe complete.')}</span>{!chat.isPending && <button data-testid="button-dismiss-probe" onClick={() => setProbeOpen(false)} className="ml-auto rounded p-1 text-current/60 hover:text-current"><X className="h-4 w-4" /></button>}</div>}
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Healthy providers" value={isLoading ? '—' : `${connectedCount}/${providers.length || 0}`} detail={connectedCount > 0 ? 'ready for requests' : 'awaiting configuration'} icon={<CircleCheck className="h-4 w-4" />} accent="teal" />
        <MetricCard label="Configured routes" value={isLoading ? '—' : `${configuredCount}`} detail="credential metadata present" icon={<KeyRound className="h-4 w-4" />} accent="amber" />
        <MetricCard label="Failover posture" value={providers.length ? 'Automatic' : 'Standby'} detail={providers.length ? 'priority order is active' : 'add a provider to begin'} icon={<Network className="h-4 w-4" />} accent="slate" />
      </div>
      <section className="mt-10 animate-in delay-100">
        <div className="mb-4 flex items-end justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Signal board</p><h2 className="mt-2 text-xl font-semibold tracking-[-0.04em]">Provider health</h2></div><button data-testid="button-refresh-providers" onClick={onRetry} disabled={isLoading} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh</button></div>
        {isError ? <ErrorState onRetry={onRetry} /> : isLoading ? <ProviderSkeleton /> : providers.length === 0 ? <EmptyState onConfigure={onConfigure} /> : <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr] border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:grid"><span>Provider</span><span>Route</span><span>Health</span><span>Last checked</span></div>{providers.map((provider) => <ProviderRow key={provider.id} provider={provider} />)}</div>}
      </section>
      <section className="mt-10 grid gap-5 lg:grid-cols-[1.2fr_.8fr] animate-in delay-200">
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Routing logic</p><h2 className="mt-2 text-xl font-semibold tracking-[-0.04em]">Priority is deliberate.</h2></div><SlidersHorizontal className="h-5 w-5 text-primary" /></div><p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">The Oracle tries enabled models from lowest priority number to highest. A healthy primary keeps the writing room quick; a fallback keeps it moving.</p><button data-testid="button-configure-routing" onClick={onConfigure} className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary hover:gap-3 transition-all">Configure routing <ArrowRight className="h-4 w-4" /></button></div>
        <div className="rounded-2xl border border-sidebar/10 bg-sidebar p-6 text-sidebar-foreground sm:p-7"><TerminalSquare className="h-5 w-5 text-sidebar-primary" /><p className="mt-7 font-mono text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/45">Operator note</p><p className="mt-3 text-sm leading-6 text-sidebar-foreground/75">Keys are accepted once, then replaced by a hint. No secret is returned to this surface.</p></div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, icon, accent }: { label: string; value: string; detail: string; icon: React.ReactNode; accent: string }) {
  return <div data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent === 'amber' ? 'bg-accent/20 text-accent-foreground' : accent === 'teal' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>{icon}</div><p className="mt-6 text-2xl font-semibold tracking-[-0.05em]">{value}</p><p className="mt-1 text-xs font-semibold text-foreground">{label}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>;
}

function ProviderRow({ provider }: { provider: ProviderStatus }) {
  return <div data-testid={`row-provider-${provider.id}`} className="grid gap-3 border-b border-border px-5 py-4 last:border-0 sm:grid-cols-[1.5fr_1fr_1fr_1fr] sm:items-center"><div><div className="flex items-center gap-3"><ProviderMark provider={provider.id as ProviderId} /><div><p className="text-sm font-semibold">{provider.label}</p><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{provider.keyHint ? `key ${provider.keyHint}` : 'no credential stored'}</p></div></div></div><div className="flex items-center gap-2 pl-11 text-xs text-muted-foreground sm:pl-0"><span className={`h-1.5 w-1.5 rounded-full ${provider.enabled ? 'bg-primary' : 'bg-muted-foreground/40'}`} />{provider.enabled ? `Priority ${provider.priority}` : 'Disabled'}</div><div className="pl-11 sm:pl-0"><StatusPill status={provider.status} /></div><div className="flex items-center gap-2 pl-11 text-xs text-muted-foreground sm:pl-0"><Clock3 className="h-3.5 w-3.5" />{provider.lastCheckedAt ? formatDate(provider.lastCheckedAt) : 'Not checked'}</div></div>;
}

function ProvidersSection({ providers, isLoading, isError, onRetry, session }: { providers: ProviderStatus[]; isLoading: boolean; isError: boolean; onRetry: () => void; session: boolean }) {
  return <div className="mx-auto max-w-[1180px]"><div className="animate-in"><PageHeading eyebrow="Control room / provider routing" title="Tune the signal chain." description="Store credentials safely, choose model order, and test each connection without exposing a secret." action={<div data-testid="status-authenticated" className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-primary"><ShieldCheck className="h-3.5 w-3.5" /> {session ? 'Session verified' : 'Session pending'}</div>} /></div><div className="mt-10 space-y-5 animate-in delay-100">{isError ? <ErrorState onRetry={onRetry} /> : isLoading ? <ProviderSkeleton /> : providers.length === 0 ? <EmptyState onConfigure={() => undefined} /> : providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)}</div></div>;
}

function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const update = useUpdateAdminProvider();
  const check = useCheckAdminProvider();
  const queryClient = useQueryClient();
  const providerId = provider.id as ProviderId;
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl || '');
  const [modelId, setModelId] = useState(provider.models.find((model) => model.enabled)?.id || '');
  const [customModel, setCustomModel] = useState(false);
  const [priority, setPriority] = useState(String(provider.priority));
  const [enabled, setEnabled] = useState(provider.enabled);
  const [expanded, setExpanded] = useState(providerId === 'groq');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setBaseUrl(provider.baseUrl || '');
    const current = provider.models.find((model) => model.enabled)?.id || '';
    setModelId(current);
    setCustomModel(false);
    setPriority(String(provider.priority));
    setEnabled(provider.enabled);
  }, [provider.baseUrl, provider.models, provider.priority, provider.enabled]);

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: ProviderUpdate = { apiKey: apiKey.trim() || undefined, baseUrl: baseUrl.trim() || undefined, modelId: modelId.trim() || undefined, enabled, priority: Math.max(1, Number(priority) || 1) };
    update.mutate({ providerId, data: payload }, {
      onSuccess: () => {
        setApiKey('');
        setNotice('Saved securely. The credential has been cleared from this form.');
        queryClient.invalidateQueries({ queryKey: getListAdminProvidersQueryKey() });
      },
      onError: () => setNotice('Could not save this provider. No changes were applied.'),
    });
  };
  const testConnection = () => {
    setNotice('');
    check.mutate({ providerId }, { onSuccess: () => { setNotice('Connection check complete.'); queryClient.invalidateQueries({ queryKey: getListAdminProvidersQueryKey() }); }, onError: () => setNotice('Connection check failed. Review the endpoint and try again.') });
  };
  const models = provider.models || [];
  const meta = providerMeta[providerId] || providerMeta.groq;

  return <article data-testid={`card-provider-${provider.id}`} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><button data-testid={`button-expand-provider-${provider.id}`} onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-4 p-5 text-left sm:p-6"><div className="flex min-w-0 items-center gap-4"><ProviderMark provider={providerId} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{provider.label}</h2><StatusPill status={provider.status} /></div><p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{meta.eyebrow}</p><p className="mt-2 truncate text-xs text-muted-foreground">{meta.description}</p></div></div><ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>{expanded && <form onSubmit={save} className="border-t border-border bg-background/45 p-5 sm:p-6"><div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><div className="space-y-5"><label className="block"><span className="mb-2 flex items-center justify-between text-xs font-semibold">API credential <span className="font-mono text-[10px] font-normal text-muted-foreground">{provider.keyHint ? `stored ${provider.keyHint}` : 'not configured'}</span></span><input data-testid={`input-api-key-${provider.id}`} type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider.keyHint ? 'Enter a new key to replace it' : 'Paste provider credential'} className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" /><span className="mt-2 block text-[11px] leading-5 text-muted-foreground">Leave blank to keep the stored credential. It will never be shown after saving.</span></label><label className="block"><span className="mb-2 block text-xs font-semibold">Base URL</span><input data-testid={`input-base-url-${provider.id}`} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…" className="h-11 w-full rounded-xl border border-input bg-card px-3.5 font-mono text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" /></label><label className="block"><span className="mb-2 block text-xs font-semibold">Model <span className="font-normal text-muted-foreground">(choose from the provider's catalog)</span></span>{models.length > 0 ? <div className="space-y-2"><select data-testid={`select-model-${provider.id}`} value={customModel ? '__custom__' : modelId || ''} onChange={(event) => { if (event.target.value === '__custom__') { setCustomModel(true); } else { setModelId(event.target.value); setCustomModel(false); } }} className="h-11 w-full rounded-xl border border-input bg-card px-3.5 font-mono text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"><option value="" disabled>Select a model…</option>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}<option value="__custom__">Custom model…</option></select>{customModel && <input data-testid={`input-model-id-${provider.id}`} value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="Enter a model id not in the list" className="h-11 w-full rounded-xl border border-input bg-card px-3.5 font-mono text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" />}</div> : <input data-testid={`input-model-id-${provider.id}`} value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="provider model id" className="h-11 w-full rounded-xl border border-input bg-card px-3.5 font-mono text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" />}</label></div><div className="space-y-5"><div className="grid grid-cols-2 gap-4"><label className="block"><span className="mb-2 block text-xs font-semibold">Priority</span><input data-testid={`input-priority-${provider.id}`} type="number" min="1" value={priority} onChange={(event) => setPriority(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-card px-3.5 font-mono text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" /></label><div><span className="mb-2 block text-xs font-semibold">Routing</span><button data-testid={`button-toggle-provider-${provider.id}`} type="button" onClick={() => setEnabled(!enabled)} className={`flex h-11 w-full items-center justify-between rounded-xl border px-3.5 text-xs font-semibold transition ${enabled ? 'border-primary/30 bg-primary/5 text-primary' : 'border-input bg-card text-muted-foreground'}`}><span>{enabled ? 'Enabled' : 'Disabled'}</span><span className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-primary' : 'bg-muted-foreground/40'}`} /></button></div></div><div className="rounded-xl border border-border bg-card p-4"><div className="flex items-start gap-3"><Network className="mt-0.5 h-4 w-4 text-primary" /><div><p className="text-xs font-semibold">Failover position {priority}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Lower numbers are tried first when the Oracle routes a request.</p></div></div></div><div className="flex flex-col gap-3 sm:flex-row"><button data-testid={`button-save-provider-${provider.id}`} disabled={update.isPending} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:brightness-105 disabled:opacity-50"><Save className="h-4 w-4" />{update.isPending ? 'Saving…' : 'Save provider'}</button><button data-testid={`button-check-provider-${provider.id}`} type="button" onClick={testConnection} disabled={check.isPending || !provider.configured} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"><RefreshCw className={`h-4 w-4 ${check.isPending ? 'animate-spin' : ''}`} />{check.isPending ? 'Checking…' : 'Test connection'}</button></div></div></div>{notice && <div data-testid={`status-provider-${provider.id}`} className={`mt-5 flex items-center gap-2 rounded-xl border p-3 text-xs ${notice.includes('failed') || notice.includes('Could not') ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-primary/25 bg-primary/5 text-primary'}`}>{notice.includes('failed') || notice.includes('Could not') ? <CircleAlert className="h-4 w-4" /> : <Check className="h-4 w-4" />}{notice}</div>}</form>}</article>;
}

function ProviderMark({ provider }: { provider: ProviderId }) {
  const letters = provider === 'openrouter' ? 'OR' : provider === 'lmstudio' ? 'LM' : provider === 'ollama' ? 'OL' : provider === 'freebuff' ? 'FB' : 'GQ';
  return <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-secondary font-mono text-[11px] font-medium text-foreground">{letters}</div>;
}

function StatusPill({ status }: { status: string }) {
  const connected = status === 'connected';
  const checking = status === 'checking';
  const label = status.replaceAll('_', ' ');
  return <span data-testid={`status-pill-${status}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] capitalize ${connected ? 'border-primary/25 bg-primary/8 text-primary' : checking ? 'border-accent/30 bg-accent/10 text-accent-foreground' : status === 'error' || status === 'unavailable' ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-border bg-secondary text-muted-foreground'}`}>{checking ? <RefreshCw className="h-3 w-3 animate-spin" /> : connected ? <CircleCheck className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}{label}</span>;
}

function ProviderSkeleton() {
  return <div data-testid="loading-providers" className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl bg-secondary" />)}</div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div data-testid="state-providers-error" className="flex flex-col items-start gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-6 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" /><div><p className="text-sm font-semibold">Signal board unavailable</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The provider registry could not be read. Your saved settings are untouched.</p></div></div><button data-testid="button-retry-providers" onClick={onRetry} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-secondary"><RefreshCw className="h-3.5 w-3.5" /> Try again</button></div>;
}

function EmptyState({ onConfigure }: { onConfigure: () => void }) {
  return <div data-testid="state-providers-empty" className="rounded-2xl border border-dashed border-border bg-card p-8 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-muted-foreground"><Network className="h-5 w-5" /></div><h3 className="mt-4 text-sm font-semibold">No provider routes yet</h3><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">When the provider registry is available, its health and routing order will appear here.</p><button data-testid="button-empty-configure" onClick={onConfigure} className="mt-5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Open provider routing</button></div>;
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }).format(new Date(value));
  } catch {
    return 'Recently';
  }
}

export default App;