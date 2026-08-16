import { type ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { clerkAppearance, SignInPage, SignUpPage } from '@/components/auth-pages';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import RoomPage from '@/pages/room';
import Dashboard from '@/pages/dashboard';
import CategoryUnavailable from '@/pages/category-unavailable';
import ActivityPage from '@/pages/activity';
import InboxPage from '@/pages/inbox';
import ProfilePage from '@/pages/profile';
import CollaborationPage from '@/pages/collaboration';
import { ProtectedRoute } from '@/components/protected-shell';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        previousUserId.current !== undefined &&
        previousUserId.current !== userId
      ) {
        queryClient.clear();
      }
      previousUserId.current = userId;
    });

    return unsubscribe;
  }, [addListener]);

  return null;
}

function HomeEntry() {
  const { isLoaded, isSignedIn } = useAuth();

  if (isLoaded && isSignedIn) {
    return <Redirect to="/dashboard" />;
  }

  return <Home />;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to step back into the house',
          },
        },
        signUp: {
          start: {
            title: 'Make room for your ideas',
            subtitle: 'Create your place in Tandem',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <RoutedErrorBoundary>
            <RouterWithAuth />
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function RouterWithAuth() {
  return (
    <Switch>
      <Route path="/" component={HomeEntry} />
      <Route path="/room/:slug" component={RoomPage} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard" component={DashboardRoute} />
      <Route path="/categories/:slug" component={CategoryRoute} />
      <Route path="/categories" component={DashboardRoute} />
      <Route path="/activity" component={ActivityRoute} />
      <Route path="/inbox" component={InboxRoute} />
      <Route path="/profile" component={ProfileRoute} />
      <Route path="/authors/pitch-board/new" component={CollaborationRoute} />
      <Route path="/authors/pitch-board" component={CollaborationRoute} />
      <Route path="/authors/pitch-board/seed/:seedId" component={CollaborationRoute} />
      <Route path="/authors/pitch-board/seed/:seedId/respond" component={CollaborationRoute} />
      <Route path="/authors/collaborations/continuations" component={CollaborationRoute} />
      <Route path="/authors/collaborations/continuation/:continuationId" component={CollaborationRoute} />
      <Route path="/authors/collaborations/seed/:seedId/select" component={CollaborationRoute} />
      <Route path="/authors/collaborations/thread/:threadId" component={CollaborationRoute} />
      <Route path="/authors/collaborations/inbox" component={CollaborationRoute} />
      <Route path="/authors/collaborations/requests" component={CollaborationRoute} />
      <Route path="/authors/collaborations/system" component={CollaborationRoute} />
      <Route path="/authors/collaborations/selection/:continuationId" component={CollaborationRoute} />
      <Route path="/authors/work" component={CollaborationRoute} />
      <Route path="/authors/work/solo" component={CollaborationRoute} />
      <Route path="/authors/work/tandems" component={CollaborationRoute} />
      <Route path="/authors/me" component={ProfileRoute} />
      <Route path="/authors/tandem/:projectId" component={CollaborationRoute} />
      <Route path="/authors/tandem/:projectId/contract" component={CollaborationRoute} />
      <Route path="/authors/tandem/:projectId/waiting" component={CollaborationRoute} />
      <Route path="/authors/tandem/:projectId/story-bible" component={CollaborationRoute} />
      <Route path="/authors/tandem/:projectId/activity" component={CollaborationRoute} />
      <Route component={NotFound} />
    </Switch>
  );
}

function DashboardRoute() {
  return <ProtectedRoute><Dashboard /></ProtectedRoute>;
}

function CategoryRoute() {
  return <ProtectedRoute><CategoryUnavailable /></ProtectedRoute>;
}

function ActivityRoute() {
  return <ProtectedRoute><ActivityPage /></ProtectedRoute>;
}

function InboxRoute() {
  return <ProtectedRoute><InboxPage /></ProtectedRoute>;
}

function ProfileRoute() {
  return <ProtectedRoute><ProfilePage /></ProtectedRoute>;
}

function CollaborationRoute() {
  return <ProtectedRoute><CollaborationPage /></ProtectedRoute>;
}

export default App;
