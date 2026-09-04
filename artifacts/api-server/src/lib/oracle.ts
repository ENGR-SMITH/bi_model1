import crypto from "node:crypto";
import { eq, asc } from "drizzle-orm";
import { db, oracleHealthEventsTable, oracleProvidersTable, type OracleProvider } from "@workspace/db";
import { decryptSecret, encryptSecret, keyHint } from "./secrets";

export type ProviderId = "groq" | "openrouter" | "ollama" | "lmstudio" | "freebuff";
export type ProviderHealth = "connected" | "not_configured" | "checking" | "rate_limited" | "unavailable" | "error" | "disabled";
export const MAX_ORACLE_CONTEXT_CHARS = 12_000;
export const MAX_ORACLE_MESSAGE_CHARS = 4_000;

type ProviderDefinition = {
  id: ProviderId;
  label: string;
  baseUrl: string;
  models: Array<{ id: string; label: string }>;
};

export const providerDefinitions: ProviderDefinition[] = [
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4" },
      { id: "qwen/qwen3-32b", label: "Qwen3" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [{ id: "openrouter/free", label: "OpenRouter Free Router" }],
  },
  {
    id: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    models: [{ id: "llama3.2", label: "Local Llama 3.2" }],
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    models: [{ id: "local-model", label: "Local Model" }],
  },
  {
    id: "freebuff",
    label: "Freebuff",
    baseUrl: "http://localhost:8081/v1",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash 07/31" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro 08/13" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { id: "minimax-m3", label: "MiniMax M3" },
      { id: "mimo-2.5", label: "MiMo 2.5" },
      { id: "glm-5.2", label: "GLM 5.2" },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    ],
  },
];

const definitionFor = (id: string) => providerDefinitions.find((item) => item.id === id);

// Environment-variable mapping so model credentials can be set once in .env
// (or the deployment environment) and the admin page reflects them. API keys
// are only written when the row has none yet, so a key entered through the
// admin page always wins over the environment default. Read at call time so
// late-set environment variables (e.g. in tests) are honored.
function providerEnv(id: ProviderId): { apiKey?: string; baseUrl?: string; modelId?: string } {
  switch (id) {
    case "groq":
      return {
        apiKey: process.env.GROQ_API_KEY,
        baseUrl: process.env.GROQ_BASE_URL,
        modelId: process.env.GROQ_MODEL_ID,
      };
    case "openrouter":
      return {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseUrl: process.env.OPENROUTER_BASE_URL,
        modelId: process.env.OPENROUTER_MODEL_ID,
      };
    case "ollama":
      return {
        baseUrl: process.env.OLLAMA_BASE_URL,
        modelId: process.env.OLLAMA_MODEL_ID,
      };
    case "lmstudio":
      return {
        baseUrl: process.env.LMSTUDIO_BASE_URL,
        modelId: process.env.LMSTUDIO_MODEL_ID,
      };
    case "freebuff":
      return {
        apiKey: process.env.FREEBUFF_API_KEY,
        baseUrl: process.env.FREEBUFF_BASE_URL,
        modelId: process.env.FREEBUFF_MODEL_ID,
      };
  }
}

export async function ensureProviderRows(): Promise<void> {
  let existing = await db.select().from(oracleProvidersTable);
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const missing = providerDefinitions.filter((item) => !existingById.has(item.id));
  if (missing.length) {
    await db.insert(oracleProvidersTable).values(
      missing.map((item, index) => ({
        id: item.id,
        baseUrl: item.baseUrl,
        enabled: true,
        priority: index + 1,
        status: "not_configured",
      })),
    );
    existing = await db.select().from(oracleProvidersTable);
  }
  // Seed any provider whose credentials are supplied via environment.
  const rowsById = new Map(existing.map((item) => [item.id, item]));
  for (const definition of providerDefinitions) {
    const env = providerEnv(definition.id);
    const row = rowsById.get(definition.id);
    const patch: Partial<OracleProvider> = {};
    if (env?.apiKey && !row?.apiKeyCiphertext) {
      patch.apiKeyCiphertext = encryptSecret(env.apiKey.trim());
      patch.status = "not_configured";
    }
    if (env?.baseUrl && row?.baseUrl === definition.baseUrl) {
      patch.baseUrl = env.baseUrl;
    }
    if (env?.modelId) {
      patch.modelId = env.modelId;
    }
    if (Object.keys(patch).length) {
      await db.update(oracleProvidersTable).set(patch).where(eq(oracleProvidersTable.id, definition.id));
    }
  }
}

