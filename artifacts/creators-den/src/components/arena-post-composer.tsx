import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Megaphone, X } from 'lucide-react';
import {
  getListArenaPostsQueryKey,
  useCreateArenaPost,
  useListArenaPosts,
  type ArenaPostDetail,
  type ArenaPostSummary,
  type ArenaRole,
} from '@workspace/api-client-react';
import { ARENA_ROLE_META } from '@/components/arena-apply-modal';

// ---------------------------------------------------------------------------
// PostArenaRoleModal — the Captain's \"Post an open role\" composer.
//
// Two modes:
//   - Fixed project (Vault): pass `projectId` + `projectName`.
//   - Project picker (Arena board): pass `projects`; the Captain picks which
//     of their channel projects to post on.
//
// The composer lets the Captain pick ONE or MORE of the four content roles —
// every selected role is posted (one post per role) on submit. The server
// enforces one OPEN post per (project, role); roles that already have one are
// disabled with an \"open\" badge, fetched live for the active project.
// ---------------------------------------------------------------------------

const ROLES: ArenaRole[] = ['VIDEO', 'AUDIO', 'SCRIPT', 'THUMBNAIL'];
export const PITCH_MIN = 10;
export const PITCH_MAX = 2000;

export interface ArenaPostProjectOption {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
}

interface PostArenaRoleModalProps {
  /** Fixed-project mode: the project to post on. */
  projectId?: string;
  projectName?: string;
  /** Picker mode: every project the Captain may post on (their owned channel projects). */
  projects?: ArenaPostProjectOption[];
  onClose: () => void;
  onCreated: (post: ArenaPostDetail) => void;
}

