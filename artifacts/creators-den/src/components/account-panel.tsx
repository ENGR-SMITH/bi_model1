import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, FileText, HardDrive, Loader2, Upload } from 'lucide-react';
import {
  getGetUserCvQueryKey,
  getUserCvFile,
  useDeleteUserCv,
  useGetAccountQuota,
  useGetUserCv,
  useUploadUserCv,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Account panels — the workspace storage card (2 GB free, buy-more on the
// TANDEM subscriptions desk) and the CV card, both shown on the user profile
// page. The storage card is private to the profile owner (it is their
// account's limit); the CV is visible to everyone who views the profile.
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

// The workspace storage card — total space the account is limited to, the
// current space used, and the space left. "Buy more space" goes straight to
// the Creator Den storage row on the TANDEM Subscriptions page, where the
// account's plans are listed and payable.
export function StorageBar() {
  const quota = useGetAccountQuota();

  const used = quota.data?.storageBytes.usedBytes ?? 0;
  const total = quota.data?.storageBytes.totalBytes ?? 0;
  const remaining = quota.data?.storageBytes.remainingBytes ?? 0;
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  return (
    <div className="paper-card storage-panel" data-testid="panel-storage-bar">
      <div className="inline-heading account-panel-head">
        <span className="account-panel-head-title">
          <span className="account-panel-icon"><HardDrive size={15} /></span>
          <span className="eyebrow">Workspace storage</span>
        </span>
        <span className="mono-label account-panel-summary">{formatBytes(used)} of {formatBytes(total)}</span>
      </div>

      <div className="storage-usage">
        <div className="account-bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
          <div className="account-bar-fill" style={{ width: `${percent}%` }} />
        </div>

        <div className="storage-usage-foot">
          <ul className="account-bar-stats">
            <li>
              <span>Used</span>
              <b>{formatBytes(used)}</b>
            </li>
            <li>
              <span>Total</span>
              <b>{formatBytes(total)}</b>
            </li>
            <li>
              <span>Left</span>
              <b className="storage-left">{formatBytes(remaining)}</b>
            </li>
          </ul>
          <p className="account-bar-note">
            Shared by every project you captain — uploads pause when the vault runs out.
          </p>
        </div>
      </div>

      <div className="storage-cta">
        <span className="mono-label">Need more room?</span>
        <a
          href="/subscriptions?focus=storage"
          className="primary-btn"
          data-testid="btn-buy-space"
        >
          <HardDrive size={14} /> Buy more space
          <ArrowUpRight size={13} className="storage-cta-arrow" />
        </a>
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
      <div className="inline-heading account-panel-head">
        <span className="account-panel-head-title">
          <span className="account-panel-icon accent"><FileText size={15} /></span>
          <span className="eyebrow">Curriculum vitae</span>
        </span>
        {cvData && <span className="mono-label account-panel-summary">{formatBytes(cvData.sizeBytes)}</span>}
      </div>

      {cvData ? (
        <>
          <div className="cv-file-zone" title={cvData.fileName}>
            <span className="cv-file-icon"><FileText size={20} /></span>
            <p className="cv-file-name">{cvData.fileName}</p>
            <span className="mono-label">{formatBytes(cvData.sizeBytes)}</span>
          </div>
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
          <div className="cv-empty-zone" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}>
            <span className="cv-empty-icon"><Upload size={18} /></span>
            <p className="cv-empty">Upload your CV so collaborators and clients viewing your profile can open it.</p>
          </div>
          <button type="button" className="primary-btn" onClick={() => inputRef.current?.click()} disabled={upload.isPending} data-testid="btn-cv-upload">
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