function statusFor(row: OracleProvider | undefined, now = new Date()): ProviderHealth {
  if (!row?.enabled) return "disabled";
  if (!row.apiKeyCiphertext && !["ollama", "lmstudio"].includes(row.id)) return "not_configured";
  if (row.cooldownUntil && row.cooldownUntil > now) return "rate_limited";
  return (row.status as ProviderHealth) || "not_configured";
}

export async function listProviderStatuses() {
  await ensureProviderRows();
  const rows = await db.select().from(oracleProvidersTable).orderBy(asc(oracleProvidersTable.priority));
  const latestSuccessAt = rows.reduce<Date | null>((latest, row) => {
    if (!row.lastSuccessAt || (latest && latest >= row.lastSuccessAt)) return latest;
    return row.lastSuccessAt;
  }, null);
  return rows.map((row) => {
    const definition = definitionFor(row.id)!;
    const providerStatus = statusFor(row);
    return {
      id: definition.id,
      label: definition.label,
      baseUrl: row.baseUrl ?? definition.baseUrl,
      configured: Boolean(row.apiKeyCiphertext) || ["ollama", "lmstudio"].includes(row.id),
      keyHint: keyHint(row.apiKeyCiphertext),
      enabled: row.enabled,
      priority: row.priority,
      status: providerStatus,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
      lastError: row.lastError ?? null,
      lastSuccessModelId: row.lastSuccessModelId ?? null,
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      isLastKnownGood: Boolean(row.lastSuccessAt && latestSuccessAt && row.lastSuccessAt.getTime() === latestSuccessAt.getTime()),
      models: [
        ...definition.models.map((model, index) => ({
          ...model,
          enabled: row.enabled && (row.modelId ? row.modelId === model.id : true),
          priority: row.priority * 10 + index,
          status: providerStatus,
          lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
          cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
          lastError: row.lastError ?? null,
        })),
        // Keep a saved custom model visible in the list so the admin page can
        // show it as selected even though it is not in the definition catalog.
        ...(row.modelId && !definition.models.some((model) => model.id === row.modelId)
          ? [{ id: row.modelId, label: `${row.modelId} (custom)`, enabled: row.enabled, priority: row.priority * 10 + definition.models.length, status: providerStatus, lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null, cooldownUntil: row.cooldownUntil?.toISOString() ?? null, lastError: row.lastError ?? null }]
          : []),
      ],
    };
  });
}

export async function updateProvider(id: ProviderId, input: { apiKey?: string | null; baseUrl?: string | null; modelId?: string | null; enabled: boolean; priority: number }) {
  await ensureProviderRows();
  const definition = definitionFor(id);
  if (!definition) throw new Error("Unknown provider");
  const model = input.modelId ? definition.models.find((item) => item.id === input.modelId) : undefined;
  if (input.modelId && !model) throw new Error("Unknown model for provider");
  const patch: Partial<OracleProvider> = {
    baseUrl: input.baseUrl?.trim() || definition.baseUrl,
    modelId: input.modelId || null,
    enabled: input.enabled,
    priority: Math.max(1, Math.round(input.priority)),
    status: input.enabled ? (input.apiKey || ["ollama", "lmstudio"].includes(id) ? "not_configured" : "not_configured") : "disabled",
    lastError: null,
    cooldownUntil: null,
  };
  if (input.apiKey !== undefined && input.apiKey !== null) patch.apiKeyCiphertext = input.apiKey.trim() ? encryptSecret(input.apiKey.trim()) : null;
  const [row] = await db.update(oracleProvidersTable).set(patch).where(eq(oracleProvidersTable.id, id)).returning();
  return row;
}

async function getConfiguredRows() {
  await ensureProviderRows();
  return db.select().from(oracleProvidersTable).orderBy(asc(oracleProvidersTable.priority));
}

