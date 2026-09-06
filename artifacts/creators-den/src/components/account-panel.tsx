import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, HardDrive, Loader2, Lock, Upload, X } from 'lucide-react';
import {
  getGetAccountQuotaQueryKey,
  getGetUserCvQueryKey,
  getSubscriptionPlansQueryKey,
  getUserCvFile,
  useCreatePaystackCheckout,
  useDeleteUserCv,
  useGetAccountQuota,
  useGetUserCv,
  useSubscriptionPlans,
  useUploadUserCv,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Account panels — the workspace storage bar (2 GB free, buy-more plans) and
// the CV card, both shown on the user profile page. The bar is private to the
// profile owner (it is their account's limit); the CV is visible to everyone
// who views the profile.
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

// The workspace size bar — total space the account is limited to, the current
// space used, and the space left, with a buy-more button for extension.
export function StorageBar() {
  const [buyOpen, setBuyOpen] = useState(false);
  const quota = useGetAccountQuota();

  const used = quota.data?.storageBytes.usedBytes ?? 0;
  const total = quota.data?.storageBytes.totalBytes ?? 0;
  const remaining = quota.data?.storageBytes.remainingBytes ?? 0;
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  return (
    <>
      <div className="paper-card account-bar-card" data-testid="panel-storage-bar">
        <div className="inline-heading">
          <span className="eyebrow"><HardDrive size={13} /> Workspace storage</span>
          <span className="mono-label">{formatBytes(used)} of {formatBytes(total)} used</span>
        </div>
        <div className="account-bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
          <div className="account-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="account-bar-stats">
          <span>USED <b>{formatBytes(used)}</b></span>
          <span>TOTAL <b>{formatBytes(total)}</b></span>
          <span>LEFT <b>{formatBytes(remaining)}</b></span>
        </div>
        <p className="account-bar-note">
          Every project you captain shares this space — uploads stop when it runs out.
        </p>
        <button type="button" className="primary-btn" onClick={() => setBuyOpen(true)} data-testid="btn-buy-space">
          <HardDrive size={14} /> Buy more space
        </button>
      </div>

      {buyOpen && <BuySpaceModal onClose={() => setBuyOpen(false)} />}
    </>
  );
}

// The buy-more space modal — $20/200GB, $40/500GB, $60/1TB as specified. Picking
// a plan opens Paystack's hosted checkout (USD); when the customer returns to
// the profile page, the PaystackReturnGate confirms the charge and the bar
// refreshes. No card details are ever collected here.

export function BuySpaceModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const plansQuery = useSubscriptionPlans();
  const [selected, setSelected] = useState<string | null>(plansQuery.data?.plans?.find((p) => p.kind === 'storage')?.planId ?? null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetAccountQuotaQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getSubscriptionPlansQueryKey() });
  };

  const checkout = useCreatePaystackCheckout({
    mutation: {
      onSuccess: (res) => {
        if (res.granted) {
          // A FREE promo (full discount) is granted server-side — nothing to pay.
          refresh();
          onClose();
          return;
        }
        setError('');
        setOpening(true);
        window.setTimeout(() => {
          window.location.assign(res.checkoutUrl);
        }, 350);
      },
      onError: (e: unknown) => {
        const err = e as { response?: { data?: { error?: string } }; message?: string } | null;
        setError(err?.response?.data?.error || err?.message || 'The payment could not be started. Please try again.');
      },
    },
  });

  const plans = (plansQuery.data?.plans ?? []).filter((p) => p.kind === 'storage');
  const busy = checkout.isPending || opening;

  const pay = () => {
    if (!selected) return;
    setError('');
    checkout.mutate({
      data: {
        kind: 'storage',
        planId: selected,
        callbackUrl: `${window.location.origin}${window.location.pathname}`,
      },
    });
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal small-modal plan-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X size={16} /></button>
        <span className="eyebrow">WORKSPACE STORAGE</span>
        <h2>Buy more space.</h2>
        <p>Pick a plan — Paystack handles the payment (USD). You&apos;ll come back here when it&apos;s done and the bar updates.</p>
        <div className="plan-grid" data-testid="plan-grid-storage">
          {plans.map((plan) => (
            <button
              key={plan.planId}
              type="button"
              className={`plan-option ${selected === plan.planId ? 'is-selected' : ''}`}
              onClick={() => setSelected(plan.planId)}
              disabled={busy}
              data-testid={`plan-${plan.planId}`}
            >
              <b>{plan.planLabel}</b>
              <em>${(plan.priceUsd / 100).toFixed(2)}</em>
              <small>{plan.planId === 'tb1' ? 'For the long cuts' : plan.planId === 'g500' ? 'Most popular' : 'A quick boost'}</small>
            </button>
          ))}
        </div>
        <p className="den-footnote mt-3" style={{ display: 'flex', gap: 6 }}>
          <Lock size={13} /> Secure checkout by Paystack — no card details ever pass through this site.
        </p>
        {error && <p className="buy-error" role="alert">{error}</p>}
        <button
          type="button"
          className="primary-btn w-full mt-3"
          onClick={pay}
          disabled={busy || !selected}
          data-testid="btn-pay-space"
        >
          {busy ? <Loader2 size={13} className="spin" /> : <Lock size={13} />}
          {busy ? (opening ? 'Opening secure checkout…' : 'Starting checkout…') : 'Pay for more space'}
        </button>
        <p className="den-footnote mt-3">
          You can also manage every plan on your{' '}
          <a href="/subscriptions" className="link-btn" data-testid="link-tandem-subscriptions">TANDEM Subscriptions page</a>.
        </p>
      </div>
    </div>
  );
}

