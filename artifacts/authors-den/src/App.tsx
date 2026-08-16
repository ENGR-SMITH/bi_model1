import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, Archive, ArrowLeft, ArrowRight, BookOpen, Bold, Check, CheckCircle2, ChevronDown, CircleHelp,
  ClipboardList, Clock3, Copy, Download, Eraser, ExternalLink, FileDown, FileText, FolderOpen,
  GitFork, Globe2, Heading1, Heading2, Highlighter, ImagePlus,  Italic, Library, Link2, List,
  ListOrdered, Lock, LockOpen, LogOut, MapPin, Menu, Move, PanelLeft, PenLine, Play, Plus,
  Printer, Quote, Redo2, RefreshCw, RotateCcw, Save, Search, Send, Settings, ShieldCheck, Sparkles, Strikethrough, Trash2,
  Type, Undo2, Upload, Users, WandSparkles, X, XCircle, Zap, MessageCircle
} from "lucide-react";
import { exportProject, type ExportFormat } from "./export";
import { useUser } from "@clerk/react";
import { Toaster } from "@/components/ui/toaster";
import { continuityAudit, oracleChat, outlineAssist, voiceConsistencyCheck, worldBibleExtract } from "@workspace/api-client-react";
import {
  acceptContinuation,
  createSeedApplication,
  declineContinuation,
  getCollaborationProjectDocument,
  getCollaborationProjectThreadUnread,
  getCollaborationSeed,
  getCollaborationSeedProject,
  getCollaborationThread,
  getContinuation,
  getContinuationProject,
  getOrCreateProjectThread,
  getUserProfile,
  markCollaborationProjectThreadRead,
  listCollaborationProjects,
  saveCollaborationProjectDocument,
  saveSeedApplicationDraft,
  sendCollaborationMessage,
  submitSeedApplication,
  useAcceptContinuation,
  useCreateCollaborationSeed,
  useCreateSeedApplication,
  useDeclineContinuation,
  useListCollaborationProjects,
  useSaveCollaborationProjectDocument,
  useSaveSeedApplicationDraft,
  useSubmitSeedApplication,
} from "@workspace/api-client-react";

type View = "home" | "general" | "characters" | "plots" | "world" | "outline" | "editor" | "search" | "revisions" | "oracle" | "tools" | "settings";
type MediaItem = { id: string; name: string; src: string; x: number; y: number; size: number };
type Scene = { id: string; title: string; synopsis: string; content: string; status: string; compile: boolean; target: number; pov: string; labels: string; notes: string; media?: MediaItem[] };
type Character = { id: string; name: string; role: string; pov: string; importance: string; color: string; description: string; notes: string; custom: { key: string; value: string }[] };
type Plot = { id: string; name: string; role: string; status: string; description: string; notes: string; steps: string[]; characters: string };
type WorldItem = { id: string; name: string; kind: string; description: string; notes: string; fantasy: string; mapUrl: string; image?: string; imageName?: string };
type Revision = { id: string; sceneId: string; sceneTitle: string; content: string; date: string; words: number };
type Project = { id: string; title: string; author: string; template: string; premise: string; synopsis: string; summary: string; created: string; updated: string; scenes: Scene[]; characters: Character[]; plots: Plot[]; world: WorldItem[]; revisions: Revision[]; dailyTarget: number; sessionTarget: number; isTutorial?: boolean; seedId?: string; applicationId?: string; collaborationProjectId?: string; isClone?: boolean; cloneStatus?: string; submittedAt?: string; syncedAt?: string };
type CollaborationClone = { applicationId: string; seedId: string; sourceProjectTitle: string; status: string; updatedAt: string };
// Fields exchanged between both Author Den studios for a shared project.
const SYNC_FIELDS = ["title", "author", "template", "premise", "synopsis", "summary", "scenes", "characters", "plots", "world", "revisions", "dailyTarget", "sessionTarget"] as const;
function pickSyncFields(doc: Record<string, unknown>): Partial<Project> {
  const out: Record<string, unknown> = {};
  for (const key of SYNC_FIELDS) if (doc[key] !== undefined) out[key] = doc[key];
  return out as Partial<Project>;
}
// The continuation text shown to the creator in the review desk is derived
// from the fork's scene content; the full project document travels alongside.
function projectDraftText(doc: Project): string {
  const parts = (doc.scenes ?? []).map((scene) => stripHtml(scene.content)).filter(Boolean);
  const text = parts.join("\n\n") || stripHtml(doc.premise ?? "");
  return text.slice(0, 20000);
}

const uid = () => Math.random().toString(36).slice(2, 10);
let tutorialProjectActive = false;
const now = () => new Date().toISOString();
const exportOptions: { format: ExportFormat; label: string; icon: ReactNode }[] = [
  { format: "json", label: "Project JSON", icon: <FileDown size={14} /> },
  { format: "docx", label: "Word (.docx)", icon: <FileText size={14} /> },
  { format: "pdf", label: "PDF", icon: <FileText size={14} /> },
  { format: "epub", label: "EPUB", icon: <BookOpen size={14} /> },
  { format: "rtf", label: "Rich text (.rtf)", icon: <FileText size={14} /> },
  { format: "txt", label: "Plain text", icon: <FileText size={14} /> },
  { format: "html", label: "HTML document", icon: <Globe2 size={14} /> },
  { format: "fdx", label: "Final Draft (.fdx)", icon: <FileText size={14} /> },
  { format: "md", label: "Markdown", icon: <FileText size={14} /> },
  { format: "odt", label: "OpenDocument (.odt)", icon: <FileText size={14} /> },
  { format: "doc", label: "Word 97 (.doc)", icon: <FileText size={14} /> },
  { format: "print", label: "Print", icon: <Printer size={14} /> },
];

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
const words = (value: string) => { const text = stripHtml(value); return text ? text.split(/\s+/).length : 0; };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] ?? char));
const textToHtml = (value: string) => value.split(/\n\n+/).filter(Boolean).map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br />")}</p>`).join("");
const providerDisplayNames: Record<string, string> = { groq: "Groq", openrouter: "OpenRouter", ollama: "Ollama", lmstudio: "LM Studio" };
function OracleRouteMeta({ providerId, modelId, attempted }: { providerId: string; modelId: string; attempted?: string[] }) {
  const isLocal = providerId === "ollama" || providerId === "lmstudio";
  const route = isLocal ? "Local" : "Hosted";
  return <small className={`oracle-route-meta ${isLocal ? "local" : "hosted"}`} aria-label={`${route} request`}>
    <span className="oracle-route-kind">{route}</span>
    {attempted && attempted.length > 1 && <span className="oracle-route-failover">· failed over from {attempted.slice(0, -1).join(", ")}</span>}
  </small>;
}

// Profile avatar circle for the collaboration chat. When the account's profile
// image is available (the signed-in user's Clerk picture) it renders the photo;
// for the co-writer, whose profile image is not exposed by the API, it shows a
// stable colored circle with their initial as the avatar.
function ChatAvatar({ name, src }: { name: string; src?: string | null }) {
  const label = (name || "C").slice(0, 1).toUpperCase();
  const hue = [...(name || "C")].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  if (src) return <span className="den-chat-avatar"><img src={src} alt="" /></span>;
  return <span className="den-chat-avatar" style={{ background: `hsl(${hue} 40% 42%)`, color: "#fff" }}>{label}</span>;
}

function sample(): Project {
  return {
    id: uid(), title: "The Cartographer's Silence", author: "Mara Vale", template: "Novel", isTutorial: true,
    premise: "A disgraced mapmaker discovers a coastline that does not exist on any chart — and a city waiting to be remembered.",
    synopsis: "After the northern surveys are censored, Elian returns to the salt quarter with one impossible map. The city in its margins is moving closer each night.",
    summary: "A quiet speculative novel about memory, maps, and the places we refuse to name.", created: now(), updated: now(), dailyTarget: 750, sessionTarget: 500, revisions: [],
    characters: [
      { id: uid(), name: "Elian Voss", role: "Protagonist", pov: "Primary", importance: "Major", color: "#d8735a", description: "A meticulous coastal surveyor whose career ended with a single disputed chart.", notes: "Keeps a brass divider from her mother.", custom: [{ key: "Want", value: "To make the map honest." }] },
      { id: uid(), name: "Iria Quill", role: "Ally", pov: "Secondary", importance: "Major", color: "#4d8d80", description: "An archivist with a talent for finding what institutions misplace.", notes: "Speaks in footnotes when nervous.", custom: [] },
    ],
    plots: [
      { id: uid(), name: "The Missing Coast", role: "Main plot", status: "Developing", description: "Elian follows a shoreline that appears only in the negative space of old surveys.", notes: "Keep the mystery tactile, not cosmic.", steps: ["Find the censored survey", "Cross the salt flats", "Enter the unremembered city"], characters: "Elian Voss, Iria Quill" },
      { id: uid(), name: "The Archive War", role: "Subplot", status: "Seeded", description: "The Royal Archive quietly removes records of everyone who has seen the coast.", notes: "", steps: ["A redacted catalogue", "The archivist's bargain"], characters: "Iria Quill" },
    ],
    world: [
      { id: uid(), name: "The Salt Quarter", kind: "Place", description: "Low houses, white windows, and tide marks climbing every door.", notes: "Smells of wet rope and fennel.", fantasy: "A coastal district where the tide remembers every name spoken above it.", mapUrl: "" },
      { id: uid(), name: "Royal Archive", kind: "Institution", description: "A cold limestone building where maps are classified by who is allowed to remember them.", notes: "", fantasy: "Its forbidden stacks are said to redraw themselves after midnight.", mapUrl: "" },
    ],
    scenes: [
      { id: "scene-1", title: "The last honest map", synopsis: "Elian finds a second coastline in the margin of a survey.", content: textToHtml("The map arrived folded inside a letter that had no sender.\n\nElian knew the paper first. It was the blue-grey stock used by the Royal Archive, thick enough to resist a wet thumb and soft enough to remember every fold. She opened it on the kitchen table."), status: "Draft", compile: true, target: 900, pov: "Elian Voss", labels: "inciting incident, coast", notes: "", media: [] },
      { id: "scene-2", title: "A city in the margins", synopsis: "Iria identifies the cartographer's mark and refuses to explain how.", content: textToHtml('Iria Quill did not look at the map. She looked at Elian.\n\n"You have already been seen with this," she said.'), status: "Outline", compile: true, target: 700, pov: "Iria Quill", labels: "archive", notes: "", media: [] },
      { id: "scene-3", title: "The salt road", synopsis: "The two women leave before the tide turns.", content: "", status: "Idea", compile: true, target: 1000, pov: "Elian Voss", labels: "journey", notes: "", media: [] },
    ],
  };
}

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem("authors-den-projects");
    const parsed = raw ? JSON.parse(raw) as Project[] : [sample()];
    return parsed.map((project, index) => ({ ...project, isTutorial: project.isTutorial ?? (index === 0 && project.title === "The Cartographer's Silence"), scenes: (project.scenes ?? []).map((scene) => ({ ...scene, content: scene.content?.startsWith("<") ? scene.content : textToHtml(scene.content ?? ""), media: scene.media ?? [] })), world: (project.world ?? []).map((item) => ({ ...item, fantasy: item.fantasy ?? "", mapUrl: item.mapUrl ?? "" })) }));
  } catch { return [sample()]; }
}

function loadCollaborationClones(): CollaborationClone[] {
  try {
    const raw = localStorage.getItem("tandem-continuation-clones");
    const parsed = raw ? JSON.parse(raw) as CollaborationClone[] : [];
    return parsed.filter((item) => item?.applicationId && item?.seedId && item?.sourceProjectTitle);
  } catch {
    return [];
  }
}

