import { createRoot } from 'react-dom/client';
import { ClerkProvider, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

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
          background: 'var(--paper, #f2e7d8)',
          color: '#625f6d',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 14,
        }}
      >
        Opening your desk…
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
          background: 'var(--paper, #f2e7d8)',
          color: '#625f6d',
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1
            style={{
              fontFamily: 'Libre Baskerville, serif',
              fontStyle: 'italic',
              fontSize: 32,
              color: '#292b45',
              marginBottom: 12,
            }}
          >
            Your desk is signed in on Tandem.
          </h1>
          <p style={{ lineHeight: 1.7 }}>
            Authors Den lives inside the same Tandem account — sign in on the
            Tandem app, then come back here. Seeds you answer and publish are
            tied to your identity.
          </p>
          <a
            href="/sign-in"
            style={{
              display: 'inline-block',
              marginTop: 16,
              padding: '12px 22px',
              borderRadius: 999,
              background: '#292b45',
              color: '#fff4e6',
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
  return children;
}

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
        <ClerkGate>
          <App />
        </ClerkGate>
      </ErrorBoundary>
    </QueryClientProvider>
  </ClerkProvider>,
);
