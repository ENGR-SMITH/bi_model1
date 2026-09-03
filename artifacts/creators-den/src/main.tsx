import { createRoot } from 'react-dom/client';
import { ClerkProvider, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { RealtimeProvider } from '@/lib/realtime';
import AgentSignInPage from '@/pages/agent-signin';

import './index.css';
import './creators.css';

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

function ClerkGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0f0f0f',
          color: '#a1a1a1',
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: 14,
        }}
      >
        Loading Creator Den…
      </div>
    );
  }
  if (!isSignedIn) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#0f0f0f',
          color: '#e5e5e5',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1
            style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 32,
              letterSpacing: '-0.02em',
              color: '#f1f1f1',
              marginBottom: 12,
            }}
          >
            Sign in on Tandem to open your projects.
          </h1>
          <p style={{ lineHeight: 1.7, color: '#a1a1a1' }}>
            Creator Den shares your Tandem account. Sign in on the Tandem app,
            then come back here — your projects, versions, and reviews are tied
            to your identity.
          </p>
          <a
            href="/sign-in"
            style={{
              display: 'inline-block',
              marginTop: 16,
              padding: '12px 22px',
              borderRadius: 999,
              background: '#E50914',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Go to sign in
          </a>
        </div>
      </div>
    );
  }
  return (
    <RealtimeProvider>
      {children}
    </RealtimeProvider>
  );
}

// The desktop agent opens /agent-signin in the user's browser to complete a
// device-flow sign-in. It must render pre-auth (it IS the sign-in page), so it
// bypasses ClerkGate but stays inside ClerkProvider.
const isAgentSignInPath = window.location.pathname.replace(/\/+$/, '').endsWith('/agent-signin');

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ClerkProvider
    publishableKey={clerkPubKey}
    signInUrl="/sign-in"
    signUpUrl="/sign-up"
  >
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        {isAgentSignInPath ? (
          <AgentSignInPage />
        ) : (
          <ClerkGate>
            <App />
          </ClerkGate>
        )}
      </ErrorBoundary>
    </QueryClientProvider>
  </ClerkProvider>,
);