function App() {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [collaborationClones] = useState<CollaborationClone[]>(loadCollaborationClones);
  const [projectId, setProjectId] = useState(() => projects.find((item) => item.isTutorial)?.id ?? projects[0]?.id ?? "");
  const [view, setView] = useState<View>("general");
  const [editorSceneId, setEditorSceneId] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  // The rail starts collapsed; hovering the sidebar auto-expands it.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem("authors-den-theme") ?? "light");
  const [modal, setModal] = useState<"project" | "import" | "help" | "tutorial" | null>(null);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [sidebarWorkspaceOpen, setSidebarWorkspaceOpen] = useState(false);
  const [topWorkspaceOpen, setTopWorkspaceOpen] = useState(false);
  const [mode, setMode] = useState<"lesson" | "draft">("lesson");
  const [draftNudge, setDraftNudge] = useState(false);
  const [toast, setToast] = useState("");
  const { user } = useUser();
  const [intent] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      publish: params.get("publish") === "1",
      answer: params.get("answer") ?? "",
      preview: params.get("preview") ?? "",
      openProject: params.get("project") ?? "",
      chat: params.get("chat") === "1",
    };
  });
  const [publishDraft, setPublishDraft] = useState<Project | null>(null);
  const [noteProject, setNoteProject] = useState<Project | null>(null);
  const [preview, setPreview] = useState<{ continuationId: string; project: Project } | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ respondentName: string; title: string } | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [forkError, setForkError] = useState("");
  const [sharedOpenError, setSharedOpenError] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatThread, setChatThread] = useState<{ id: string; creatorId: string; respondentId: string; creatorName: string; respondentName: string; projectId: string | null } | null>(null);
  const [chatPartnerAvatar, setChatPartnerAvatar] = useState<string | null>(null);
  const chatAvatarFetchedForRef = useRef<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ id: string; senderId: string; body: string; createdAt: string }[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [incomingAlert, setIncomingAlert] = useState<string | null>(null);
  const prevUnreadRef = useRef(-1); // -1 = unknown until the first poll for this project
  const createSeed = useCreateCollaborationSeed();
  const createApplication = useCreateSeedApplication();
  const saveDraft = useSaveSeedApplicationDraft();
  const submitApp = useSubmitSeedApplication();
  const acceptCont = useAcceptContinuation();
  const declineCont = useDeclineContinuation();
  const projectDocsQ = useListCollaborationProjects();
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  const previewActive = Boolean(preview);
  const project = preview?.project ?? projects.find((item) => item.id === projectId) ?? projects[0];
  tutorialProjectActive = Boolean(project?.isTutorial && mode === "lesson" && view !== "home");
  const hasUserProject = projects.some((item) => !item.isTutorial);
  useEffect(() => { localStorage.setItem("authors-den-projects", JSON.stringify(projects)); }, [projects]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("authors-den-theme", theme);
  }, [theme]);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".tutorial-readonly");
    if (!root) return;
    root.querySelectorAll<HTMLElement>("input, textarea, select, button, [contenteditable='true']").forEach((control) => {
      if (control.closest(".lesson-allowed")) return;
      if (control instanceof HTMLButtonElement || control instanceof HTMLSelectElement || control instanceof HTMLInputElement) control.disabled = true;
      if (control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement) control.readOnly = true;
      if (control.hasAttribute("contenteditable")) control.setAttribute("contenteditable", "false");
      control.setAttribute("tabindex", "-1");
    });
  }, [tutorialProjectActive, previewActive, view, projectId, tutorialStep]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2400); return () => clearTimeout(timer); }, [toast]);
  // “Publish a seed” from the pitch board lands here with ?publish=1 and
  // triggers the same “A NEW ROOM FOR WORDS” card as clicking New project.
  useEffect(() => { if (intent.publish && !preview) { setDraftNudge(false); setModal("project"); } }, [intent.publish]);
  // “Answer this seed” (?answer=seedId) forks the frozen project into this
  // studio. The fork is a real editable project with a bright clone marker;
  // submitting it sends the whole document to the creator for review.
  useEffect(() => {
    if (!intent.answer) return;
    let cancelled = false;
    setCloneBusy(true);
    setForkError("");
    (async () => {
      try {
        const seed = await getCollaborationSeed(intent.answer);
        const existing = projectsRef.current.find((p) => p.seedId === intent.answer && p.isClone);
        if (existing) {
          if (!cancelled) { openProject(existing); setCloneBusy(false); notify("Returning to your fork of this seed"); }
          return;
        }
        // Open the application first so the frozen project is scoped to a
        // respondent; the fork is then built from the full snapshot.
        let applicationId = seed.myApplicationId ?? undefined;
        if (!applicationId) {
          const app = await createSeedApplication(intent.answer, { respondentName: user?.firstName || "Writer" });
          applicationId = app.id;
        }
        let doc: Record<string, unknown> | null = null;
        try { doc = await getCollaborationSeedProject(intent.answer); } catch { doc = null; }
        const base = (doc && typeof doc === "object" ? doc : {}) as Partial<Project>;
        const clone: Project = {
          ...sample(),
          ...base,
          id: uid(),
          title: base.title || seed.sourceProjectTitle || "Forked project",
          author: user?.fullName || user?.firstName || "Writer",
          template: base.template || "Novel",
          isTutorial: false,
          isClone: true,
          seedId: intent.answer,
          applicationId: seed.myApplicationId ?? undefined,
          cloneStatus: seed.myApplicationStatus && seed.myApplicationStatus !== "DRAFT" ? seed.myApplicationStatus : "DRAFT",
          created: now(),
          updated: now(),
        };
        if (!Array.isArray(clone.scenes) || !clone.scenes.length) {
          clone.scenes = [{ id: uid(), title: "Opening scene", synopsis: "", content: textToHtml(seed.seedText), status: "Draft", compile: true, target: 800, pov: "", labels: "", notes: "", media: [] }];
        }
        clone.applicationId = applicationId;
        if (!cancelled) {
          setProjects((items) => [clone, ...items]);
          openProject(clone);
          notify("Fork created from the seed — make it yours, then submit it");
        }
      } catch {
        if (!cancelled) setForkError("This seed could not be forked right now. Check that you are signed in and try again.");
      } finally {
        if (!cancelled) setCloneBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [intent.answer]);
  // “Preview” (?preview=continuationId) opens a submitted fork read-only for
  // the creator, with Approve / Reject available on every view.
  useEffect(() => {
    if (!intent.preview) return;
    let cancelled = false;
    (async () => {
      try {
        const continuation = await getContinuation(intent.preview);
        const doc = await getContinuationProject(intent.preview);
        if (cancelled) return;
        const raw = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
        const previewProject: Project = {
          ...sample(),
          ...(raw as Partial<Project>),
          id: uid(),
          title: typeof raw.title === "string" ? raw.title : continuation.sourceProjectTitle,
          isTutorial: false,
          isClone: true,
          cloneStatus: "UNDER_REVIEW",
          created: now(),
          updated: now(),
        };
        setPreviewMeta({ respondentName: continuation.respondentName, title: previewProject.title });
        setView("general");
        setPreview({ continuationId: intent.preview, project: previewProject });
      } catch {
        if (!cancelled) setForkError("This submission could not be opened for preview.");
      }
    })();
    return () => { cancelled = true; };
  }, [intent.preview]);
  // On load, materialize any shared projects (accepted forks) the user is a
  // participant in, and open the one asked for via ?project=projectId.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = (await listCollaborationProjects()) as any[];
        for (const row of rows || []) {
          if (!row?.documentAvailable) continue;
          try { await ensureSharedProject(row.id); } catch { /* skip */ }
        }
      } catch { /* server unavailable — local desk still works */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);
  useEffect(() => {
    if (!intent.openProject) return;
    const local = projectsRef.current.find((p) => p.collaborationProjectId === intent.openProject);
    if (local) { openProject(local); setSharedOpenError(false); }
  }, [projects, intent.openProject]);
  // If a ?project= link can't be materialized (e.g. a legacy room with no
  // merged document yet), surface a clear note instead of a silent dead end.
  useEffect(() => {
    if (!intent.openProject) return;
    const timer = setTimeout(() => {
      const local = projectsRef.current.find((p) => p.collaborationProjectId === intent.openProject);
      if (!local) setSharedOpenError(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [intent.openProject, projects.length]);
  // Push local edits of shared projects to the server (debounced), so both
  // studios stay in sync like a merged pull request.
  useEffect(() => {
    const synced = projects.filter((p) => p.collaborationProjectId);
    if (!synced.length) return;
    const timer = setTimeout(() => {
      synced.forEach((p) => {
        saveCollaborationProjectDocument(p.collaborationProjectId!, { document: p }).catch(() => { /* offline */ });
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [projects]);
  // Pull remote changes for shared projects on an interval.
  useEffect(() => {
    if (!user) return;
    const tick = async () => {
      for (const p of projectsRef.current.filter((x) => x.collaborationProjectId)) {
        try {
          const remote = await getCollaborationProjectDocument(p.collaborationProjectId!);
          if (!remote.document) continue;
          const remoteDoc = remote.document as Record<string, unknown>;
          if (JSON.stringify(pickSyncFields(remoteDoc)) !== JSON.stringify(pickSyncFields(p as unknown as Record<string, unknown>))) {
            setProjects((items) => items.map((item) => item.id === p.id ? { ...item, ...pickSyncFields(remoteDoc), syncedAt: remote.updatedAt ?? item.syncedAt } : item));
          }
        } catch { /* offline */ }
      }
    };
    tick();
    const interval = setInterval(tick, 20000);
    return () => clearInterval(interval);
  }, [user?.id]);
  const updateProject = (patch: Partial<Project>) => { if (tutorialProjectActive || preview) return; setProjects((items) => items.map((item) => item.id === project?.id ? { ...item, ...patch, updated: now() } : item)); };
  const notify = (message: string) => setToast(message);
  const openProject = (item: Project, next: View = "general", sceneId?: string) => { setProjectId(item.id); setEditorSceneId(sceneId ?? null); setView(next); setTutorialOpen(false); setMode(item.isTutorial ? "lesson" : "draft"); };
  // ---- Private thread (floating chat) — only for collaboration projects ----
  const isSharedProject = Boolean(project?.collaborationProjectId && !preview && view !== "home");
  // The co-writer is whoever the current authenticated user is NOT: a creator
  // talks to the respondent and a respondent talks back to the creator. The
  // names come from their accounts (recorded on the thread at seed time).
  const chatPartnerName = chatThread
    ? (user?.id === chatThread.creatorId
      ? (chatThread.respondentName || "Your collaborator")
      : (chatThread.creatorName || project?.author || "Author"))
    : (project?.author || "Collaborator");
  const chatOpenRef = useRef(false);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  const openChat = async () => {
    if (!project?.collaborationProjectId || chatOpenRef.current || chatBusy) return;
    setChatBusy(true);
    try {
      const thread = await getOrCreateProjectThread(project.collaborationProjectId);
      setChatThread(thread);
      // Fetch the co-writer's authentication profile picture so the chat avatar
      // shows their real photo (falls back to their initial avatar on error).
      const partnerId = user?.id === thread.creatorId ? thread.respondentId : thread.creatorId;
      if (partnerId && chatAvatarFetchedForRef.current !== partnerId) {
        chatAvatarFetchedForRef.current = partnerId;
        getUserProfile(partnerId)
          .then((profile) => setChatPartnerAvatar(profile.imageUrl ?? null))
          .catch(() => { /* keep the initial-letter avatar */ });
      }
      setChatMessages((thread.messages ?? []) as any[]);
      markCollaborationProjectThreadRead(project.collaborationProjectId).catch(() => {});
      setChatUnread(0);
      setIncomingAlert(null);
      prevUnreadRef.current = 0;
      setChatOpen(true);
    } catch {
      notify("The private room could not be opened right now.");
    } finally {
      setChatBusy(false);
    }
  };
  // The chat only opens when the user clicks or hovers the widget. A deep link
  // (?chat=1) may open it once per project, but closing it must stay closed —
  // the guard ref stops the effect from re-opening it right after a close.
  const chatAutoOpenedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (intent.chat && project?.collaborationProjectId && !chatOpen && chatAutoOpenedForRef.current !== project.collaborationProjectId) {
      chatAutoOpenedForRef.current = project.collaborationProjectId;
      openChat();
    }
  }, [intent.chat, project?.collaborationProjectId, chatOpen]);
  // Dragging: the whole chat widget (panel + FAB) can be moved anywhere on the
  // page by grabbing its header; the position is clamped to the viewport.
  const [chatPos, setChatPos] = useState<{ x: number; y: number } | null>(null);
  const chatDragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);
  const chatShellRef = useRef<HTMLDivElement>(null);
  const chatDragMove = (event: globalThis.PointerEvent) => {
    const drag = chatDragRef.current;
    const shell = chatShellRef.current;
    if (!drag || !shell) return;
    const maxX = Math.max(0, window.innerWidth - shell.offsetWidth - 8);
    const maxY = Math.max(0, window.innerHeight - shell.offsetHeight - 8);
    setChatPos({
      x: Math.min(Math.max(8, drag.origLeft + event.clientX - drag.startX), maxX),
      y: Math.min(Math.max(8, drag.origTop + event.clientY - drag.startY), maxY),
    });
  };
  const chatDragEnd = () => {
    chatDragRef.current = null;
    document.removeEventListener("pointermove", chatDragMove);
    document.removeEventListener("pointerup", chatDragEnd);
  };
  const chatDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".icon-btn, .den-chat-compose, .den-chat-messages")) return;
    const shell = chatShellRef.current;
    if (!shell) return;
    chatDragRef.current = { startX: event.clientX, startY: event.clientY, origLeft: chatPos?.x ?? window.innerWidth - shell.offsetWidth - 26, origTop: chatPos?.y ?? window.innerHeight - shell.offsetHeight - 26 };
    document.addEventListener("pointermove", chatDragMove);
    document.addEventListener("pointerup", chatDragEnd);
  };
  const closeChat = () => {
    // Anything that arrived while the panel was open counts as seen: mark it
    // read the moment the chat collapses so no stale badge is left behind.
    if (project?.collaborationProjectId) {
      markCollaborationProjectThreadRead(project.collaborationProjectId).catch(() => {});
    }
    setChatUnread(0);
    prevUnreadRef.current = 0;
    setChatOpen(false);
  };
  // A soft two-pip chime for an incoming message (Web Audio — no asset needed).
  const playChatBeep = () => {
    try {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      void ctx.resume();
      const pip = (frequency: number, at: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + duration + 0.05);
      };
      pip(660, 0, 0.16);
      pip(880, 0.2, 0.2);
    } catch { /* audio unavailable */ }
  };
  const sendChat = async () => {
    const body = chatText.trim();
    if (!body || !chatThread) return;
    setChatBusy(true);
    try {
      const message = await sendCollaborationMessage(chatThread.id, { body });
      setChatMessages((items) => [...items, message as any]);
      setChatText("");
    } catch {
      notify("That message could not be sent.");
    } finally {
      setChatBusy(false);
    }
  };
  // Refresh messages while the chat is open, and mark anything seen as read so
  // the badge (and the Tandem inbox) reflect what the user has actually opened.
  useEffect(() => {
    if (!chatOpen || !chatThread?.id || !project?.collaborationProjectId) return;
    const projectId = project.collaborationProjectId;
    const tick = async () => {
      try {
        const thread = await getCollaborationThread(chatThread.id);
        setChatMessages((thread.messages ?? []) as any[]);
        markCollaborationProjectThreadRead(projectId).catch(() => {});
      } catch { /* offline */ }
    };
    tick();
    const interval = setInterval(tick, 15000);
    return () => clearInterval(interval);
  }, [chatOpen, chatThread?.id, project?.collaborationProjectId]);
  // Unread badge on the FAB: driven by the server's unread message state
  // (unread collaboration_message notifications), not a client-side timestamp.
  // A message arriving while the chat is collapsed pops a subtle alert + chime.
  // Mark the unread state unknown whenever the open project changes, so a
  // pre-existing unread message doesn't chime on first poll.
  useEffect(() => {
    prevUnreadRef.current = -1;
    chatAvatarFetchedForRef.current = null;
    setChatPartnerAvatar(null);
  }, [project?.collaborationProjectId]);
  useEffect(() => {
    if (!isSharedProject || !user || !project?.collaborationProjectId) return;
    const projectId = project.collaborationProjectId;
    const tick = async () => {
      try {
        const state = await getCollaborationProjectThreadUnread(projectId);
        const count = state.count ?? 0;
        setChatUnread(count);
        if (!chatOpen && prevUnreadRef.current === 0 && count > 0) {
          setIncomingAlert(chatPartnerName || "Your collaborator");
          playChatBeep();
        }
        prevUnreadRef.current = count;
      } catch { /* offline */ }
    };
    tick();
    const interval = setInterval(tick, 20000);
    return () => clearInterval(interval);
  }, [isSharedProject, user?.id, project?.collaborationProjectId, chatOpen]);
  // Auto-dismiss the incoming-message alert after a few seconds.
  useEffect(() => {
    if (!incomingAlert) return;
    const timer = setTimeout(() => setIncomingAlert(null), 5000);
    return () => clearTimeout(timer);
  }, [incomingAlert]);
  const openEditor = (sceneId?: string) => { setEditorSceneId(sceneId ?? project?.scenes[0]?.id ?? null); setView("editor"); setTutorialOpen(false); };
  const tutorialViews: View[] = ["general", "outline", "editor", "settings"];
  const startTutorial = () => { const tutorial = projects.find((item) => item.isTutorial) ?? project ?? sample(); if (!projects.some((item) => item.id === tutorial.id)) setProjects((items) => [tutorial, ...items]); setMode("lesson"); setProjectId(tutorial.id); setEditorSceneId(tutorial.scenes[0]?.id ?? null); setTutorialStep(0); setView("general"); setTutorialOpen(false); setModal("tutorial"); };
  const closeTutorial = () => { setModal(null); setTutorialOpen(true); };
  const nextLesson = () => { if (tutorialStep >= tutorialViews.length - 1) { setTutorialOpen(false); notify("Tutorial complete — make the desk yours"); return; } const next = tutorialStep + 1; setTutorialStep(next); setView(tutorialViews[next]); if (next === 2) setEditorSceneId(project?.scenes[0]?.id ?? null); setModal("tutorial"); setTutorialOpen(false); };
  const createProject = (template: string, title: string, author: string) => { const seed = sample(); const item: Project = { ...seed, id: uid(), title: title || `Untitled ${template}`, author: author || "Untitled author", template, isTutorial: false, premise: "", synopsis: "", summary: "", characters: [], plots: [], world: [], revisions: [], scenes: [{ ...seed.scenes[0], id: uid(), title: "Untitled scene", synopsis: "", content: "", status: "Idea", pov: "", labels: "", notes: "", media: [] }] }; setMode("draft"); setDraftNudge(false); setProjects((items) => [item, ...items]); setProjectId(item.id); setEditorSceneId(item.scenes[0].id); setModal(null); setTutorialOpen(false); setView("editor"); notify("Project created — your blank desk is ready"); };
  const duplicateProject = (item: Project) => {
    const duplicate: Project = {
      ...item,
      id: uid(),
      title: `${item.title} copy`,
      created: now(),
      updated: now(),
      isTutorial: false,
      scenes: item.scenes.map((scene) => ({ ...scene, id: uid(), labels: "" })),
    };
    setProjects((items) => [duplicate, ...items]);
    notify("Project duplicated as a clean draft");
  };
  const deleteProject = (id: string) => { setProjects((items) => items.filter((item) => item.id !== id)); if (id === projectId) { setProjectId(projects.find((item) => item.id !== id)?.id ?? ""); setView("home"); } notify("Project deleted"); };
  // Publishing happens entirely inside the Author Den: "Post on Pitch Board"
  // opens The Brief (what a collaborator should know, desired role, respondent
  // limit) and publishes the frozen project snapshot straight to the API.
  const postProject = (item: Project) => { setPublishDraft(item); };
  const publishSeed = (item: Project, brief: { plotConstraints: string; desiredRole: string; respondentLimit: 0 | 3 | 5 | 10 }) => {
    const posted = item.scenes.find((scene) => scene.content.trim());
    createSeed.mutate({
      data: {
        sourceProjectId: item.id,
        sourceProjectTitle: item.title,
        creatorName: user?.fullName || user?.username || user?.firstName || item.author || "Author",
        sourceSceneId: posted?.id ?? null,
        sourceVersion: posted ? item.revisions.filter((r) => r.sceneId === posted.id).length + 1 : 1,
        seedText: stripHtml(posted?.content ?? item.premise ?? "").slice(0, 12000),
        unitType: "scene",
        protocol: "Continue from the final line",
        genre: "Literary",
        tone: "Open and searching",
        language: "English",
        plotConstraints: brief.plotConstraints,
        desiredRole: brief.desiredRole,
        visibility: "SEED_AND_BRIEF",
        respondentLimit: brief.respondentLimit,
        projectDocument: item,
      },
    }, {
      onSuccess: (seed) => {
        setPublishDraft(null);
        notify("Seed published to the pitch board");
        window.location.href = `/authors/pitch-board/seed/${seed.id}`;
      },
      onError: () => notify("The seed could not be published. Check that you are signed in and try again."),
    });
  };
  // Submitting a fork: the whole edited project + the note travel with the
  // application so the creator can preview it read-only in their own studio.
  const submitClone = (item: Project, note: string) => {
    const doSubmit = (applicationId: string) => {
      const draftText = projectDraftText(item);
      saveDraft.mutate(
        { applicationId, data: { draftText, draftComments: note, projectDocument: item } },
        {
          onSuccess: () => submitApp.mutate({ applicationId }, {
            onSuccess: () => {
              setNoteProject(null);
              setProjects((items) => items.map((p) => p.id === item.id ? { ...p, cloneStatus: "SUBMITTED", submittedAt: now(), applicationId } : p));
              notify("Fork submitted — the creator will review it in their inbox");
            },
            onError: () => notify("The fork could not be submitted. Try again."),
          }),
          onError: () => notify("Your fork could not be saved before submitting."),
        },
      );
    };
    // A declined application is resolved, so resubmitting opens a fresh one.
    if (item.applicationId && item.cloneStatus !== "DECLINED") { doSubmit(item.applicationId); return; }
    createApplication.mutate({ seedId: item.seedId || "", data: { respondentName: user?.firstName || "Writer" } }, {
      onSuccess: (app) => {
        setProjects((items) => items.map((p) => p.id === item.id ? { ...p, applicationId: app.id } : p));
        doSubmit(app.id);
      },
      onError: () => notify("Could not open an application for this fork."),
    });
  };
  const ensureSharedProject = async (projectId: string) => {
    const remote = await getCollaborationProjectDocument(projectId);
    if (!remote.document) return;
    const doc = remote.document as Record<string, unknown>;
    const docTitle = typeof doc.title === "string" ? doc.title : "";
    setProjects((items) => {
      const existing = items.find((p) => p.collaborationProjectId === projectId);
      if (existing) {
        return items.map((p) => p.id === existing.id ? { ...p, ...pickSyncFields(doc), syncedAt: remote.updatedAt ?? p.syncedAt } : p);
      }
      const fork = items.find((p) => p.isClone && p.seedId && p.title === docTitle && !p.collaborationProjectId);
      if (fork) {
        return items.map((p) => p.id === fork.id ? { ...p, ...pickSyncFields(doc), collaborationProjectId: projectId, cloneStatus: "ACCEPTED", syncedAt: remote.updatedAt ?? p.syncedAt } : p);
      }
      const seedProject = items.find((p) => !p.isClone && p.title === docTitle && !p.collaborationProjectId);
      if (seedProject) {
        return items.map((p) => p.id === seedProject.id ? { ...p, ...pickSyncFields(doc), collaborationProjectId: projectId, syncedAt: remote.updatedAt ?? p.syncedAt } : p);
      }
      const fresh: Project = {
        ...sample(),
        ...(doc as Partial<Project>),
        id: uid(),
        isTutorial: false,
        isClone: true,
        collaborationProjectId: projectId,
        cloneStatus: "ACCEPTED",
        created: now(),
        updated: now(),
      };
      return [fresh, ...items];
    });
  };
  const approvePreview = () => {
    if (!preview) return;
    acceptCont.mutate({ continuationId: preview.continuationId }, {
      onSuccess: async (shared) => {
        try { await ensureSharedProject(shared.id); } catch { /* still navigate */ }
        setPreview(null);
        notify("Fork accepted — the merged project is now shared in both studios");
        window.location.href = `/authors-den/?project=${shared.id}`;
      },
      onError: () => notify("This fork could not be accepted right now."),
    });
  };
  const rejectPreview = () => {
    if (!preview) return;
    declineCont.mutate({ continuationId: preview.continuationId }, {
      onSuccess: () => { setPreview(null); window.location.href = "/authors/collaborations/continuations"; },
      onError: () => notify("The fork could not be declined right now."),
    });
  };
  const switchToLesson = () => { startTutorial(); };
  const switchToDraft = () => { setMode("draft"); setModal(null); setTutorialOpen(false); if (project?.isTutorial) { setDraftNudge(!hasUserProject); setView("home"); } else { setDraftNudge(false); setEditorSceneId(project?.scenes[0]?.id ?? null); setView(project ? "editor" : "home"); } };
  const exportFile = async (format: ExportFormat) => { if (!project) return; await exportProject({ ...project, scenes: project.scenes.map((scene) => ({ id: scene.id, title: scene.title, synopsis: scene.synopsis, content: scene.content, status: scene.status, pov: scene.pov })) }, format); notify(format === "print" ? "Print window opened" : `Downloaded ${format.toUpperCase()}`); };
  const importFile = (file: File) => { const reader = new FileReader(); reader.onload = () => { try { const raw = String(reader.result); const parsed = file.name.endsWith(".json") || file.name.endsWith(".msk") ? JSON.parse(raw) : { ...sample(), title: raw.split("\n")[0] || "Imported work", scenes: [{ ...sample().scenes[0], id: uid(), title: "Imported draft", content: textToHtml(raw) }] }; setProjects((items) => [{ ...sample(), ...parsed, id: uid(), isTutorial: false, updated: now() }, ...items]); setModal(null); notify("Import complete"); } catch { notify("That file could not be read"); } }; reader.readAsText(file); };
    return <div className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <Sidebar view={view} setView={setView} project={project} projects={projects} openProject={openProject} openEditor={openEditor} mobile={mobileNav} close={() => setMobileNav(false)} onNew={() => { setDraftNudge(false); setModal("project"); }} onTutorial={startTutorial} workspaceOpen={sidebarWorkspaceOpen} setWorkspaceOpen={setSidebarWorkspaceOpen} mode={mode} hasUserProject={hasUserProject} notify={notify} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
    <main className="main-stage">
      <header className="topbar">
        <button className="icon-btn mobile-only" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={19} /></button>
        <div className="top-workspace-wrap" onPointerLeave={() => setTopWorkspaceOpen(false)}><button className="top-workspace" onClick={() => setTopWorkspaceOpen((open) => !open)}><span>Workspace</span><ChevronDown size={13} /><b>{project?.title ?? "Your projects"}</b></button>{topWorkspaceOpen && <WorkspaceMenu projects={projects} project={project} onSelect={(item) => { openProject(item); setTopWorkspaceOpen(false); }} onNew={() => { setModal("project"); setTopWorkspaceOpen(false); }} />}</div>
         <div className="mode-switch" role="tablist" aria-label="Writing mode"><button className={`${mode === "draft" ? "active " : ""}draft-mode-tab ${mode === "lesson" ? "wave-nudge" : ""}`} onClick={switchToDraft} role="tab" aria-selected={mode === "draft"}><PenLine size={13} /> Draft</button><button className={mode === "lesson" ? "active" : ""} onClick={switchToLesson} role="tab" aria-selected={mode === "lesson"}><BookOpen size={13} /> Lesson</button></div>
         <div className="top-actions">{preview && <div className="preview-actions"><button className="preview-btn preview-reject" onClick={rejectPreview} disabled={declineCont.isPending}><XCircle size={15} /> {declineCont.isPending ? "Archiving…" : "Reject"}</button><button className="preview-btn preview-approve" onClick={approvePreview} disabled={acceptCont.isPending}><CheckCircle2 size={15} /> {acceptCont.isPending ? "Merging…" : "Approve & merge"}</button></div>}<button className="icon-btn" aria-label="Help" onClick={() => setModal("help")}><CircleHelp size={18} /></button><button className="avatar" aria-label="Author settings" onClick={() => project && setView("settings")}>{project?.author?.slice(0, 1) ?? "A"}</button></div>
      </header>
        {cloneBusy && <div className="den-status-banner"><RefreshCw size={15} className="spin" /> Opening your fork of this seed…</div>}
        {forkError && <div className="den-status-banner error"><XCircle size={15} /> {forkError}</div>}
        {preview && <div className="den-status-banner preview"><GitFork size={15} /> Previewing {previewMeta?.respondentName ? `${previewMeta.respondentName}'s` : "a writer's"} submission of “{previewMeta?.title ?? project.title}” — read only. Approve to merge it into the shared project.</div>}
        {sharedOpenError && <div className="den-status-banner error"><XCircle size={15} /> This shared room has no merged document in your studio yet — shared projects appear here once a submission has been approved and merged.</div>}
        {view === "home" || !project ? <Home projects={projects} collaborationClones={collaborationClones} openProject={openProject} onNew={() => { setDraftNudge(false); setModal("project"); }} onDuplicate={duplicateProject} onDelete={deleteProject} onImport={() => setModal("import")} onExport={exportFile} onTutorial={startTutorial} onPost={postProject} onSubmitClone={(item) => setNoteProject(item)} highlightNew={draftNudge} /> : <div className={tutorialProjectActive || previewActive ? "tutorial-readonly" : ""}>{previewActive ? <div className="readonly-badge">Previewing a submitted project · read only</div> : tutorialProjectActive && <div className="readonly-badge">Lesson tutorial · read only</div>}<div className="workspace-content"><Workspace view={view} project={project} editorSceneId={editorSceneId} updateProject={updateProject} setView={setView} openEditor={openEditor} notify={notify} exportFile={exportFile} projects={projects} openProject={openProject} theme={theme} setTheme={setTheme} /></div></div>}
      {tutorialOpen && <TutorialDock step={tutorialStep} onNext={nextLesson} onDismiss={() => setTutorialOpen(false)} />}
    </main>
    {isSharedProject && <div ref={chatShellRef} className={`den-chat ${chatOpen ? "den-chat-open" : ""} ${chatDragRef.current ? "den-chat-dragging" : ""}`} style={chatPos ? { left: chatPos.x, top: chatPos.y, right: "auto", bottom: "auto" } : undefined} onMouseEnter={openChat} onMouseLeave={closeChat}>
      {chatOpen ? <div className="den-chat-panel">
        <div className="den-chat-head" onPointerDown={chatDragStart} title="Drag to move the chat"><ChatAvatar name={chatPartnerName} src={chatPartnerAvatar} /><div><b>{chatPartnerName || "Private thread"}</b><small>Private thread with {chatPartnerName || "your co-writer"}</small></div><button className="icon-btn" aria-label="Close private thread" onClick={closeChat}><X size={16} /></button></div>
        <div className="den-chat-messages">{chatMessages.length ? chatMessages.map((message) => <div key={message.id} className={`den-chat-msg ${message.senderId === user?.id ? "mine" : ""}`}><p>{message.body}</p><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>) : <div className="den-chat-empty">No messages yet — say hello to your co-writer.</div>}</div>
        <div className="den-chat-compose"><textarea value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="Write to your co-writer…" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") sendChat(); }} disabled={chatBusy} /><button className="den-chat-send" onClick={sendChat} disabled={chatBusy || !chatText.trim()}><Send size={14} /> Send</button></div>
      </div> : <><div className="den-chat-fab-wrap" onMouseEnter={openChat}>{incomingAlert && <div className="den-chat-alert"><ChatAvatar name={chatPartnerName} src={chatPartnerAvatar} /><button className="den-chat-alert-body" onClick={openChat}><b>New message</b><small>from {incomingAlert}</small></button><button className="den-chat-alert-close" aria-label="Dismiss" onClick={() => setIncomingAlert(null)}><X size={13} /></button></div>}<button className="den-chat-fab" aria-label="Open private thread" title={`Private thread with ${chatPartnerName}`} onClick={openChat}><ChatAvatar name={chatPartnerName} src={chatPartnerAvatar} /><MessageCircle size={20} />{chatUnread > 0 && <span className="den-chat-badge">{chatUnread}</span>}</button></div></>}
    </div>}
    {modal === "project" && <ProjectModal onClose={() => setModal(null)} onCreate={createProject} />}
    {modal === "import" && <ImportModal onClose={() => setModal(null)} onImport={importFile} />}
    {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
    {modal === "tutorial" && <TutorialModal step={tutorialStep} onClose={closeTutorial} />}
    {publishDraft && <BriefModal project={publishDraft} onClose={() => setPublishDraft(null)} onPublish={(brief) => publishSeed(publishDraft, brief)} publishing={createSeed.isPending} />}
    {noteProject && <NoteModal project={noteProject} onClose={() => setNoteProject(null)} onSubmit={(note) => submitClone(noteProject, note)} submitting={saveDraft.isPending || submitApp.isPending || createApplication.isPending} />}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    <Toaster />
  </div>;
}

function WorkspaceMenu({ projects, project, onSelect, onNew }: { projects: Project[]; project?: Project; onSelect: (project: Project) => void; onNew: () => void }) {
  return <div className="workspace-menu" onPointerLeave={(event) => event.stopPropagation()}><span className="menu-caption">MY PROJECTS</span>{projects.map((item) => <button key={item.id} className={item.id === project?.id ? "selected" : ""} onClick={() => onSelect(item)}><span className="menu-project-mark">{item.title.slice(0, 1)}</span><span>{item.title}<small>{item.template}</small></span><Check size={14} /></button>)}<button className="menu-new" onClick={onNew}><Plus size={14} /> New project</button></div>;
}

function Sidebar({ view, setView, project, projects, openProject, openEditor, mobile, close, onNew, onTutorial, workspaceOpen, setWorkspaceOpen, mode, hasUserProject, notify, collapsed, setCollapsed }: { view: View; setView: (view: View) => void; project?: Project; projects: Project[]; openProject: (project: Project, view?: View, sceneId?: string) => void; openEditor: (sceneId?: string) => void; mobile: boolean; close: () => void; onNew: () => void; onTutorial: () => void; workspaceOpen: boolean; setWorkspaceOpen: (open: boolean) => void; mode: "lesson" | "draft"; hasUserProject: boolean; notify: (message: string) => void; collapsed: boolean; setCollapsed: (collapsed: boolean) => void }) {
  const nav: [View, string, ReactNode][] = [["general", "General", <PenLine size={17} />], ["characters", "Characters", <Users size={17} />], ["world", "World", <Globe2 size={17} />], ["plots", "Plots", <Sparkles size={17} />], ["outline", "Outline", <ClipboardList size={17} />], ["editor", "Draft", <BookOpen size={17} />]];
   const aux: [View, string, ReactNode][] = [["search", "Search", <Search size={17} />], ["revisions", "Revisions", <Archive size={17} />], ["oracle", "Oracle", <WandSparkles size={17} />], ["tools", "Tools", <Zap size={17} />], ["settings", "Settings", <Settings size={17} />]];
  const gated = mode === "draft" && !hasUserProject;
  const go = (id: View) => { if (gated) { notify("Create a project first to open your current work"); return; } if (id === "editor") openEditor(); else setView(id); close(); };
   return <aside className={`sidebar ${mobile ? "sidebar-open" : ""} ${collapsed ? "sidebar-collapsed" : ""}`} onMouseEnter={() => !mobile && setCollapsed(false)} onMouseLeave={() => !mobile && setCollapsed(true)}><a className="tandem-back-btn" href="/" title="Back to Tandem"><LogOut size={15} /><span>Back to Tandem</span></a><div className="brand-row"><div className="brand-mark">A</div><div className="brand-copy"><div className="brand-name">Authors Den</div><div className="brand-sub">writing studio</div></div><button className="icon-btn sidebar-close mobile-only" onClick={close} aria-label="Close navigation"><X size={17} /></button></div>
     <div className="workspace-switch-wrap" onPointerLeave={() => setWorkspaceOpen(false)}><button className={`workspace-switch ${workspaceOpen ? "open" : ""}`} onClick={() => setWorkspaceOpen(!workspaceOpen)}><span className="workspace-icon"><Library size={14} /></span><span className="workspace-copy"><small>WORKSPACE</small><strong>My writing desk</strong></span><ChevronDown size={14} /></button>{workspaceOpen && <WorkspaceMenu projects={projects} project={project} onSelect={(item) => { openProject(item); setWorkspaceOpen(false); }} onNew={() => { onNew(); setWorkspaceOpen(false); }} />}</div>
    <button className={`nav-item ${view === "home" ? "active" : ""}`} onClick={() => { setView("home"); close(); }}><FolderOpen size={17} /><span>Projects</span><span className="nav-count">{projects.length}</span></button>
     <div className="nav-label">CURRENT WORK</div>{project ? nav.map(([id, label, icon]) => <button key={id} className={`nav-item ${view === id ? "active" : ""} ${gated ? "nav-item-gated" : ""}`} onClick={() => go(id)} disabled={gated} title={gated ? "Create a project first before opening current work" : undefined}>{icon}<span>{label}</span>{id === "outline" && <span className="nav-count">{project.scenes.length}</span>}{gated && <span className="nav-lock">Create first</span>}</button>) : <div className="empty-sidebar">Open a project to begin.</div>}
    <div className="nav-label nav-label-spaced">STUDIO</div>{aux.map(([id, label, icon]) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => go(id)}>{icon}<span>{label}</span></button>)}
    <div className="sidebar-bottom"><button className="tutorial-btn" onClick={onTutorial}><Play size={14} /><span>Explore the tutorial</span></button><button className="new-project-btn" onClick={onNew}><Plus size={17} /><span>New project</span></button></div>
  </aside>;
}

function Home({ projects, collaborationClones, openProject, onNew, onDuplicate, onDelete, onImport, onExport, onTutorial, onPost, onSubmitClone, highlightNew }: { projects: Project[]; collaborationClones: CollaborationClone[]; openProject: (project: Project, view?: View) => void; onNew: () => void; onDuplicate: (project: Project) => void; onDelete: (id: string) => void; onImport: () => void;  onExport: (format: ExportFormat) => void; onTutorial: () => void; onPost: (project: Project) => void; onSubmitClone: (project: Project) => void; highlightNew?: boolean }) {
  return <div className="page home-page"><PageGuide label="YOUR LIBRARY" text="Every project starts here. Open a project to shape the story." /><div className="home-hero"><div><div className="eyebrow"><span className="eyebrow-line" /> PRIVATE WRITING DESK</div><h1>Keep the whole<br /><em>story</em> in reach.</h1><p>A quiet place for premise, people, plot, and pages.<br />Everything you need to carry a work from first thought to final draft.</p></div><div className="hero-orbit"><div className="orbit-center">A</div><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><span className="orbit-word word-a">PREMISE</span><span className="orbit-word word-b">DRAFT</span><span className="orbit-word word-c">WORLD</span></div></div>
     <div className="section-head"><div><div className="eyebrow">YOUR LIBRARY</div><h2>Recent projects</h2><button className={`new-library-btn ${highlightNew ? "wave-nudge" : ""}`} onClick={onNew}><span className="new-project-plus"><Plus size={25} strokeWidth={3} /></span><span><b>New project</b><small>Create a project to unlock your desk</small></span></button></div></div>
     {projects.length ? <div className="project-grid">{projects.map((item, index) => <article className={`project-card ${index === 0 ? "featured" : ""}`} key={item.id}><div className="project-card-top">{item.isClone && !item.collaborationProjectId ? <span className="clone-badge"><GitFork size={11} /> Fork of a seed</span> : item.collaborationProjectId ? <span className="sync-badge"><RefreshCw size={11} /> Shared project</span> : <span className="template-tag">{item.template}</span>}</div><button className="project-open" onClick={() => openProject(item)}><h3>{item.title}</h3><p>{item.author}</p>{item.isClone && !item.collaborationProjectId && <p className="clone-source"><GitFork size={11} /> Forked from a seed ad — edit, then submit it to the creator</p>}{item.collaborationProjectId && <p className="clone-source shared"><RefreshCw size={11} /> Synced with your collaborator — edits appear in both studios</p>}<div className="card-rule" /><div className="project-meta"><span><FileText size={13} /> {item.scenes.length} scenes</span><span>{new Date(item.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div></button><div className="card-actions">{item.isClone && !item.collaborationProjectId && (item.cloneStatus === "SUBMITTED" || item.cloneStatus === "UNDER_REVIEW") ? <span className="clone-status in-review"><Clock3 size={13} /> In review</span> : item.isClone && !item.collaborationProjectId && item.cloneStatus === "ACCEPTED" ? <span className="clone-status accepted"><Check size={13} /> Accepted</span> : item.isClone && !item.collaborationProjectId && item.cloneStatus === "DECLINED" ? <span className="clone-status declined"><XCircle size={13} /> Declined — edit and resubmit</span> : null}{!item.isClone && <button className="card-action-btn post-btn" onClick={() => onPost(item)}><Send size={13} /> Post on Pitch Board</button>}{item.isClone && !item.collaborationProjectId && (!item.cloneStatus || item.cloneStatus === "DRAFT" || item.cloneStatus === "DECLINED") && <button className="card-action-btn submit-clone-btn" onClick={() => onSubmitClone(item)}><Send size={13} /> Submit</button>}<button className="card-action-btn duplicate-btn" onClick={() => onDuplicate(item)}><Copy size={13} /> Duplicate</button><button className="card-action-btn delete-btn" onClick={() => onDelete(item.id)}><Trash2 size={13} /> Delete</button></div></article>)}</div> : <Empty icon={<BookOpen size={28} />} title="A blank desk, waiting" text="Create your first project and give the next idea somewhere to land." action={<button className="primary-btn" onClick={onNew}><Plus size={16} /> New project</button>} />}
     {collaborationClones.length > 0 && <section className="home-lower" aria-label="Collaboration clones"><div className="quick-start"><span className="eyebrow">COLLABORATION CLONES</span><h3>Responses you have in motion.</h3><p>These private forks stay linked to their frozen source seeds until you submit or withdraw them.</p><div className="quick-actions">{collaborationClones.slice(0, 3).map((clone) => <a className="secondary-btn" key={clone.applicationId} href={`/authors-den/?answer=${clone.seedId}`}><MessageCircle size={15} /> {clone.sourceProjectTitle}<small>{clone.status.replaceAll("_", " ").toLowerCase()}</small></a>)}</div></div></section>}
    <div className="home-lower"><div className="quick-start"><span className="eyebrow">START SOMEWHERE</span><h3>Bring in work from another desk.</h3><p>Import a project or plain text draft, then keep going.</p><div className="quick-actions"><button className="secondary-btn" onClick={onImport}><Upload size={15} /> Import file</button><button className="link-btn" onClick={onTutorial}><Play size={14} /> Take the tutorial</button></div></div><div className="portable"><div><Check size={18} /><b>Local by design</b></div><p>Your projects live in this browser. Export anytime.</p><button className="link-btn" onClick={() => onExport("json")}><Download size={14} /> Export a portable project</button></div></div>
  </div>;
}

function PageGuide({ label, text }: { label: string; text: string }) { if (!tutorialProjectActive) return null; return <div className="page-guide"><span className="guide-pin" /><div><b>{label}</b><span>{text}</span></div><span className="guide-spark" aria-hidden="true" /></div>; }
function PageHeader({ eyebrow, title, description, action, guide }: { eyebrow: string; title: string; description: string; action?: ReactNode; guide: string }) { return <><PageGuide label={eyebrow} text={guide} /><div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div></>; }
function TextField({ label, value, onChange, area = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; area?: boolean; placeholder?: string }) { return <label className="field"><span>{label}</span>{area ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>; }
function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state">{icon}<h3>{title}</h3><p>{text}</p>{action}</div>; }

function Workspace({ view, project, editorSceneId, updateProject, setView, openEditor, notify, exportFile, projects, openProject, theme, setTheme }: { view: View; project: Project; editorSceneId: string | null; updateProject: (patch: Partial<Project>) => void; setView: (view: View) => void; openEditor: (sceneId?: string) => void;  notify: (message: string) => void; exportFile: (format: ExportFormat) => void; projects: Project[]; openProject: (project: Project, view?: View, sceneId?: string) => void; theme: string; setTheme: (theme: string) => void }) {
  if (view === "general") return <General project={project} update={updateProject} notify={notify} />;
  if (view === "characters") return <Characters project={project} update={updateProject} notify={notify} />;
  if (view === "plots") return <Plots project={project} update={updateProject} notify={notify} />;
  if (view === "world") return <World project={project} update={updateProject} notify={notify} />;
  if (view === "outline") return <Outline project={project} update={updateProject} openEditor={openEditor} notify={notify} />;
     if (view === "editor") return <div className="draft-workspace"><Editor project={project} editorSceneId={editorSceneId} update={updateProject} setView={setView} notify={notify} exportFile={exportFile} /><ToneRewritePanel project={project} sceneId={editorSceneId ?? project.scenes[0]?.id ?? null} /></div>;
  if (view === "search") return <SearchPage project={project.isTutorial ? undefined : project} openEditor={openEditor} />;
  if (view === "revisions") return <Revisions project={project} update={updateProject} notify={notify} />;
   if (view === "oracle") return <OraclePage project={project} updateProject={updateProject} notify={notify} />;
   if (view === "tools") return <Tools project={project} updateProject={updateProject} notify={notify} />;
  return <SettingsPage project={project} update={updateProject} notify={notify} exportFile={exportFile} theme={theme} setTheme={setTheme} />;
}

function Stats({ project }: { project: Project }) { const total = project.scenes.reduce((sum, scene) => sum + words(scene.content), 0); return <section className="stats-row"><div className="stat"><span>WORDS</span><b>{total.toLocaleString()}</b><small>across your draft</small></div><div className="stat"><span>SCENES</span><b>{project.scenes.length}</b><small>{project.scenes.filter((scene) => scene.status === "Draft").length} drafted</small></div><div className="stat"><span>PEOPLE</span><b>{project.characters.length}</b><small>in the cast</small></div><div className="stat stat-highlight"><span>LAST OPENED</span><b>{new Date(project.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</b><small>in this browser</small></div></section>; }
function General({ project, update, notify }: { project: Project; update: (patch: Partial<Project>) => void; notify: (message: string) => void }) { return <div className="page"><PageHeader eyebrow="GENERAL" title="Shape the work." description="The north star of your project. Keep the essential shape visible as the pages grow." guide="Set the premise, synopsis, and identity of the whole project." action={<button className="primary-btn" onClick={() => notify("All changes are saved locally")}><Save size={15} /> Save changes</button>} /><div className="general-layout"><section className="paper-card"><div className="card-heading"><div><span className="eyebrow">IDENTITY</span><h2>The cover of the work</h2></div><span className="mono-label">01 / 04</span></div><div className="two-fields"><TextField label="Project title" value={project.title} onChange={(value) => update({ title: value })} /><TextField label="Author" value={project.author} onChange={(value) => update({ author: value })} /></div><label className="field"><span>Template</span><select value={project.template} onChange={(event) => update({ template: event.target.value })}>{["Novel", "Novella", "Short Story", "Research Paper", "Empty"].map((value) => <option key={value}>{value}</option>)}</select></label><TextField label="Premise" area value={project.premise} onChange={(value) => update({ premise: value })} placeholder="What happens, and why does it matter?" /></section><section className="paper-card accent-card"><div className="card-heading"><div><span className="eyebrow">THE SHORT VERSION</span><h2>What is this really about?</h2></div><WandSparkles size={18} /></div><TextField label="Synopsis" area value={project.synopsis} onChange={(value) => update({ synopsis: value })} placeholder="A paragraph you could tell someone at a table." /><TextField label="One-line summary" value={project.summary} onChange={(value) => update({ summary: value })} /><div className="summary-lengths"><button onClick={() => update({ summary: project.premise })}>Long</button><button onClick={() => update({ summary: project.synopsis.slice(0, 120) })}>Medium</button><button onClick={() => update({ summary: project.title })}>Short</button></div></section></div><Stats project={project} /></div>; }

function Characters({ project, update, notify }: { project: Project; update: (patch: Partial<Project>) => void; notify: (message: string) => void }) {
  const [selected, setSelected] = useState<string | null>(project.characters[0]?.id ?? null); const current = project.characters.find((character) => character.id === selected); const patch = (value: Partial<Character>) => current && update({ characters: project.characters.map((character) => character.id === current.id ? { ...character, ...value } : character) }); const add = () => { const character: Character = { id: uid(), name: "New character", role: "Supporting", pov: "None", importance: "Minor", color: "#a98dca", description: "", notes: "", custom: [] }; update({ characters: [...project.characters, character] }); setSelected(character.id); };
  return <div className="page"><PageHeader eyebrow="PEOPLE" title="Characters" description="Give every voice a place to stand, from first mention to final scene." guide="The cast page holds the people who carry the story." action={<button className="primary-btn" onClick={add}><Plus size={15} /> Add character</button>} /><div className="split-layout"><div className="list-panel"><div className="list-toolbar"><span>{project.characters.length} characters</span><Search size={15} /></div>{project.characters.map((character) => <button className={`list-row ${selected === character.id ? "selected" : ""}`} key={character.id} onClick={() => setSelected(character.id)}><span className="person-dot" style={{ background: character.color }}>{character.name.slice(0, 1)}</span><span><b>{character.name}</b><small>{character.role}</small></span><ChevronDown size={14} /></button>)}</div>{current ? <section className="paper-card detail-card"><div className="detail-heading"><div><span className="eyebrow">CHARACTER DOSSIER</span><h2>{current.name}</h2></div><button className="danger-icon" onClick={() => { update({ characters: project.characters.filter((character) => character.id !== current.id) }); setSelected(project.characters.find((character) => character.id !== current.id)?.id ?? null); notify("Character removed"); }} aria-label="Delete character"><Trash2 size={16} /></button></div><div className="two-fields"><TextField label="Name" value={current.name} onChange={(value) => patch({ name: value })} /><label className="field"><span>Importance</span><select value={current.importance} onChange={(event) => patch({ importance: event.target.value })}>{["Major", "Minor", "Mentioned"].map((value) => <option key={value}>{value}</option>)}</select></label></div><div className="three-fields"><label className="field"><span>Role</span><select value={current.role} onChange={(event) => patch({ role: event.target.value })}>{["Protagonist", "Antagonist", "Ally", "Supporting", "Minor"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="field"><span>POV</span><select value={current.pov} onChange={(event) => patch({ pov: event.target.value })}>{["Primary", "Secondary", "None"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="field color-field"><span>Character color</span><span className="color-picker"><span className="color-gradient" style={{ background: `linear-gradient(135deg, ${current.color}, #f1bd76, #5c6ac4)` }} /><input type="color" value={current.color} onChange={(event) => patch({ color: event.target.value })} /></span><span className="color-swatches">{["#d8735a", "#4d8d80", "#a98dca", "#e2ab58", "#6c82bd"].map((color) => <button key={color} style={{ background: color }} aria-label={`Use ${color}`} onClick={() => patch({ color })} />)}</span></label></div><TextField label="Description" area value={current.description} onChange={(value) => patch({ description: value })} placeholder="The visible facts, and the contradictions underneath." /><TextField label="Notes" area value={current.notes} onChange={(value) => patch({ notes: value })} placeholder="Private notes for the author." /><div className="custom-info"><div className="inline-heading"><span className="eyebrow">CUSTOM INFORMATION</span><button className="text-btn" onClick={() => patch({ custom: [...current.custom, { key: "New detail", value: "" }] })}><Plus size={14} /> Add row</button></div>{current.custom.map((row, index) => <div className="custom-row" key={`${row.key}-${index}`}><input value={row.key} onChange={(event) => { const rows = [...current.custom]; rows[index] = { ...rows[index], key: event.target.value }; patch({ custom: rows }); }} /><input value={row.value} onChange={(event) => { const rows = [...current.custom]; rows[index] = { ...rows[index], value: event.target.value }; patch({ custom: rows }); }} /><button onClick={() => patch({ custom: current.custom.filter((_, rowIndex) => rowIndex !== index) })}><X size={14} /></button></div>)}</div></section> : <Empty icon={<Users size={27} />} title="Make a cast list" text="Characters become easier to write when they can surprise you." action={<button className="primary-btn" onClick={add}>Add first character</button>} />}</div><CharacterNetwork project={project} /></div>;
}

function CharacterNetwork({ project }: { project: Project }) {
  const materialFor = (character: Character) => project.scenes.map((scene) => `${scene.title}\n${scene.synopsis}\n${stripHtml(scene.content)}\n${scene.notes}\n${scene.pov}`).concat(project.plots.map((plot) => `${plot.name}\n${plot.characters}\n${plot.description}\n${plot.notes}`)).join("\n");
  const mentionCount = (character: Character) => {
    const material = materialFor(character);
    const escaped = character.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped ? (material.match(new RegExp(`\\b${escaped}\\b`, "gi"))?.length ?? 0) : 0;
  };
  const mentions = new Map(project.characters.map((character) => [character.id, mentionCount(character)]));
  const edges = project.characters.flatMap((left, leftIndex) => project.characters.slice(leftIndex + 1).flatMap((right) => {
    const sharedScenes = project.scenes.filter((scene) => {
      const material = `${scene.title}\n${scene.synopsis}\n${stripHtml(scene.content)}\n${scene.notes}\n${scene.pov}`;
      return new RegExp(`\\b${left.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(material)
        && new RegExp(`\\b${right.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(material);
    });
    const sharedPlots = project.plots.filter((plot) => {
      const material = `${plot.characters}\n${plot.description}\n${plot.notes}`;
      return material.toLowerCase().includes(left.name.toLowerCase()) && material.toLowerCase().includes(right.name.toLowerCase());
    });
    const strength = sharedScenes.length + sharedPlots.length;
    return strength ? [{ left, right, strength, detail: `${sharedScenes.length} shared scene${sharedScenes.length === 1 ? "" : "s"}${sharedPlots.length ? ` · ${sharedPlots.length} plot thread${sharedPlots.length === 1 ? "" : "s"}` : ""}` }] : [];
  }));
  const orphaned = project.characters.filter((character) => !mentions.get(character.id));
  return <section className="paper-card character-network"><div className="card-heading"><div><span className="eyebrow"><Users size={13} /> RELATIONSHIP WEB</span><h2>See who the story keeps together.</h2><p>Connections are inferred locally from shared scene and plot mentions. They are signals, not canon.</p></div><div className="network-count"><b>{edges.length}</b><span>connections</span></div></div>{orphaned.length > 0 && <div className="orphan-warning"><AlertTriangle size={15} /><span><b>{orphaned.length} character{orphaned.length === 1 ? "" : "s"} may be orphaned:</b> {orphaned.map((character) => character.name).join(", ")} has no matching mention in a scene or plot thread yet.</span></div>}<div className="network-content"><div className="network-nodes">{project.characters.map((character) => <div className={`network-node ${mentions.get(character.id) ? "" : "unmentioned"}`} key={character.id}><span className="person-dot" style={{ background: character.color }}>{character.name.slice(0, 1)}</span><span><b>{character.name}</b><small>{mentions.get(character.id) ?? 0} mention{mentions.get(character.id) === 1 ? "" : "s"}</small></span></div>)}</div>{edges.length ? <div className="relationship-list">{edges.map((edge) => <div className="relationship-row" key={`${edge.left.id}-${edge.right.id}`}><span className="relationship-people"><b>{edge.left.name}</b><span>↔</span><b>{edge.right.name}</b></span><small>{edge.detail} · {edge.strength} signal{edge.strength === 1 ? "" : "s"}</small></div>)}</div> : <div className="panel-empty">Shared scene and plot connections will appear as the draft gains names.</div>}</div></section>;
}

function Plots({ project, update, notify }: { project: Project; update: (patch: Partial<Project>) => void; notify: (message: string) => void }) { const [selected, setSelected] = useState<string | null>(project.plots[0]?.id ?? null); const current = project.plots.find((plot) => plot.id === selected); const patch = (value: Partial<Plot>) => current && update({ plots: project.plots.map((plot) => plot.id === current.id ? { ...plot, ...value } : plot) }); const add = () => { const plot: Plot = { id: uid(), name: "New plot thread", role: "Subplot", status: "Seeded", description: "", notes: "", steps: [], characters: "" }; update({ plots: [...project.plots, plot] }); setSelected(plot.id); }; return <div className="page"><PageHeader eyebrow="STORY ARCHITECTURE" title="Plots" description="See the threads beneath the scenes. Keep momentum without flattening the mystery." guide="Plot threads reveal the pressure moving underneath each scene." action={<button className="primary-btn" onClick={add}><Plus size={15} /> Add plot</button>} /><div className="plot-split"><div className="plot-panel"><div className="list-toolbar"><span>{project.plots.length} threads</span><Search size={15} /></div>{project.plots.map((plot) => <button className={`list-row ${selected === plot.id ? "selected" : ""}`} key={plot.id} onClick={() => setSelected(plot.id)}><span className="plot-card-mark"><Sparkles size={14} /></span><span><b>{plot.name}</b><small>{plot.role} · {plot.status}</small></span><ChevronDown size={14} /></button>)}<button className="add-dashed" onClick={add}><Plus size={18} /><span>Add a thread</span></button></div>{current ? <section className="paper-card plot-editor"><div className="detail-heading"><div><span className="eyebrow">THREAD NOTES</span><h2>{current.name}</h2></div><button className="danger-icon" onClick={() => { update({ plots: project.plots.filter((plot) => plot.id !== current.id) }); setSelected(null); notify("Plot deleted"); }}><Trash2 size={16} /></button></div><div className="two-fields"><TextField label="Plot name" value={current.name} onChange={(value) => patch({ name: value })} /><label className="field"><span>Status</span><select value={current.status} onChange={(event) => patch({ status: event.target.value })}>{["Seeded", "Developing", "Climax", "Resolved", "On hold"].map((value) => <option key={value}>{value}</option>)}</select></label></div><TextField label="Description" area value={current.description} onChange={(value) => patch({ description: value })} /><div className="steps-section"><div className="inline-heading"><span className="eyebrow">ORDERED STEPS</span><button className="text-btn" onClick={() => patch({ steps: [...current.steps, "New plot step"] })}><Plus size={14} /> Add step</button></div>{current.steps.map((step, index) => <div className="step-row" key={`${step}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><input value={step} onChange={(event) => { const steps = [...current.steps]; steps[index] = event.target.value; patch({ steps }); }} /><button onClick={() => patch({ steps: current.steps.filter((_, rowIndex) => rowIndex !== index) })}><X size={14} /></button></div>)}</div><TextField label="Linked characters" value={current.characters} onChange={(value) => patch({ characters: value })} /><TextField label="Notes" area value={current.notes} onChange={(value) => patch({ notes: value })} /></section> : <Empty icon={<Sparkles size={27} />} title="Make a thread" text="Add a plot thread to see its notes here." action={<button className="primary-btn" onClick={add}>Add first thread</button>} />}</div></div>; }

function World({ project, update, notify }: { project: Project; update: (patch: Partial<Project>) => void; notify: (message: string) => void }) {
  const [selected, setSelected] = useState<string | null>(project.world[0]?.id ?? null); const current = project.world.find((item) => item.id === selected); const kinds = ["Place", "Country", "Culture", "Object", "System", "Institution"]; const patch = (value: Partial<WorldItem>) => current && update({ world: project.world.map((item) => item.id === current.id ? { ...item, ...value } : item) }); const add = (kind = "Place") => { const item: WorldItem = { id: uid(), name: `New ${kind.toLowerCase()}`, kind, description: "", notes: "", fantasy: "", mapUrl: "" }; update({ world: [...project.world, item] }); setSelected(item.id); }; const upload = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file || !current) return; const reader = new FileReader(); reader.onload = () => { patch({ image: String(reader.result), imageName: file.name }); notify("World image added"); }; reader.readAsDataURL(file); };
  return <div className="page"><PageHeader eyebrow="WORLD-BUILDING" title="World" description="Give the setting a clear working surface: place, image, map point, and the fantasy that makes it yours." guide="World holds the places, countries, customs, and impossible details around the story." action={<button className="primary-btn" onClick={() => add()}><Plus size={15} /> Add entry</button>} /><div className="world-categories">{kinds.map((kind, index) => <button key={kind} onClick={() => add(kind)}><span className={`category-icon ci-${index}`}>{kind === "Country" ? <MapPin size={16} /> : <Globe2 size={16} />}</span><span><b>{kind}</b><small>{project.world.filter((item) => item.kind === kind).length} entries</small></span><Plus size={14} /></button>)}</div><div className="split-layout world-split"><div className="list-panel world-list">{project.world.map((item) => <button className={`list-row ${selected === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}><span className="world-symbol">{item.image ? <img src={item.image} alt="" /> : <Globe2 size={15} />}</span><span><b>{item.name}</b><small>{item.kind}</small></span></button>)}{!project.world.length && <div className="panel-empty">Start with a place, country, custom, or impossible object.</div>}</div>{current ? <section className="paper-card detail-card world-detail"><div className="detail-heading"><div><span className="eyebrow">{current.kind.toUpperCase()}</span><h2>{current.name}</h2></div><button className="danger-icon" onClick={() => { update({ world: project.world.filter((item) => item.id !== current.id) }); setSelected(null); notify("World entry deleted"); }}><Trash2 size={16} /></button></div><div className="two-fields"><TextField label="Name" value={current.name} onChange={(value) => patch({ name: value })} /><label className="field"><span>Kind</span><select value={current.kind} onChange={(event) => patch({ kind: event.target.value })}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label></div><div className="world-form-grid"><div className="world-image-upload">{current.image ? <img src={current.image} alt={current.imageName ?? current.name} /> : <div><ImagePlus size={22} /><span>Upload a reference image</span></div>}<label className="secondary-btn"><Upload size={14} /> {current.image ? "Replace image" : "Choose image"}<input type="file" accept="image/*" hidden onChange={upload} /></label></div><div className="map-card"><div className="map-lines" /><MapPin size={20} /><b>Map point</b><span>Pin this country or place with a Google Maps link.</span><input value={current.mapUrl} onChange={(event) => patch({ mapUrl: event.target.value })} placeholder="Paste a Google Maps link or search URL" />{current.mapUrl && <a href={current.mapUrl} target="_blank" rel="noreferrer">Open map point <ArrowRight size={13} /></a>}</div></div><TextField label="Description" area value={current.description} onChange={(value) => patch({ description: value })} placeholder="What can the reader touch, hear, or get lost in?" /><TextField label="Fantasy of this place" area value={current.fantasy} onChange={(value) => patch({ fantasy: value })} placeholder="What makes this country or place impossible to mistake for our world?" /><TextField label="Private notes" area value={current.notes} onChange={(value) => patch({ notes: value })} /></section> : <Empty icon={<Globe2 size={27} />} title="Build the room around the story" text="Places, countries, customs, and systems — start with one specific detail." />}</div></div>;
}

function Outline({ project, update, openEditor, notify }: { project: Project; update: (patch: Partial<Project>) => void; openEditor: (sceneId?: string) => void; notify: (message: string) => void }) { const [query, setQuery] = useState(""); const [filter, setFilter] = useState("All"); const [relationshipSceneId, setRelationshipSceneId] = useState<string | null>(null); const [relationshipResults, setRelationshipResults] = useState<Record<string, SceneRelationship | null>>({}); const scenes = project.scenes.filter((scene) => (filter === "All" || scene.status === filter) && `${scene.title} ${scene.synopsis} ${scene.labels}`.toLowerCase().includes(query.toLowerCase())); const change = (id: string, patch: Partial<Scene>) => update({ scenes: project.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene) }); const add = () => { const scene: Scene = { id: uid(), title: "Untitled scene", synopsis: "", content: "", status: "Idea", compile: true, target: 800, pov: "", labels: "", notes: "", media: [] }; update({ scenes: [...project.scenes, scene] }); notify("Scene added"); }; const move = (index: number, direction: number) => { const actual = project.scenes.findIndex((scene) => scene.id === scenes[index].id); const target = actual + direction; if (target < 0 || target >= project.scenes.length) return; const items = [...project.scenes]; [items[actual], items[target]] = [items[target], items[actual]]; update({ scenes: items }); }; return <div className="page"><PageHeader eyebrow="STRUCTURE" title="Outline" description="A movable map of scenes. Find the shape before you lose yourself in the sentence." guide="Outline is the map of the pages: reorder scenes, then open one to draft." action={<button className="primary-btn" onClick={add}><Plus size={15} /> Add scene</button>} /><div className="outline-tools"><label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search scenes, labels, synopsis" /></label><div className="filter-tabs">{["All", "Idea", "Outline", "Draft", "Revised"].map((value) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value}</button>)}</div><span className="mono-label">{scenes.length} / {project.scenes.length}</span></div><div className="outline-list">{scenes.map((scene, index) => <article className="scene-row" key={scene.id}><div className="scene-number">{String(project.scenes.indexOf(scene) + 1).padStart(2, "0")}</div><div className="scene-main"><div className="scene-title-line"><button className="scene-title" onClick={() => openEditor(scene.id)}>{scene.title}</button><span className={`scene-status status-${scene.status.toLowerCase()}`}>{scene.status}</span>{scene.compile && <span className="compile-check"><Check size={11} /></span>}</div><p>{scene.synopsis || "Add a synopsis to remember what this scene is carrying."}</p><div className="scene-tags">{scene.pov && <span>{scene.pov}</span>}{scene.labels.split(",").filter(Boolean).map((label) => <span key={label}>{label.trim()}</span>)}<span className="target-tag">{scene.target} words</span></div></div><div className="scene-actions"><button onClick={() => move(index, -1)} aria-label="Move scene up"><ArrowLeft size={14} /></button><button onClick={() => move(index, 1)} aria-label="Move scene down"><ArrowRight size={14} /></button><button onClick={() => { update({ scenes: [...project.scenes, { ...scene, id: uid(), title: `${scene.title} copy` }] }); notify("Scene duplicated"); }} aria-label="Duplicate scene"><Copy size={14} /></button><button onClick={() => { update({ scenes: project.scenes.filter((item) => item.id !== scene.id) }); notify("Scene deleted"); }} aria-label="Delete scene"><Trash2 size={14} /></button><button className={`${relationshipSceneId === scene.id ? "toggled" : ""}`} onClick={() => setRelationshipSceneId(relationshipSceneId === scene.id ? null : scene.id)} aria-label="Scene relationships" title="Scene relationships"><Sparkles size={14} /></button></div><div className="scene-quick-edit"><input value={scene.synopsis} onChange={(event) => change(scene.id, { synopsis: event.target.value })} placeholder="Synopsis" /><select value={scene.status} onChange={(event) => change(scene.id, { status: event.target.value })}>{["Idea", "Outline", "Draft", "Revised"].map((value) => <option key={value}>{value}</option>)}</select><label className="compile-toggle"><input type="checkbox" checked={scene.compile} onChange={(event) => change(scene.id, { compile: event.target.checked })} /> Compile</label><button className="edit-scene-btn" onClick={() => openEditor(scene.id)}><PenLine size={13} /> Edit draft</button></div>{relationshipSceneId === scene.id && <div className="scene-relationship-wrap"><SceneRelationshipPanel key={scene.id} project={project} scene={scene} cached={relationshipResults[scene.id]} onCache={(value) => setRelationshipResults((prev) => ({ ...prev, [scene.id]: value }))} /></div>}</article>)}</div>{!scenes.length && <Empty icon={<Search size={27} />} title="Nothing in this view" text="Try another filter, or make a new scene." action={<button className="secondary-btn" onClick={add}>Add scene</button>} />}</div>; }

function LegacyEditor({ project, editorSceneId, update, setView, notify }: { project: Project; editorSceneId: string | null; update: (patch: Partial<Project>) => void; setView: (view: View) => void; notify: (message: string) => void }) {
  const [sceneId, setSceneId] = useState(editorSceneId ?? project.scenes[0]?.id ?? ""); const scene = project.scenes.find((item) => item.id === sceneId) ?? project.scenes[0]; const [content, setContent] = useState(scene?.content ?? ""); const [focus, setFocus] = useState(false); const [settings, setSettings] = useState(false); const [coWritingEnabled, setCoWritingEnabled] = useState(false); const [coWritingSuggestion, setCoWritingSuggestion] = useState<{ content: string; providerId: string; modelId: string; attempted: string[] } | null>(null); const coWritingAbortController = useRef<AbortController | null>(null); const editorRef = useRef<HTMLDivElement>(null); const mediaInput = useRef<HTMLInputElement>(null);
  const coWriting = useMutation({
    mutationFn: (data: Parameters<typeof oracleChat>[0]) => {
      const controller = new AbortController();
      coWritingAbortController.current = controller;
      return oracleChat(data, { signal: controller.signal });
    },
    onSettled: () => {
      coWritingAbortController.current = null;
    },
  });
  useEffect(() => { if (editorSceneId && editorSceneId !== sceneId) setSceneId(editorSceneId); }, [editorSceneId]); useEffect(() => { setContent(scene?.content ?? ""); if (editorRef.current) editorRef.current.innerHTML = scene?.content ?? ""; }, [sceneId]); useEffect(() => { if (!scene || content === scene.content) return; const timer = setTimeout(() => update({ scenes: project.scenes.map((item) => item.id === scene.id ? { ...item, content, status: "Draft" } : item), revisions: [...project.revisions, { id: uid(), sceneId: scene.id, sceneTitle: scene.title, content, date: now(), words: words(content) }] }), 800); return () => clearTimeout(timer); }, [content, sceneId]);
  useEffect(() => { setCoWritingSuggestion(null); coWriting.reset(); setCoWritingEnabled(false); }, [sceneId]);
  const updateScene = (patch: Partial<Scene>) => scene && update({ scenes: project.scenes.map((item) => item.id === scene.id ? { ...item, ...patch } : item) });
  const command = (name: string, value?: string) => { document.execCommand(name, false, value); editorRef.current?.focus(); if (editorRef.current) setContent(editorRef.current.innerHTML); };
  const addMedia = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file || !file.type.startsWith("image/") || !scene) return; const reader = new FileReader(); reader.onload = () => { updateScene({ media: [...(scene.media ?? []), { id: uid(), name: file.name, src: String(reader.result), x: 6, y: 7, size: 180 }] }); notify(`${file.name} added to the page`); event.target.value = ""; }; reader.readAsDataURL(file); };
  const sceneIndex = project.scenes.findIndex((item) => item.id === scene?.id); const go = (index: number) => { const next = project.scenes[index]; if (next) setSceneId(next.id); };
  const save = () => { if (!scene) return; updateScene({ content, status: content.trim() ? "Draft" : scene.status }); update({ revisions: [...project.revisions, { id: uid(), sceneId: scene.id, sceneTitle: scene.title, content, date: now(), words: words(content) }] }); notify("Draft snapshot saved"); };
  const suggestNext = () => {
    if (!scene || !coWritingEnabled || coWriting.isPending) return;
    setCoWritingSuggestion(null);
    coWriting.mutate({
      messages: [
        { role: "system", content: "You are an opt-in fiction co-writing assistant. Suggest one or two sentences that could follow the current ending. Match the passage's point of view and tone, preserve established facts, and do not introduce a new plot twist unless the material strongly supports it. Return only the suggested continuation, with no quotation marks or explanation." },
        { role: "user", content: `Scene synopsis:\n${scene.synopsis || "No synopsis provided."}\n\nCurrent scene ending:\n${stripHtml(content).slice(-5000)}` },
      ],
      context: `Current scene only: ${scene.title}\nSynopsis: ${scene.synopsis}\nEnding: ${stripHtml(content).slice(-5000)}`.slice(0, 6000),
      temperature: 0.55,
    }, { onSuccess: (result) => setCoWritingSuggestion(result) });
  };
  const cancelCoWriting = () => { coWritingAbortController.current?.abort(); coWriting.reset(); setCoWritingSuggestion(null); };
  const acceptCoWriting = () => {
    if (!coWritingSuggestion || !editorRef.current) return;
    const selection = window.getSelection();
    const range = document.createRange();
    const activeRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!activeRange || !editorRef.current.contains(activeRange.commonAncestorContainer)) {
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    document.execCommand("insertText", false, coWritingSuggestion.content);
    editorRef.current.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: coWritingSuggestion.content }));
    setCoWritingSuggestion(null);
    notify("Co-writing suggestion accepted");
  };
  if (!scene) return <div className="page"><Empty icon={<BookOpen size={28} />} title="No scenes yet" text="Add a scene in your outline, then come here to draft." action={<button className="primary-btn" onClick={() => setView("outline")}>Open outline</button>} /></div>;
  return <div className={`editor-page ${focus ? "focus-editor" : ""}`}><PageGuide label="DRAFT" text="Write here with real rich text formatting. Images stay simple, square, movable, and resizable." /><div className="editor-head"><div><div className="eyebrow">DRAFT / SCENE {String(sceneIndex + 1).padStart(2, "0")}</div><input className="editor-title-input" value={scene.title} onChange={(event) => updateScene({ title: event.target.value })} aria-label="Scene title" /></div><div className="editor-head-actions"><span className="save-indicator"><span className="pulse-dot" /> Autosaved</span><button className={`icon-btn ${focus ? "toggled" : ""}`} onClick={() => setFocus(!focus)} aria-label="Toggle focus mode"><PanelLeft size={17} /></button><button className={`icon-btn ${settings ? "toggled" : ""}`} onClick={() => setSettings(!settings)} aria-label="Editor settings"><Settings size={17} /></button></div></div>{!focus && <div className="editor-scene-nav"><button onClick={() => go(sceneIndex - 1)} disabled={sceneIndex <= 0}><ArrowLeft size={14} /> Previous</button><label className="scene-picker"><span>Scene</span><select value={scene.id} onChange={(event) => setSceneId(event.target.value)}>{project.scenes.map((item, index) => <option key={item.id} value={item.id}>{String(index + 1).padStart(2, "0")} · {item.title}</option>)}</select></label><span>{sceneIndex + 1} of {project.scenes.length}</span><button onClick={() => go(sceneIndex + 1)} disabled={sceneIndex >= project.scenes.length - 1}>Next <ArrowRight size={14} /></button></div>}<div className="editor-layout"><div className="editor-column"><div className="format-bar"><button onClick={() => command("undo")} aria-label="Undo"><Undo2 size={16} /></button><button onClick={() => command("redo")} aria-label="Redo"><Redo2 size={16} /></button><span className="bar-divider" /><button onClick={() => command("bold")} aria-label="Bold"><Bold size={16} /></button><button onClick={() => command("italic")} aria-label="Italic"><Italic size={16} /></button><button onClick={() => command("strikeThrough")} aria-label="Strikethrough"><Strikethrough size={16} /></button><button onClick={() => command("formatBlock", "h1")} aria-label="Title heading"><Heading1 size={16} /></button><button onClick={() => command("formatBlock", "h2")} aria-label="Heading"><Heading2 size={16} /></button><button onClick={() => command("insertUnorderedList")} aria-label="Bulleted list"><List size={16} /></button><button onClick={() => command("insertOrderedList")} aria-label="Numbered list"><ListOrdered size={16} /></button><button onClick={() => command("formatBlock", "blockquote")} aria-label="Quote"><Quote size={16} /></button><button onClick={() => { const url = window.prompt("Link URL"); if (url) command("createLink", url); }} aria-label="Link"><Link2 size={16} /></button><button onClick={() => command("removeFormat")} aria-label="Clear formatting"><Eraser size={16} /></button><span className="toolbar-spacer" /><button className="media-import-btn" onClick={() => mediaInput.current?.click()}><ImagePlus size={15} /> Add image</button><input ref={mediaInput} type="file" accept="image/*" hidden onChange={addMedia} /></div><div ref={editorRef} className="draft-area rich-editor" contentEditable suppressContentEditableWarning onKeyDown={(event) => { if (event.key === "Tab" && coWritingSuggestion && coWritingEnabled) { event.preventDefault(); acceptCoWriting(); } if (event.key === "Escape" && coWritingSuggestion) setCoWritingSuggestion(null); }} onInput={(event) => setContent(event.currentTarget.innerHTML)} data-placeholder="Begin where the pressure is..." /><MediaBoard scene={scene} updateScene={updateScene} /><section className="co-writing-bar"><div className="co-writing-top"><label className="co-writing-toggle"><input type="checkbox" checked={coWritingEnabled} onChange={(event) => { setCoWritingEnabled(event.target.checked); setCoWritingSuggestion(null); }} /><span><b>Opt-in co-writing</b><small>Off until you choose it</small></span></label><span className="co-writing-scope"><ShieldCheck size={13} /> Current scene ending only</span></div><div className="co-writing-actions"><button className="secondary-btn" onClick={coWriting.isPending ? cancelCoWriting : suggestNext} disabled={!coWritingEnabled && !coWriting.isPending}>{coWriting.isPending ? <><X size={14} /> Cancel suggestion</> : <><Sparkles size={14} /> Suggest next beat</>}</button><small>One or two sentences · press Tab to accept · Esc to dismiss</small></div>{coWriting.isError && <div className="oracle-error"><X size={14} />The suggestion could not reach a working model. Try again when the provider signal is ready.</div>}{coWritingSuggestion && <div className="co-writing-suggestion"><div><span className="eyebrow">SUGGESTED CONTINUATION</span><p>{coWritingSuggestion.content}</p><OracleRouteMeta providerId={coWritingSuggestion.providerId} modelId={coWritingSuggestion.modelId} attempted={coWritingSuggestion.attempted} /></div><button className="primary-btn" onClick={acceptCoWriting}><Check size={14} /> Accept <kbd>Tab</kbd></button></div>}</section></div>{settings && <aside className="editor-settings"><span className="eyebrow">DESK SETTINGS</span><h3>Reading room</h3><label className="field"><span>Typeface</span><select><option>Libre Baskerville</option><option>DM Sans</option><option>DM Mono</option></select></label><label className="field"><span>Text size</span><input type="range" min="15" max="28" defaultValue="19" /></label><label className="field"><span>Line spacing</span><input type="range" min="1.3" max="2.2" step=".1" defaultValue="1.8" /></label></aside>}</div><div className="editor-footer"><span><b>{words(content)}</b> words</span><span><b>{stripHtml(content).length}</b> characters</span><span><b>{stripHtml(content).split(/\n/).filter(Boolean).length}</b> paragraphs</span><span className="footer-spacer" /><button onClick={save}><Save size={14} /> Save snapshot</button></div></div>;
}

function Editor({ project, editorSceneId, update, setView, notify, exportFile }: { project: Project; editorSceneId: string | null; update: (patch: Partial<Project>) => void; setView: (view: View) => void; notify: (message: string) => void; exportFile: (format: ExportFormat) => void }) {
  const [sceneId, setSceneId] = useState(editorSceneId ?? project.scenes[0]?.id ?? "");
  const scene = project.scenes.find((item) => item.id === sceneId) ?? project.scenes[0];
  const [content, setContent] = useState(scene?.content ?? "");
  const [focus, setFocus] = useState(false);
  const [typeface, setTypeface] = useState("Libre Baskerville");
  const [textSize, setTextSize] = useState(20);
  const [lineSpacing, setLineSpacing] = useState(1.9);
  const [coWritingEnabled, setCoWritingEnabled] = useState(false);
  const [coWritingDirection, setCoWritingDirection] = useState("");
  const [coWritingSuggestion, setCoWritingSuggestion] = useState<{ content: string; providerId: string; modelId: string; attempted: string[] } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const sceneIndex = project.scenes.findIndex((item) => item.id === scene?.id);
  const coWriting = useMutation({
    mutationFn: (data: Parameters<typeof oracleChat>[0]) => oracleChat(data),
  });
  // Tone-rewrite floating trigger + modal (replaces the old inline TONE REWRITE section).
  const [rewriteAnchor, setRewriteAnchor] = useState<{ top: number; left: number } | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteText, setRewriteText] = useState("");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewriteReferenceId, setRewriteReferenceId] = useState(() => project.scenes.find((item) => words(item.content) > 0)?.id ?? project.scenes[0]?.id ?? "");
  const [rewriteOptions, setRewriteOptions] = useState<{ tone: string; content: string }[] | null>(null);
  const [rewritePending, setRewritePending] = useState(false);
  const [rewriteError, setRewriteError] = useState(false);
  const selectionRangeRef = useRef<Range | null>(null);
  const rewriteAbort = useRef<AbortController | null>(null);
  // Export dropdown in the toolbar.
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (event: Event) => { if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) setExportOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [exportOpen]);

  useEffect(() => {
    if (editorSceneId && editorSceneId !== sceneId) setSceneId(editorSceneId);
  }, [editorSceneId, sceneId]);

  // Only re-sync the DOM when the scene changes. Re-syncing on `scene?.content`
  // re-assigned innerHTML after every autosave, which reset the caret to the
  // start of the page while typing.
  useEffect(() => {
    setContent(scene?.content ?? "");
    if (editorRef.current) editorRef.current.innerHTML = scene?.content ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  useEffect(() => {
    if (!scene || content === scene.content) return;
    const timer = setTimeout(() => update({
      scenes: project.scenes.map((item) => item.id === scene.id ? { ...item, content, status: "Draft" } : item),
      revisions: [...project.revisions, { id: uid(), sceneId: scene.id, sceneTitle: scene.title, content, date: now(), words: words(content) }],
    }), 800);
    return () => clearTimeout(timer);
  }, [content, sceneId, project, update]);

  useEffect(() => {
    setCoWritingSuggestion(null);
    coWriting.reset();
    setCoWritingEnabled(false);
  }, [sceneId]);

  // Track a live selection inside the rich editor so the floating TONE REWRITE
  // trigger can appear above the highlighted text.
  useEffect(() => {
    const capture = () => {
      if (rewriteOpen) return;
      refreshFormatState();
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const editor = range?.commonAncestorContainer.parentElement?.closest(".rich-editor");
      if (!range || !editor || !selection?.toString().trim()) {
        setRewriteAnchor(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setRewriteAnchor(null);
        return;
      }
      selectionRangeRef.current = range.cloneRange();
      setRewriteAnchor({ top: rect.top, left: rect.left + rect.width / 2 });
    };
    document.addEventListener("selectionchange", capture);
    document.addEventListener("mouseup", capture);
    document.addEventListener("keyup", capture);
    return () => {
      document.removeEventListener("selectionchange", capture);
      document.removeEventListener("mouseup", capture);
      document.removeEventListener("keyup", capture);
    };
  }, [rewriteOpen]);

  const updateScene = (patch: Partial<Scene>) => {
    if (scene) update({ scenes: project.scenes.map((item) => item.id === scene.id ? { ...item, ...patch } : item) });
  };
  const command = (name: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, value);
    if (editorRef.current) setContent(editorRef.current.innerHTML);
    refreshFormatState();
  };
  // Keep focus + selection inside the editor while clicking toolbar buttons;
  // otherwise execCommand silently no-ops on the lost selection.
  const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();
  // Track which formatting commands are active at the caret so the toolbar
  // buttons highlight (e.g. Bold stays lit while the cursor is inside bold text).
  const [formatState, setFormatState] = useState({ bold: false, italic: false, strike: false, h1: false, h2: false, ul: false, ol: false, quote: false });
  const refreshFormatState = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.anchorNode || !editor.contains(selection.anchorNode)) return;
    const block = String(document.queryCommandValue("formatBlock") ?? "").toLowerCase();
    setFormatState({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      strike: document.queryCommandState("strikeThrough"),
      h1: block === "h1",
      h2: block === "h2",
      ul: document.queryCommandState("insertUnorderedList"),
      ol: document.queryCommandState("insertOrderedList"),
      quote: block === "blockquote",
    });
  };
  const addMedia = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/") || !scene) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateScene({ media: [...(scene.media ?? []), { id: uid(), name: file.name, src: String(reader.result), x: 6, y: 7, size: 180 }] });
      notify(`${file.name} added to the page`);
      event.target.value = "";
    };
    reader.readAsDataURL(file);
  };
  const go = (index: number) => {
    const next = project.scenes[index];
    if (next) setSceneId(next.id);
  };
  const save = () => {
    if (!scene) return;
    updateScene({ content, status: content.trim() ? "Draft" : scene.status });
    update({ revisions: [...project.revisions, { id: uid(), sceneId: scene.id, sceneTitle: scene.title, content, date: now(), words: words(content) }] });
    notify("Draft snapshot saved");
  };
  const suggestNext = () => {
    if (!scene || !coWritingEnabled || coWriting.isPending) return;
    setCoWritingSuggestion(null);
    const direction = coWritingDirection.trim();
    coWriting.mutate({
      messages: [
        { role: "system", content: "You are an opt-in fiction co-writing assistant. Suggest one or two sentences that could follow the current ending. Match the passage's point of view and tone, preserve established facts, and return only the suggested continuation." },
        { role: "user", content: `Scene synopsis:\n${scene.synopsis || "No synopsis provided."}${direction ? `\n\nOptional direction from the author:\n${direction}` : ""}\n\nCurrent scene ending:\n${stripHtml(content).slice(-5000)}` },
      ],
      context: `Current scene only: ${scene.title}\nSynopsis: ${scene.synopsis}${direction ? `\nAuthor direction: ${direction}` : ""}\nEnding: ${stripHtml(content).slice(-5000)}`.slice(0, 6000),
      temperature: 0.55,
    }, { onSuccess: (result) => setCoWritingSuggestion(result) });
  };
  const acceptCoWriting = () => {
    if (!coWritingSuggestion || !editorRef.current) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editorRef.current);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("insertText", false, coWritingSuggestion.content);
    editorRef.current.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: coWritingSuggestion.content }));
    setCoWritingSuggestion(null);
    notify("Co-writing suggestion accepted");
  };
  const openRewrite = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim().slice(0, 4000) ?? "";
    if (!text || !selectionRangeRef.current) return;
    setRewriteText(text);
    setRewriteOpen(true);
    setRewriteAnchor(null);
  };
  const closeRewrite = () => {
    rewriteAbort.current?.abort();
    rewriteAbort.current = null;
    setRewriteOpen(false);
    setRewriteOptions(null);
    setRewriteError(false);
    setRewritePending(false);
    setRewriteInstruction("");
    setRewriteAnchor(null);
    selectionRangeRef.current = null;
  };
  const generateRewrites = () => {
    if (!rewriteText.trim() || rewritePending) return;
    setRewriteOptions(null);
    setRewriteError(false);
    const referenceScene = project.scenes.find((item) => item.id === rewriteReferenceId);
    const controller = new AbortController();
    rewriteAbort.current = controller;
    setRewritePending(true);
    oracleChat({
      messages: [
        { role: "system", content: "You are a fiction tone-rewrite assistant. Rewrite the user's selected passage in three clearly distinct tones, following the voice reference and optional direction. Return ONLY a JSON array with exactly 3 objects, each shaped {\"tone\": \"short tone name\", \"content\": \"the rewritten passage\"}. No markdown fences, no commentary." },
        { role: "user", content: `Passage:\n${rewriteText}\n\nVoice reference:\n${stripHtml(referenceScene?.content ?? "").slice(0, 6000)}\n\nOptional direction:\n${rewriteInstruction.trim() || "none"}` },
      ],
      context: `Tone rewrite. Passage (${rewriteText.length} chars). Voice reference: ${referenceScene?.title ?? "none"}. Direction: ${rewriteInstruction.trim() || "none"}.`,
      temperature: 0.8,
    }, { signal: controller.signal }).then((result) => {
      const parsed = (() => {
        try {
          const raw = result.content.replace(/```json|```/g, "").trim();
          const start = raw.indexOf("[");
          const end = raw.lastIndexOf("]");
          const arr = JSON.parse(raw.slice(start, end + 1));
          if (!Array.isArray(arr)) return null;
          return arr.filter((item) => item && typeof item.content === "string").map((item) => ({ tone: String(item.tone ?? "Rewrite"), content: String(item.content) })).slice(0, 3);
        } catch { return null; }
      })();
      if (parsed && parsed.length) setRewriteOptions(parsed);
      else setRewriteError(true);
    }).catch(() => { if (!controller.signal.aborted) setRewriteError(true); }).finally(() => { rewriteAbort.current = null; setRewritePending(false); });
  };
  const applyRewrite = (content: string) => {
    if (!selectionRangeRef.current || !editorRef.current) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectionRangeRef.current);
    document.execCommand("insertText", false, content);
    editorRef.current.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: content }));
    closeRewrite();
    notify("Tone rewrite applied to the draft");
  };
  if (!scene) return <div className="page"><Empty icon={<BookOpen size={28} />} title="No scenes yet" text="Add a scene in your outline, then come here to draft." action={<button className="primary-btn" onClick={() => setView("outline")}>Open outline</button>} /></div>;

  const editorStyle = {
    "--draft-font-family": typeface,
    "--draft-text-size": `${textSize}px`,
    "--draft-line-height": lineSpacing,
  } as CSSProperties;

  return <div className={`editor-page ${focus ? "focus-editor" : ""}`}>
    {!focus && <PageGuide label="DRAFT" text="Write here with real rich text formatting. Images stay simple, square, movable, and resizable." />}
    {!focus && <div className="editor-head"><div className="editor-head-left"><div className="eyebrow editor-scene-eyebrow">DRAFT / SCENE {String(sceneIndex + 1).padStart(2, "0")}<label className="scene-picker scene-picker-inline"><span>Scene</span><select value={scene.id} onChange={(event) => setSceneId(event.target.value)} aria-label="Current scene">{project.scenes.map((item, index) => <option key={item.id} value={item.id}>{String(index + 1).padStart(2, "0")} · {item.title}</option>)}</select></label></div><div className="editor-title-row"><input className="editor-title-input" value={scene.title} onChange={(event) => updateScene({ title: event.target.value })} aria-label="Scene title" /><span className="scene-counter">{sceneIndex + 1} of {project.scenes.length}</span></div></div><div className="editor-head-center"><button className="lock-mode-btn" onClick={() => setFocus(true)} aria-label="Enter lock mode"><LockOpen size={18} /><span>Enter Lock Mode</span></button></div><div className="editor-head-actions"><div className="export-menu-wrap" ref={exportMenuRef}><button className={`export-trigger head-export-trigger ${exportOpen ? "toggled" : ""}`} onClick={() => setExportOpen((open) => !open)} aria-label="Export manuscript"><Download size={15} /> Export</button>{exportOpen && <div className="export-menu"><div className="export-menu-head"><span>EXPORT</span><button onClick={() => setExportOpen(false)} aria-label="Close export menu"><X size={14} /></button></div>{exportOptions.map((option) => <button key={option.format} onClick={() => { setExportOpen(false); exportFile(option.format); }}>{option.icon}{option.label}</button>)}</div>}</div></div></div>}
    {focus && <button className="focus-exit" onClick={() => setFocus(false)} aria-label="Exit lock mode"><Lock size={20} /><span>Exit Lock Mode</span></button>}
    <div className="editor-layout"><button className="scene-side-nav scene-side-prev" onClick={() => go(sceneIndex - 1)} disabled={sceneIndex <= 0} aria-label="Previous scene"><ArrowLeft size={18} /></button><div className="editor-column" style={editorStyle}>
      {!focus && <section className="co-writing-bar"><div className="co-writing-top"><div className="co-writing-controls"><label className="co-writing-toggle"><input type="checkbox" checked={coWritingEnabled} onChange={(event) => { setCoWritingEnabled(event.target.checked); setCoWritingSuggestion(null); }} /><span><b>Opt-in co-writing</b></span></label><label className="co-writing-direction"><span>Optional direction</span><input value={coWritingDirection} onChange={(event) => setCoWritingDirection(event.target.value.slice(0, 300))} placeholder="e.g. keep it quiet, more sensory" /></label></div><div className="co-writing-actions"><button className="secondary-btn" onClick={coWriting.isPending ? () => { coWriting.reset(); setCoWritingSuggestion(null); } : suggestNext} disabled={!coWritingEnabled && !coWriting.isPending}>{coWriting.isPending ? <><X size={14} /> Cancel suggestion</> : <><Sparkles size={14} /> Suggest next beat</>}</button></div></div>{coWriting.isError && <div className="oracle-error"><X size={14} /> The suggestion could not reach a working model. Try again when the provider signal is ready.</div>}{coWritingSuggestion && <div className="co-writing-suggestion"><div><span className="eyebrow">SUGGESTED CONTINUATION</span><p>{coWritingSuggestion.content}</p></div><button className="primary-btn" onClick={acceptCoWriting}><Check size={14} /> Accept <kbd>Tab</kbd></button></div>}</section>}
      <div className="format-bar"><button onMouseDown={keepSelection} onClick={() => command("undo")} aria-label="Undo"><Undo2 size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("redo")} aria-label="Redo"><Redo2 size={16} /></button><span className="bar-divider" /><button onMouseDown={keepSelection} onClick={() => command("bold")} aria-label="Bold" className={formatState.bold ? "toggled" : ""}><Bold size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("italic")} aria-label="Italic" className={formatState.italic ? "toggled" : ""}><Italic size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("strikeThrough")} aria-label="Strikethrough" className={formatState.strike ? "toggled" : ""}><Strikethrough size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("formatBlock", "h1")} aria-label="Title heading" className={formatState.h1 ? "toggled" : ""}><Heading1 size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("formatBlock", "h2")} aria-label="Heading" className={formatState.h2 ? "toggled" : ""}><Heading2 size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("insertUnorderedList")} aria-label="Bulleted list" className={formatState.ul ? "toggled" : ""}><List size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("insertOrderedList")} aria-label="Numbered list" className={formatState.ol ? "toggled" : ""}><ListOrdered size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("formatBlock", "blockquote")} aria-label="Quote" className={formatState.quote ? "toggled" : ""}><Quote size={16} /></button><button onMouseDown={keepSelection} onClick={() => { const url = window.prompt("Link URL"); if (url) command("createLink", url); }} aria-label="Link"><Link2 size={16} /></button><button onMouseDown={keepSelection} onClick={() => command("removeFormat")} aria-label="Clear formatting"><Eraser size={16} /></button><span className="bar-divider" /><label className="toolbar-setting toolbar-typeface"><Type size={13} /><select value={typeface} onChange={(event) => setTypeface(event.target.value)} aria-label="Typeface"><option>Libre Baskerville</option><option>DM Sans</option><option>DM Mono</option></select></label><label className="toolbar-setting" title={`Text size · ${textSize}px`}><span className="toolbar-setting-label">Aa</span><input type="range" min="15" max="28" value={textSize} onChange={(event) => setTextSize(Number(event.target.value))} aria-label="Text size" /><em>{textSize}px</em></label><label className="toolbar-setting" title={`Line spacing · ${lineSpacing}`}><span className="toolbar-setting-label">≡</span><input type="range" min="1.3" max="2.2" step=".1" value={lineSpacing} onChange={(event) => setLineSpacing(Number(event.target.value))} aria-label="Line spacing" /><em>{lineSpacing}</em></label><span className="toolbar-spacer" /><button className="media-import-btn" onMouseDown={keepSelection} onClick={() => mediaInput.current?.click()} aria-label="Add image"><ImagePlus size={15} /> Add image</button><input ref={mediaInput} type="file" accept="image/*" hidden onChange={addMedia} /></div>
      <div ref={editorRef} className="draft-area rich-editor" contentEditable suppressContentEditableWarning onKeyDown={(event) => { if (event.key === "Tab" && coWritingSuggestion && coWritingEnabled) { event.preventDefault(); acceptCoWriting(); } if (event.key === "Escape" && coWritingSuggestion) setCoWritingSuggestion(null); }} onInput={(event) => setContent(event.currentTarget.innerHTML)} data-placeholder="Begin where the pressure is..." />
      <MediaBoard scene={scene} updateScene={updateScene} />
    </div><button className="scene-side-nav scene-side-next" onClick={() => go(sceneIndex + 1)} disabled={sceneIndex >= project.scenes.length - 1} aria-label="Next scene"><ArrowRight size={18} /></button></div>
    {!focus && <div className="editor-footer"><span><b>{words(content)}</b> words</span><span><b>{stripHtml(content).length}</b> characters</span><span><b>{stripHtml(content).split(/\n/).filter(Boolean).length}</b> paragraphs</span><span className="footer-spacer" /><button onClick={save}><Save size={14} /> Save snapshot</button></div>}
    {rewriteAnchor && !rewriteOpen && <button className="tone-rewrite-float" style={{ top: Math.max(120, rewriteAnchor.top - 50), left: rewriteAnchor.left }} onMouseDown={(event) => event.preventDefault()} onClick={openRewrite} aria-label="Tone rewrite"><span className="tone-rewrite-float-icon"><PenLine size={13} /><Sparkles size={9} className="tone-rewrite-float-spark" /></span> TONE REWRITE</button>}
    {rewriteOpen && <div className="modal-backdrop" onMouseDown={closeRewrite}><div className="modal tone-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true"><button className="modal-close" onClick={closeRewrite} aria-label="Close"><X size={17} /></button><span className="eyebrow"><PenLine size={12} /> TONE REWRITE</span><h2>Rephrase the selection.</h2><p>Three tonal options, generated from your voice reference. Pick the one to replace the highlighted text.</p><label className="field"><span>Optional direction</span><input value={rewriteInstruction} onChange={(event) => setRewriteInstruction(event.target.value.slice(0, 500))} placeholder="e.g. quieter, more tactile, keep the sentence length" /></label><label className="field"><span>Voice reference</span><select value={rewriteReferenceId} onChange={(event) => setRewriteReferenceId(event.target.value)} disabled={!project.scenes.length}>{project.scenes.map((item) => <option key={item.id} value={item.id}>{item.title}{item.id === scene?.id ? " · current" : ""}</option>)}</select></label><button className="primary-btn tone-run-btn" onClick={rewritePending ? () => { rewriteAbort.current?.abort(); rewriteAbort.current = null; setRewritePending(false); setRewriteError(false); } : generateRewrites} disabled={!rewriteText.trim() && !rewritePending}>{rewritePending ? <><X size={15} /> Cancel</> : <><WandSparkles size={15} /> Rephrase</>}</button><div className="oracle-footnote"><span><ShieldCheck size={13} /> Sends only the selected passage and up to 6,000 characters of one voice reference</span></div>{rewriteError && !rewritePending && <div className="oracle-error"><X size={14} /> The rewrite could not reach a working model. Try again when the provider signal is ready.</div>}{rewriteOptions && <div className="tone-options">{rewriteOptions.map((option, index) => <button className="tone-option" key={`${option.tone}-${index}`} onClick={() => applyRewrite(option.content)}><b>{option.tone}</b><p>{option.content}</p><span>Use this <Check size={13} /></span></button>)}</div>}</div></div>}
  </div>;
}

