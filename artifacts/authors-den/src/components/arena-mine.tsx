import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Clock3, PenLine, Send, X } from "lucide-react";
import {
  getListMyWriterArenaAuditionsQueryKey,
  getListWriterArenaPostsQueryKey,
  useListMyWriterArenaAuditions,
  useWithdrawWriterArenaAudition,
} from "@workspace/api-client-react";
import { apiErrorText, auditionStatusLabel, auditionStatusTone, isOpenAudition, timeAgo, writerRoleLabel } from "@/lib/arena";

// ---------------------------------------------------------------------------
// My Auditions — the writer's own track record across both rails, with the
// withdraw action for anything the author has not decided yet.
// ---------------------------------------------------------------------------

type Tab = "all" | "open" | "accepted" | "declined";

function tabFor(status: string): Tab {
  if (["SUBMITTED", "UNDER_REVIEW", "DRAFT"].includes(status)) return "open";
  if (["ACCEPTED", "ACCEPTED_PENDING_CONTRACT"].includes(status)) return "accepted";
  if (["DECLINED", "WITHDRAWN"].includes(status)) return "declined";
  return "open";
}

export function ArenaMinePage({
  onBack,
  onOpenPost,
  notify,
}: {
  onBack: () => void;
  onOpenPost: (seedId: string) => void;
  notify: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const auditions = useListMyWriterArenaAuditions();
  const withdraw = useWithdrawWriterArenaAudition();

  const rows = auditions.data ?? [];
  const counts = useMemo(() => {
    const result: Record<Tab, number> = { all: rows.length, open: 0, accepted: 0, declined: 0 };
    for (const row of rows) result[tabFor(row.status)] += 1;
    return result;
  }, [rows]);

  const visible = tab === "all" ? rows : rows.filter((row) => tabFor(row.status) === tab);

  const retract = (applicationId: string) => {
    withdraw.mutate({ applicationId }, {
      onSuccess: () => {
        notify("Audition withdrawn");
        void queryClient.invalidateQueries({ queryKey: getListMyWriterArenaAuditionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListWriterArenaPostsQueryKey() });
      },
      onError: (error) => notify(apiErrorText(error, "That audition could not be withdrawn.")),
    });
  };

  return (
    <div className="page arena-mine-page">
      <button type="button" className="link-btn" onClick={onBack} data-testid="link-back-arena-mine">
        <ArrowLeft size={14} /> Back to the arena
      </button>

      <div className="page-header">
        <div>
          <div className="eyebrow">YOUR TRAIL</div>
          <h1>My auditions.</h1>
          <p>Every call you have answered, and where each one stands with its author.</p>
        </div>
      </div>

      <div className="filter-tabs role-tabs" role="tablist" aria-label="Audition status">
        {([["all", "All"], ["open", "In review"], ["accepted", "Accepted"], ["declined", "Declined"]] as const).map(
          ([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
              role="tab"
              aria-selected={tab === id}
              data-testid={`audition-tab-${id}`}
            >
              {label} <span className="leg-badge">{counts[id]}</span>
            </button>
          ),
        )}
      </div>

      {auditions.isLoading ? (
        <div className="panel-empty">Gathering your auditions…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state" data-testid="mine-empty">
          <BookOpen size={22} />
          <h3>{tab === "all" ? "No auditions yet." : `Nothing ${tab === "open" ? "in review" : tab}.`}</h3>
          <p>Answer an open role from the arena and it will appear here while the author decides.</p>
        </div>
      ) : (
        <div className="paper-card">
          <div className="den-stack">
            {visible.map((row) => (
              <div className="arena-mine-row" key={row.id} data-testid={`audition-${row.id}`}>
                <button type="button" className="list-row arena-mine-main" onClick={() => onOpenPost(row.postId)}>
                  <span className="den-work-mark">
                    {row.kind === "ROLE" ? <Send size={15} /> : <BookOpen size={15} />}
                  </span>
                  <span className="min-w-0">
                    <b className="truncate">{row.sourceProjectTitle}</b>
                    <small className="truncate">
                      {writerRoleLabel(row.role)} · by {row.creatorName}
                    </small>
                    <em className="truncate">{row.rolePitch ?? "Frozen seed on the pitch board"}</em>
                  </span>
                  <span className={`den-tag ${auditionStatusTone(row.status)}`}>{auditionStatusLabel(row.status)}</span>
                  <span className="arena-card-time">
                    <Clock3 size={11} /> {timeAgo(row.updatedAt)}
                  </span>
                </button>
                {isOpenAudition(row.status) && (
                  <button
                    type="button"
                    className="link-btn arena-mine-withdraw"
                    onClick={() => retract(row.id)}
                    disabled={withdraw.isPending}
                    data-testid={`withdraw-${row.id}`}
                  >
                    <X size={13} /> Withdraw
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="arena-side-note">
        <PenLine size={12} /> Drafts live in your library until you submit them — a withdrawn audition frees you to
        answer the call again.
      </p>
    </div>
  );
}
