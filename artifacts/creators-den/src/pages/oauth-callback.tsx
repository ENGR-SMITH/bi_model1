import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Link2, XCircle } from 'lucide-react';
import { getListChannelsQueryKey, useExchangeChannelOauth } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// OAuth callback — where Google lands after the channel-linking consent
// screen: /creators-den/channels/oauth/callback?code=…&state=…  (or
// ?error=access_denied when the user declined). Reads the code + signed state,
// exchanges them server-side (tokens stored encrypted, channel → CONNECTED
// with real branding), then returns to the CMS grid.
// ---------------------------------------------------------------------------

export default function OauthCallbackPage() {
  const queryClient = useQueryClient();
  const exchange = useExchangeChannelOauth();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [phase, setPhase] = useState<'exchanging' | 'done' | 'error'>('exchanging');
  const [message, setMessage] = useState('');

  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');
  // The channel being linked rides in the state token as a base64url JSON
  // payload ({ channelId, exp }); decode it so we know which channel to exchange.
  let channelId = '';
  try {
    const payload = (state ?? '').split('.')[0];
    channelId = (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')) as string) as { channelId?: string }).channelId ?? '';
  } catch {
    channelId = '';
  }

  useEffect(() => {
    // The user declined the consent screen — nothing to exchange.
    if (denied) {
      setPhase('error');
      setMessage('You declined the link — the channel stays unlinked.');
      return;
    }
    if (!code || !state) {
      setPhase('error');
      setMessage('This link request is incomplete — start again from the channel card.');
      return;
    }
    exchange.mutate(
      { channelId, data: { state, code } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
          setPhase('done');
        },
        onError: (error) => {
          const err = error as { response?: { data?: { error?: string } } };
          setMessage(err?.response?.data?.error || 'The link could not be completed — try again.');
          setPhase('error');
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <div className="paper-card" style={{ maxWidth: 480, marginInline: 'auto', marginTop: 48 }} data-testid="oauth-callback-card">
        {phase === 'exchanging' && (
          <div className="panel-empty">
            <Link2 size={18} />
            Linking your YouTube channel…
          </div>
        )}
        {phase === 'done' && (
          <div className="empty-state" data-testid="oauth-callback-success">
            <CheckCircle2 size={22} />
            <h3>YouTube channel linked.</h3>
            <p>Its name, logo, and banner now show on the channel card — and Analytics can start tracking it.</p>
            <Link href="/" className="primary-btn mt-3">Back to your channels</Link>
          </div>
        )}
        {phase === 'error' && (
          <div className="empty-state" data-testid="oauth-callback-error">
            <XCircle size={22} />
            <h3>The link didn't complete.</h3>
            <p>{message}</p>
            <Link href="/" className="secondary-btn mt-3">Back to your channels</Link>
          </div>
        )}
      </div>
    </div>
  );
}