type SceneRelationship = { summary: string; characterIds: string[]; worldIds: string[]; plotIds: string[] };

// AI scene-relationship summary shared between the draft RECAP panel and the
// outline: what the scene does, how it connects to the cast, world, and plot
// pages, plus separate rows for the characters, worlds, and plots present.
// `cached`/`onCache` let a parent (the outline) keep results per scene so
// re-expanding a scene shows the summary instantly instead of re-asking the AI.
function SceneRelationshipPanel({ project, scene, autoRun = true, cached, onCache }: {
  project: Project;
  scene?: Scene;
  autoRun?: boolean;
  cached?: SceneRelationship | null;
  onCache?: (value: SceneRelationship | null) => void;
}) {
  const sceneAbortController = useRef<AbortController | null>(null);
  const sceneContextRanForRef = useRef<string | null>(null);
  const [sceneContext, setSceneContext] = useState<SceneRelationship | null>(cached ?? null);
  const [sceneContextError, setSceneContextError] = useState(false);
  const sceneContextMutation = useMutation({
    mutationFn: (data: Parameters<typeof oracleChat>[0]) => {
      const controller = new AbortController();
      sceneAbortController.current = controller;
      return oracleChat(data, { signal: controller.signal });
    },
    onSettled: () => { sceneAbortController.current = null; },
  });
  // Local name-matching fills the presence rows instantly and doubles as the
  // fallback when the model is unreachable; the AI pass refines both summary
  // and presence together against the character, world, and plot pages.
  const localPresence = useMemo(() => {
    if (!scene) return { characterIds: [] as string[], worldIds: [] as string[], plotIds: [] as string[] };
    const material = `${scene.title}\n${scene.synopsis}\n${stripHtml(scene.content)}\n${scene.pov}\n${scene.labels}\n${scene.notes}`.toLowerCase();
    const matches = (name: string) => Boolean(name) && material.includes(name.toLowerCase());
    return {
      characterIds: project.characters.filter((character) => matches(character.name)).map((character) => character.id),
      worldIds: project.world.filter((item) => matches(item.name)).map((item) => item.id),
      plotIds: project.plots.filter((plot) => matches(plot.name) || matches(plot.characters)).map((plot) => plot.id),
    };
  }, [project.characters, project.world, project.plots, scene]);
  const runSceneContext = (target: Scene) => {
    if (!target || sceneContextMutation.isPending) return;
    setSceneContextError(false);
    setSceneContext(null);
    const chapterSoFar = project.scenes
      .filter((item) => project.scenes.indexOf(item) <= project.scenes.indexOf(target))
      .map((item) => `${item.title}${item.synopsis ? ` — ${item.synopsis}` : ""}\n${stripHtml(item.content).slice(0, 900)}`)
      .join("\n\n");
    const cast = project.characters.map((character) => `${character.name} (${character.role}): ${character.description}`).join("\n");
    const world = project.world.map((item) => `${item.name} (${item.kind}): ${item.description}`).join("\n");
    const plots = project.plots.map((plot) => `${plot.name} (${plot.role}): ${plot.description}`).join("\n");
    const context = `Project: ${project.title}\nPremise: ${project.premise}\n\nCharacters (from the character page):\n${cast}\n\nWorld entries (from the world page):\n${world}\n\nPlot threads (from the plot page):\n${plots}\n\nScene to analyze:\n${target.title}\nSynopsis: ${target.synopsis}\nScene text:\n${stripHtml(target.content).slice(0, 5000)}\n\nChapter so far — this scene and everything before it:\n${chapterSoFar}`.slice(0, 14000);
    sceneContextMutation.mutate({
      messages: [
        { role: "system", content: `You are a story-continuity analyst. Analyze the given scene and return ONLY a JSON object (no markdown fences, no commentary) shaped exactly like:\n{\n  "summary": "A precise, direct relationship summary: what this scene does, how it connects to the project's characters, world entries, and plot threads, and where it leaves the chapter so far. 2-4 concrete sentences, no hedging.",\n  "characterIds": ["<character id>", ...],\n  "worldIds": ["<world id>", ...],\n  "plotIds": ["<plot id>", ...]\n}\nUse ONLY ids from the provided lists. Include an id only when that person, place, or thread is actually present in or clearly driving this scene. Never invent ids or names.` },
        { role: "user", content: `Analyze the scene against the project's character, world, and plot pages. Return the JSON object only.` },
      ],
      context,
      temperature: 0.3,
    }, {
      onSuccess: (result) => {
        const value: SceneRelationship = (() => {
          try {
            const raw = result.content.replace(/```json|```/g, "").trim();
            const start = raw.indexOf("{");
            const end = raw.lastIndexOf("}");
            const parsed = JSON.parse(raw.slice(start, end + 1));
            const valid = (ids: unknown): string[] => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
            const characterIds = valid(parsed.characterIds).filter((id) => project.characters.some((character) => character.id === id));
            const worldIds = valid(parsed.worldIds).filter((id) => project.world.some((item) => item.id === id));
            const plotIds = valid(parsed.plotIds).filter((id) => project.plots.some((plot) => plot.id === id));
            return {
              summary: String(parsed.summary ?? "").trim(),
              characterIds: characterIds.length ? characterIds : localPresence.characterIds,
              worldIds: worldIds.length ? worldIds : localPresence.worldIds,
              plotIds: plotIds.length ? plotIds : localPresence.plotIds,
            };
          } catch {
            return { summary: result.content, characterIds: localPresence.characterIds, worldIds: localPresence.worldIds, plotIds: localPresence.plotIds };
          }
        })();
        setSceneContext(value);
        onCache?.(value);
      },
      onError: () => setSceneContextError(true),
    });
  };
  // Refresh the relationship summary when the scene changes, or adopt a cached
  // result (outline re-expansion) without asking the model again.
  useEffect(() => {
    if (cached) {
      setSceneContext(cached);
      setSceneContextError(false);
      return;
    }
    setSceneContext(null);
    setSceneContextError(false);
    if (!scene || !autoRun) return;
    if (sceneContextRanForRef.current === scene.id) return;
    sceneContextRanForRef.current = scene.id;
    const timer = setTimeout(() => runSceneContext(scene), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, cached, autoRun]);
  if (!scene) {
    return <div className="tone-scene-context"><div className="tone-scene-context-head"><span className="eyebrow">SCENE RELATIONSHIP</span></div><div className="tone-presence-empty">Select a scene to see its connections to your cast, world, and plot pages.</div></div>;
  }
  const charactersPresent = (sceneContext ? sceneContext.characterIds : localPresence.characterIds)
    .map((id) => project.characters.find((character) => character.id === id))
    .filter((character): character is Character => Boolean(character));
  const worldsPresent = (sceneContext ? sceneContext.worldIds : localPresence.worldIds)
    .map((id) => project.world.find((item) => item.id === id))
    .filter((item): item is WorldItem => Boolean(item));
  const plotsPresent = (sceneContext ? sceneContext.plotIds : localPresence.plotIds)
    .map((id) => project.plots.find((plot) => plot.id === id))
    .filter((plot): plot is Plot => Boolean(plot));
  return <div className="tone-scene-context">
    <div className="tone-scene-context-head"><span className="eyebrow">SCENE RELATIONSHIP</span><button className="text-btn" onClick={() => runSceneContext(scene)} disabled={sceneContextMutation.isPending}><RefreshCw size={13} className={sceneContextMutation.isPending ? "spin" : ""} /> Latest RECAP</button></div>
    {sceneContextMutation.isPending && !sceneContext && <div className="tone-scene-loading"><RefreshCw size={15} className="spin" /> Reading this scene against your cast, world, and plot pages…</div>}
    {sceneContextError && !sceneContext && <div className="oracle-error"><X size={14} /> The scene summary could not reach a working model — showing locally detected connections.</div>}
    {sceneContext?.summary && <p className="tone-scene-summary">{sceneContext.summary}</p>}
    <div className="tone-presence">
      <div className="tone-presence-row"><span className="tone-presence-label"><Users size={13} /> Characters in this scene</span><div className="tone-presence-items">{charactersPresent.length ? charactersPresent.map((character) => <span className="tone-presence-chip" key={character.id} title={character.description}><span className="person-dot" style={{ background: character.color }}>{character.name.slice(0, 1)}</span>{character.name}</span>) : <span className="tone-presence-empty">None detected</span>}</div></div>
      <div className="tone-presence-row"><span className="tone-presence-label"><Globe2 size={13} /> Worlds in this scene</span><div className="tone-presence-items">{worldsPresent.length ? worldsPresent.map((item) => <span className="tone-presence-chip" key={item.id} title={item.description}>{item.name}<small>{item.kind}</small></span>) : <span className="tone-presence-empty">None detected</span>}</div></div>
      <div className="tone-presence-row"><span className="tone-presence-label"><Sparkles size={13} /> Plots in this scene</span><div className="tone-presence-items">{plotsPresent.length ? plotsPresent.map((plot) => <span className="tone-presence-chip" key={plot.id} title={plot.description}>{plot.name}<small>{plot.role}</small></span>) : <span className="tone-presence-empty">None detected</span>}</div></div>
    </div>
    <div className="oracle-footnote"><span><ShieldCheck size={13} /> Uses this scene, the chapter so far, and the cast, world, and plot pages · capped at 14,000 characters</span></div>
  </div>;
}

function ToneRewritePanel({ project, sceneId }: { project: Project; sceneId: string | null }) {
  const currentScene = project.scenes.find((scene) => scene.id === sceneId) ?? project.scenes[0];
  return <section className="tone-rewrite-shell">
    <div className="paper-card tone-rewrite-panel">
      <div className="card-heading tone-rewrite-heading">
        <div><span className="eyebrow"><WandSparkles size={13} /> RECAP</span><h2>See the scene's connections.</h2><p>The relationship between this scene and the cast, world, and plot threads you set up in your project pages.</p></div>
      </div>
      <SceneRelationshipPanel project={project} scene={currentScene} />
    </div>
  </section>;
}

function MediaBoard({ scene, updateScene }: { scene: Scene; updateScene: (patch: Partial<Scene>) => void }) { const media = scene.media ?? []; const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null); const canvasRef = useRef<HTMLDivElement>(null); const patch = (id: string, value: Partial<MediaItem>) => updateScene({ media: media.map((item) => item.id === id ? { ...item, ...value } : item) }); const move = (event: PointerEvent<HTMLDivElement>) => { if (!dragging || !canvasRef.current) return; const item = media.find((entry) => entry.id === dragging.id); if (!item) return; const bounds = canvasRef.current.getBoundingClientRect(); patch(item.id, { x: Math.max(0, Math.min(100 - item.size / bounds.width * 100, item.x + (event.clientX - dragging.x) / bounds.width * 100)), y: Math.max(0, Math.min(100 - item.size / bounds.height * 100, item.y + (event.clientY - dragging.y) / bounds.height * 100)) }); setDragging({ id: item.id, x: event.clientX, y: event.clientY }); }; if (!media.length) return null; return <section className="media-board"><div className="media-board-head"><div><span className="eyebrow">IMAGES ON PAGE</span><b>{media.length} {media.length === 1 ? "image" : "images"}</b></div><span className="media-hint"><Move size={12} /> Drag image · pull corner to resize</span></div><div className="media-canvas" ref={canvasRef} onPointerMove={move} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>{media.map((item) => <div key={item.id} className="media-item" style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.size}px`, height: `${item.size}px` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging({ id: item.id, x: event.clientX, y: event.clientY }); }}><img src={item.src} alt={item.name} draggable={false} /><span className="media-label">{item.name}</span><button className="media-remove" onPointerDown={(event) => event.stopPropagation()} onClick={() => updateScene({ media: media.filter((entry) => entry.id !== item.id) })}><X size={12} /></button><span className="resize-handle" onPointerDown={(event) => { event.stopPropagation(); const start = { x: event.clientX, y: event.clientY, size: item.size }; event.currentTarget.setPointerCapture(event.pointerId); const moveResize = (resizeEvent: globalThis.PointerEvent) => patch(item.id, { size: Math.max(96, Math.min(420, start.size + Math.max(resizeEvent.clientX - start.x, resizeEvent.clientY - start.y))) }); const stopResize = () => { window.removeEventListener("pointermove", moveResize); window.removeEventListener("pointerup", stopResize); }; window.addEventListener("pointermove", moveResize); window.addEventListener("pointerup", stopResize); }} /></div>)}</div></section>; }

function SearchPage({ project, openEditor }: { project?: Project; openEditor: (sceneId?: string) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    if (!query || !project) return [];
    const items = [...project.scenes.map((scene) => ({ type: "Scene", title: scene.title, text: `${scene.synopsis}\n${stripHtml(scene.content)}\n${scene.notes}`, id: scene.id })), ...project.characters.map((character) => ({ type: "Character", title: character.name, text: `${character.description}\n${character.notes}`, id: character.id })), ...project.world.map((item) => ({ type: "World", title: item.name, text: `${item.description}\n${item.fantasy}\n${item.notes}`, id: item.id }))];
    return items.filter((item) => `${item.title} ${item.text}`.toLowerCase().includes(query.toLowerCase()));
  }, [query, project]);
  return <div className="page"><PageHeader eyebrow="FIND YOUR THREAD" title="Search" description={project ? "A project-wide index for the details you almost remember." : "Search becomes available when you create your own project."} guide="Search keeps a thread findable across scenes, people, plots, and world." /><div className="big-search"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={project ? "Search your project..." : "Create a project to search"} disabled={!project} /><kbd>⌘ K</kbd></div>{project && query && <div className="search-results">{results.map((result) => <button className="result-row" key={`${result.type}-${result.id}`} onClick={() => result.type === "Scene" && openEditor(result.id)}><span className="result-type">{result.type}</span><div><b>{result.title}</b><p>{result.text.slice(0, 180) || "No notes yet."}</p></div><ArrowRight size={15} /></button>)}{!results.length && <Empty icon={<Search size={26} />} title="No matches" text="Try a shorter phrase, or search for a proper name." />}</div>}</div>;
}
function Revisions({ project, update, notify }: { project: Project; update: (patch: Partial<Project>) => void; notify: (message: string) => void }) { const [selected, setSelected] = useState(project.revisions.at(-1)?.id); const revision = project.revisions.find((item) => item.id === selected); return <div className="page"><PageHeader eyebrow="TIME MACHINE" title="Revisions" description="Automatic snapshots keep yesterday's sentence close enough to reconsider." guide="Every autosave leaves a quiet trail you can restore." action={<button className="secondary-btn" onClick={() => { update({ revisions: [] }); notify("Revision history cleared"); }} disabled={!project.revisions.length}><Trash2 size={15} /> Clear history</button>} /><div className="revision-layout"><div className="revision-list">{project.revisions.length ? [...project.revisions].reverse().map((item) => <button className={`revision-row ${selected === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}><Clock3 size={15} /><span><b>{item.sceneTitle}</b><small>{new Date(item.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span><em>{item.words}w</em></button>) : <div className="panel-empty"><Archive size={23} /><br />Snapshots appear as you draft.</div>}</div><div className="revision-preview">{revision ? <><div className="inline-heading"><span className="eyebrow">SNAPSHOT PREVIEW</span><button className="text-btn" onClick={() => { update({ scenes: project.scenes.map((scene) => scene.id === revision.sceneId ? { ...scene, content: revision.content } : scene) }); notify("Revision restored"); }}><RotateCcw size={14} /> Restore</button></div><h2>{revision.sceneTitle}</h2><p className="revision-date">{new Date(revision.date).toLocaleString()}</p><div className="revision-copy" dangerouslySetInnerHTML={{ __html: revision.content }} /></> : <Empty icon={<Archive size={27} />} title="A quiet history" text="Save a scene to create your first snapshot." />}</div></div></div>; }

type ProseFinding = { id: string; label: string; detail: string; evidence?: string; severity: "notice" | "review" };
type ProseReport = {
  wordCount: number;
  sentenceCount: number;
  averageSentenceLength: number;
  longSentenceCount: number;
  shortSentenceRatio: number;
  paragraphCount: number;
  findings: ProseFinding[];
  repeatedPhrases: Array<{ phrase: string; count: number }>;
  crutchWords: Array<{ word: string; count: number }>;
};

const proseStopWords = new Set("a an and are as at be by for from has in is it of on or that the this to was were with".split(" "));
const crutchWordList = ["just", "very", "really", "actually", "suddenly", "began", "started", "seemed", "felt", "looked", "that", "then", "like"];

function analyzeProse(scenes: Scene[]): ProseReport {
  const source = scenes.map((scene) => stripHtml(scene.content)).filter(Boolean).join("\n\n");
  const paragraphs = source.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const sentences = source.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  const sentenceLengths = sentences.map((sentence) => sentence.split(/\s+/).filter(Boolean).length);
  const wordTokens: string[] = source.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  const normalized = wordTokens.filter((token) => token.length > 2);
  const phraseCounts = new Map<string, number>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const phrase = `${normalized[index]} ${normalized[index + 1]}`;
    if (proseStopWords.has(normalized[index]) && proseStopWords.has(normalized[index + 1])) continue;
    phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
  }
  const repeatedPhrases = [...phraseCounts.entries()].filter(([, count]) => count > 1).sort((left, right) => right[1] - left[1]).slice(0, 6).map(([phrase, count]) => ({ phrase, count }));
  const crutchCounts = crutchWordList.map((word) => ({ word, count: wordTokens.filter((token) => token === word).length })).filter((item) => item.count > 0).sort((left, right) => right.count - left.count).slice(0, 8);
  const longSentenceCount = sentenceLengths.filter((length) => length >= 35).length;
  const shortSentenceRatio = sentenceLengths.length ? sentenceLengths.filter((length) => length <= 6).length / sentenceLengths.length : 0;
  const averageSentenceLength = sentenceLengths.length ? Math.round(sentenceLengths.reduce((sum, length) => sum + length, 0) / sentenceLengths.length) : 0;
  const findings: ProseFinding[] = [];
  const tellingPattern = /\b(feel|felt|feeling|was|were|seemed|knew|realized|thought|wondered|afraid|angry|sad|happy|tired|nervous|looked|heard|saw)\b/i;
  const tellingSentence = sentences.find((sentence) => tellingPattern.test(sentence));
  if (tellingSentence) findings.push({ id: "show-tell", label: "Show-vs-tell opportunity", detail: "A sentence names an emotion, perception, or conclusion directly. Consider replacing the label with a physical choice, sensory detail, or specific behavior where the moment needs more pressure.", evidence: tellingSentence.slice(0, 180), severity: "review" });
  if (longSentenceCount > 0) findings.push({ id: "long-sentences", label: `${longSentenceCount} long sentence${longSentenceCount === 1 ? "" : "s"} to review`, detail: "Long sentences can create a useful rush, but several in a row may blur the beat. Check whether each clause changes the situation or only extends the description.", severity: "review" });
  if (shortSentenceRatio >= 0.35) findings.push({ id: "short-rhythm", label: "Compressed sentence rhythm", detail: `${Math.round(shortSentenceRatio * 100)}% of sentences are six words or fewer. That can sharpen urgency; mix in a longer landing sentence when the scene needs reflection or atmosphere.`, severity: "notice" });
  if (paragraphs.length > 0 && paragraphs.filter((paragraph) => paragraph.split(/\s+/).length > 120).length > 0) findings.push({ id: "dense-paragraphs", label: "Dense paragraph blocks", detail: "At least one paragraph runs past 120 words. A break at a turn, image, or change in attention may give the reader a better handhold.", severity: "notice" });
  return { wordCount: wordTokens.length, sentenceCount: sentences.length, averageSentenceLength, longSentenceCount, shortSentenceRatio, paragraphCount: paragraphs.length, findings, repeatedPhrases, crutchWords: crutchCounts };
}

