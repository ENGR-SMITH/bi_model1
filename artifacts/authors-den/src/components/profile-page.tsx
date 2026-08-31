import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { FileText, FolderOpen, HardDrive, Loader2, Upload, X } from "lucide-react";
import {
  getGetAccountQuotaQueryKey,
  getGetUserCvQueryKey,
  getUserCvFile,
  useDeleteUserCv,
  useGetAccountQuota,
  useGetUserCv,
  usePurchaseAccountQuota,
  useUploadUserCv,
} from "@workspace/api-client-react";
import type { ProjectPlan } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Author Den profile — the account's project-count bar (5 free projects,
// buy-more plans) and the CV card. The bar counts the projects actually
// created in this studio (the tutorial sample doesn't count); the limit and
// purchases live on the account server-side.
// ---------------------------------------------------------------------------

export function ProfilePage({ projectCount }: { projectCount: number }) {
  const { user } = useUser();
  const [buyOpen, setBuyOpen] = useState(false);
  const quota = useGetAccountQuota();

  const total = quota.data?.projects.total ?? 5;
  const used = projectCount;
  const remaining = Math.max(0, total - used);
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.username || "Writer";
  const email = user?.primaryEmailAddress?.emailAddress;
  const initials = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || ""}` || displayName.slice(0, 2).toUpperCase();

  return (
    <div className="page profile-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">YOUR ACCOUNT</div>
          <h1>Profile</h1>
          <p>Your CV is visible on this profile; the project bar shows how many works your account can hold.</p>
        </div>
      </div>

      <section className="paper-card profile-card">
        {user?.imageUrl ? (
          <img src={user.imageUrl} alt="" className="profile-page-avatar" />
        ) : (
          <span className="profile-page-avatar profile-page-avatar-initial">{initials}</span>
        )}
        <div className="min-w-0">
          <h2>{displayName}</h2>
          {email && <p>{email}</p>}
          <small className="profile-page-hint">Signed in on Tandem · your projects stay in this browser</small>
        </div>
      </section>

      <div className="profile-bars">
        <section className="paper-card account-bar-card" data-testid="panel-project-bar">
          <div className="inline-heading">
            <span className="eyebrow"><FolderOpen size={13} /> Work projects</span>
            <span className="mono-label">{used} of {total} created</span>
          </div>
          <div className="account-bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className="account-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="account-bar-stats">
            <span>CREATED <b>{used}</b></span>
            <span>TOTAL <b>{total}</b></span>
            <span>LEFT <b>{remaining}</b></span>
          </div>
          <p className="account-bar-note">
            Every project you create counts against this limit — new projects are blocked once it is reached.
          </p>
          <button type="button" className="primary-btn" onClick={() => setBuyOpen(true)} data-testid="btn-buy-projects">
            <HardDrive size={14} /> Buy more projects
          </button>
        </section>

        <AuthorCvCard userId={user?.id ?? ""} />
      </div>

      {buyOpen && <BuyProjectsModal onClose={() => setBuyOpen(false)} />}
    </div>
  );
}

// The buy-more projects modal — $5/10, $20/50, $50/200 as specified. The
// purchase applies to the account server-side; the bar refreshes instantly.
// Also rendered app-wide when a create/duplicate hits the limit.
export function BuyProjectsModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const quota = useGetAccountQuota();
  const purchase = usePurchaseAccountQuota({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetAccountQuotaQueryKey() });
        onClose();
      },
    },
  });

  const plans: ProjectPlan[] = quota.data?.plans.projects ?? [];
  return (
    <div className="modal-backdrop" onClick={purchase.isPending ? undefined : onClose}>
      <div className="modal small-modal plan-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <span className="eyebrow">WORK PROJECTS</span>
        <h2>Buy more projects.</h2>
        <p>Extend the number of projects your account can hold. The bar above updates the moment a plan is applied.</p>
        <div className="plan-grid" data-testid="plan-grid-projects">
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              className="plan-option"
              onClick={() => purchase.mutate({ data: { kind: "projects", planId: plan.id } })}
              disabled={purchase.isPending}
              data-testid={`plan-${plan.id}`}
            >
              <b>+{plan.count} projects</b>
              <em>${plan.priceUsd}</em>
              <small>{plan.count === 10 ? "A quick boost" : plan.count === 50 ? "Most popular" : "For the prolific"}</small>
            </button>
          ))}
        </div>
        {purchase.isPending && (
          <p className="plan-pending"><Loader2 size={13} className="spin" /> Applying plan…</p>
        )}
        <p className="profile-footnote mt-3">Payment is processed through your Tandem account checkout.</p>
      </div>
    </div>
  );
}

// CV card — upload/replace/remove on your own profile (the author den profile
// is only ever your own; collaborators see your CV through the shared API).
function AuthorCvCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);
  const [toast, setToast] = useState("");

  const cv = useGetUserCv(userId, {
    query: { queryKey: getGetUserCvQueryKey(userId), enabled: Boolean(userId) },
  });
  const upload = useUploadUserCv({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetUserCvQueryKey(userId) });
        if (inputRef.current) inputRef.current.value = "";
        setToast("CV uploaded");
        window.setTimeout(() => setToast(""), 2200);
      },
      onError: () => {
        if (inputRef.current) inputRef.current.value = "";
        setToast("That file could not be uploaded");
        window.setTimeout(() => setToast(""), 2200);
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
      window.open(url, "_blank", "noopener");
    } catch {
      setToast("The CV could not be opened");
      window.setTimeout(() => setToast(""), 2200);
    } finally {
      setOpening(false);
    }
  };

  const cvData = cv.data;
  return (
    <section className="paper-card cv-card" data-testid="panel-cv">
      <div className="inline-heading">
        <span className="eyebrow"><FileText size={13} /> Curriculum vitae</span>
        {cvData && <span className="mono-label">{formatBytes(cvData.sizeBytes)}</span>}
      </div>
      {cvData ? (
        <>
          <p className="cv-file-name" title={cvData.fileName}><FileText size={15} /> {cvData.fileName}</p>
          <div className="cv-actions">
            <button type="button" className="primary-btn" onClick={() => void openCv()} disabled={opening}>
              {opening ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} View CV
            </button>
            <button type="button" className="secondary-btn" onClick={() => inputRef.current?.click()}>
              <Upload size={14} /> Replace
            </button>
            <button type="button" className="danger-btn" onClick={() => remove.mutate({ userId })} disabled={remove.isPending}>
              Remove
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="cv-empty">Upload your CV so collaborators and clients can open it from your profile.</p>
          <button type="button" className="primary-btn" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Upload CV
          </button>
        </>
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
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
