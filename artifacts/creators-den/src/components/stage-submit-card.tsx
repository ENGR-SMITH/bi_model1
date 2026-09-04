// ---------------------------------------------------------------------------
// StageSubmitCard — the description + submit card on the role pages (Video /
// Audio / Thumbnail). Replaces the old oracle chat: instead of asking an AI,
// the member writes a short description of the work done on this stage and
// submits the current snapshot for the Captain's review.
//
//   - Description field — what was done in this pass.
//   - Resolved review notes — comments other people left on previous versions
//     that the member marked done are listed here and auto-included with the
//     submission, so the Captain sees what was addressed.
//   - Submit — pins the stage's current head snapshot for review (approve
//     merges it to the timeline; reject sends it back with the Captain's note).
//
// Multi-leg stages (Video owns SELECTS + CUT) no longer ask which leg is
// being handed in — the card targets the leg that is actually being worked
// on (one awaiting the Captain's review first, otherwise the one with the
// newest saved snapshot).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock3,
  FileUp,
  Send,
  XCircle,
} from 'lucide-react';
import {
  getGetVideoProjectQueryKey,
  getGetVideoTimelineQueryKey,
  getListVideoCommentsQueryKey,
  getListVideoSubmissionsQueryKey,
  getUploadVideoAssetUrl,
  useCreateVideoSubmission,
  useGetVideoProject,
  useListVideoComments,
  useListVideoSubmissions,
  useListVideoTimelineVersions,
} from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';
import { RELAY_LEGS } from '@/components/shell';
import { VAULT_KIND_LABELS } from '@/components/preview-shared';
import { BROWSER_UPLOAD_MAX_LABEL, exceedsBrowserUploadCap } from '@/components/agent-upload-modal';

