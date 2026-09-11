import { useState } from "react";
import { Send, X } from "lucide-react";
import type { WriterArenaRole } from "@workspace/api-client-react";
import { WRITER_ROLES, WRITER_ROLE_LABELS } from "@/lib/arena";

// ---------------------------------------------------------------------------
// "Call for a role" — the same frozen-brief publish as the pitch board, plus
// the typed role and the pitch describing it. Opened from a project card or
// from the Arena board (where the author picks which project to call from).
// ---------------------------------------------------------------------------

type ProjectRef = { id: string; title: string; author?: string };

export type ArenaRoleBrief = {
  project: ProjectRef;
  role: WriterArenaRole;
  rolePitch: string;
  plotConstraints: string;
  desiredRole: string;
  respondentLimit: 0 | 3 | 5 | 10;
};

export function ArenaRoleModal({
  projects,
  initialProject,
  onClose,
  onPublish,
  publishing,
}: {
  projects: ProjectRef[];
  initialProject?: ProjectRef | null;
  onClose: () => void;
  onPublish: (brief: ArenaRoleBrief) => void;
  publishing: boolean;
}) {
  const [projectId, setProjectId] = useState(initialProject?.id ?? projects[0]?.id ?? "");
  const [role, setRole] = useState<WriterArenaRole>("CO_WRITER");
  const [rolePitch, setRolePitch] = useState("");
  const [plotConstraints, setPlotConstraints] = useState("");
  const [desiredRole, setDesiredRole] = useState("Co-author");
  const [respondentLimit, setRespondentLimit] = useState<0 | 3 | 5 | 10>(3);

  const project = projects.find((item) => item.id === projectId) ?? initialProject ?? null;
  const canPublish = Boolean(project) && rolePitch.trim().length >= 10;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal brief-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={17} />
        </button>
        <span className="eyebrow">CALL FOR A ROLE</span>
        <h2>Open a writing role.</h2>
        <p>
          Your project becomes a frozen brief in the arena. Writers audition with their own passage, and you choose the
          one whose work answers yours.
        </p>

        {!initialProject && (
          <label className="field">
            <span>Which project is calling?</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} data-testid="select-role-project">
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as WriterArenaRole)} data-testid="select-role">
            {WRITER_ROLES.map((value) => (
              <option key={value} value={value}>
                {WRITER_ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>What are you asking for?</span>
          <textarea
            value={rolePitch}
            onChange={(event) => setRolePitch(event.target.value)}
            placeholder="Describe the work, the shape of the collaboration, and how you would like to split it…"
            data-testid="input-role-pitch"
          />
        </label>

        <label className="field">
          <span>What should a collaborator know?</span>
          <textarea
            value={plotConstraints}
            onChange={(event) => setPlotConstraints(event.target.value)}
            placeholder="Constraints, characters, or room to explore…"
          />
        </label>

        <div className="two-fields">
          <label className="field">
            <span>Desired role</span>
            <input value={desiredRole} onChange={(event) => setDesiredRole(event.target.value)} />
          </label>
          <label className="field">
            <span>Audition limit</span>
            <select
              value={respondentLimit}
              onChange={(event) => setRespondentLimit(Number(event.target.value) as 0 | 3 | 5 | 10)}
            >
              <option value={3}>3 voices</option>
              <option value={5}>5 voices</option>
              <option value={10}>10 voices</option>
              <option value={0}>Unlimited</option>
            </select>
          </label>
        </div>

        <button
          className="primary-btn modal-submit"
          disabled={publishing || !canPublish}
          onClick={() =>
            project &&
            onPublish({
              project,
              role,
              rolePitch: rolePitch.trim(),
              plotConstraints,
              desiredRole,
              respondentLimit,
            })
          }
          data-testid="button-publish-role"
        >
          <Send size={15} /> {publishing ? "Opening the call…" : "Open the call"}
        </button>
      </div>
    </div>
  );
}