function endpointFor(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

function errorStatus(responseStatus: number): ProviderHealth {
  if (responseStatus === 429) return "rate_limited";
  if (responseStatus >= 500) return "unavailable";
  return "error";
}

async function recordHealthEvent(input: {
  providerId: string;
  modelId?: string | null;
  eventType: string;
  status: ProviderHealth;
  responseStatus?: number | null;
}) {
  await db.insert(oracleHealthEventsTable).values({
    id: crypto.randomUUID(),
    providerId: input.providerId,
    modelId: input.modelId ?? null,
    eventType: input.eventType,
    status: input.status,
    responseStatus: input.responseStatus ?? null,
  });
}

async function callProvider(row: OracleProvider, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, temperature?: number, signal?: AbortSignal) {
  const definition = definitionFor(row.id)!;
  const modelId = row.modelId ?? definition.models[0].id;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (row.apiKeyCiphertext) headers.authorization = `Bearer ${decryptSecret(row.apiKeyCiphertext)}`;
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(18_000)])
    : AbortSignal.timeout(18_000);
  const response = await fetch(endpointFor(row.baseUrl ?? definition.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ model: modelId, messages, temperature: temperature ?? 0.3, max_tokens: 1200 }),
    signal: requestSignal,
  });
  if (!response.ok) {
    const error = new Error(`Provider returned ${response.status}`);
    Object.assign(error, { providerStatus: errorStatus(response.status), responseStatus: response.status });
    throw error;
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Provider returned no content");
  return { content, modelId };
}

async function markFailure(row: OracleProvider, health: ProviderHealth, message: string, responseStatus?: number) {
  const cooldownMs = health === "rate_limited" ? 60_000 : health === "unavailable" ? 20_000 : 5_000;
  await db.update(oracleProvidersTable).set({
    status: health,
    lastError: message.slice(0, 240),
    lastCheckedAt: new Date(),
    cooldownUntil: new Date(Date.now() + cooldownMs),
  }).where(eq(oracleProvidersTable.id, row.id));
  await recordHealthEvent({
    providerId: row.id,
    modelId: row.modelId ?? definitionFor(row.id)?.models[0]?.id,
    eventType: health === "rate_limited" ? "rate_limited" : "request_failed",
    status: health,
    responseStatus: responseStatus ?? null,
  });
}

export async function checkProvider(id: ProviderId) {
  await ensureProviderRows();
  const [row] = await db.select().from(oracleProvidersTable).where(eq(oracleProvidersTable.id, id));
  if (!row) throw new Error("Unknown provider");
  if (!row.apiKeyCiphertext && !["ollama", "lmstudio"].includes(id)) {
    await db.update(oracleProvidersTable).set({ status: "not_configured", lastCheckedAt: new Date(), lastError: null }).where(eq(oracleProvidersTable.id, id));
    return;
  }
  try {
    const result = await callProvider(row, [{ role: "user", content: "Reply with the single word OK." }], 0, AbortSignal.timeout(10_000));
    await db.update(oracleProvidersTable).set({ status: "connected", lastCheckedAt: new Date(), lastError: null, cooldownUntil: null }).where(eq(oracleProvidersTable.id, id));
    await recordHealthEvent({ providerId: row.id, modelId: result.modelId, eventType: "health_check", status: "connected" });
  } catch (error) {
    const health = ((error as { providerStatus?: ProviderHealth }).providerStatus ?? "error");
    await markFailure(row, health, error instanceof Error ? error.message : "Connection check failed", (error as { responseStatus?: number }).responseStatus);
  }
}

