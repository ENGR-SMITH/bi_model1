import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, XCircle } from 'lucide-react';
import { getListChannelsQueryKey, useExchangeChannelOauth } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// OAuth callback — where Google lands after the channel-linking consent
// screen: /creators-den/channels/oauth/callback?code=…&state=…  (or
// ?error=access_denied when the user declined). Reads the code + signed state,
// exchanges them server-side (tokens stored encrypted, channel → CONNECTED
// with real branding), then bounces the user straight into that channel's den
// — no intermediate success page.
// ---------------------------------------------------------------------------

export default function OauthCallbackPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const exchange = useExchangeChannelOauth();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [phase, setPhase] = useState<'exchanging' | 'error'>('exchanging');
  const [message, setMessage] = useState('');

  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');
  // The channel being linked rides in the state token as a base64url JSON
  // payload ({ channelId, exp }); decode it so we know which channel to
  // exchange and where to land afterwards.
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
          // Straight into the linked channel's den (MCNs grid when unknown).
          setLocation(channelId ? `/channels/${channelId}` : '/');
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
    <div className="oauth-standalone" data-testid="oauth-callback-card">
      <div className="paper-card oauth-card">
        {phase === 'exchanging' && (
          <div className="panel-empty">
            <Link2 size={18} />
            {channelId ? 'Opening your channel…' : 'Linking your YouTube channel…'}
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