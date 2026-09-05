import { useState } from 'react';
import { Megaphone, X } from 'lucide-react';
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
// The composer picks one of the four content roles and writes the pitch. The
// server enforces one OPEN post per (project, role); roles that already have
// one are disabled with an \"open\" badge, fetched live for the active project.
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
  const pickerMode = Boolean(projects && projects.length > 0);
  const [selectedProjectId, setSelectedProjectId] = useState(projects?.[0]?.id ?? projectId ?? '');
  const [role, setRole] = useState<ArenaRole | null>(null);
  const [pitch, setPitch] = useState('');

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
  const allRolesOpen = pickerMode && Boolean(activeProjectId) && alreadyOpenRoles.length >= ROLES.length;

  const create = useCreateArenaPost({
    mutation: {
      onSuccess: (post) => onCreated(post),
      onError: (error) => {
        const messageFromServer =
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null;
        setServerError(
          messageFromServer ?? 'We could not open this audition just yet. Try again.',
        );
      },
    },
  });
  const [serverError, setServerError] = useState<string | null>(null);

  const selected = role ? ARENA_ROLE_META[role] : null;
  const pitchLength = pitch.length;
  const canSubmit =
    Boolean(role) &&
    Boolean(activeProjectId) &&
    pitchLength >= PITCH_MIN &&
    pitchLength <= PITCH_MAX &&
    !create.isPending &&
    !allRolesOpen;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !role || !activeProjectId) return;
    setServerError(null);
    create.mutate({ data: { projectId: activeProjectId, role, pitch: pitch.trim() } });
  };

  const title = pickerMode ? 'Open a role on one of your projects.' : `Open a role on “${projectName}”.`;
  const copy = pickerMode
    ? 'Pick the project, then the seat you want to fill. Anyone signed in can audition while the post is open — and can preview that project read-only (timeline + preview only) until you fill the seat or close it.'
    : 'Anyone signed in can audition while the post is open — and can preview this project read-only (timeline + preview only) until you fill the seat or close it.';

  return (
    <div className="modal-backdrop" onClick={create.isPending ? undefined : onClose} data-testid="arena-post-composer">
      <div className="modal project-modal arena-apply-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} disabled={create.isPending} aria-label="Close">
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
                  setRole(null);
                  setPitch('');
                  setServerError(null);
                }}
                className="den-select"
                disabled={create.isPending}
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
          {activeProjectId && allRolesOpen && (
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} data-testid="arena-composer-full">
              Every role already has an open audition on {pickerMode ? `“${activeProject?.name}”` : 'this project'}. Close
              or fill one before posting another.
            </p>
          )}

          <div className="field">
            <span>Which role are you hiring for?</span>
            <div className="role-tabs arena-composer-roles" role="group" aria-label="Role to post">
              {ROLES.map((candidate) => {
                const alreadyOpen = alreadyOpenRoles.includes(candidate);
                const disabled = alreadyOpen || allRolesOpen || !activeProjectId;
                return (
                  <button
                    key={candidate}
                    type="button"
                    className={role === candidate ? 'active' : ''}
                    onClick={() => {
                      if (disabled) return;
                      setRole(candidate);
                      setServerError(null);
                    }}
                    disabled={disabled}
                    title={
                      !activeProjectId
                        ? 'Pick a project first'
                        : alreadyOpen
                          ? `A ${ARENA_ROLE_META[candidate].label.toLowerCase()} audition is already open on this project`
                          : ARENA_ROLE_META[candidate].roleLabel
                    }
                    data-testid={`arena-composer-role-${candidate.toLowerCase()}`}
                  >
                    {ARENA_ROLE_META[candidate].label}
                    {alreadyOpen && <span className="leg-badge">open</span>}
                  </button>
                );
              })}
            </div>
            {selected && <span className="channel-name-hint">{selected.blurb}</span>}
          </div>

          <div className="field">
            <span>
              Your pitch ({pitchLength}/{PITCH_MAX} — at least {PITCH_MIN} characters)
            </span>
            <textarea
              value={pitch}
              onChange={(event) => setPitch(event.target.value)}
              placeholder="I'm looking for an editor who loves documentary pacing. We ship weekly and you'd own the cut from selects to picture lock…"
              maxLength={PITCH_MAX}
              rows={5}
              disabled={create.isPending}
              data-testid="input-arena-post-pitch"
            />
          </div>

          {serverError && (
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} role="alert" data-testid="arena-post-error">
              {serverError}
            </p>
          )}

          <button type="submit" disabled={!canSubmit} className="primary-btn modal-submit" data-testid="button-arena-post">
            {create.isPending ? 'Opening the audition…' : 'Post open role'}
            <Megaphone size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}