export async function askOracle(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, context?: string | null, temperature?: number, signal?: AbortSignal) {
  const rows = await getConfiguredRows();
  const attempted: string[] = [];
  const boundedContext = context?.slice(0, MAX_ORACLE_CONTEXT_CHARS) ?? null;
  const boundedMessages = messages.map((message) => ({
    ...message,
    content: message.content.slice(0, MAX_ORACLE_MESSAGE_CHARS),
  }));
  const fullMessages = boundedContext
    ? [{ role: "system" as const, content: `Project context selected by the author:\n${boundedContext}` }, ...boundedMessages]
    : boundedMessages;
  for (const row of rows) {
    if (signal?.aborted) throw new DOMException("Oracle request canceled", "AbortError");
    if (!row.enabled || statusFor(row) === "rate_limited" || (!row.apiKeyCiphertext && !["ollama", "lmstudio"].includes(row.id))) continue;
    attempted.push(row.id);
    try {
      const result = await callProvider(row, fullMessages, temperature, signal);
      const successAt = new Date();
      await db.update(oracleProvidersTable).set({
        status: "connected",
        lastCheckedAt: successAt,
        lastError: null,
        cooldownUntil: null,
        lastSuccessModelId: result.modelId,
        lastSuccessAt: successAt,
      }).where(eq(oracleProvidersTable.id, row.id));
      await recordHealthEvent({ providerId: row.id, modelId: result.modelId, eventType: "request_succeeded", status: "connected" });
      return { content: result.content, providerId: row.id, modelId: result.modelId, attempted };
    } catch (error) {
      if (signal?.aborted) throw error;
      const health = ((error as { providerStatus?: ProviderHealth }).providerStatus ?? "error");
      await markFailure(row, health, error instanceof Error ? error.message : "Oracle request failed", (error as { responseStatus?: number }).responseStatus);
    }
  }
  throw new Error("No configured Story Oracle model is currently available");
}

type ContinuityIssue = {
  id: string;
  category: "character" | "timeline" | "location" | "world" | "plot" | "other";
  severity: "high" | "medium" | "low";
  claim: string;
  evidence: string[];
  explanation: string;
  suggestion: string;
};

type VoiceConsistencyIssue = {
  id: string;
  category: "diction" | "rhythm" | "worldview" | "knowledge" | "emotion" | "other";
  severity: "high" | "medium" | "low";
  claim: string;
  evidence: string[];
  explanation: string;
  suggestion: string;
};

type WorldBibleEntry = {
  id: string;
  kind: "location" | "item" | "rule";
  name: string;
  description: string;
  evidence: string[];
  suggestedWorldKind: "Place" | "Country" | "Culture" | "Object" | "System" | "Institution";
};

function parseContinuityIssues(content: string): ContinuityIssue[] {
  const unfenced = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) throw new Error("Continuity model returned an invalid result");
  const parsed = JSON.parse(unfenced.slice(objectStart, objectEnd + 1)) as { issues?: unknown };
  if (!Array.isArray(parsed.issues)) throw new Error("Continuity model returned no issue list");
  return parsed.issues.flatMap((item, index): ContinuityIssue[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const evidence = Array.isArray(value.evidence) ? value.evidence.filter((entry): entry is string => typeof entry === "string").slice(0, 4) : [];
    if (typeof value.claim !== "string" || !evidence.length || typeof value.explanation !== "string" || typeof value.suggestion !== "string") return [];
    const categories = new Set<ContinuityIssue["category"]>(["character", "timeline", "location", "world", "plot", "other"]);
    const severities = new Set<ContinuityIssue["severity"]>(["high", "medium", "low"]);
    const category = categories.has(value.category as ContinuityIssue["category"]) ? value.category as ContinuityIssue["category"] : "other";
    const severity = severities.has(value.severity as ContinuityIssue["severity"]) ? value.severity as ContinuityIssue["severity"] : "low";
    return [{
      id: typeof value.id === "string" && value.id ? value.id : `continuity-${index + 1}`,
      category,
      severity,
      claim: value.claim.slice(0, 500),
      evidence,
      explanation: value.explanation.slice(0, 800),
      suggestion: value.suggestion.slice(0, 800),
    }];
  });
}