// The CV card — the profile owner can upload/replace/remove their CV; visitors
// can open it. Shown on every profile (own and others).
export function CvCard({ userId, editable }: { userId: string; editable: boolean }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);
  const [toast, setToast] = useState('');

  const cv = useGetUserCv(userId, {
    query: { queryKey: getGetUserCvQueryKey(userId), enabled: Boolean(userId) },
  });
  const upload = useUploadUserCv({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetUserCvQueryKey(userId) });
        if (inputRef.current) inputRef.current.value = '';
        setToast('CV uploaded');
        window.setTimeout(() => setToast(''), 2200);
      },
      onError: () => {
        if (inputRef.current) inputRef.current.value = '';
        setToast('That file could not be uploaded');
        window.setTimeout(() => setToast(''), 2200);
      },
    },
  });
  const remove = useDeleteUserCv({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetUserCvQueryKey(userId) });
      },
    },
  });

  const openCv = async () => {
    setOpening(true);
    try {
      const blob = await getUserCvFile(userId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
    } catch {
      setToast('The CV could not be opened');
      window.setTimeout(() => setToast(''), 2200);
    } finally {
      setOpening(false);
    }
  };

  const cvData = cv.data;

  return (
    <div className="paper-card cv-card" data-testid="panel-cv">
      <div className="inline-heading">
        <span className="eyebrow"><FileText size={13} /> Curriculum vitae</span>
        {cvData && <span className="mono-label">{formatBytes(cvData.sizeBytes)}</span>}
      </div>

      {cvData ? (
        <>
          <p className="cv-file-name" title={cvData.fileName}>
            <FileText size={15} /> {cvData.fileName}
          </p>
          <div className="cv-actions">
            <button type="button" className="primary-btn" onClick={() => void openCv()} disabled={opening}>
              {opening ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} View CV
            </button>
            {editable && (
              <>
                <button type="button" className="secondary-btn" onClick={() => inputRef.current?.click()}>
                  <Upload size={14} /> Replace
                </button>
                <button type="button" className="danger-btn" onClick={() => remove.mutate({ userId })} disabled={remove.isPending}>
                  Remove
                </button>
              </>
            )}
          </div>
        </>
      ) : editable ? (
        <>
          <p className="cv-empty">
            Upload your CV so collaborators and clients viewing your profile can open it.
          </p>
          <button type="button" className="primary-btn" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Upload CV
          </button>
        </>
      ) : (
        <p className="cv-empty muted">This creator has not uploaded a CV yet.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg"
        className="visually-hidden"
        data-testid="cv-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload.mutate({ userId, data: { file } });
        }}
      />

      {toast && <span className="cv-toast">{toast}</span>}
    </div>
  );
}
