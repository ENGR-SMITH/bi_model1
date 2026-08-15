import { Router, type IRouter } from "express";
import { ContinuityAuditBody, OracleChatBody, OutlineAssistBody, ToneRewriteBody, VoiceConsistencyCheckBody, WorldBibleExtractBody } from "@workspace/api-zod";
import { askOracle, assistOutline, auditContinuity, checkVoiceConsistency, extractWorldBible, rewriteTone, type OutlineAssistMode } from "../lib/oracle";

const router: IRouter = Router();

router.post("/oracle/chat", async (req, res): Promise<void> => {
  const parsed = OracleChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Oracle request" });
    return;
  }
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  req.once("aborted", abortRequest);
  res.once("close", abortRequest);
  try {
    const result = await askOracle(parsed.data.messages, parsed.data.context, parsed.data.temperature, controller.signal);
    res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    req.log.warn({ err: error }, "All Oracle providers failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "No Oracle model is available" });
  } finally {
    req.off("aborted", abortRequest);
    res.off("close", abortRequest);
  }
});

router.post("/oracle/continuity", async (req, res): Promise<void> => {
  const parsed = ContinuityAuditBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid continuity request" });
    return;
  }
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  req.once("aborted", abortRequest);
  res.once("close", abortRequest);
  try {
    const result = await auditContinuity(parsed.data.context, parsed.data.focus, controller.signal);
    res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    req.log.warn({ err: error }, "Continuity audit failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "No Oracle model is available" });
  } finally {
    req.off("aborted", abortRequest);
    res.off("close", abortRequest);
  }
});

router.post("/oracle/rewrite", async (req, res): Promise<void> => {
  const parsed = ToneRewriteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid rewrite request" });
    return;
  }
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  req.once("aborted", abortRequest);
  res.once("close", abortRequest);
  try {
    const result = await rewriteTone(parsed.data.selectedText, parsed.data.voiceReference, parsed.data.instruction, controller.signal);
    res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    req.log.warn({ err: error }, "Tone rewrite failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "No Oracle model is available" });
  } finally {
    req.off("aborted", abortRequest);
    res.off("close", abortRequest);
  }
});

router.post("/oracle/outline", async (req, res): Promise<void> => {
  const parsed = OutlineAssistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid outline request" });
    return;
  }
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  req.once("aborted", abortRequest);
  res.once("close", abortRequest);
  try {
    const result = await assistOutline(parsed.data.mode as OutlineAssistMode, parsed.data.context, parsed.data.focus, controller.signal);
    res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    req.log.warn({ err: error }, "Outline assistance failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "No Oracle model is available" });
  } finally {
    req.off("aborted", abortRequest);
    res.off("close", abortRequest);
  }
});

router.post("/oracle/voice", async (req, res): Promise<void> => {
  const parsed = VoiceConsistencyCheckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid voice consistency request" });
    return;
  }
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  req.once("aborted", abortRequest);
  res.once("close", abortRequest);
  try {
    const result = await checkVoiceConsistency(parsed.data.characterProfile, parsed.data.context, parsed.data.focus, controller.signal);
    res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    req.log.warn({ err: error }, "Voice consistency check failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "No Oracle model is available" });
  } finally {
    req.off("aborted", abortRequest);
    res.off("close", abortRequest);
  }
});

router.post("/oracle/world-bible", async (req, res): Promise<void> => {
  const parsed = WorldBibleExtractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid world bible request" });
    return;
  }
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  req.once("aborted", abortRequest);
  res.once("close", abortRequest);
  try {
    const result = await extractWorldBible(parsed.data.context, parsed.data.focus, controller.signal);
    res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    req.log.warn({ err: error }, "World bible extraction failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "No Oracle model is available" });
  } finally {
    req.off("aborted", abortRequest);
    res.off("close", abortRequest);
  }
});

export default router;