function parseVoiceConsistencyIssues(content: string): VoiceConsistencyIssue[] {
  const unfenced = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) throw new Error("Voice consistency model returned an invalid result");
  const parsed = JSON.parse(unfenced.slice(objectStart, objectEnd + 1)) as { issues?: unknown };
  if (!Array.isArray(parsed.issues)) throw new Error("Voice consistency model returned no issue list");
  return parsed.issues.flatMap((item, index): VoiceConsistencyIssue[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const evidence = Array.isArray(value.evidence) ? value.evidence.filter((entry): entry is string => typeof entry === "string").slice(0, 4) : [];
    if (typeof value.claim !== "string" || !evidence.length || typeof value.explanation !== "string" || typeof value.suggestion !== "string") return [];
    const categories = new Set<VoiceConsistencyIssue["category"]>(["diction", "rhythm", "worldview", "knowledge", "emotion", "other"]);
    const severities = new Set<VoiceConsistencyIssue["severity"]>(["high", "medium", "low"]);
    const category = categories.has(value.category as VoiceConsistencyIssue["category"]) ? value.category as VoiceConsistencyIssue["category"] : "other";
    const severity = severities.has(value.severity as VoiceConsistencyIssue["severity"]) ? value.severity as VoiceConsistencyIssue["severity"] : "low";
    return [{
      id: typeof value.id === "string" && value.id ? value.id : `voice-${index + 1}`,
      category,
      severity,
      claim: value.claim.slice(0, 500),
      evidence,
      explanation: value.explanation.slice(0, 800),
      suggestion: value.suggestion.slice(0, 800),
    }];
  });
}

function parseWorldBibleEntries(content: string): WorldBibleEntry[] {
  const unfenced = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) throw new Error("World bible model returned an invalid result");
  const parsed = JSON.parse(unfenced.slice(objectStart, objectEnd + 1)) as { entries?: unknown };
  if (!Array.isArray(parsed.entries)) throw new Error("World bible model returned no entry list");
  return parsed.entries.flatMap((item, index): WorldBibleEntry[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const evidence = Array.isArray(value.evidence) ? value.evidence.filter((entry): entry is string => typeof entry === "string").slice(0, 4) : [];
    if (typeof value.name !== "string" || !value.name.trim() || typeof value.description !== "string" || !value.description.trim() || !evidence.length) return [];
    const kinds = new Set<WorldBibleEntry["kind"]>(["location", "item", "rule"]);
    const worldKinds = new Set<WorldBibleEntry["suggestedWorldKind"]>(["Place", "Country", "Culture", "Object", "System", "Institution"]);
    const kind = kinds.has(value.kind as WorldBibleEntry["kind"]) ? value.kind as WorldBibleEntry["kind"] : "location";
    const suggestedWorldKind = worldKinds.has(value.suggestedWorldKind as WorldBibleEntry["suggestedWorldKind"])
      ? value.suggestedWorldKind as WorldBibleEntry["suggestedWorldKind"]
      : kind === "item" ? "Object" : kind === "rule" ? "System" : "Place";
    return [{
      id: typeof value.id === "string" && value.id ? value.id : `world-entry-${index + 1}`,
      kind,
      name: value.name.trim().slice(0, 180),
      description: value.description.trim().slice(0, 800),
      evidence,
      suggestedWorldKind,
    }];
  });
}

export async function auditContinuity(context: string, focus?: string | null, signal?: AbortSignal) {
  const result = await askOracle(
    [{
      role: "system",
      content: [
        "You are a meticulous fiction continuity editor.",
        "Audit only the selected manuscript context. Do not invent contradictions, and do not flag intentional ambiguity unless the text creates a clear factual conflict.",
        "Compare recurring facts about character identity, age, appearance, backstory, timeline, location history, world rules, and plot state.",
        "Return JSON only, with this exact shape: {\"issues\":[{\"id\":\"string\",\"category\":\"character|timeline|location|world|plot|other\",\"severity\":\"high|medium|low\",\"claim\":\"short factual claim\",\"evidence\":[\"scene title and quoted/paraphrased detail\",\"another scene and detail\"],\"explanation\":\"why these details conflict\",\"suggestion\":\"a concrete revision choice\"}]}",
        "Use an empty issues array when there are no supported conflicts.",
      ].join(" "),
    }, {
      role: "user",
      content: `Audit this selected material for continuity conflicts.${focus?.trim() ? ` Focus especially on: ${focus.trim()}` : ""}`,
    }],
    context,
    0.1,
    signal,
  );
  return {
    issues: parseContinuityIssues(result.content),
    providerId: result.providerId,
    modelId: result.modelId,
    attempted: result.attempted,
  };
}