function ProseIntelligence({ selectedScenes }: { selectedScenes: Scene[] }) {
  const report = useMemo(() => analyzeProse(selectedScenes), [selectedScenes]);
  return <section className="paper-card prose-panel">
    <div className="card-heading prose-heading"><div><span className="eyebrow"><FileText size={13} /> PROSE INTELLIGENCE</span><h2>Notice the habits inside the sentences.</h2><p>A private, local reading of the selected scenes. It suggests places to look; it does not decide what the writing should be.</p></div><div className="oracle-privacy"><ShieldCheck size={16} /><span>Runs locally<br /><b>nothing uploaded</b></span></div></div>
    {!selectedScenes.length ? <div className="prose-empty"><FileText size={22} /><b>Select at least one scene above</b><span>Choose material in the continuity selector to inspect its rhythm and repeated language.</span></div> : <><div className="prose-metrics"><div><span>WORDS</span><b>{report.wordCount.toLocaleString()}</b><small>{report.paragraphCount} paragraphs</small></div><div><span>SENTENCES</span><b>{report.sentenceCount}</b><small>{report.averageSentenceLength} words on average</small></div><div><span>LONG SENTENCES</span><b>{report.longSentenceCount}</b><small>35 words or more</small></div><div><span>SHORT RHYTHM</span><b>{Math.round(report.shortSentenceRatio * 100)}%</b><small>six words or fewer</small></div></div>
      <div className="prose-columns"><div><div className="inline-heading"><span className="eyebrow">SUGGESTIONS</span><span className="prose-scope">{selectedScenes.length} scene{selectedScenes.length === 1 ? "" : "s"} selected</span></div>{report.findings.length ? <div className="prose-findings">{report.findings.map((finding) => <article className={`prose-finding ${finding.severity}`} key={finding.id}><div><span className="prose-finding-label">{finding.severity === "review" ? <AlertTriangle size={13} /> : <Check size={13} />}{finding.label}</span><p>{finding.detail}</p>{finding.evidence && <blockquote>“{finding.evidence}”</blockquote>}</div></article>)}</div> : <div className="prose-clear"><Check size={16} /><span>No broad signals stood out in this selection. Read it aloud once for the details a local pass cannot hear.</span></div>}</div><div className="prose-side-lists"><div><span className="eyebrow">REPEATED PHRASES</span>{report.repeatedPhrases.length ? <ul>{report.repeatedPhrases.map((item) => <li key={item.phrase}><span>{item.phrase}</span><b>{item.count}×</b></li>)}</ul> : <p className="panel-empty">No repeated two-word phrases found.</p>}</div><div><span className="eyebrow">CRUTCH WORDS</span>{report.crutchWords.length ? <ul>{report.crutchWords.map((item) => <li key={item.word}><span>{item.word}</span><b>{item.count}×</b></li>)}</ul> : <p className="panel-empty">No tracked crutch words found.</p>}<small className="prose-method">Tracked list: just, very, really, actually, suddenly, began, started, seemed, felt, looked, that, then, like.</small></div></div></div></>}
  </section>;
}