/** The role that owns each relay leg (mirrors the server's LEG_ROLES). */
const LEG_ROLE: Record<StudioLeg, string> = {
  SELECTS: 'VIDEO',
  CUT: 'VIDEO',
  SOUND: 'AUDIO',
  FINISH: 'CAPTAIN',
  THUMBNAIL: 'THUMBNAIL',
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function legLabel(leg: string): string {
  return RELAY_LEGS.find((relay) => relay.leg === leg)?.label ?? leg;
}

export function StageSubmitCard({
  projectId,
  legs,
  roleName,
  pendingFile,
  onFileSubmitted,
}: {
  projectId: string;
  /** The relay legs this stage owns (Video owns SELECTS + CUT, Audio SOUND…). */
  legs: StudioLeg[];
  /** e.g. "Visual Editor" / "Sound Designer" — used in the card copy. */
  roleName: string;
  /** A file picked in the upload card — it travels with the description as a
      submit-for-review upload (approve moves it into the vault). */
  pendingFile?: { file: File; kind: string } | null;
  /** Called once a pending file has been handed in (page clears the pick). */
  onFileSubmitted?: () => void;
}) {
  const queryClient = useQueryClient();
  const project = useGetVideoProject(projectId);
  const comments = useListVideoComments(projectId);
  const submissions = useListVideoSubmissions(projectId);

  // The card does not ask which stage to hand in (the Selects/Cut tabs are
  // gone) — the leg is auto-targeted: one already awaiting the Captain's
  // review first, otherwise the leg with the newest saved snapshot.
  const legVersionQueries = legs.map((option) => ({
    leg: option,
    query: useListVideoTimelineVersions(projectId, option),
  }));
  const [description, setDescription] = useState('');
  const [includeResolved, setIncludeResolved] = useState(true);
  // What the server actually answered on the last file hand-in — the card must
  // not wait for a list refetch to tell the member what happened to their file.
  const [fileResult, setFileResult] = useState<{ fileName: string; review: boolean } | null>(null);
  // The server pins the stage's current head snapshot — with none saved there
  // is nothing to hand in yet.
  const hasSnapshot = (legVersionQueries.find((entry) => entry.leg === leg)?.query.data?.length ?? 0) > 0;

  // The leg the card hands in, resolved from the data: a pending review keeps
  // its status banner visible; otherwise the leg whose snapshot was most
  // recently saved is the one being worked on. Single-leg stages never switch.
  const leg = useMemo<StudioLeg>(() => {
    if (legs.length < 2) return legs[0];
    const pendingLeg = legs.find((option) =>
      (submissions.data ?? []).some((s) => s.leg === option && s.status === 'SUBMITTED'),
    );
    if (pendingLeg) return pendingLeg;
    const newest = legVersionQueries
      .map(({ leg: option, query }) => ({
        leg: option,
        latest: query.data
          ? [...query.data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
          : null,
      }))
      .filter((entry) => entry.latest != null)
      .sort((a, b) => new Date(b.latest!.createdAt).getTime() - new Date(a.latest!.createdAt).getTime())[0];
    return newest?.leg ?? legs[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, legVersionQueries, submissions.data]);

  const canSubmit =
    project.data?.myRoles?.includes('CAPTAIN') ||
    project.data?.myRoles?.includes(LEG_ROLE[leg]);

  // A different pick resets the last upload's result note.
  useEffect(() => {
    setFileResult(null);
  }, [pendingFile?.file.name]);

  // Review notes from earlier passes that the member marked as done — these
  // are listed and auto-included so the Captain sees what was addressed.
  const resolvedNotes = useMemo(
    () =>
      (comments.data ?? [])
        .filter(
          (comment) =>
            comment.leg === leg &&
            comment.resolvedAt != null &&
            !comment.submissionId &&
            Boolean(comment.body),
        )
        .map((comment) => comment.body.trim())
        .filter(Boolean),
    [comments.data, leg],
  );

  // The submission state for this leg drives the card: pending review (locked),
  // rejected (show the Captain's note + allow a fresh submit), approved.
  const legSubmissions = useMemo(
    () => (submissions.data ?? []).filter((submission) => submission.leg === leg),
    [submissions.data, leg],
  );
  const pending = legSubmissions.find((submission) => submission.status === 'SUBMITTED') ?? null;
  const latestDecided = legSubmissions.find(
    (submission) => submission.status === 'APPROVED' || submission.status === 'REJECTED',
  );

  // While a hand-in is awaiting the Captain's review the whole card collapses
  // to just the pending status line: there is no editable draft or submit
  // control to mistake for a live form until the review is decided.
  const locked = Boolean(pending);

  const submit = useCreateVideoSubmission();

  // A picked file is handed in as a submit-for-review upload: the file + the
  // description below go to the Captain's review desk together, and only an
  // approval moves the file into the vault.
  const submitFile = useMutation({
    mutationFn: async ({ file, kind, note }: { file: File; kind: string; note: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', kind);
      formData.append('review', 'true');
      // The card is "Submit file for review", so it means it even when the
      // uploader is the project's Captain: forceReview overrides the usual
      // captain-skip so their hand-in lands on the review desk too (they then
      // approve it like any other submission). Harmless for crew members.
      formData.append('forceReview', 'true');
      formData.append('note', note);
      const response = await fetch(getUploadVideoAssetUrl(projectId), {
        method: 'POST',
        body: formData,
      });
      let data: { error?: string } = {};
      try {
        data = (await response.json()) as { error?: string };
      } catch {
        // Non-JSON body — keep the generic message.
      }
      if (!response.ok) {
        throw new Error(data.error || `The submission failed (${response.status}).`);
      }
      return data;
    },
    onSuccess: (data) => {
      const response = data as { submissionId?: string; review?: boolean };
      setDescription('');
      setFileResult({
        fileName: pendingFile?.file.name ?? 'Your file',
        // A submit-for-review upload answers with review: true + a
        // submissionId. Without it the file went straight into the vault — the
        // uploader is this project's Captain (their uploads skip review), or
        // the server predates the review flow.
        review: response.review === true || Boolean(response.submissionId),
      });
      queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
      // The crew's own /review list ("Your submissions") should show the new
      // hand-in immediately, without waiting for its next poll tick.
      queryClient.invalidateQueries({ queryKey: ['my-video-submissions'] });
      onFileSubmitted?.();
    },
  });

  const pendingFileOverCap = pendingFile ? exceedsBrowserUploadCap(pendingFile.file) : false;

  const resolvedBlock = includeResolved && resolvedNotes.length > 0
    ? `\n\nResolved notes from review:\n${resolvedNotes.map((note) => `- ${note}`).join('\n')}`
    : '';
  const finalNote = (description.trim() + resolvedBlock).trim();

  const onSubmit = () => {
    if (pendingFile) {
      submitFile.mutate({
        file: pendingFile.file,
        kind: pendingFile.kind,
        note: finalNote,
      });
      return;
    }
    submit.mutate(
      { projectId, data: { leg, note: finalNote || undefined } },
      {
        onSuccess: () => {
          setDescription('');
          queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, leg) });
          queryClient.invalidateQueries({ queryKey: getListVideoCommentsQueryKey(projectId) });
          // The crew's own /review list ("Your submissions") should show the
          // new hand-in immediately, without waiting for its next poll tick.
          queryClient.invalidateQueries({ queryKey: ['my-video-submissions'] });
        },
      },
    );
  };

  const submitError = submit.error as { response?: { data?: { error?: string } } } | null;
  const fileError = submitFile.error as Error | null;
  const submitting = submit.isPending || submitFile.isPending;

  return (
    <div
      className={`paper-card stage-submit-card ${locked ? 'is-locked' : ''}`}
      data-testid="stage-submit-card"
    >
      <div className="inline-heading">
        <span className="eyebrow"><Send size={13} /> Hand this stage in</span>
        <span className="den-tag gold">submit for review</span>
      </div>

      {/* While the hand-in awaits the Captain, the status line is the ONLY
          content of the card — no description box, no resolved-notes list, no
          submit row. The card targets the leg that is actually being worked
          on, so the pending stage's status stays in view. */}
      {pending && (
        <div
          className="stage-submit-banner is-pending stage-submit-banner-standalone"
          data-testid="stage-submit-pending"
        >
          <Clock3 size={14} />
          <span>
            <b>{legLabel(leg)} is awaiting the Captain&apos;s review</b> — submitted {timeAgo(pending.createdAt)}.
            You&apos;ll be able to hand in another pass once it&apos;s decided.
          </span>
        </div>
      )}

      {!pending && (
        <>
          {latestDecided?.status === 'REJECTED' && (
            <div className="stage-submit-banner is-rejected" data-testid="stage-submit-rejected">
              <XCircle size={14} />
              <span>
                <b>{legLabel(leg)} was sent back</b>
                {latestDecided.decisionNote ? ` — ${latestDecided.decisionNote}` : ''}
              </span>
            </div>
          )}
          <div className="stage-desc-wrap">
            <textarea
              className="stage-desc-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={`Describe what you did in this ${roleName.toLowerCase()} pass before handing it to the Captain — the cut, the mix, the design, and what you changed since the last review.`}
              rows={4}
              maxLength={2000}
              disabled={!canSubmit}
              data-testid="stage-submit-description"
            />
            <div className="stage-desc-tools">
              {!canSubmit && <span className="setting-copy">Only the {legLabel(leg)} role (or the Captain) can hand this stage in.</span>}
            </div>
          </div>

          {resolvedNotes.length > 0 && (
            <div className="stage-resolved" data-testid="stage-resolved-notes">
              <label className="stage-resolved-head">
                <input
                  type="checkbox"
                  checked={includeResolved}
                  onChange={(event) => setIncludeResolved(event.target.checked)}
                  data-testid="stage-resolved-toggle"
                />
                <span>
                  <b>Include {resolvedNotes.length} resolved note{resolvedNotes.length === 1 ? '' : 's'}</b>
                  <small>Notes you marked done from the review comments — sent with your submission.</small>
                </span>
              </label>
              <ul>
                {resolvedNotes.map((note, index) => (
                  <li key={index}>“{note}”</li>
                ))}
              </ul>
            </div>
          )}

          {pendingFile && (
            <div className="stage-file-chip" data-testid="stage-file-chip">
              <FileUp size={13} />
              <span>
                <b>{pendingFile.file.name}</b>
                <small>
                  {VAULT_KIND_LABELS[pendingFile.kind] ?? pendingFile.kind} — travels with your description
                  {pendingFileOverCap ? ` · over the ${BROWSER_UPLOAD_MAX_LABEL} browser limit, use the Desktop agent button` : ''}
                </small>
              </span>
            </div>
          )}

          <div className="stage-submit-row">
            <button
              type="button"
              className="primary-btn"
              onClick={onSubmit}
              disabled={
                submitting ||
                !canSubmit ||
                pendingFileOverCap ||
                (!hasSnapshot && !pendingFile) ||
                (!description.trim() && resolvedNotes.length === 0)
              }
              data-testid="stage-submit-button"
            >
              {submitting ? <Clock3 size={13} className="spin" /> : <Send size={13} />}
              {submitting
                ? pendingFile
                  ? 'Submitting file…'
                  : 'Submitting…'
                : pendingFile
                  ? 'Submit file for review'
                  : 'Submit for review'}
            </button>
            {pendingFile && (
              <span className="setting-copy">
                Sends the file and your description to the Captain — Accept adds it to the vault, Reject deletes it and sends it back with their note.
              </span>
            )}
          </div>
          {fileResult && (
            <div
              className={`stage-submit-banner ${fileResult.review ? 'is-pending' : 'is-approved'}`}
              role="status"
              data-testid={fileResult.review ? 'stage-submit-file-in-review' : 'stage-submit-file-direct'}
            >
              {fileResult.review ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}
              <span>
                {fileResult.review ? (
                  <>
                    <b>{fileResult.fileName} was submitted for review</b>
                    It&apos;s on the Captain&apos;s desk now — the decision and any improvement note will
                    appear on your /review page.
                  </>
                ) : (
                  <>
                    <b>{fileResult.fileName} went straight into the project vault</b>
                    No review submission was created — this happens when the upload is made by the
                    project&apos;s Captain (their files skip review), or when the app/server build you&apos;re
                    using predates the review flow. Ask your Captain to update if you expected a review.
                  </>
                )}
              </span>
            </div>
          )}
          {!hasSnapshot && !pendingFile && (
            <p className="setting-copy" role="status" data-testid="stage-submit-no-snapshot">
              This stage has no saved snapshot yet — save a version of the {legLabel(leg)} in the preview
              studio first, then hand it in here.
            </p>
          )}
          {submit.isError && (
            <p className="setting-copy mt-2" role="alert">
              {submitError?.response?.data?.error || 'The submission could not be created.'}
            </p>
          )}
          {submitFile.isError && (
            <p className="setting-copy mt-2" role="alert">
              {fileError?.message || 'The file could not be submitted for review.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
