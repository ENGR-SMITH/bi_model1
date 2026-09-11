import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { ArrowLeft, Bell, Check, Clock3, Lock, PenLine, Send, Users } from "lucide-react";
import {
  getGetWriterArenaPostQueryKey,
  getListWriterArenaPostsQueryKey,
  getListWriterArenaWatchesQueryKey,
  useCreateWriterArenaWatch,
  useDeleteWriterArenaWatch,
  useGetWriterArenaPost,
  useListWriterArenaWatches,
  useUpdateWriterArenaPost,
  useWithdrawWriterArenaAudition,
} from "@workspace/api-client-react";
import type { WriterArenaRole } from "@workspace/api-client-react";
import { apiErrorText, auditionStatusLabel, auditionStatusTone, isOpenAudition, timeAgo, writerRoleLabel } from "@/lib/arena";

// ---------------------------------------------------------------------------
// One Arena post. The author sees the call's controls and the way into their
// review desk; everyone else reads the frozen brief and auditions.
// ---------------------------------------------------------------------------

export function ArenaPostPage({
  seedId,
  onBack,
  onAudition,
  notify,
}: {
  seedId: string;
  onBack: () => void;
  onAudition: (seedId: string) => void;
  notify: (message: string) => void;
}) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const post = useGetWriterArenaPost(seedId);
  const decisions = useUpdateWriterArenaPost();
  const withdraw = useWithdrawWriterArenaAudition();
  const watches = useListWriterArenaWatches();
  const createWatch = useCreateWriterArenaWatch();
  const deleteWatch = useDeleteWriterArenaWatch();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetWriterArenaPostQueryKey(seedId) });
    void queryClient.invalidateQueries({ queryKey: getListWriterArenaPostsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListWriterArenaWatchesQueryKey() });
  };

  if (post.isLoading) return <div className="page"><div className="panel-empty">Opening the call…</div></div>;

  const data = post.data;
  if (post.isError || !data) {
    return (
      <div className="page">
        <button type="button" className="link-btn" onClick={onBack}>
          <ArrowLeft size={14} /> Back to the arena
        </button>
        <div className="empty-state">
          <h3>This call could not be found.</h3>
          <p>It may have been removed, or the link is out of date.</p>
        </div>
      </div>
    );
  }

  const isAuthor = user?.id === data.creatorId;
  const isRole = data.kind === "ROLE";
  const applied = Boolean(data.myApplicationId);
  const filled = Boolean(data.filledBy);
  const open = data.availability === "OPEN" && !filled;
  const watch = (watches.data ?? []).find((row) => row.role === data.role && row.creatorId === data.creatorId);

  const toggleWatch = () => {
    if (!data.role) return;
    if (watch) deleteWatch.mutate({ watchId: watch.id }, { onSuccess: refresh });
    else createWatch.mutate({ data: { role: data.role as WriterArenaRole, creatorId: data.creatorId } }, { onSuccess: refresh });
  };

  const setAvailability = (availability: "OPEN" | "CLOSED") => {
    decisions.mutate({ seedId, data: { availability } }, {
      onSuccess: () => {
        notify(availability === "CLOSED" ? "Call closed — everyone auditioning was told" : "Call reopened");
        refresh();
      },
      onError: (error) => notify(apiErrorText(error, "That change could not be saved.")),
    });
  };

  const retract = () => {
    if (!data.myApplicationId) return;
    withdraw.mutate({ applicationId: data.myApplicationId }, {
      onSuccess: () => {
        notify("Audition withdrawn");
        refresh();
      },
      onError: (error) => notify(apiErrorText(error, "That audition could not be withdrawn.")),
    });
  };

  return (
    <div className="page arena-post-page">
      <button type="button" className="link-btn" onClick={onBack} data-testid="link-back-arena">
        <ArrowLeft size={14} /> Back to the arena
      </button>

      <div className="page-header">
        <div>
          <div className="eyebrow">
            {isRole ? `${writerRoleLabel(data.role).toUpperCase()} · OPEN CALL` : "PITCH BOARD · FROZEN SEED"}
          </div>
          <h1>{data.sourceProjectTitle}</h1>
          <p>
            {isRole && data.rolePitch ? data.rolePitch : data.seedText.slice(0, 220)}
          </p>
          <div className="arena-post-meta">
            <span>by {data.creatorName}</span>
            <span>{data.genre}</span>
            <span>{data.unitType}</span>
            <span>
              <Clock3 size={11} /> posted {timeAgo(data.publishedAt)}
            </span>
          </div>
        </div>
        <div className="arena-header-actions">
          {data.role && !isAuthor && (
            <button type="button" className={`secondary-btn ${watch ? "is-watching" : ""}`} onClick={toggleWatch} disabled={createWatch.isPending || deleteWatch.isPending} data-testid="button-watch-role">
              <Bell size={15} /> {watch ? "Watching" : `Watch ${writerRoleLabel(data.role).toLowerCase()} calls`}
            </button>
          )}
        </div>
      </div>

      <div className="arena-post-grid">
        <section className="paper-card arena-brief">
          <div className="card-heading">
            <div>
              <span className="eyebrow">THE FROZEN BRIEF</span>
              <h2>What the writer is protecting</h2>
            </div>
            <Lock size={16} />
          </div>
          <p className="arena-brief-text">{data.seedText}</p>
          <dl className="arena-brief-facts">
            <div><dt>Protocol</dt><dd>{data.protocol}</dd></div>
            <div><dt>Tone</dt><dd>{data.tone}</dd></div>
            <div><dt>Language</dt><dd>{data.language}</dd></div>
            <div><dt>Desired role</dt><dd>{data.desiredRole}</dd></div>
            {data.plotConstraints && <div><dt>Constraints</dt><dd>{data.plotConstraints}</dd></div>}
          </dl>
        </section>

        <aside className="arena-post-side">
          <div className="paper-card arena-stats">
            <div className="arena-stat">
              <span>
                <Users size={13} /> Auditioning
              </span>
              <b>{data.respondentCount}</b>
            </div>
            <div className="arena-stat">
              <span>{isAuthor ? "Total received" : "Voices wanted"}</span>
              <b>{isAuthor ? data.totalApplications : data.respondentLimit === 0 ? "∞" : data.respondentLimit}</b>
            </div>
            <div className="arena-stat">
              <span>Status</span>
              <b>{filled ? "Filled" : data.availability === "OPEN" ? "Open" : "Closed"}</b>
            </div>
          </div>

          {isAuthor ? (
            <div className="paper-card arena-side-actions">
              <span className="eyebrow">YOUR CALL</span>
              <p className="setting-copy">
                Review every audition — their text, comments, and private notes — in the pitch board's selection room.
              </p>
              <a className="primary-btn arena-block-btn" href={`/authors/pitch-board/seed/${seedId}`} data-testid="link-review-auditions">
                <PenLine size={15} /> Review auditions
              </a>
              {data.availability === "OPEN" ? (
                <button type="button" className="secondary-btn arena-block-btn" onClick={() => setAvailability("CLOSED")} disabled={decisions.isPending} data-testid="button-close-call">
                  Close this call
                </button>
              ) : (
                <button type="button" className="secondary-btn arena-block-btn" onClick={() => setAvailability("OPEN")} disabled={decisions.isPending || filled} data-testid="button-reopen-call">
                  Reopen this call
                </button>
              )}
            </div>
          ) : (
            <div className="paper-card arena-side-actions">
              <span className="eyebrow">AUDITION</span>
              {filled ? (
                <p className="setting-copy">This role is filled. The brief stays readable, but the call is closed.</p>
              ) : applied ? (
                <>
                  <p className="setting-copy">
                    Your audition is {auditionStatusLabel(data.myApplicationStatus ?? "DRAFT").toLowerCase()}. Continue it from
                    your library, or retract it below.
                  </p>
                  <span className={`den-tag ${auditionStatusTone(data.myApplicationStatus ?? "")}`}>
                    {auditionStatusLabel(data.myApplicationStatus ?? "DRAFT")}
                  </span>
                  {isOpenAudition(data.myApplicationStatus ?? "") && (
                    <button type="button" className="secondary-btn arena-block-btn" onClick={retract} disabled={withdraw.isPending} data-testid="button-withdraw-audition">
                      Withdraw audition
                    </button>
                  )}
                </>
              ) : open ? (
                <>
                  <p className="setting-copy">
                    Fork the frozen brief into your own studio, write your passage, then submit it for the author to read.
                  </p>
                  <button type="button" className="primary-btn arena-block-btn" onClick={() => onAudition(seedId)} data-testid="button-audition">
                    <Send size={15} /> Audition for this role
                  </button>
                </>
              ) : (
                <p className="setting-copy">This call is closed to new auditions.</p>
              )}
              <p className="arena-side-note">
                <Check size={12} /> Nothing leaves your desk until you submit it.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