type GenerationMode = "synopsis" | "blurb" | "query_letter" | "series_bible";
const generationModes: Record<GenerationMode, { label: string; detail: string; instruction: string; placeholder: string }> = {
  synopsis: { label: "Synopsis", detail: "A clear, spoiler-aware overview of the story.", instruction: "Write a polished synopsis for an author submission packet. Cover the central character, inciting disruption, major escalation, and ending or resolution when the selected material supports it. Be specific, not breathless. Do not invent facts.", placeholder: "Optional emphasis, such as foregrounding the emotional arc" },
  blurb: { label: "Back-cover blurb", detail: "A compact promise that makes the right reader lean in.", instruction: "Write three versions of a back-cover or retailer blurb. Each should be concise, intriguing, genre-aware, and focused on the protagonist's immediate pressure without spoiling the resolution. Use only supported material and label each version by tone.", placeholder: "Optional audience or tonal direction" },
  query_letter: { label: "Query letter", detail: "A professional opening for an agent or editor.", instruction: "Draft a professional query letter opening for a literary agent. Include a compelling housekeeping line with placeholders only when details are missing, a focused pitch paragraph, and a short author/platform placeholder section. Do not invent awards, credentials, comps, word count, or publication details.", placeholder: "Optional genre, word count, or agent-specific note" },
  series_bible: { label: "Series bible", detail: "A reusable reference for the story's larger shape.", instruction: "Create a concise series bible draft from the selected material. Organize it with headings for premise, core cast, world rules, long arc, current installment, open questions, and possible future pressure. Clearly label inferences and unknowns; do not turn guesses into canon.", placeholder: "Optional focus, such as future installments or world rules" },
};

