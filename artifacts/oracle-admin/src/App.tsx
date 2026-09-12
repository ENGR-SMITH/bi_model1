import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  CreditCard,
  Database,
  KeyRound,
  LogOut,
  Mail,
  Menu,
  Network,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Ticket,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { ClerkProvider, useAuth, useClerk, useSignIn } from '@clerk/react';
import { isEmailLinkError, EmailLinkErrorCodeStatus } from '@clerk/react/errors';
import { publishableKeyFromHost } from '@clerk/react/internal';
import {
  getGetAdminSessionQueryKey,
  getListAdminPlanSettingsQueryKey,
  getListAdminPromosQueryKey,
  getListAdminProvidersQueryKey,
  getListAdminSubscriptionsQueryKey,
  useCheckAdminProvider,
  useCreateAdminPromo,
  useGetAdminSession,
  useListAdminPlanSettings,
  useListAdminPromos,
  useListAdminProviders,
  useListAdminSubscriptions,
  useOracleChat,
  useUpdateAdminPlanSetting,
  useUpdateAdminPromo,
  useUpdateAdminProvider,
  useUpdateAdminSubscriptionAutoRenew,
} from '@workspace/api-client-react';
import type { AdminPlanSetting, AdminPromo, AdminSubscription, ProviderStatus, ProviderUpdate } from '@workspace/api-client-react';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

type ProviderId = 'groq' | 'openrouter' | 'ollama' | 'lmstudio' | 'freebuff';

const providerMeta: Record<ProviderId, { eyebrow: string; description: string; tone: string }> = {
  groq: { eyebrow: 'CLOUD / PRIMARY', description: 'Fast inference for everyday oracle sessions.', tone: 'amber' },
  openrouter: { eyebrow: 'CLOUD / FALLBACK', description: 'A broad model relay for resilient overflow.', tone: 'teal' },
  ollama: { eyebrow: 'LOCAL / PRIVATE', description: 'Optional local runtime on the authoring machine.', tone: 'slate' },
  lmstudio: { eyebrow: 'LOCAL / PRIVATE', description: 'Optional desktop inference endpoint.', tone: 'plum' },
  freebuff: { eyebrow: 'LOCAL / GATEWAY', description: 'Freebuff model gateway on the authoring machine.', tone: 'teal' },
};

function App() {
  // Without the Clerk publishable key the magic-link flow has nothing to talk
  // to — show a setup hint instead of an endless loading screen.
  if (!clerkPubKey) {
    return <ClerkSetupHint />;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkApp />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function ClerkApp() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <ErrorBoundary resetKey={window.location.pathname}>
        <Switch>
          <Route path="/verify" component={VerifyEmailLink} />
          <Route path="/" component={OracleAdmin} />
          <Route path="/oracle-admin/" component={OracleAdmin} />
          <Route component={OracleAdmin} />
        </Switch>
      </ErrorBoundary>
    </ClerkProvider>
  );
}

function ClerkSetupHint() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-8">
      <div className="w-full max-w-md rounded-[1.75rem] border border-border bg-card p-8 text-center shadow-xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.045em]">Clerk is not configured here</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">The Oracle Admin signs in with a Clerk magic link. Set <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">CLERK_PUBLISHABLE_KEY</code> in the repo-root <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">.env</code> (the same key the other apps use), then restart the dev server.</p>
      </div>
    </main>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { isLoaded, userId } = useAuth();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    if (
      previousUserId.current !== undefined &&
      previousUserId.current !== userId
    ) {
      queryClient.invalidateQueries();
    }
    previousUserId.current = userId;
  }, [isLoaded, userId]);

  return null;
}