export async function checkVoiceConsistency(characterProfile: string, context: string, focus?: string | null, signal?: AbortSignal) {
  const result = await askOracle(
    [{
      role: "system",
      content: [
        "You are a precise fiction character-voice editor.",
        "Compare the selected character profile and author notes against the character's dialogue, interiority, reactions, and knowledge in the selected scenes.",
        "Flag only supported drift: diction, rhythm, worldview, knowledge, or emotional behavior that feels inconsistent with the profile or established voice. Do not penalize intentional growth, disguise, trauma responses, or a deliberately different situation unless the context gives no signal for it.",
        "Return JSON only, with this exact shape: {\"issues\":[{\"id\":\"string\",\"category\":\"diction|rhythm|worldview|knowledge|emotion|other\",\"severity\":\"high|medium|low\",\"claim\":\"short voice claim\",\"evidence\":[\"scene title and quoted/paraphrased detail\",\"profile or another scene detail\"],\"explanation\":\"why this may be a voice drift\",\"suggestion\":\"a concrete revision or confirmation choice\"}]}",
        "Use an empty issues array when the selected material supports a consistent voice.",
      ].join(" "),
    }, {
      role: "user",
      content: `${focus?.trim() ? `Author focus:\n${focus.trim()}\n\n` : ""}Character profile and notes:\n${characterProfile}\n\nSelected scene material:\n${context}`,
    }],
    context,
    0.15,
    signal,
  );
  return {
    issues: parseVoiceConsistencyIssues(result.content),
    providerId: result.providerId,
    modelId: result.modelId,
    attempted: result.attempted,
  };
}

export async function extractWorldBible(context: string, focus?: string | null, signal?: AbortSignal) {
  const result = await askOracle(
    [{
      role: "system",
      content: [
        "You are a careful fiction world-bible editor.",
        "Extract only concrete, recurring or story-significant world details supported by the selected project material: locations, physical or symbolic items, and rules or systems that govern the world.",
        "Do not invent details, promote ordinary passing nouns into lore, or duplicate entries that are clearly the same thing. Keep descriptions concise and useful to an author.",
        "Return JSON only, with this exact shape: {\"entries\":[{\"id\":\"string\",\"kind\":\"location|item|rule\",\"name\":\"short name\",\"description\":\"concise author-facing description\",\"evidence\":[\"scene title and quoted/paraphrased support\"],\"suggestedWorldKind\":\"Place|Country|Culture|Object|System|Institution\"}]}",
        "Use an empty entries array when the selected material does not support a useful extraction.",
      ].join(" "),
    }, {
      role: "user",
      content: `${focus?.trim() ? `Author focus:\n${focus.trim()}\n\n` : ""}Extract a reviewable world bible from this selected material:\n${context}`,
    }],
    context,
    0.2,
    signal,
  );
  return {
    entries: parseWorldBibleEntries(result.content),
    providerId: result.providerId,
    modelId: result.modelId,
    attempted: result.attempted,
  };
}

export async function rewriteTone(selectedText: string, voiceReference: string, instruction?: string | null, signal?: AbortSignal) {
  const result = await askOracle(
    [{
      role: "system",
      content: [
        "You are a careful fiction line editor.",
        "Rewrite only the selected passage so it carries the voice, rhythm, diction, and narrative distance of the reference.",
        "Preserve the selected passage's meaning, facts, point of view, and approximate length unless the instruction asks otherwise.",
        "Do not add plot facts, explain your choices, wrap the answer in quotes, or use markdown.",
        "Return only the rewritten passage.",
      ].join(" "),
    }, {
      role: "user",
      content: `Selected passage:\n${selectedText}\n\n${instruction?.trim() ? `Additional instruction:\n${instruction.trim()}` : "Keep the same narrative purpose and scene facts."}`,
    }],
    voiceReference.slice(0, MAX_ORACLE_CONTEXT_CHARS),
    0.45,
    signal,
  );
  return {
    content: result.content.replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim(),
    providerId: result.providerId,
    modelId: result.modelId,
    attempted: result.attempted,
  };
}

export type OutlineAssistMode = "premise_expansion" | "scene_ideas" | "chapter_breaks";