function StoryMaterialsGenerator({ context, selectedScenes }: { context: string; selectedScenes: Scene[] }) {
  const [mode, setMode] = useState<GenerationMode>("synopsis");
  const [focus, setFocus] = useState("");
  const [result, setResult] = useState<{ content: string; providerId: string; modelId: string; attempted: string[] } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const abortController = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationFn: (data: Parameters<typeof oracleChat>[0]) => {
      const controller = new AbortController();
      abortController.current = controller;
      return oracleChat(data, { signal: controller.signal });
    },
    onSettled: () => {
      abortController.current = null;
    },
  });
  const selected = generationModes[mode];
  const run = () => {
    if (!selectedScenes.length || mutation.isPending) return;
    setCancelled(false);
    setResult(null);
    mutation.mutate({
      messages: [
        { role: "system", content: `${selected.instruction} Return only the requested editorial draft. Use plain text headings where helpful. Do not mention providers, prompts, or unavailable context.` },
        { role: "user", content: `${focus.trim() ? `Author direction:\n${focus.trim()}\n\n` : ""}Prepare a ${selected.label} from the selected Authors Den project material.` },
      ],
      context,
      temperature: 0.4,
    }, { onSuccess: (value) => setResult(value) });
  };
  const cancel = () => {
    abortController.current?.abort();
    mutation.reset();
    setCancelled(true);
  };
  const copy = async () => {
    if (!result) return;
    await navigator.clipboard?.writeText(result.content);
  };
  const errorMessage = mutation.error instanceof Error ? mutation.error.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "The draft generator could not reach a working model. Try again after checking the provider signal.";
  return <section className="paper-card materials-panel">
    <div className="card-heading materials-heading"><div><span className="eyebrow"><FileText size={13} /> AUTHOR MATERIALS</span><h2>Turn the work into its next document.</h2><p>Create a starting draft for a synopsis, blurb, query letter, or series bible. Treat every result as editable working material.</p></div><div className="oracle-privacy"><ShieldCheck size={16} /><span>Selected material<br /><b>review before use</b></span></div></div>
    <div className="materials-options">{(Object.keys(generationModes) as GenerationMode[]).map((item) => <button className={mode === item ? "materials-option selected" : "materials-option"} key={item} onClick={() => { setMode(item); setResult(null); mutation.reset(); setCancelled(false); }}><b>{generationModes[item].label}</b><small>{generationModes[item].detail}</small></button>)}</div>
    <div className="materials-run"><label className="field"><span>Optional direction</span><input value={focus} onChange={(event) => setFocus(event.target.value.slice(0, 700))} placeholder={selected.placeholder} /></label><button className="primary-btn" onClick={mutation.isPending ? cancel : run} disabled={!selectedScenes.length && !mutation.isPending}>{mutation.isPending ? <><X size={15} /> Cancel draft</> : <><WandSparkles size={15} /> Draft {selected.label}</>}</button></div>
    <div className="oracle-footnote"><span><ShieldCheck size={13} /> Uses only the selected scenes plus project facts · capped at 12,000 characters</span><span>{selectedScenes.length} scene{selectedScenes.length === 1 ? "" : "s"} selected</span></div>
    {!selectedScenes.length && <div className="materials-empty"><FileText size={19} />Select at least one scene in the material selector above.</div>}
    {cancelled && <div className="oracle-error"><X size={15} />Draft canceled before a response was returned.</div>}
    {mutation.isError && !cancelled && <div className="oracle-error"><X size={15} />{errorMessage}</div>}
    {result && <div className="materials-result"><div className="oracle-answer-meta"><span><FileText size={13} /> Working draft · {selected.label}</span><OracleRouteMeta providerId={result.providerId} modelId={result.modelId} attempted={result.attempted} /></div><div className="materials-copy">{result.content}</div><div className="materials-actions"><button className="secondary-btn" onClick={copy}><Copy size={14} /> Copy draft</button><small>Edit for accuracy, voice, and market fit before sending it anywhere.</small></div></div>}
  </section>;
}