function OracleAdmin() {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const session = useGetAdminSession({
    query: {
      queryKey: getGetAdminSessionQueryKey(),
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sessionStalled, setSessionStalled] = useState(false);
  const isAuthenticated = Boolean(session.data?.authenticated);

  // The session check is the only gate into the control room — if it neither
  // resolves nor errors (API server down, proxy hang, stalled Clerk lookup),
  // surface the failure with a retry instead of an endless loading skeleton.
  useEffect(() => {
    if (!session.isLoading && !session.isFetching) return;
    const timer = window.setTimeout(() => setSessionStalled(true), 8000);
    return () => window.clearTimeout(timer);
  }, [session.isLoading, session.isFetching]);

  const stuck = sessionStalled && (session.isLoading || session.isFetching);

  if (!clerkLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <LoginScreen />;
  if (session.isError || !isAuthenticated || stuck) {
    return (
      <DeniedScreen
        sessionError={session.isError || stuck}
        onRetry={() => {
          setSessionStalled(false);
          session.refetch();
        }}
      />
    );
  }
  if (session.isLoading || session.isFetching) return <LoadingScreen />;
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

/**
 * Pull the reason out of a Clerk SDK error so a failed request says *why* —
 * `form_identifier_not_found` (no such user on this instance) reads very
 * differently from email-link sign-in being disabled, or the verification URL
 * not being an allowed redirect URL. Without this the login screen collapses
 * every one of those into the same sentence.
 * ClerkAPIResponseError nests the detail in `.errors[]`; runtime errors carry
 * a `code` on the error itself.
 */
function clerkErrorReason(error: unknown): string {
  const err = error as {
    errors?: Array<{ code?: string; longMessage?: string; message?: string }>;
    code?: string;
    message?: string;
  };
  const first = err?.errors?.[0];
  const code = first?.code ?? err?.code;
  const text = first?.longMessage ?? first?.message ?? err?.message;
  if (code && text) return `${code} — ${text}`;
  return code ?? text ?? 'unknown error';
}

function LoginScreen() {
  const { signIn } = useSignIn();
  const [email, setEmail] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState('');

  // Clerk's email-link strategy: Clerk emails the sign-in link, the user
  // clicks it, and the session lands back here. No password to create or lose.
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) {
      setMessage('Enter your admin email to continue.');
      return;
    }
    setMessage('');
    setVerifying(true);
    const protocol = window.location.protocol;
    const host = window.location.host;
    try {
      const { error: sendError } = await signIn.emailLink.sendLink({
        emailAddress: email.trim(),
        verificationUrl: `${protocol}//${host}${basePath}/verify`,
      });
      if (sendError) {
        setVerifying(false);
        setMessage(
          `That email could not receive a sign-in link (${clerkErrorReason(sendError)}). Check it and try again.`,
        );
        return;
      }
      // Resolves once the user clicks the link in the email (or it expires).
      const { error: waitError } = await signIn.emailLink.waitForVerification();
      if (waitError) {
        setVerifying(false);
        setMessage('The link was not confirmed in time. Request a new link and try again.');
        return;
      }
      if (signIn.status === 'complete') {
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) {
          setVerifying(false);
          setMessage('Sign-in did not finish. Request a new link.');
          return;
        }
        // finalize activates the session — ClerkProvider re-renders and the
        // control room opens on its own.
      } else {
        setVerifying(false);
        setMessage('Sign-in did not complete. Request a new link.');
      }
    } catch {
      setVerifying(false);
      setMessage('Something went wrong. Request a new link.');
    }
  };

  const reset = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVerifying(false);
    setMessage('');
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
            {verifying ? (
              <>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Story Oracle / Admin</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-foreground">Check your inbox.</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">A sign-in link is on its way to <span className="font-semibold text-foreground">{email.trim()}</span>. Click it and the control room opens — no password needed, ever.</p>
                <form onSubmit={reset} className="mt-9">
                  <button data-testid="button-resend-magic-link" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold transition hover:bg-secondary">
                    <RefreshCw className="h-4 w-4" /> Request a new link
                  </button>
                </form>
                <p className="mt-10 flex items-center gap-2 text-[11px] leading-5 text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" /> The link expires after a few minutes — request another any time.</p>
              </>
            ) : (
              <>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Story Oracle / Admin</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-foreground">Enter the control room.</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">No password to create, remember, or lose. Type your admin email and we'll send you a magic link.</p>
                <form onSubmit={submit} className="mt-9 space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Admin email</span>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                      <input
                        data-testid="input-admin-email"
                        autoComplete="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@yourdomain.com"
                        className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                      />
                    </div>
                  </label>
                  {message && (
                    <div data-testid="status-login-error" className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{message}</span>
                    </div>
                  )}
                  <button data-testid="button-request-magic-link" disabled={verifying} className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">
                    {verifying ? 'Sending link…' : 'Email me a sign-in link'}
                    {!verifying && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
                  </button>
                  <div id="clerk-captcha" />
                </form>
                <p className="mt-10 flex items-center gap-2 text-[11px] leading-5 text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" /> Keys are never displayed after they are saved.</p>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

type VerifyStatus = 'loading' | 'verified' | 'expired' | 'failed' | 'client_mismatch' | 'other_device';

const verifyCopy: Record<VerifyStatus, { title: string; body: string }> = {
  loading: {
    title: 'Confirming your link…',
    body: 'This tab is confirming the sign-in link from your email.',
  },
  verified: {
    title: 'You are signed in.',
    body: 'Opening the control room…',
  },
  other_device: {
    title: 'You are signed in.',
    body: 'The control room is opening in the tab where you requested the link — you can close this one.',
  },
  expired: {
    title: 'This link has expired',
    body: 'Go back to the admin page and request a new link.',
  },
  failed: {
    title: 'The link did not work',
    body: 'Request a new link from the admin page and try again.',
  },
  client_mismatch: {
    title: 'Open the link on the same device',
    body: 'For security, the link must be opened in the same browser where you requested it.',
  },
};

// The magic-link destination: Clerk redirects the clicked email link here.
// Clerk does not process the link on its own — this page drives the
// verification with handleEmailLinkVerification(), which activates the session
// when it exists on this client. Once the session is active, the page drops the
// user straight into the control room.
function VerifyEmailLink() {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { loaded, handleEmailLinkVerification } = useClerk();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<VerifyStatus>('loading');

  // Safety net: the instant the session is active here, open the control room.
  // handleEmailLinkVerification() activates it via setActive; this effect also
  // covers the case where the requesting tab finished the sign-in on its own.
  useEffect(() => {
    if (clerkLoaded && isSignedIn) {
      setLocation('/', { replace: true });
    }
  }, [clerkLoaded, isSignedIn, setLocation]);

  // Drive the email-link verification explicitly (Clerk's documented pattern).
  // The redirect URL carries the link's outcome (__clerk_status /
  // __clerk_created_session): a session already on this client gets activated,
  // an expired or mismatched link throws, and a link verified elsewhere reports
  // through onVerifiedOnOtherDevice. When the session lives on the requesting
  // tab, that tab finalizes a moment after the click — retry briefly so this
  // tab can pick the session up itself instead of leaving the user hanging.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    let retryTimer: number | undefined;

    const verify = (retriesLeft: number) => {
      if (cancelled) return;
      handleEmailLinkVerification({
        onVerifiedOnOtherDevice: () => {
          if (cancelled) return;
          if (retriesLeft > 0) {
            retryTimer = window.setTimeout(() => verify(retriesLeft - 1), 1200);
          } else {
            setStatus('other_device');
          }
        },
      })
        .then(() => {
          if (!cancelled) setStatus('verified');
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          let next: VerifyStatus = 'failed';
          const emailLinkError = error as Error;
          if (isEmailLinkError(emailLinkError)) {
            if (emailLinkError.code === EmailLinkErrorCodeStatus.Expired) next = 'expired';
            else if (emailLinkError.code === EmailLinkErrorCodeStatus.ClientMismatch) next = 'client_mismatch';
          }
          setStatus(next);
        });
    };

    verify(5);

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [loaded, handleEmailLinkVerification]);

  const isError = status === 'expired' || status === 'failed' || status === 'client_mismatch';
  const isDone = status === 'verified' || status === 'other_device';
  const { title, body } = verifyCopy[status];

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-8">
      <div className="w-full max-w-md rounded-[1.75rem] border border-border bg-card p-8 text-center shadow-xl">
        <div className={`mx-auto grid h-12 w-12 place-items-center rounded-xl ${isError ? 'bg-destructive/10 text-destructive' : isDone ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>
          {isError ? <CircleAlert className="h-5 w-5" /> : isDone ? <CircleCheck className="h-5 w-5" /> : <RefreshCw className="h-5 w-5 animate-spin" />}
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.045em]">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
        <a href={basePath || '/'} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary transition-all hover:gap-3">Back to the admin page <ArrowRight className="h-4 w-4" /></a>
      </div>
    </main>
  );
}

function DeniedScreen({ sessionError, onRetry }: { sessionError: boolean; onRetry: () => void }) {
  const { signOut } = useClerk();

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-8">
      <div className="w-full max-w-md rounded-[1.75rem] border border-border bg-card p-8 text-center shadow-xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-destructive/10 text-destructive"><ShieldCheck className="h-5 w-5" /></div>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.045em]">This account can't open the control room.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Only the admin email configured on the server (ADMIN_EMAIL) is allowed in here. Sign out and request the magic link with that address.</p>
        {sessionError && <p className="mt-3 text-xs leading-5 text-destructive">The session check also failed — retry below or sign in again.</p>}
        <div className="mt-6 flex flex-col gap-3">
          <button data-testid="button-sign-out" onClick={() => signOut()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:brightness-105"><LogOut className="h-4 w-4" /> Sign out and switch account</button>
          {sessionError && <button data-testid="button-retry-session" type="button" onClick={onRetry} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold transition hover:bg-secondary"><RefreshCw className="h-4 w-4" /> Retry session check</button>}
        </div>
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
  const session = useGetAdminSession({
    query: {
      queryKey: getGetAdminSessionQueryKey(),
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  });
  const providers = useListAdminProviders({
    query: {
      queryKey: getListAdminProvidersQueryKey(),
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  });
  const { signOut } = useClerk();
  const [activeSection, setActiveSection] = useState<'overview' | 'providers' | 'promos' | 'plans' | 'subscriptions'>('overview');
  const [signingOut, setSigningOut] = useState(false);

  const providerList = useMemo(() => providers.data || [], [providers.data]);
  const connectedCount = providerList.filter((provider) => provider.status === 'connected').length;
  const configuredCount = providerList.filter((provider) => provider.configured).length;

  const signOutOfAdmin = async () => {
    setSigningOut(true);
    try {
      await signOut();
      queryClient.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() });
    } finally {
      setSigningOut(false);
    }
  };

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
              <button data-testid="button-nav-promos" onClick={() => { setActiveSection('promos'); setMobileOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${activeSection === 'promos' ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}`}><Ticket className="h-4 w-4" /> Promo codes</button>
              <button data-testid="button-nav-plans" onClick={() => { setActiveSection('plans'); setMobileOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${activeSection === 'plans' ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}`}><CreditCard className="h-4 w-4" /> Plan settings</button>
              <button data-testid="button-nav-subscriptions" onClick={() => { setActiveSection('subscriptions'); setMobileOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${activeSection === 'subscriptions' ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}`}><Users className="h-4 w-4" /> Subscriptions</button>
            </nav>
          </div>
          <div className="mt-auto">
            <div className="mb-5 rounded-2xl border border-sidebar-border bg-sidebar-accent/40 p-4">
              <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/50">Session</span><span className="h-2 w-2 rounded-full bg-sidebar-primary" /></div>
              <p className="mt-3 text-xs text-sidebar-foreground/70">Private operator mode</p>
              <p className="mt-1 font-mono text-[10px] text-sidebar-foreground/40">credentials sealed</p>
            </div>
            <button data-testid="button-admin-logout" onClick={signOutOfAdmin} disabled={signingOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50"><LogOut className="h-4 w-4" /> {signingOut ? 'Closing session…' : 'Close session'}</button>
          </div>
        </aside>
        {mobileOpen && <button data-testid="button-mobile-overlay" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" aria-label="Close menu" />}
        <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 sm:py-10 lg:px-14 lg:py-12">
          {activeSection === 'overview' ? (
            <Overview providers={providerList} isLoading={providers.isLoading} isError={providers.isError} onRetry={() => providers.refetch()} connectedCount={connectedCount} configuredCount={configuredCount} onConfigure={() => setActiveSection('providers')} />
          ) : activeSection === 'promos' ? (
            <PromosSection session={session.data?.authenticated ?? false} />
          ) : activeSection === 'plans' ? (
            <PlanSettingsSection session={session.data?.authenticated ?? false} />
          ) : activeSection === 'subscriptions' ? (
            <SubscriptionsSection session={session.data?.authenticated ?? false} />
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

// ---------------------------------------------------------------------------
// Ticket promo codes — the admin surface for the monthly passes. Only FREE
// codes are accepted at checkout: every plan bills monthly through Whop,
// so percent/dollar-off codes (which would discount the first charge) don't
// apply. Legacy PERCENT/FLAT rows are still listed for history but are not
// accepted. Codes are created/edited/deleted here; the checkout validates
// them live.
// ---------------------------------------------------------------------------

const PROMO_KIND_META: Record<string, { label: string; tone: string }> = {
  FREE: { label: 'Free pass', tone: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/25' },
  PERCENT: { label: '% off · legacy', tone: 'text-amber-600 bg-amber-500/10 border-amber-500/25' },
  FLAT: { label: '$ off · legacy', tone: 'text-sky-600 bg-sky-500/10 border-sky-500/25' },
};

/** The pass each code can be redeemed against. A code belongs to exactly one. */
const PROMO_CATEGORIES = [
  { value: 'authors', label: 'Author & Writer pass' },
  { value: 'content-creators', label: 'Content Creators pass' },
] as const;

type PromoCategory = (typeof PROMO_CATEGORIES)[number]['value'];

/** Legacy rows created before scoping carry no category and work on any pass. */
function promoCategoryLabel(category: string | null): string {
  return PROMO_CATEGORIES.find((entry) => entry.value === category)?.label ?? 'Any pass · legacy';
}

/** How long a pass a code grants lasts, in the words the admin reads. */
function promoDurationLabel(days: number): string {
  if (days === 30) return 'one free month';
  if (days === 1) return 'a one-day pass';
  if (days === 7) return 'a one-week pass';
  return `a ${days}-day pass`;
}

function PromoValueLabel(promo: AdminPromo): string {
  if (promo.kind === 'FREE') return `Grants ${promoDurationLabel(promo.durationDays)}`;
  if (promo.kind === 'PERCENT') return `${promo.value}% off — no longer accepted`;
  return `$${(promo.value / 100).toFixed(2)} off — no longer accepted`;
}

function PromosSection({ session }: { session: boolean }) {
  const promos = useListAdminPromos();

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="animate-in">
        <PageHeading
          eyebrow="Control room / ticket passes"
          title="Manage the promo codes."
          description="Create and retire the codes the pass checkout accepts. Every code is dedicated to ONE category pass — an Author & Writer code is refused on the Content Creators pass and vice versa. Only FREE codes apply — every plan bills monthly through Whop, so percent and dollar-off codes can't discount a subscription. A FREE code grants a pass as long as the code says (30 days by default) with no card charge; every code can be shared by many people — each person may redeem it once — and a code that is paused stops working immediately without losing its history."
          action={
            <div data-testid="status-authenticated" className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-primary">
              <ShieldCheck className="h-3.5 w-3.5" /> {session ? 'Session verified' : 'Session pending'}
            </div>
          }
        />
      </div>

      <div className="mt-10 space-y-6 animate-in delay-100">
        <CreatePromoForm />
        {promos.isError ? (
          <ErrorState onRetry={() => promos.refetch()} />
        ) : promos.isLoading ? (
          <PromoSkeleton />
        ) : (promos.data ?? []).length === 0 ? (
          <div data-testid="state-promos-empty" className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-muted-foreground"><Ticket className="h-5 w-5" /></div>
            <h3 className="mt-4 text-sm font-semibold">No promo codes yet</h3>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">Create one above — for example a FREE code for early testers or a launch giveaway.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(promos.data ?? []).map((promo) => (
              <PromoRow key={promo.code} promo={promo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PromoSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-24 rounded-2xl border border-border bg-secondary/60" />
      ))}
    </div>
  );
}

function CreatePromoForm() {
  const queryClient = useQueryClient();
  const create = useCreateAdminPromo({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminPromosQueryKey() });
        setCode('');
        setUsage('multi-unlimited');
        setCap('10');
        setDurationDays('30');
        setExpiry('');
        setNotice('');
      },
      onError: (error) => {
        const apiError = error as { response?: { data?: { error?: string } } } | null;
        setNotice(apiError?.response?.data?.error || 'That code could not be created.');
      },
    },
  });
  const [code, setCode] = useState('');
  const [category, setCategory] = useState<PromoCategory>('authors');
  const [usage, setUsage] = useState<'single' | 'multi-unlimited' | 'multi-capped'>('multi-unlimited');
  const [cap, setCap] = useState('10');
  // How long the pass this code grants lasts. 30 = the normal month; a short
  // promo (a 2-day launch window) sets exactly what it promises.
  const [durationDays, setDurationDays] = useState('30');
  const [expiry, setExpiry] = useState('');
  const [notice, setNotice] = useState('');

  const maxUsesOf = (): number => {
    if (usage === 'single') return 1;
    if (usage === 'multi-capped') return Math.max(2, Number(cap) || 2);
    return 0; // unlimited people
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    if (!code.trim()) {
      setNotice('Give the code a name, e.g. EARLYBIRD.');
      return;
    }
    const days = Number(durationDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      setNotice('Pass length must be between 1 and 365 days — 30 is one month.');
      return;
    }
    create.mutate({
      data: {
        code: code.trim(),
        category,
        kind: 'FREE',
        value: 0,
        durationDays: Math.floor(days),
        maxUses: maxUsesOf(),
        expiresAt: expiry ? new Date(expiry).toISOString() : undefined,
      },
    });
  };

  const inputClass = 'h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid="create-promo-form">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-foreground"><Plus className="h-4 w-4" /></span>
        <div>
          <h3 className="text-sm font-semibold">New promo code</h3>
          <p className="text-xs text-muted-foreground">Every code is a FREE code — it grants a pass as long as the length you set (30 days = one month) with no card charge — and is dedicated to the one pass category you pick. Codes are stored uppercase and the checkout matches them exactly.</p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_.9fr_.7fr_.9fr_auto]">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Code</span>
          <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="EARLYBIRD" className={inputClass} data-testid="input-promo-code" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as PromoCategory)} className={inputClass} data-testid="select-promo-category">
            {PROMO_CATEGORIES.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Who can use it</span>
          <select value={usage} onChange={(event) => setUsage(event.target.value as 'single' | 'multi-unlimited' | 'multi-capped')} className={inputClass} data-testid="select-promo-usage">
            <option value="multi-unlimited">Many people · no limit</option>
            <option value="single">One person only</option>
            <option value="multi-capped">Many people · limited</option>
          </select>
          {usage === 'multi-capped' && (
            <input type="number" min="2" value={cap} onChange={(event) => setCap(event.target.value)} className={`${inputClass} mt-2`} aria-label="People limit" data-testid="input-promo-max-uses" />
          )}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pass length (days)</span>
          <input type="number" min="1" max="365" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} className={inputClass} aria-label="Pass length in days" data-testid="input-promo-duration" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Code expires (optional)</span>
          <input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} className={inputClass} data-testid="input-promo-expiry" />
        </label>
        <button type="submit" disabled={create.isPending} className="mt-6 h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60" data-testid="button-create-promo">
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>
      {notice && <p className="mt-3 text-xs font-semibold text-destructive" role="alert" data-testid="create-promo-notice">{notice}</p>}
    </section>
  );
}

type PromoUsage = 'single' | 'multi-unlimited' | 'multi-capped';

function usageForMaxUses(maxUses: number): PromoUsage {
  if (maxUses <= 1) return maxUses === 1 ? 'single' : 'multi-unlimited';
  return 'multi-capped';
}

function PromoRow({ promo }: { promo: AdminPromo }) {
  const queryClient = useQueryClient();
  const update = useUpdateAdminPromo({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAdminPromosQueryKey() }),
    },
  });
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<string>(promo.category ?? 'authors');
  const [usage, setUsage] = useState<PromoUsage>(usageForMaxUses(promo.maxUses));
  const [cap, setCap] = useState(String(promo.maxUses > 1 ? promo.maxUses : 10));
  const [durationDays, setDurationDays] = useState(String(promo.durationDays ?? 30));
  const [expiry, setExpiry] = useState(promo.expiresAt ? new Date(promo.expiresAt).toISOString().slice(0, 10) : '');

  const meta = PROMO_KIND_META[promo.kind] ?? PROMO_KIND_META.PERCENT;
  const exhausted = promo.maxUses > 0 && promo.uses >= promo.maxUses;
  const inputClass = 'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

  const maxUsesOf = (): number => {
    if (usage === 'single') return 1;
    if (usage === 'multi-capped') return Math.max(2, Number(cap) || 2);
    return 0;
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update.mutate({
      code: promo.code,
      data: {
        // Only FREE codes are accepted at checkout — preserve whatever kind
        // this row carries (legacy PERCENT/FLAT rows keep their history).
        kind: promo.kind as 'FREE' | 'PERCENT' | 'FLAT',
        // Re-scoping is allowed here so a mis-assigned code can be corrected.
        category: category as PromoCategory,
        value: promo.value,
        durationDays: Math.min(365, Math.max(1, Math.floor(Number(durationDays) || 30))),
        maxUses: maxUsesOf(),
        active: promo.active,
        expiresAt: expiry ? new Date(expiry).toISOString() : undefined,
      },
    });
    setEditing(false);
  };

  const pauseOrResume = () => {
    update.mutate({
      code: promo.code,
      data: {
        kind: promo.kind as 'FREE' | 'PERCENT' | 'FLAT',
        value: promo.value,
        maxUses: promo.maxUses,
        active: !promo.active,
        expiresAt: promo.expiresAt ? new Date(promo.expiresAt).toISOString() : undefined,
      },
    });
  };

  return (
    <div data-testid={`promo-${promo.code}`} className="rounded-2xl border border-border bg-card p-5">
      {editing ? (
        <form onSubmit={save} className="grid gap-4 md:grid-cols-[1fr_.8fr_.7fr_1fr_auto]">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} data-testid={`select-category-${promo.code}`}>
              {PROMO_CATEGORIES.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Who can use it</span>
            <select value={usage} onChange={(event) => setUsage(event.target.value as PromoUsage)} className={inputClass}>
              <option value="multi-unlimited">Many people · no limit</option>
              <option value="single">One person only</option>
              <option value="multi-capped">Many people · limited</option>
            </select>
            {usage === 'multi-capped' && (
              <input type="number" min="2" value={cap} onChange={(event) => setCap(event.target.value)} className={`${inputClass} mt-2`} aria-label="People limit" />
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pass length (days)</span>
            <input type="number" min="1" max="365" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} className={inputClass} aria-label="Pass length in days" data-testid={`input-duration-${promo.code}`} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Code expires (optional)</span>
            <input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} className={inputClass} />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" disabled={update.isPending} className="h-10 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:brightness-105 disabled:opacity-60">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-xl border border-border px-4 text-xs font-semibold hover:bg-secondary">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <span className={`rounded-lg border px-2.5 py-1 font-mono text-xs font-bold tracking-[0.12em] ${meta.tone}`}>{promo.code}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{PromoValueLabel(promo)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className={promo.active ? '' : 'text-amber-600'}>
                {promo.active ? 'Live' : 'Paused'} · redeemed by {promo.uses}
                {promo.maxUses > 0 ? ` of ${promo.maxUses} ${promo.maxUses === 1 ? 'person' : 'people'}` : ' · unlimited people'}
              </span>
              {exhausted && promo.active && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">all uses taken</span>}
              {promo.expiresAt && <span className="ml-2">· code expires {formatDate(promo.expiresAt)}</span>}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              {promoCategoryLabel(promo.category)} · pass lasts {promo.durationDays} {promo.durationDays === 1 ? 'day' : 'days'} · each person can redeem this code once.
            </p>
          </div>
          <button data-testid={`button-edit-${promo.code}`} type="button" onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary"><Pencil className="h-3.5 w-3.5" /> Edit</button>
          <button data-testid={`button-toggle-${promo.code}`} type="button" onClick={pauseOrResume} disabled={update.isPending} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${promo.active ? 'border-amber-600/30 text-amber-600 hover:bg-amber-600/5' : 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'}`}>
            {promo.active ? <PauseCircle className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
            {update.isPending ? 'Saving…' : promo.active ? 'Pause' : 'Resume'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscriptions admin — every purchase across all accounts, newest first,
// with the buyer's email resolved from Clerk. The auto-renew toggle here is
// the per-account override: switch server-managed renewal on/off for one
// specific subscription without touching the customer's other rows.
// ---------------------------------------------------------------------------

function apiErrorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Something went wrong — try again.';
}

type SubscriptionKindFilter = 'pass' | 'storage' | 'projects';

const SUBSCRIPTION_PRODUCT_META: Record<SubscriptionKindFilter, { label: string; title: string; description: string; icon: React.ReactNode }> = {
  pass: {
    label: 'NEXET pass',
    title: 'Category passes',
    description: 'Every pass purchase across both categories, arranged by category and account, with auto-renewal control per subscription.',
    icon: <Ticket className="h-5 w-5" />,
  },
  storage: {
    label: 'Creator Den',
    title: 'Workspace storage',
    description: 'Every storage extension (GB/TB) purchased across all Creator Den accounts, arranged by plan and account, with auto-renewal control per subscription.',
    icon: <Database className="h-5 w-5" />,
  },
  projects: {
    label: 'Author Den',
    title: 'Project capacity',
    description: 'Every project-count plan purchased across all Author Den accounts, arranged by plan and account, with auto-renewal control per subscription.',
    icon: <BookOpen className="h-5 w-5" />,
  },
};

function SubscriptionsSection({ session }: { session: boolean }) {
  const subscriptions = useListAdminSubscriptions();
  const queryClient = useQueryClient();
  const update = useUpdateAdminSubscriptionAutoRenew({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAdminSubscriptionsQueryKey() }),
    },
  });
  const [kind, setKind] = useState<SubscriptionKindFilter | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [error, setError] = useState('');

  const all = subscriptions.data ?? [];
  const toggle = (sub: AdminSubscription) => {
    setError('');
    update.mutate(
      { id: sub.id, data: { enabled: !sub.autoRenew } },
      {
        onError: (cause: unknown) => setError(apiErrorText(cause)),
      },
    );
  };

  if (selectedUser) {
    return (
      <UserProfilePage
        userId={selectedUser}
        rows={all.filter((sub) => sub.userId === selectedUser)}
        backLabel={kind ? SUBSCRIPTION_PRODUCT_META[kind].label : undefined}
        onBack={() => setSelectedUser(null)}
        updating={update.isPending}
        onToggle={toggle}
        error={error}
        session={session}
      />
    );
  }

  if (kind) {
    return (
      <SubscriptionKindPage
        kind={kind}
        rows={all.filter((sub) => sub.kind === kind)}
        isLoading={subscriptions.isLoading}
        isError={subscriptions.isError}
        onRetry={() => subscriptions.refetch()}
        onBack={() => setKind(null)}
        onSelectUser={(userId) => setSelectedUser(userId)}
        updating={update.isPending}
        onToggle={toggle}
        error={error}
        session={session}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="animate-in">
        <PageHeading
          eyebrow="Control room / subscriptions"
          title="Every subscription, every account."
          description="Pick a product to see who is paying for what — arranged by plan and account — and switch server-managed auto-renewal on or off for any individual subscription."
          action={
            <div data-testid="status-authenticated" className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-primary">
              <ShieldCheck className="h-3.5 w-3.5" /> {session ? 'Session verified' : 'Session pending'}
            </div>
          }
        />
      </div>

      <div className="mt-10 space-y-4 animate-in delay-100">
        {error && (
          <p data-testid="subscriptions-error" className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">{error}</p>
        )}

        {subscriptions.isError ? (
          <ErrorState onRetry={() => subscriptions.refetch()} />
        ) : subscriptions.isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">{[0, 1, 2].map((item) => <div key={item} className="h-52 rounded-2xl border border-border bg-secondary/60" />)}</div>
        ) : all.length === 0 ? (
          <div data-testid="state-subscriptions-empty" className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-muted-foreground"><Users className="h-5 w-5" /></div>
            <h3 className="mt-4 text-sm font-semibold">No subscriptions yet</h3>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">Purchases from the category-pass, storage, and projects checkouts will land here.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(SUBSCRIPTION_PRODUCT_META) as SubscriptionKindFilter[]).map((productKind) => {
              const rows = all.filter((sub) => sub.kind === productKind);
              const meta = SUBSCRIPTION_PRODUCT_META[productKind];
              return (
                <button
                  key={productKind}
                  type="button"
                  data-testid={`card-subscriptions-${productKind}`}
                  onClick={() => setKind(productKind)}
                  className="group flex flex-col rounded-2xl border border-border bg-card p-6 text-left transition hover:border-primary/40 hover:bg-secondary/40"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-muted-foreground transition group-hover:text-primary">{meta.icon}</span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">{meta.label}</h3>
                      <p className="text-[11px] text-muted-foreground">{meta.title}</p>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <StatBox label="Subscriptions" value={rows.length} />
                    <StatBox label="Active" value={rows.filter((sub) => sub.active).length} />
                    <StatBox label="Users" value={new Set(rows.map((sub) => sub.userId)).size} />
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {rows.filter((sub) => sub.autoRenew).length} auto-renewing · {new Set(rows.map((sub) => sub.planId)).size} plans
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition group-hover:text-primary">
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-2 py-2 text-center">
      <p className="font-mono text-sm font-bold">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
    </div>
  );
}

function SubscriptionKindPage({
  kind,
  rows,
  isLoading,
  isError,
  onRetry,
  onBack,
  onSelectUser,
  updating,
  onToggle,
  error,
  session,
}: {
  kind: SubscriptionKindFilter;
  rows: AdminSubscription[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onBack: () => void;
  onSelectUser: (userId: string) => void;
  updating: boolean;
  onToggle: (sub: AdminSubscription) => void;
  error: string;
  session: boolean;
}) {
  const meta = SUBSCRIPTION_PRODUCT_META[kind];
  const [filter, setFilter] = useState('');

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? rows.filter((sub) =>
        [sub.userEmail, sub.userId, sub.planLabel, sub.planId, sub.status, sub.id]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q)),
      )
    : rows;

  const planGroups = groupByPlanId(filtered).sort((a, b) => a.planId.localeCompare(b.planId));

  return (
    <div className="mx-auto max-w-[1180px]">
      <button
        type="button"
        onClick={onBack}
        data-testid="button-subscriptions-back"
        className="mb-5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All subscriptions
      </button>

      <div className="animate-in">
        <PageHeading
          eyebrow={`Control room / ${meta.label}`}
          title={meta.title}
          description={meta.description}
          action={
            <div data-testid="status-authenticated" className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-primary">
              <ShieldCheck className="h-3.5 w-3.5" /> {session ? 'Session verified' : 'Session pending'}
            </div>
          }
        />
      </div>

      <div className="mt-8 space-y-4 animate-in delay-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by email, user id, plan, or status…"
            data-testid="input-subscriptions-filter"
            className="h-10 w-full max-w-sm rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <span className="text-[11px] text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'subscription' : 'subscriptions'} · {filtered.filter((sub) => sub.active).length} active · {filtered.filter((sub) => sub.autoRenew).length} auto-renewing
          </span>
        </div>

        {error && (
          <p data-testid="subscriptions-error" className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">{error}</p>
        )}

        {isError ? (
          <ErrorState onRetry={onRetry} />
        ) : isLoading ? (
          <div className="space-y-3 animate-pulse">{[0, 1, 2].map((item) => <div key={item} className="h-24 rounded-2xl border border-border bg-secondary/60" />)}</div>
        ) : rows.length === 0 ? (
          <div data-testid={`state-${kind}-empty`} className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            No {meta.label} subscriptions yet — they'll appear here after the first purchase.
          </div>
        ) : filtered.length === 0 ? (
          <div data-testid="state-subscriptions-no-match" className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">No {meta.label} subscriptions match “{filter}”.</div>
        ) : (
          <div className="space-y-6">
            {planGroups.map((group) => (
              <div key={group.planId}>
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-sm font-semibold">{group.planLabel}</h3>
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{group.planId}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{group.subs.length} {group.subs.length === 1 ? 'subscription' : 'subscriptions'}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-3">
                  {groupByUser(group.subs)
                    .sort((a, b) => (a.userEmail ?? a.userId).localeCompare(b.userEmail ?? b.userId))
                    .map((user) => (
                      <div key={user.userId} className="rounded-2xl border border-border/60 bg-background/40 p-3">
                        <button
                          type="button"
                          onClick={() => onSelectUser(user.userId)}
                          data-testid={`button-user-${user.userId}`}
                          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-2 pb-2 text-left transition hover:text-primary"
                        >
                          <p className="text-xs font-semibold">{user.userEmail ?? `User ${user.userId}`}</p>
                          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                            {user.userId} <ArrowRight className="h-3 w-3" />
                          </span>
                        </button>
                        <div className="space-y-2">
                          {user.subs.map((sub) => (
                            <SubscriptionRow key={sub.id} sub={sub} updating={updating} onToggle={() => onToggle(sub)} compact />
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserProfilePage({
  userId,
  rows,
  backLabel,
  onBack,
  updating,
  onToggle,
  error,
  session,
}: {
  userId: string;
  rows: AdminSubscription[];
  backLabel?: string;
  onBack: () => void;
  updating: boolean;
  onToggle: (sub: AdminSubscription) => void;
  error: string;
  session: boolean;
}) {
  const user = rows[0];
  const email = user?.userEmail ?? null;
  const kinds: SubscriptionKindFilter[] = ['pass', 'storage', 'projects'];

  return (
    <div className="mx-auto max-w-[1180px]">
      <button
        type="button"
        onClick={onBack}
        data-testid="button-user-profile-back"
        className="mb-5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {backLabel ?? 'All subscriptions'}
      </button>

      <div className="animate-in">
        <PageHeading
          eyebrow="Control room / account"
          title={email ?? `User ${userId}`}
          description="Every subscription this account holds across NEXET pass, Creator Den, and Author Den — the full purchase history on one view."
          action={
            <div data-testid="status-authenticated" className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-primary">
              <ShieldCheck className="h-3.5 w-3.5" /> {session ? 'Session verified' : 'Session pending'}
            </div>
          }
        />
      </div>

      <div className="mt-8 space-y-4 animate-in delay-100">
        {error && (
          <p data-testid="subscriptions-error" className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="Subscriptions" value={rows.length} />
          <StatBox label="Active" value={rows.filter((sub) => sub.active).length} />
          <StatBox label="Auto-renewing" value={rows.filter((sub) => sub.autoRenew).length} />
          <StatBox label="Products" value={new Set(rows.map((sub) => sub.kind)).size} />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">account {userId}</p>

        {rows.length === 0 ? (
          <div data-testid="state-user-empty" className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            This account has no subscriptions yet.
          </div>
        ) : (
          kinds.map((kind) => {
            const kindRows = rows.filter((sub) => sub.kind === kind);
            if (kindRows.length === 0) return null;
            return (
              <div key={kind}>
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-sm font-semibold">{SUBSCRIPTION_PRODUCT_META[kind].label}</h3>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{kindRows.length} {kindRows.length === 1 ? 'subscription' : 'subscriptions'}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-3">
                  {kindRows.map((sub) => (
                    <SubscriptionRow key={sub.id} sub={sub} updating={updating} onToggle={() => onToggle(sub)} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function groupByPlanId(rows: AdminSubscription[]): Array<{ planId: string; planLabel: string; subs: AdminSubscription[] }> {
  const groups: Array<{ planId: string; planLabel: string; subs: AdminSubscription[] }> = [];
  for (const sub of rows) {
    let group = groups.find((item) => item.planId === sub.planId);
    if (!group) {
      group = { planId: sub.planId, planLabel: sub.planLabel, subs: [] };
      groups.push(group);
    }
    group.subs.push(sub);
  }
  return groups;
}

function groupByUser(rows: AdminSubscription[]): Array<{ userId: string; userEmail: string | null; subs: AdminSubscription[] }> {
  const groups: Array<{ userId: string; userEmail: string | null; subs: AdminSubscription[] }> = [];
  for (const sub of rows) {
    let group = groups.find((item) => item.userId === sub.userId);
    if (!group) {
      group = { userId: sub.userId, userEmail: sub.userEmail, subs: [] };
      groups.push(group);
    }
    group.subs.push(sub);
  }
  return groups;
}

function SubscriptionRow({ sub, updating, onToggle, compact = false }: { sub: AdminSubscription; updating: boolean; onToggle: () => void; compact?: boolean }) {
  return (
    <div data-testid={`admin-sub-${sub.id}`} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card ${compact ? 'p-3.5' : 'p-5'}`}>
      <div className="min-w-0">
        <p className={`${compact ? 'text-xs' : 'text-sm'} font-semibold`}>{sub.userEmail ?? `User ${sub.userId}`}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {sub.planLabel} · {sub.kind} · {sub.planId} · ${(sub.priceUsd / 100).toFixed(2)} / {sub.intervalLabel}
        </p>
        {!compact && (
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">user {sub.userId} · sub {sub.id}</p>
        )}
        {sub.renewalFailure ? (
          <p className="mt-2 rounded-md border border-amber-600/25 bg-amber-600/5 px-2 py-1 text-[11px] leading-relaxed text-amber-600" data-testid={`admin-sub-failure-${sub.id}`}>{sub.renewalFailure}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${sub.active ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600' : 'border-border bg-secondary/60 text-muted-foreground'}`}>{sub.active ? 'Active' : sub.status}</span>
        <span className="font-mono text-[10px] text-muted-foreground">until {formatDate(sub.periodEnd)}</span>
        {sub.cardLast4 ? <span className="font-mono text-[10px] text-muted-foreground">•••• {sub.cardLast4}</span> : null}
        <button
          type="button"
          data-testid={`button-admin-auto-renew-${sub.id}`}
          onClick={onToggle}
          disabled={updating}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${sub.autoRenew ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15' : 'border-border text-muted-foreground hover:bg-secondary'}`}
        >
          {sub.autoRenew ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
          {updating ? 'Saving…' : sub.autoRenew ? 'Auto-renew on' : 'Auto-renew off'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscription plan settings — the operational knobs on the code-defined plan
// catalog. Every Whop subscription auto-renews by default; this is where
// an admin can switch auto-renewal off for a whole plan. New purchases follow
// this switch, and the per-subscription toggle in the Subscriptions room
// overrides an individual row.
// ---------------------------------------------------------------------------

const PLAN_SETTING_GROUPS: Array<{ kind: string; label: string; hint: string }> = [
  { kind: 'pass', label: 'Category passes', hint: 'Every pass auto-renews with the card on file. Switch it off to stop new pass purchases from renewing.' },
  { kind: 'storage', label: 'Creator Den storage', hint: 'Storage extensions auto-renew each cycle. Switch it off to stop new storage purchases from renewing.' },
  { kind: 'projects', label: 'Author Den projects', hint: 'Project plans auto-renew each cycle. Switch it off to stop new project purchases from renewing.' },
];

function PlanSettingsSection({ session }: { session: boolean }) {
  const settings = useListAdminPlanSettings();
  const queryClient = useQueryClient();
  const update = useUpdateAdminPlanSetting({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAdminPlanSettingsQueryKey() }),
    },
  });

  const plans = settings.data ?? [];

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="animate-in">
        <PageHeading
          eyebrow="Control room / subscriptions"
          title="Tune the subscription plans."
          description="Turn server-managed auto-renewal on or off per plan. New purchases follow this switch — every Whop subscription renews by default unless switched off here (or on an individual subscription in the Subscriptions room)."
          action={
            <div data-testid="status-authenticated" className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-primary">
              <ShieldCheck className="h-3.5 w-3.5" /> {session ? 'Session verified' : 'Session pending'}
            </div>
          }
        />
      </div>

      <div className="mt-10 space-y-8 animate-in delay-100">
        {settings.isError ? (
          <ErrorState onRetry={() => settings.refetch()} />
        ) : settings.isLoading ? (
          <div className="space-y-3 animate-pulse">{[0, 1, 2, 3].map((item) => <div key={item} className="h-20 rounded-2xl border border-border bg-secondary/60" />)}</div>
        ) : (
          PLAN_SETTING_GROUPS.map((group) => {
            const rows = plans.filter((plan) => plan.kind === group.kind);
            if (rows.length === 0) return null;
            return (
              <div key={group.kind}>
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{group.hint}</p>
                </div>
                <div className="space-y-3">
                  {rows.map((plan) => (
                    <PlanSettingRow
                      key={`${plan.kind}:${plan.planId}`}
                      plan={plan}
                      updating={update.isPending}
                      onToggle={() =>
                        update.mutate({
                          kind: plan.kind,
                          planId: plan.planId,
                          data: { autoRenewAvailable: !plan.autoRenewAvailable },
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PlanSettingRow({ plan, updating, onToggle }: { plan: AdminPlanSetting; updating: boolean; onToggle: () => void }) {
  return (
    <div data-testid={`plan-setting-${plan.kind}-${plan.planId}`} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{plan.planLabel}</p>
        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          {plan.kind} · {plan.planId} · ${(plan.priceUsd / 100).toFixed(2)} / {plan.intervalLabel}
        </p>
      </div>
      <button
        type="button"
        data-testid={`button-toggle-auto-renew-${plan.planId}`}
        onClick={onToggle}
        disabled={updating}
        className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${plan.autoRenewAvailable ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15' : 'border-border text-muted-foreground hover:bg-secondary'}`}
      >
        {plan.autoRenewAvailable ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
        {updating ? 'Saving…' : plan.autoRenewAvailable ? 'Auto-renew on' : 'Auto-renew off'}
      </button>
    </div>
  );
}

export default App;