const outlineModeInstructions: Record<OutlineAssistMode, string> = {
  premise_expansion: "Expand the premise into a sharper story promise, central tension, escalating stakes, and three possible directions. Keep the author's existing genre and material; do not replace the premise with a different story.",
  scene_ideas: "Suggest five specific next-scene ideas. For each, include the scene purpose, pressure or turn, point-of-view opportunity, and the unresolved question it leaves behind. Prefer concrete actions over abstract themes.",
  chapter_breaks: "Review the selected scene sequence for pacing. Suggest natural chapter breaks, explaining the turning point at each break and whether the break creates enough forward pull. Do not invent scene events that are not supported by the context.",
};

export type CollaborationAdvisorySignal = {
  category: string;
  level: "positive" | "neutral" | "attention";
  title: string;
  detail: string;
};

function parseCollaborationAdvisorySignals(content: string): CollaborationAdvisorySignal[] {
  const unfenced = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) throw new Error("Advisory model returned an invalid result");
  const parsed = JSON.parse(unfenced.slice(objectStart, objectEnd + 1)) as { signals?: unknown };
  if (!Array.isArray(parsed.signals)) throw new Error("Advisory model returned no signal list");
  return parsed.signals.flatMap((item, index): CollaborationAdvisorySignal[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.title !== "string" || !value.title.trim() || typeof value.detail !== "string" || !value.detail.trim()) return [];
    const levels = new Set<CollaborationAdvisorySignal["level"]>(["positive", "neutral", "attention"]);
    const level = levels.has(value.level as CollaborationAdvisorySignal["level"]) ? value.level as CollaborationAdvisorySignal["level"] : "neutral";
    return [{
      category: typeof value.category === "string" && value.category ? value.category.slice(0, 40) : "observation",
      level,
      title: value.title.slice(0, 160),
      detail: value.detail.slice(0, 600),
    }];
  }).slice(0, 5);
}

/**
 * Optional, advisory-only observations comparing a frozen seed with a
 * submitted continuation. Always advisory: it never ranks the writer and
 * never decides selection. Throws when no Story Oracle provider is
 * available so callers can degrade to local checks.
 */
export async function observeCollaboration(seedText: string, continuationText: string, signal?: AbortSignal) {
  const result = await askOracle(
    [{
      role: "system",
      content: [
        "You are a careful, neutral fiction collaboration observer.",
        "Compare the frozen seed (the opening the creator protects) with the submitted continuation.",
        "Report only supported observations: tone drift, continuity conflicts, character or domain consistency, and whether the continuation opens rather than closes the story.",
        "Never rank the writer, never recommend or decide selection, and never alter any prose. Keep every observation specific and human-reviewable.",
        "Return JSON only, with this exact shape: {\"signals\":[{\"category\":\"tone|continuity|character|scope|compatibility\",\"level\":\"positive|neutral|attention\",\"title\":\"short title\",\"detail\":\"specific observation\"}]}",
        "Use an empty signals array when there is nothing supported to report.",
      ].join(" "),
    }, {
      role: "user",
      content: "Observe this seed and continuation. Report at most five signals.",
    }],
    `Frozen seed:\n${seedText}\n\nSubmitted continuation:\n${continuationText}`,
    0.2,
    signal,
  );
  return {
    signals: parseCollaborationAdvisorySignals(result.content),
    providerId: result.providerId,
    modelId: result.modelId,
    attempted: result.attempted,
  };
}

export async function assistOutline(mode: OutlineAssistMode, context: string, focus?: string | null, signal?: AbortSignal) {
  const result = await askOracle(
    [{
      role: "system",
      content: [
        "You are a thoughtful fiction story architect.",
        outlineModeInstructions[mode],
        "Use clear headings and concise bullets. Return only the useful editorial output, without mentioning system prompts, providers, or missing information.",
      ].join(" "),
    }, {
      role: "user",
      content: `${focus?.trim() ? `Author focus:\n${focus.trim()}\n\n` : ""}Work from this selected project material:\n${context}`,
    }],
    context,
    0.4,
    signal,
  );
  return {
    content: result.content.replace(/^```(?:markdown|text)?\s*/i, "").replace(/\s*```$/i, "").trim(),
    providerId: result.providerId,
    modelId: result.modelId,
    attempted: result.attempted,
  };
}