function OraclePage({ project, updateProject, notify }: { project: Project; updateProject: (patch: Partial<Project>) => void; notify: (message: string) => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ content: string; providerId: string; modelId: string; attempted: string[] } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const abortController = useRef<AbortController | null>(null);
  const oracle = useMutation({
    mutationFn: (data: Parameters<typeof oracleChat>[0]) => {
      const controller = new AbortController();
      abortController.current = controller;
      return oracleChat(data, { signal: controller.signal });
    },
    onSettled: () => {
      abortController.current = null;
    },
  });
  const projectContext = useMemo(() => {
    const scenes = project.scenes.map((scene) => `Scene: ${scene.title}\nSynopsis: ${scene.synopsis}\nDraft: ${stripHtml(scene.content).slice(0, 2400)}`).join("\n\n");
    const cast = project.characters.map((character) => `${character.name} (${character.role}): ${character.description}`).join("\n");
    const world = project.world.map((item) => `${item.name} (${item.kind}): ${item.description}`).join("\n");
    return `Project: ${project.title}\nPremise: ${project.premise}\nSynopsis: ${project.synopsis}\nCharacters:\n${cast}\nWorld:\n${world}\nScenes:\n${scenes}`.slice(0, 12000);
  }, [project]);
  const ask = () => {
    const trimmed = question.trim();
    if (!trimmed || oracle.isPending) return;
    setCancelled(false);
    setAnswer(null);
    oracle.mutate({
      messages: [{ role: "user", content: trimmed }],
      context: projectContext,
      temperature: 0.35,
    }, {
      onSuccess: (result) => {
        setAnswer(result);
        setQuestion("");
      },
    });
  };
  const cancel = () => {
    abortController.current?.abort();
    setCancelled(true);
    oracle.reset();
  };
  const errorMessage = oracle.error instanceof Error
    ? oracle.error.message.replace(/^HTTP \d+ [^:]+:\s*/, "")
    : "The Oracle could not reach a working model. Try again after checking the provider signal.";
  return <div className="page oracle-page">
    <PageHeader eyebrow="STORY ORACLE" title="Ask the work itself." description="A private conversation with the story you are already building. The Oracle works from the project context you choose, not a generic chatbot." guide="Ask about a character, place, contradiction, or next move. The Oracle keeps its answer close to your Authors Den project." />
    <div className="oracle-page-intro"><div><span className="eyebrow">YOUR AUTHORS DEN PROJECT, IN CONTEXT</span><p>{project.scenes.length} scenes · {project.characters.length} characters · {project.world.length} world entries available for this conversation.</p></div><div className="oracle-page-badge"><ShieldCheck size={16} /><span>Context-bounded<br /><b>privacy first</b></span></div></div>
    <section className="paper-card oracle-panel oracle-page-card">
      <div className="card-heading oracle-heading"><div><span className="eyebrow"><Sparkles size={13} /> STORY ORACLE</span><h2>A question is a way in.</h2><p>Use the prompts below for a starting point, or ask the question that is pulling at the work today.</p></div><span className="oracle-mark"><Sparkles size={19} /></span></div>
      <div className="oracle-suggestions"><button onClick={() => setQuestion("What continuity details should I verify before writing the next scene?")}>Check continuity</button><button onClick={() => setQuestion("What does this project currently promise the reader?")}>Find the story promise</button><button onClick={() => setQuestion("Suggest three scene ideas that deepen the current tension.")}>Generate scene ideas</button></div>
      <div className="oracle-input-wrap"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); ask(); } }} placeholder="Ask about a character, place, contradiction, or next move…" aria-label="Ask the Story Oracle" /><button className="oracle-send" onClick={oracle.isPending ? cancel : ask} disabled={!question.trim() && !oracle.isPending} aria-label={oracle.isPending ? "Cancel Oracle request" : "Ask the Story Oracle"}>{oracle.isPending ? <X size={16} /> : <Send size={16} />}</button></div>
      <div className="oracle-footnote"><span><ShieldCheck size={13} /> Selected project context only · capped at 12,000 characters</span><kbd>⌘ ↵</kbd></div>
      {cancelled && <div className="oracle-error"><X size={15} />Oracle request canceled before a response was returned.</div>}
      {oracle.isError && !cancelled && <div className="oracle-error"><X size={15} />{errorMessage}</div>}
      {answer && <div className="oracle-answer"><div className="oracle-answer-meta"><span><Sparkles size={13} /> Oracle response</span><OracleRouteMeta providerId={answer.providerId} modelId={answer.modelId} attempted={answer.attempted} /></div><p>{answer.content}</p></div>}
    </section>
      <Tools project={project} updateProject={updateProject} notify={notify} embedded />
      <div className="oracle-page-note"><ShieldCheck size={17} /><div><b>Only the context shown above is sent</b><span>Your question is paired with the selected Authors Den project context and nothing else from this browser.</span></div></div>
  </div>;
}

