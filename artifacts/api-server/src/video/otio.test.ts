import { describe, expect, it } from "vitest";
import {
  buildTimelineOtio,
  parseTimelineOtio,
  resolveOtioEvents,
} from "./otio";
import type { EdlClip } from "./edl";

const camA = "asset-cam-a";
const camB = "asset-cam-b";

function clips(): EdlClip[] {
  return [
    { id: "c1", assetId: camA, inMs: 0, outMs: 5000, srcInMs: 0, srcOutMs: 5000 },
    { id: "c2", assetId: camB, inMs: 5000, outMs: 9000, srcInMs: 2000, srcOutMs: 6000 },
  ];
}

const assets = new Map<string, { fileName: string; kind: string }>([
  [camA, { fileName: "interview-cam-a.mp4", kind: "RAW_VIDEO" }],
  [camB, { fileName: "broll-shot.mp4", kind: "B_ROLL" }],
]);

describe("buildTimelineOtio", () => {
  it("emits a Timeline.1 document with a video track of clips", () => {
    const json = buildTimelineOtio({ title: "The Cut", version: 3, clips: clips(), assetById: assets });
    const doc = JSON.parse(json) as Record<string, unknown>;
    expect(doc.OTIO_SCHEMA).toBe("Timeline.1");
    expect(doc.name).toBe("The Cut");
    expect((doc.metadata as { creatorsDen: { version: number } }).creatorsDen.version).toBe(3);

    const track = ((doc.tracks as { children: Array<{ kind: string; children: unknown[] }> }).children)[0];
    expect(track.kind).toBe("Video");
    expect(track.children).toHaveLength(2);

    const first = track.children[0] as {
      OTIO_SCHEMA: string;
      name: string;
      source_range: { start_time: { value: number; rate: number }; duration: { value: number } };
      media_references: { target_url: string };
      metadata: { assetId: string };
    };
    expect(first.OTIO_SCHEMA).toBe("Clip.1");
    expect(first.name).toBe("interview-cam-a.mp4");
    expect(first.source_range.start_time).toMatchObject({ value: 0, rate: 25 });
    expect(first.source_range.duration.value).toBe(125); // 5000ms @ 25fps
    expect(first.media_references.target_url).toBe("file:///vault/interview-cam-a.mp4");
    expect(first.metadata.assetId).toBe(camA);
  });

  it("parses back its own output with the same clip windows", () => {
    const json = buildTimelineOtio({ title: "The Cut", clips: clips(), assetById: assets });
    const parsed = parseTimelineOtio(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ assetId: camA, offsetMs: 0, durationMs: 5000, startMs: 0 });
    expect(parsed[1]).toMatchObject({
      assetId: camB,
      offsetMs: 5000,
      durationMs: 4000,
      startMs: 2000,
      targetUrl: "file:///vault/broll-shot.mp4",
    });
  });
});

describe("parseTimelineOtio", () => {
  it("accumulates record offsets across gaps and skips non-video tracks", () => {
    const doc = {
      OTIO_SCHEMA: "Timeline.1",
      name: "P",
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        children: [
          {
            OTIO_SCHEMA: "Track.1",
            kind: "Audio",
            children: [
              { OTIO_SCHEMA: "Clip.1", name: "audio.wav", source_range: { duration: { value: 125, rate: 25 } } },
            ],
          },
          {
            OTIO_SCHEMA: "Track.1",
            kind: "Video",
            children: [
              { OTIO_SCHEMA: "Clip.1", name: "a.mp4", source_range: { start_time: { value: 25, rate: 25 }, duration: { value: 125, rate: 25 } } },
              { OTIO_SCHEMA: "Gap.1", source_range: { duration: { value: 50, rate: 25 } } },
              { OTIO_SCHEMA: "Clip.1", name: "b.mp4", source_range: { start_time: { value: 50, rate: 25 }, duration: { value: 100, rate: 25 } } },
            ],
          },
        ],
      },
    };
    const parsed = parseTimelineOtio(JSON.stringify(doc));
    // Only the two video clips; the audio track and the gap are skipped.
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ name: "a.mp4", offsetMs: 0, durationMs: 5000, startMs: 1000 });
    // The gap advanced the record cursor by 2000ms.
    expect(parsed[1]).toMatchObject({ name: "b.mp4", offsetMs: 7000, durationMs: 4000, startMs: 2000 });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseTimelineOtio("not json")).toThrow(/Invalid OTIO/);
    expect(() => parseTimelineOtio('{"OTIO_SCHEMA": "Timeline.1"}')).not.toThrow();
    expect(parseTimelineOtio('{"OTIO_SCHEMA": "Timeline.1"}')).toHaveLength(0);
  });
});

describe("resolveOtioEvents", () => {
  it("relinks by metadata.assetId first, then by target_url basename", () => {
    const json = buildTimelineOtio({ title: "x", clips: clips(), assetById: assets });
    const parsed = parseTimelineOtio(json);
    const { clips: resolved, unresolved } = resolveOtioEvents(parsed, [
      { id: camA, fileName: "interview-cam-a.mp4" },
      { id: camB, fileName: "broll-shot.mp4" },
    ]);
    expect(unresolved).toEqual([]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].assetId).toBe(camA);
    expect(resolved[0].inMs).toBe(0);
    expect(resolved[0].outMs).toBe(5000);
    expect(resolved[0].srcInMs).toBe(0);
    expect(resolved[1].assetId).toBe(camB);
    expect(resolved[1].inMs).toBe(5000);
    expect(resolved[1].outMs).toBe(9000);
    expect(resolved[1].srcInMs).toBe(2000);
    expect(resolved[1].srcOutMs).toBe(6000);
  });

  it("falls back to file-name matching when the assetId is foreign", () => {
    const parsed = parseTimelineOtio(
      JSON.stringify({
        OTIO_SCHEMA: "Timeline.1",
        name: "P",
        tracks: {
          children: [
            {
              kind: "Video",
              children: [
                {
                  OTIO_SCHEMA: "Clip.1",
                  name: "take 01.MP4",
                  source_range: { start_time: { value: 0, rate: 25 }, duration: { value: 125, rate: 25 } },
                  media_references: { target_url: "file:///Media/take 01.MP4" },
                  metadata: {},
                },
              ],
            },
          ],
        },
      }),
    );
    const { clips: resolved, unresolved } = resolveOtioEvents(parsed, [
      { id: camA, fileName: "take 01.mov" }, // different extension, same base name
    ]);
    expect(unresolved).toEqual([]);
    expect(resolved[0].assetId).toBe(camA);
  });

  it("reports sources that cannot be relinked", () => {
    const parsed = parseTimelineOtio(
      JSON.stringify({
        OTIO_SCHEMA: "Timeline.1",
        name: "P",
        tracks: {
          children: [
            {
              kind: "Video",
              children: [
                {
                  OTIO_SCHEMA: "Clip.1",
                  name: "missing.mp4",
                  source_range: { start_time: { value: 0, rate: 25 }, duration: { value: 125, rate: 25 } },
                  media_references: { target_url: "file:///Media/missing.mp4" },
                },
              ],
            },
          ],
        },
      }),
    );
    const { clips: resolved, unresolved } = resolveOtioEvents(parsed, [
      { id: camA, fileName: "interview-cam-a.mp4" },
    ]);
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual(["file:///Media/missing.mp4"]);
  });
});