export function PostArenaRoleModal({
  projectId,
  projectName,
  projects,
  onClose,
  onCreated,
}: PostArenaRoleModalProps) {
  const queryClient = useQueryClient();
  const pickerMode = Boolean(projects && projects.length > 0);
  const [selectedProjectId, setSelectedProjectId] = useState(projects?.[0]?.id ?? projectId ?? '');
  const [roles, setRoles] = useState<ArenaRole[]>([]);
  const [pitch, setPitch] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const activeProjectId = pickerMode ? selectedProjectId : (projectId ?? '');
  const activeProject = projects?.find((p) => p.id === activeProjectId);

  // Open roles on the active project — disable those seats in the picker.
  const openOnProject = useListArenaPosts(
    { projectId: activeProjectId },
    {
      query: {
        queryKey: getListArenaPostsQueryKey({ projectId: activeProjectId }),
        enabled: Boolean(activeProjectId),
      },
    },
  );
  const alreadyOpenRoles = ((openOnProject.data ?? []) as ArenaPostSummary[]).map((post) => post.role);
  const allRolesOpen = Boolean(activeProjectId) && alreadyOpenRoles.length >= ROLES.length;

  // The roles still queued for creation on this submit pass.
  const queueRef = useRef<ArenaRole[]>([]);

  const create = useCreateArenaPost();

  const busy = pendingCount > 0;
  const pitchLength = pitch.length;
  const canSubmit =
    roles.length > 0 &&
    Boolean(activeProjectId) &&
    pitchLength >= PITCH_MIN &&
    pitchLength <= PITCH_MAX &&
    !busy &&
    !allRolesOpen;

  const toggleRole = (candidate: ArenaRole, disabled: boolean) => {
    if (disabled || busy) return;
    setServerError(null);
    setRoles((current) =>
      current.includes(candidate)
        ? current.filter((role) => role !== candidate)
        : [...current, candidate],
    );
  };

  // One role at a time: the shared mutation hook can only track a single
  // in-flight request, so firing them all at once drops the callbacks for
  // every call but the last. Sequential mutateAsync posts every selected role
  // and only navigates away after the final one lands.
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || roles.length === 0 || !activeProjectId) return;
    setServerError(null);
    const queue = roles.slice();
    queueRef.current = queue;
    setPendingCount(queue.length);
    let lastPost: ArenaPostDetail | null = null;
    for (const role of queue) {
      try {
        lastPost = await create.mutateAsync({
          data: { projectId: activeProjectId, role, pitch: pitch.trim() },
        });
        queueRef.current = queueRef.current.slice(1);
        setPendingCount(queueRef.current.length);
      } catch (error) {
        queueRef.current = [];
        setPendingCount(0);
        const messageFromServer =
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null;
        setServerError(
          messageFromServer
            ? `${ARENA_ROLE_META[role].roleLabel}: ${messageFromServer}`
            : `We could not open the ${ARENA_ROLE_META[role].roleLabel.toLowerCase()} audition just yet — the other roles went through.`,
        );
        // The roles that already went live must now read as open/disabled.
        void queryClient.invalidateQueries({
          queryKey: getListArenaPostsQueryKey({ projectId: activeProjectId }),
        });
        return;
      }
    }
    if (lastPost) onCreated(lastPost);
  };

  const title = pickerMode ? 'Open roles on your projects.' : `Open a role on “${projectName}”.`;
  const copy = pickerMode
    ? 'Pick a project and every seat you’re hiring for — one audition post per role.'
    : 'Anyone signed in can audition — and preview this project read-only — while a post is live.';

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose} data-testid="arena-post-composer">
      <div className="modal project-modal arena-apply-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
          <X size={16} />
        </button>
        <div className="project-modal-heading">
          <span className="eyebrow"><Megaphone size={12} /> Collaboration / Audition Arena</span>
          <h2>{title}</h2>
          <p>{copy}</p>
        </div>
        <form className="project-modal-fields" onSubmit={submit}>
          {pickerMode && projects && (
            <div className="field">
              <span>Which project are you hiring for?</span>
              <select
                value={selectedProjectId}
                onChange={(event) => {
                  setSelectedProjectId(event.target.value);
                  setRoles([]);
                  setPitch('');
                  setServerError(null);
                }}
                className="den-select"
                disabled={busy}
                data-testid="arena-composer-project"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.channelName} · {project.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {allRolesOpen && (
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} data-testid="arena-composer-full">
              Every role already has an open audition on {pickerMode ? `“${activeProject?.name}”` : 'this project'}. Close
              or fill one before posting another.
            </p>
          )}

          <div className="field">
            <span>Which roles are you hiring for? <em className="arena-composer-hint">— pick as many as you need</em></span>
            <div className="role-tabs arena-composer-roles" role="group" aria-label="Roles to post">
              {ROLES.map((candidate) => {
                const alreadyOpen = alreadyOpenRoles.includes(candidate);
                const disabled = alreadyOpen || allRolesOpen || !activeProjectId || busy;
                const isSelected = roles.includes(candidate);
                return (
                  <button
                    key={candidate}
                    type="button"
                    className={isSelected ? 'active' : ''}
                    onClick={() => toggleRole(candidate, disabled)}
                    disabled={disabled}
                    aria-pressed={isSelected}
                    title={
                      !activeProjectId
                        ? 'Pick a project first'
                        : alreadyOpen
                          ? `A ${ARENA_ROLE_META[candidate].label.toLowerCase()} audition is already open on this project`
                          : ARENA_ROLE_META[candidate].roleLabel
                    }
                    data-testid={`arena-composer-role-${candidate.toLowerCase()}`}
                  >
                    <span className="arena-composer-check" aria-hidden>{isSelected ? <Check size={11} /> : null}</span>
                    {ARENA_ROLE_META[candidate].label}
                    {alreadyOpen && <span className="leg-badge">open</span>}
                  </button>
                );
              })}
            </div>
            {roles.length === 1 && (
              <span className="channel-name-hint">{ARENA_ROLE_META[roles[0]].blurb}</span>
            )}
            {roles.length > 1 && (
              <span className="channel-name-hint">
                {roles.length} roles selected — one audition post each, shared pitch.
              </span>
            )}
          </div>

          <div className="field">
            <span>
              Pitch ({pitchLength}/{PITCH_MAX} — min {PITCH_MIN})
            </span>
            <textarea
              value={pitch}
              onChange={(event) => setPitch(event.target.value)}
              placeholder="I'm looking for an editor who loves documentary pacing. We ship weekly and you'd own the cut from selects to picture lock…"
              maxLength={PITCH_MAX}
              rows={5}
              disabled={busy}
              data-testid="input-arena-post-pitch"
            />
          </div>

          {serverError && (
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} role="alert" data-testid="arena-post-error">
              {serverError}
            </p>
          )}

          <button type="submit" disabled={!canSubmit} className="primary-btn modal-submit" data-testid="button-arena-post">
            {busy
              ? `Posting ${pendingCount} role${pendingCount === 1 ? '' : 's'}…`
              : roles.length > 1
                ? `Post ${roles.length} open roles`
                : 'Post open role'}
            <Megaphone size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}