function Tools({ project, updateProject, notify, embedded = false }: { project: Project; updateProject: (patch: Partial<Project>) => void; notify: (message: string) => void; embedded?: boolean }) {
  const total = project.scenes.reduce((sum, scene) => sum + words(scene.content), 0);
  const abortController = useRef<AbortController | null>(null);
  const continuityAbortController = useRef<AbortController | null>(null);
  const outlineAbortController = useRef<AbortController | null>(null);
  const voiceAbortController = useRef<AbortController | null>(null);
  const worldBibleAbortController = useRef<AbortController | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [continuityCancelled, setContinuityCancelled] = useState(false);
  const [outlineCancelled, setOutlineCancelled] = useState(false);
  const [voiceCancelled, setVoiceCancelled] = useState(false);
  const [worldBibleCancelled, setWorldBibleCancelled] = useState(false);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>(() => project.scenes.map((scene) => scene.id));
  const [continuityFocus, setContinuityFocus] = useState("");
  const [outlineMode, setOutlineMode] = useState<"premise_expansion" | "scene_ideas" | "chapter_breaks">("premise_expansion");
  const [outlineFocus, setOutlineFocus] = useState("");
  const [voiceCharacterId, setVoiceCharacterId] = useState(project.characters[0]?.id ?? "");
  const [voiceFocus, setVoiceFocus] = useState("");
  const [worldBibleFocus, setWorldBibleFocus] = useState("");
  const oracle = useMutation({
    mutationFn: (data: Parameters<typeof oracleChat>[0]) => {
      const controller = new AbortController();
      abortController.current = controller;
      return oracleChat(data, { signal: controller.signal });
    },
    onSettled: () => {
      abortController.current = null;
    },
  });
  const continuity = useMutation({
    mutationFn: (data: Parameters<typeof continuityAudit>[0]) => {
      const controller = new AbortController();
      continuityAbortController.current = controller;
      return continuityAudit(data, { signal: controller.signal });
    },
    onSettled: () => {
      continuityAbortController.current = null;
    },
  });
  const outline = useMutation({
    mutationFn: (data: Parameters<typeof outlineAssist>[0]) => {
      const controller = new AbortController();
      outlineAbortController.current = controller;
      return outlineAssist(data, { signal: controller.signal });
    },
    onSettled: () => {
      outlineAbortController.current = null;
    },
  });
  const voice = useMutation({
    mutationFn: (data: Parameters<typeof voiceConsistencyCheck>[0]) => {
      const controller = new AbortController();
      voiceAbortController.current = controller;
      return voiceConsistencyCheck(data, { signal: controller.signal });
    },
    onSettled: () => {
      voiceAbortController.current = null;
    },
  });
  const worldBible = useMutation({
    mutationFn: (data: Parameters<typeof worldBibleExtract>[0]) => {
      const controller = new AbortController();
      worldBibleAbortController.current = controller;
      return worldBibleExtract(data, { signal: controller.signal });
    },
    onSettled: () => {
      worldBibleAbortController.current = null;
    },
  });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ content: string; providerId: string; modelId: string; attempted: string[] } | null>(null);
  const selectedScenes = useMemo(() => project.scenes.filter((scene) => selectedSceneIds.includes(scene.id)), [project.scenes, selectedSceneIds]);
  const selectedCharacter = project.characters.find((character) => character.id === voiceCharacterId) ?? project.characters[0];
  const projectContext = useMemo(() => {
    const scenes = selectedScenes.map((scene) => `Scene: ${scene.title}\nSynopsis: ${scene.synopsis}\nDraft: ${stripHtml(scene.content).slice(0, 2200)}`).join("\n\n");
    const cast = project.characters.map((character) => `${character.name} (${character.role}): ${character.description}`).join("\n");
    const world = project.world.map((item) => `${item.name} (${item.kind}): ${item.description}`).join("\n");
    return `Project: ${project.title}\nPremise: ${project.premise}\nSynopsis: ${project.synopsis}\nCharacters:\n${cast}\nWorld:\n${world}\nScenes:\n${scenes}`.slice(0, 12000);
  }, [project, selectedScenes]);
  const ask = () => {
    const trimmed = question.trim();
    if (!trimmed || oracle.isPending) return;
    setCancelled(false);
    setAnswer(null);
    oracle.mutate({ messages: [{ role: "user", content: trimmed }], context: projectContext, temperature: 0.35 }, {
      onSuccess: (result) => {
        setAnswer(result);
        setQuestion("");
      },
    });
  };
  const cancel = () => {
    abortController.current?.abort();
    setCancelled(true);
    oracle.reset();
  };
  const runContinuityAudit = () => {
    if (!selectedScenes.length || continuity.isPending) return;
    setContinuityCancelled(false);
    continuity.mutate({ context: projectContext, focus: continuityFocus.trim() || null });
  };
  const cancelContinuityAudit = () => {
    continuityAbortController.current?.abort();
    setContinuityCancelled(true);
    continuity.reset();
  };
  const runOutlineAssist = () => {
    if (outline.isPending) return;
    setOutlineCancelled(false);
    outline.mutate({ mode: outlineMode, context: projectContext, focus: outlineFocus.trim() || null });
  };
  const cancelOutlineAssist = () => {
    outlineAbortController.current?.abort();
    setOutlineCancelled(true);
    outline.reset();
  };
  const runVoiceCheck = () => {
    if (!selectedCharacter || !selectedScenes.length || voice.isPending) return;
    setVoiceCancelled(false);
    voice.mutate({
      characterProfile: [
        `${selectedCharacter.name} — ${selectedCharacter.role}, ${selectedCharacter.importance} importance, ${selectedCharacter.pov} POV`,
        `Description: ${selectedCharacter.description}`,
        `Notes: ${selectedCharacter.notes}`,
        selectedCharacter.custom.length ? `Custom details:\n${selectedCharacter.custom.map((row) => `${row.key}: ${row.value}`).join("\n")}` : "",
      ].filter(Boolean).join("\n"),
      context: projectContext,
      focus: voiceFocus.trim() || null,
    });
  };
  const cancelVoiceCheck = () => {
    voiceAbortController.current?.abort();
    setVoiceCancelled(true);
    voice.reset();
  };
  const runWorldBible = () => {
    if (!selectedScenes.length || worldBible.isPending) return;
    setWorldBibleCancelled(false);
    worldBible.mutate({ context: projectContext, focus: worldBibleFocus.trim() || null });
  };
  const cancelWorldBible = () => {
    worldBibleAbortController.current?.abort();
    setWorldBibleCancelled(true);
    worldBible.reset();
  };
  const errorMessage = oracle.error instanceof Error ? oracle.error.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "The Oracle could not reach a working model. Try again after checking the provider signal.";
  const continuityErrorMessage = continuity.error instanceof Error ? continuity.error.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "The continuity audit could not reach a working model. Try again after checking the provider signal.";
  const outlineErrorMessage = outline.error instanceof Error ? outline.error.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "The outline assistant could not reach a working model. Try again after checking the provider signal.";
  const voiceErrorMessage = voice.error instanceof Error ? voice.error.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "The voice check could not reach a working model. Try again after checking the provider signal.";
  const worldBibleErrorMessage = worldBible.error instanceof Error ? worldBible.error.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "The world bible extraction could not reach a working model. Try again after checking the provider signal.";
  const addWorldBibleEntry = (entry: NonNullable<typeof worldBible.data>["entries"][number]) => {
    updateProject({
      world: [...project.world, {
        id: uid(),
        name: entry.name,
        kind: entry.suggestedWorldKind,
        description: entry.description,
        notes: `Extracted from selected material.\nEvidence: ${entry.evidence.join(" · ")}`,
        fantasy: entry.kind === "rule" ? entry.description : "",
        mapUrl: "",
      }],
    });
    notify(`${entry.name} added to the world bible`);
  };
  const outlineLabels = {
    premise_expansion: { label: "Premise expansion", detail: "Sharpen the promise, pressure, stakes, and possible directions." },
    scene_ideas: { label: "Scene ideas", detail: "Find concrete next moves that deepen the current tension." },
    chapter_breaks: { label: "Chapter breaks", detail: "Spot pacing turns and natural places to make the reader pause." },
  } as const;
  const oracleToolCards = <>
    <StoryMaterialsGenerator context={projectContext} selectedScenes={selectedScenes} />
    <section className="paper-card continuity-panel">
      <div className="card-heading continuity-heading"><div><span className="eyebrow"><ClipboardList size={13} /> CONTINUITY AUDIT</span><h2>Catch the details that drift.</h2><p>Compare selected scenes for factual conflicts before they become expensive to fix.</p></div><div className="oracle-privacy"><ShieldCheck size={16} /><span>Selected scenes<br /><b>privacy first</b></span></div></div>
      <div className="continuity-controls">
        <div className="continuity-scenes"><div className="inline-heading"><span className="eyebrow">MATERIAL TO CHECK</span><button className="text-btn" onClick={() => setSelectedSceneIds(selectedSceneIds.length === project.scenes.length ? [] : project.scenes.map((scene) => scene.id))}>{selectedSceneIds.length === project.scenes.length ? "Clear all" : "Select all"}</button></div>
          <div className="scene-check-list">{project.scenes.map((scene) => <label className="scene-check" key={scene.id}><input type="checkbox" checked={selectedSceneIds.includes(scene.id)} onChange={() => setSelectedSceneIds((ids) => ids.includes(scene.id) ? ids.filter((id) => id !== scene.id) : [...ids, scene.id])} /><span><b>{scene.title}</b><small>{words(scene.content).toLocaleString()} words · {scene.status}</small></span></label>)}</div>
        </div>
        <div className="continuity-run"><label className="field"><span>Optional focus</span><input value={continuityFocus} onChange={(event) => setContinuityFocus(event.target.value)} placeholder="e.g. Elian's age and travel timeline" /></label><button className="primary-btn" onClick={continuity.isPending ? cancelContinuityAudit : runContinuityAudit} disabled={!selectedScenes.length && !continuity.isPending}>{continuity.isPending ? <><X size={15} /> Cancel audit</> : <><Search size={15} /> Audit selected scenes</>}</button><small>{selectedScenes.length} of {project.scenes.length} scenes selected · capped at 12,000 characters</small></div>
      </div>
      {continuityCancelled && <div className="oracle-error"><X size={15} />Continuity audit canceled before a response was returned.</div>}
      {continuity.isError && !continuityCancelled && <div className="oracle-error"><X size={15} />{continuityErrorMessage}</div>}
      {continuity.data && <div className="continuity-results"><div className="continuity-results-head"><div><span className="eyebrow">AUDIT REPORT</span><h3>{continuity.data.issues.length ? `${continuity.data.issues.length} detail${continuity.data.issues.length === 1 ? "" : "s"} worth checking` : "No supported conflicts found"}</h3></div><OracleRouteMeta providerId={continuity.data.providerId} modelId={continuity.data.modelId} attempted={continuity.data.attempted} /></div>{continuity.data.issues.length ? <div className="continuity-issues">{continuity.data.issues.map((issue) => <article className={`continuity-issue severity-${issue.severity}`} key={issue.id}><div className="continuity-issue-top"><span className="continuity-severity"><AlertTriangle size={14} /> {issue.severity}</span><span className="template-tag">{issue.category}</span></div><h4>{issue.claim}</h4><p>{issue.explanation}</p><div className="continuity-evidence"><b>Evidence</b>{issue.evidence.map((evidence) => <span key={evidence}>“{evidence}”</span>)}</div><div className="continuity-suggestion"><b>Possible fix</b><span>{issue.suggestion}</span></div></article>)}</div> : <p className="continuity-clear"><Check size={16} /> The selected scenes are internally consistent on the facts the Oracle could verify.</p>}</div>}
    </section>
    <section className="paper-card voice-panel">
      <div className="card-heading voice-heading"><div><span className="eyebrow"><MessageCircle size={13} /> CHARACTER VOICE</span><h2>Keep every voice recognizable.</h2><p>Compare one character's profile with the selected scenes and review any supported drift in diction, rhythm, worldview, knowledge, or emotional behavior.</p></div><div className="oracle-privacy"><ShieldCheck size={16} /><span>Selected scenes<br /><b>review before use</b></span></div></div>
      <div className="voice-controls">
        <label className="field"><span>Character to check</span><select value={voiceCharacterId} onChange={(event) => { setVoiceCharacterId(event.target.value); voice.reset(); setVoiceCancelled(false); }} disabled={!project.characters.length}>{project.characters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.role}</option>)}</select></label>
        <label className="field"><span>Optional focus</span><input value={voiceFocus} onChange={(event) => setVoiceFocus(event.target.value.slice(0, 700))} placeholder="e.g. watch for formal language in dialogue" /></label>
      </div>
      <div className="voice-run-row"><button className="primary-btn" onClick={voice.isPending ? cancelVoiceCheck : runVoiceCheck} disabled={(!selectedCharacter || !selectedScenes.length) && !voice.isPending}>{voice.isPending ? <><X size={15} /> Cancel voice check</> : <><MessageCircle size={15} /> Check character voice</>}</button><small>{selectedCharacter ? `${selectedCharacter.name} · ${selectedScenes.length} scenes selected` : "Add a character before running a check"} · profile and selected material only</small></div>
      {voiceCancelled && <div className="oracle-error"><X size={15} />Voice check canceled before a response was returned.</div>}
      {voice.isError && !voiceCancelled && <div className="oracle-error"><X size={15} />{voiceErrorMessage}</div>}
      {voice.data && <div className="voice-results"><div className="voice-results-head"><div><span className="eyebrow">VOICE REPORT · {selectedCharacter?.name}</span><h3>{voice.data.issues.length ? `${voice.data.issues.length} possible drift${voice.data.issues.length === 1 ? "" : "s"} to review` : "Voice is supported by the selected material"}</h3></div><OracleRouteMeta providerId={voice.data.providerId} modelId={voice.data.modelId} attempted={voice.data.attempted} /></div>{voice.data.issues.length ? <div className="voice-issues">{voice.data.issues.map((issue) => <article className={`continuity-issue severity-${issue.severity}`} key={issue.id}><div className="continuity-issue-top"><span className="continuity-severity"><AlertTriangle size={14} /> {issue.severity}</span><span className="template-tag">{issue.category}</span></div><h4>{issue.claim}</h4><p>{issue.explanation}</p><div className="continuity-evidence"><b>Evidence</b>{issue.evidence.map((evidence) => <span key={evidence}>“{evidence}”</span>)}</div><div className="continuity-suggestion"><b>Review</b><span>{issue.suggestion}</span></div></article>)}</div> : <p className="continuity-clear"><Check size={16} /> No supported voice drift was found. Intentional growth and deliberate situation changes remain yours to judge.</p>}</div>}
    </section>
    <section className="paper-card world-bible-panel">
      <div className="card-heading world-bible-heading"><div><span className="eyebrow"><Globe2 size={13} /> WORLD BIBLE</span><h2>Find what makes the world hold together.</h2><p>Extract concrete places, items, and rules from selected material. Nothing is added until you review it.</p></div><div className="oracle-privacy"><ShieldCheck size={16} /><span>Review first<br /><b>no auto-save</b></span></div></div>
      <div className="world-bible-run"><label className="field"><span>Optional focus</span><input value={worldBibleFocus} onChange={(event) => setWorldBibleFocus(event.target.value.slice(0, 700))} placeholder="e.g. only extract named places and travel rules" /></label><button className="primary-btn" onClick={worldBible.isPending ? cancelWorldBible : runWorldBible} disabled={!selectedScenes.length && !worldBible.isPending}>{worldBible.isPending ? <><X size={15} /> Cancel extraction</> : <><Globe2 size={15} /> Extract world details</>}</button></div>
      <div className="oracle-footnote"><span><ShieldCheck size={13} /> Selected scenes, cast, world notes, premise, and synopsis · capped at 12,000 characters</span><span>{selectedScenes.length} scenes selected</span></div>
      {worldBibleCancelled && <div className="oracle-error"><X size={15} />World bible extraction canceled before a response was returned.</div>}
      {worldBible.isError && !worldBibleCancelled && <div className="oracle-error"><X size={15} />{worldBibleErrorMessage}</div>}
      {worldBible.data && <div className="world-bible-results"><div className="world-bible-results-head"><div><span className="eyebrow">EXTRACTION REVIEW</span><h3>{worldBible.data.entries.length ? `${worldBible.data.entries.length} world detail${worldBible.data.entries.length === 1 ? "" : "s"} found` : "No supported world details found"}</h3></div><OracleRouteMeta providerId={worldBible.data.providerId} modelId={worldBible.data.modelId} attempted={worldBible.data.attempted} /></div>{worldBible.data.entries.length ? <div className="world-bible-entries">{worldBible.data.entries.map((entry) => <article className="world-bible-entry" key={entry.id}><div className="world-bible-entry-top"><span className="template-tag">{entry.kind}</span><span className="world-bible-entry-kind">{entry.suggestedWorldKind}</span></div><h4>{entry.name}</h4><p>{entry.description}</p><div className="continuity-evidence"><b>Evidence</b>{entry.evidence.map((evidence) => <span key={evidence}>“{evidence}”</span>)}</div><button className="secondary-btn" onClick={() => addWorldBibleEntry(entry)}><Plus size={14} /> Add to world</button></article>)}</div> : <p className="continuity-clear"><Check size={16} /> The selected material did not support any new location, item, or rule worth adding.</p>}</div>}
    </section>
    <section className="paper-card outline-assist-panel">
      <div className="card-heading outline-assist-heading"><div><span className="eyebrow"><Sparkles size={13} /> STORY ARCHITECT</span><h2>Find the next shape.</h2><p>Use the selected project context to develop the premise, discover scene moves, or test the pace of your chapter sequence.</p></div><div className="oracle-privacy"><ShieldCheck size={16} /><span>Review first<br /><b>context-bounded</b></span></div></div>
      <div className="outline-assist-options">{(Object.keys(outlineLabels) as Array<keyof typeof outlineLabels>).map((mode) => <button key={mode} className={outlineMode === mode ? "outline-assist-option selected" : "outline-assist-option"} onClick={() => { setOutlineMode(mode); outline.reset(); setOutlineCancelled(false); }}><b>{outlineLabels[mode].label}</b><small>{outlineLabels[mode].detail}</small></button>)}</div>
      <div className="outline-assist-run"><label className="field"><span>Optional question or constraint</span><input value={outlineFocus} onChange={(event) => setOutlineFocus(event.target.value.slice(0, 700))} placeholder={outlineMode === "premise_expansion" ? "e.g. keep it intimate and coastal" : outlineMode === "scene_ideas" ? "e.g. no new locations in the next scene" : "e.g. favor breaks after irreversible choices"} /></label><button className="primary-btn" onClick={outline.isPending ? cancelOutlineAssist : runOutlineAssist}>{outline.isPending ? <><X size={15} /> Cancel assistant</> : <><Sparkles size={15} /> {outlineLabels[outlineMode].label}</>}</button></div>
      <div className="oracle-footnote"><span><ShieldCheck size={13} /> Uses the selected scenes, cast, world, premise, and synopsis · capped at 12,000 characters</span><span>{selectedScenes.length} scenes selected</span></div>
      {outlineCancelled && <div className="oracle-error"><X size={15} />Outline assistance canceled before a response was returned.</div>}
      {outline.isError && !outlineCancelled && <div className="oracle-error"><X size={15} />{outlineErrorMessage}</div>}
      {outline.data && <div className="outline-assist-result"><div className="oracle-answer-meta"><span><Sparkles size={13} /> {outlineLabels[outlineMode].label}</span><OracleRouteMeta providerId={outline.data.providerId} modelId={outline.data.modelId} attempted={outline.data.attempted} /></div><div className="outline-assist-copy">{outline.data.content}</div></div>}
    </section>
  </>;
  if (embedded) return <div className="oracle-tools-stack">{oracleToolCards}</div>;
  return <div className="page">
    <PageHeader eyebrow="WRITING TOOLS" title="Tools" description="Small instruments for noticing the work, without interrupting it." guide="Tools make the rhythm of your writing visible." />
    <div className="tools-grid">
      <section className="paper-card target-card"><div className="card-heading"><div><span className="eyebrow">DAILY TARGET</span><h2>Make a little room</h2></div><Zap size={18} /></div><div className="target-number"><b>{Math.min(total, project.dailyTarget)}</b><span>/ {project.dailyTarget} words</span></div><div className="progress-track"><span style={{ width: `${Math.min(100, total / project.dailyTarget * 100)}%` }} /></div><p className="setting-copy">Your draft is {total >= project.dailyTarget ? "at today's target." : `${project.dailyTarget - total} words from today's target.`}</p></section>
      <section className="paper-card"><div className="card-heading"><div><span className="eyebrow">SESSION TARGET</span><h2>This sitting</h2></div><Clock3 size={18} /></div><div className="target-number"><b>{Math.min(total, project.sessionTarget)}</b><span>/ {project.sessionTarget} words</span></div><div className="progress-track peach"><span style={{ width: `${Math.min(100, total / project.sessionTarget * 100)}%` }} /></div><p className="setting-copy">Keep the pressure gentle and specific.</p></section>
      <Stats project={project} />
    </div>
    <ProseIntelligence selectedScenes={selectedScenes} />
  </div>;
}
function SettingsPage({ project, update, notify, exportFile, theme, setTheme }: { project: Project; update: (patch: Partial<Project>) => void;  notify: (message: string) => void; exportFile: (format: ExportFormat) => void; theme: string; setTheme: (theme: string) => void }) {
  const { user } = useUser();
  const applyTheme = (value: string) => { setTheme(value); notify(`${value === "dark" ? "Night" : "Light"} desk applied`); };
  const themes = [{ id: "light", label: "Light desk", detail: "Vellum & brass", swatch: "light-swatch" }, { id: "dark", label: "Night desk", detail: "Ink & amber", swatch: "dark-swatch" }, { id: "sage", label: "Sage room", detail: "Moss & paper", swatch: "sage-swatch" }, { id: "rose", label: "Rose studio", detail: "Blush & ink", swatch: "rose-swatch" }];
  const initial = (user?.fullName || user?.username || user?.firstName || "W").slice(0, 1).toUpperCase();
  return <div className="page"><PageHeader eyebrow="THE DESK" title="Settings" description="Tune the room around the way you think." guide="Settings keeps the desk portable, personal, and yours." /><div className="settings-layout"><section className="paper-card settings-card account-card"><div className="card-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>Who is at this desk</h2></div><span className="account-avatar">{initial}</span></div><p className="setting-copy">This is the identity shared with your Tandem account — the name creators see when you answer their seed, and the studio both of you keep in sync after a fork is accepted.</p><div className="account-row"><span>Display name</span><b>{user?.fullName || user?.username || user?.firstName || "Writer"}</b></div><div className="account-row"><span>Email</span><b>{user?.primaryEmailAddress?.emailAddress ?? "—"}</b></div><div className="account-row"><span>Author on projects</span><b>{project?.author || "—"}</b></div></section><section className="paper-card settings-card"><div className="card-heading"><div><span className="eyebrow">APPEARANCE</span><h2>Choose your room</h2></div></div><p className="setting-copy">Pick a color combination for the writing desk. Your choice stays saved on this device.</p><div className="theme-grid">{themes.map((item) => <button key={item.id} className={`theme-choice ${theme === item.id ? "selected" : ""}`} onClick={() => applyTheme(item.id)}><span className={`theme-preview ${item.swatch}`}><i /><i /><i /></span><span><b>{item.label}</b><small>{item.detail}</small></span>{theme === item.id && <Check size={15} />}</button>)}</div><div className="setting-row"><div><b>Autosave snapshots</b><small>Keep a revision when a scene changes.</small></div><input type="checkbox" defaultChecked /></div></section><section className="paper-card settings-card"><div className="card-heading"><div><span className="eyebrow">PORTABILITY</span><h2>Take it with you</h2></div><Download size={18} /></div><p className="setting-copy">Authors Den never locks your words away. Download the project as a portable file or finished document.</p><div className="export-grid"><button onClick={() => exportFile("json")}><FileDown size={15} /> Project JSON</button><button onClick={() => exportFile("docx")}><FileText size={15} /> Word (.docx)</button><button onClick={() => exportFile("pdf")}><FileText size={15} /> PDF</button><button onClick={() => exportFile("epub")}><BookOpen size={15} /> EPUB</button><button onClick={() => exportFile("rtf")}><FileText size={15} /> Rich text (.rtf)</button><button onClick={() => exportFile("txt")}><FileText size={15} /> Plain text</button><button onClick={() => exportFile("html")}><Globe2 size={15} /> HTML document</button><button onClick={() => exportFile("fdx")}><FileText size={15} /> Final Draft (.fdx)</button><button onClick={() => exportFile("md")}><FileText size={15} /> Markdown</button><button onClick={() => exportFile("odt")}><FileText size={15} /> OpenDocument (.odt)</button><button onClick={() => exportFile("doc")}><FileText size={15} /> Word 97 (.doc)</button><button onClick={() => exportFile("print")}><Printer size={15} /> Print</button></div></section><section className="paper-card settings-card danger-card"><div className="card-heading"><div><span className="eyebrow">LOCAL DATA</span><h2>Your browser desk</h2></div></div><p className="setting-copy">Changes save automatically in this browser. Export a copy whenever you move between devices.</p><button className="secondary-btn" onClick={() => { update({ updated: now() }); notify("Desk saved locally"); }}><Save size={15} /> Confirm local save</button></section></div></div>;
}

function TutorialDock({ step, onNext, onDismiss }: { step: number; onNext: () => void; onDismiss: () => void }) { const labels = ["Project shape", "Outline", "Draft", "Settings"]; return <div className="tutorial-dock"><span className="dock-arrow" /><div><span className="eyebrow">NEXT LESSON · {String(step + 1).padStart(2, "0")} / 04</span><b>{labels[step]}</b><small>Close the lesson above, explore this page, then continue when ready.</small></div><button className="primary-btn" onClick={onNext}>{step === labels.length - 1 ? "Finish tutorial" : "Next lesson"} <ArrowRight size={15} /></button><button className="icon-btn" onClick={onDismiss} aria-label="Dismiss lesson"><X size={15} /></button></div>; }
function TutorialModal({ step, onClose }: { step: number; onClose: () => void }) { const lessons = [{ eyebrow: "01 / PROJECT SHAPE", title: "Start with the north star.", body: "The sample project is your tutorial desk. Close this lesson to see the General page it is describing, then use the Next lesson control on that page." }, { eyebrow: "02 / OUTLINE", title: "Give the story somewhere to go.", body: "Outline holds your scenes. Close this lesson to explore the scene map, then continue from the page when you are ready." }, { eyebrow: "03 / DRAFT", title: "Edit the scene that you chose.", body: "Draft is a real rich-text editor. Close this lesson to write, format, and place simple square images on the page." }, { eyebrow: "04 / MAKE IT YOURS", title: "Your work stays portable.", body: "Settings lets you tune the desk and export your work. Close this lesson to explore the controls." }]; const lesson = lessons[step] ?? lessons[0]; return <div className="modal-backdrop tutorial-backdrop" onMouseDown={onClose}><div className="modal tutorial-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="Close tutorial"><X size={17} /></button><div className="tutorial-mark"><span>A</span><i /></div><span className="eyebrow">{lesson.eyebrow}</span><h2>{lesson.title}</h2><p>{lesson.body}</p><div className="tutorial-progress">{lessons.map((_, index) => <span key={index} className={index <= step ? "active" : ""} />)}</div><div className="tutorial-actions"><button className="link-btn" onClick={onClose}>Close lesson</button><span className="tutorial-hint">Continue from the page</span></div></div></div>; }
function ProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (template: string, title: string, author: string) => void }) { const [template, setTemplate] = useState("Novel"); const [title, setTitle] = useState(""); const [author, setAuthor] = useState(""); const templateDetails: Record<string, string> = { Novel: "Long-form arc", Novella: "A compact journey", "Short Story": "One bright spark", "Research Paper": "Ideas in order", Empty: "Make your own shape" }; return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal project-modal" onMouseDown={(event) => event.stopPropagation()}><div className="project-modal-orbit" aria-hidden="true"><span /><i /><b>+</b></div><button className="modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button><div className="project-modal-heading"><span className="eyebrow">A NEW ROOM FOR WORDS</span><h2>Give the next idea<br /><em>somewhere to land.</em></h2><p>Choose a starting shape, then let the work become its own thing.</p></div><div className="template-options">{["Novel", "Novella", "Short Story", "Research Paper", "Empty"].map((value) => <button className={template === value ? "template-option selected" : "template-option"} key={value} onClick={() => setTemplate(value)}><span className="template-glyph">{value.slice(0, 1)}</span><b>{value}</b><small>{templateDetails[value]}</small><span className="template-check"><Check size={11} /></span></button>)}</div><div className="project-modal-fields"><div className="modal-section-label"><span>MAKE IT YOURS</span><i /></div><div className="two-fields"><TextField label="Project title" value={title} onChange={setTitle} placeholder={`Untitled ${template}`} /><TextField label="Author" value={author} onChange={setAuthor} placeholder="Your name" /></div></div><button className="primary-btn modal-submit" onClick={() => onCreate(template, title, author)}><Plus size={15} /> Create project</button></div></div>; }
function BriefModal({ project, onClose, onPublish, publishing }: { project: Project; onClose: () => void; onPublish: (brief: { plotConstraints: string; desiredRole: string; respondentLimit: 0 | 3 | 5 | 10 }) => void; publishing: boolean }) {
  const [plotConstraints, setPlotConstraints] = useState("");
  const [desiredRole, setDesiredRole] = useState("Co-author");
  const [respondentLimit, setRespondentLimit] = useState<0 | 3 | 5 | 10>(3);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal brief-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button><span className="eyebrow">THE BRIEF</span><h2>Post “{project.title}” to the pitch board?</h2><p>Your project becomes a frozen seed. Respondents fork it in their own studio, and you review their submitted forks before accepting one as a collaborator.</p><label className="field"><span>What should a collaborator know?</span><textarea value={plotConstraints} onChange={(event) => setPlotConstraints(event.target.value)} placeholder="Constraints, characters, or room to explore…" /></label><div className="two-fields"><label className="field"><span>Desired role</span><input value={desiredRole} onChange={(event) => setDesiredRole(event.target.value)} /></label><label className="field"><span>Respondent limit</span><select value={respondentLimit} onChange={(event) => setRespondentLimit(Number(event.target.value) as 0 | 3 | 5 | 10)}><option value={3}>3 voices</option><option value={5}>5 voices</option><option value={10}>10 voices</option><option value={0}>Unlimited</option></select></label></div><button className="primary-btn modal-submit" onClick={() => onPublish({ plotConstraints, desiredRole, respondentLimit })} disabled={publishing || !desiredRole.trim()}><Send size={15} /> {publishing ? "Publishing…" : "Publish to the pitch board"}</button></div></div>;
}
function NoteModal({ project, onClose, onSubmit, submitting }: { project: Project; onClose: () => void; onSubmit: (note: string) => void; submitting: boolean }) {
  const [note, setNote] = useState("");
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal note-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button><span className="eyebrow">BEFORE YOU SUBMIT</span><h2>Send “{project.title}” to the creator?</h2><p>Your fork — every scene, character, plot, and world page — is about to leave your desk and land in the creator's inbox for a read-only review.</p><label className="field"><span>A note for the creator</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tell them what you changed and where you were heading…" /></label><button className="primary-btn modal-submit" onClick={() => onSubmit(note.trim())} disabled={submitting}><Send size={15} /> {submitting ? "Submitting…" : "Submit fork to the creator"}</button></div></div>;
}
function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (file: File) => void }) { const input = useRef<HTMLInputElement>(null); return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal small-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button><span className="eyebrow">BRING IT IN</span><h2>Import a project</h2><p>Use a project JSON, Markdown file, or plain text draft.</p><div className="drop-zone" onClick={() => input.current?.click()}><Upload size={23} /><b>Choose a file</b><small>JSON, Markdown, or text</small><input ref={input} type="file" accept=".json,.msk,.md,.txt" hidden onChange={(event) => event.target.files?.[0] && onImport(event.target.files[0])} /></div></div></div>; }
function HelpModal({ onClose }: { onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal small-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button><span className="eyebrow">A FEW SHORTCUTS</span><h2>Keep your hands on the page.</h2><div className="shortcut-list"><div><kbd>⌘ K</kbd><span>Open search</span></div><div><kbd>⌘ S</kbd><span>Save a revision snapshot from Draft</span></div><div><kbd>⌘ Z</kbd><span>Undo your last edit</span></div><div><kbd>⌘ ⇧ F</kbd><span>Toggle focus mode in Draft</span></div></div></div></div>; }

export default App;