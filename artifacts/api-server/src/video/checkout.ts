import {
  db,
  tandemVideoAssetsTable,
  tandemVideoProjectsTable,
  tandemVideoTimelineVersionsTable,
  tandemVideoTimelinesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  buildCheckoutManifest,
  type CheckoutMediaItem,
  type EdlClip,
} from "./edl";
import { buildTimelineEdl } from "./edl";
import { buildTimelineFcpxml } from "./fcpxml";
import { buildTimelineOtio } from "./otio";
import { buildTimelineAaf } from "./aaf";

export interface CheckoutBundle {
  projectId: string;
  projectName: string;
  leg: string;
  version: number | null;
  edl: string;
  fcpxml: string;
  otio: string;
  aaf: Buffer;
  manifest: CheckoutMediaItem[];
}

/**
 * Load a leg's saved snapshot and build all four interchange documents plus
 * the media manifest. Returns null when the leg has no saved snapshot yet.
 * Shared by the synchronous checkout routes and the EXPORT_BUNDLE worker
 * processor, so both always speak the same bytes.
 */
export async function buildCheckout(
  projectId: string,
  leg: string,
): Promise<CheckoutBundle | null> {
  const [project] = await db
    .select()
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.id, projectId))
    .limit(1);
  if (!project) return null;

  const [timeline] = await db
    .select()
    .from(tandemVideoTimelinesTable)
    .where(
      and(
        eq(tandemVideoTimelinesTable.projectId, projectId),
        eq(tandemVideoTimelinesTable.leg, leg),
      ),
    )
    .limit(1);
  if (!timeline || !timeline.currentVersionId) return null;

  const [version] = await db
    .select()
    .from(tandemVideoTimelineVersionsTable)
    .where(eq(tandemVideoTimelineVersionsTable.id, timeline.currentVersionId))
    .limit(1);
  if (!version) return null;

  const snapshot = (version.snapshot ?? {}) as { clips?: EdlClip[] };
  const clips = Array.isArray(snapshot.clips) ? snapshot.clips : [];
  const assetIds = [...new Set(clips.map((clip) => clip.assetId).filter(Boolean))];

  const assets = assetIds.length
    ? await db
        .select()
        .from(tandemVideoAssetsTable)
        .where(inArray(tandemVideoAssetsTable.id, assetIds))
    : [];
  const assetById = new Map(
    assets.map((asset) => [asset.id, { fileName: asset.fileName, kind: asset.kind }]),
  );

  const title = `${project.name} — ${leg}`;
  return {
    projectId,
    projectName: project.name,
    leg,
    version: version.version,
    edl: buildTimelineEdl({ title, version: version.version, clips, assetById }),
    fcpxml: buildTimelineFcpxml({ title, version: version.version, clips, assetById }),
    otio: buildTimelineOtio({ title, version: version.version, clips, assetById }),
    aaf: buildTimelineAaf({ title, version: version.version, clips, assetById }),
    manifest: buildCheckoutManifest(clips, assetById),
  };
}
