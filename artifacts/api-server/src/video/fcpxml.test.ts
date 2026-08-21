import { describe, expect, it } from "vitest";
import {
  buildTimelineFcpxml,
  formatFcpxmlTime,
  parseFcpxmlTime,
  parseTimelineFcpxml,
  resolveFcpxmlEvents,
} from "./fcpxml";
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

describe("FCPXML time helpers", () => {
  it("round-trips milliseconds through rational seconds", () => {
    // 25fps quantizes to 40ms frames — use frame-aligned values.
    for (const ms of [0, 1000, 45240, 60000, 3600000, 3723440]) {
      expect(parseFcpxmlTime(formatFcpxmlTime(ms))).toBe(ms);
    }
  });

  it("parses plain and rational time strings", () => {
    expect(parseFcpxmlTime("0s")).toBe(0);
    expect(parseFcpxmlTime("5s")).toBe(5000);
    expect(parseFcpxmlTime("125/25s")).toBe(5000);
    expect(parseFcpxmlTime("3600/25s")).toBe(144000);
  });

  it("rejects malformed times", () => {
    expect(() => parseFcpxmlTime("nope")).toThrow(/Invalid FCPXML time/);
    expect(() => parseFcpxmlTime("3600/25")).toThrow(/Invalid FCPXML time/);
  });
});

describe("buildTimelineFcpxml", () => {
  it("emits a self-describing FCPXML 1.9 project with assets and spine clips", () => {
    const xml = buildTimelineFcpxml({ title: "The Cut", version: 3, clips: clips(), assetById: assets });
    expect(xml).toContain(`<fcpxml version="1.9"`);
    expect(xml).toContain("<!DOCTYPE fcpxml");
    expect(xml).toContain(`name="FFVideoFormat1080p25"`);
    expect(xml).toContain(`<asset id="${camA}"`);
    expect(xml).toContain(`name="interview-cam-a.mp4"`);
    expect(xml).toContain(`src="file:///vault/broll-shot.mp4"`);
    expect(xml).toContain(`<spine>`);
    expect(xml).toContain(`uid="${camA}" ref="${camA}" offset="0/25s" duration="125/25s" start="0/25s"`);
    expect(xml).toContain(`uid="${camB}" ref="${camB}" offset="125/25s" duration="100/25s" start="50/25s"`);
  });

  it("escapes XML metacharacters in file names", () => {
    const weird = new Map([[camA, { fileName: "take & 2 <final>.mp4", kind: "RAW_VIDEO" }]]);
    const xml = buildTimelineFcpxml({ title: "x", clips: clips().slice(0, 1), assetById: weird });
    expect(xml).toContain("take &amp; 2 &lt;final&gt;.mp4");
    expect(xml).not.toContain("take & 2 <final>");
  });

  it("parses back its own output with the same clip windows", () => {
    const xml = buildTimelineFcpxml({ title: "The Cut", clips: clips(), assetById: assets });
    const parsed = parseTimelineFcpxml(xml);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ uid: camA, offsetMs: 0, durationMs: 5000, startMs: 0 });
    expect(parsed[1]).toMatchObject({ uid: camB, offsetMs: 5000, durationMs: 4000, startMs: 2000, srcName: "broll-shot.mp4" });
  });
});

describe("parseTimelineFcpxml", () => {
  it("parses an NLE-style document and skips non-spine tracks", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>
    <asset id="r2" name="a.mp4" src="file:///Media/a.mp4" start="0s" duration="12000/25s" format="r1"/>
    <asset id="r3" name="b.mp4" src="file:///Media/b.mp4" start="0s" duration="12000/25s" format="r1"/>
  </resources>
  <library><event name="E"><project name="P"><sequence format="r1" duration="12000/25s"><spine>
    <clip name="a.mp4" ref="r2" offset="0s" duration="125/25s" start="25/25s" format="r1" tcFormat="NDF"/>
    <sync-clip name="sync">
      <clip name="b.mp4" ref="r3" offset="0s" duration="125/25s" start="0s" format="r1"/>
    </sync-clip>
    <gap name="gap" offset="125/25s" duration="25/25s"/>
    <clip name="b.mp4" ref="r3" offset="150/25s" duration="100/25s" start="50/25s" format="r1"/>
  </spine></sequence></project></event></library>
</fcpxml>`;
    const parsed = parseTimelineFcpxml(xml);
    // Only the two direct spine clips; the sync-clip child and gap are skipped.
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ name: "a.mp4", srcName: "a.mp4", offsetMs: 0, durationMs: 5000, startMs: 1000 });
    expect(parsed[1]).toMatchObject({ name: "b.mp4", srcName: "b.mp4", offsetMs: 6000, durationMs: 4000, startMs: 2000 });
  });

  it("decodes XML entities in attribute values", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>
    <asset id="r2" name="a &amp; b.mp4" src="file:///Media/a &amp; b.mp4" start="0s" duration="5000/25s" format="r1"/>
  </resources>
  <library><event name="E"><project name="P"><sequence format="r1" duration="5000/25s"><spine>
    <clip name="a &amp; b.mp4" ref="r2" offset="0s" duration="5000/25s" start="0s" format="r1"/>
  </spine></sequence></project></event></library>
</fcpxml>`;
    const parsed = parseTimelineFcpxml(xml);
    expect(parsed[0].srcName).toBe("a & b.mp4");
  });
});

describe("resolveFcpxmlEvents", () => {
  it("relinks by uid first, then by source file name", () => {
    const xml = buildTimelineFcpxml({ title: "x", clips: clips(), assetById: assets });
    const parsed = parseTimelineFcpxml(xml);
    const { clips: resolved, unresolved } = resolveFcpxmlEvents(parsed, [
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

  it("falls back to file-name matching when uid/ref are foreign", () => {
    const parsed = parseTimelineFcpxml(`<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>
    <asset id="r2" name="take 01.MP4" src="file:///Media/take 01.MP4" start="0s" duration="125/25s" format="r1"/>
  </resources>
  <library><event name="E"><project name="P"><sequence format="r1" duration="125/25s"><spine>
    <clip name="take 01.MP4" ref="r2" offset="0s" duration="125/25s" start="0s" format="r1"/>
  </spine></sequence></project></event></library>
</fcpxml>`);
    const { clips: resolved, unresolved } = resolveFcpxmlEvents(parsed, [
      { id: camA, fileName: "take 01.mov" }, // different extension, same base name
    ]);
    expect(unresolved).toEqual([]);
    expect(resolved[0].assetId).toBe(camA);
  });

  it("reports sources that cannot be relinked", () => {
    const parsed = parseTimelineFcpxml(`<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>
    <asset id="r2" name="missing.mp4" src="file:///Media/missing.mp4" start="0s" duration="125/25s" format="r1"/>
  </resources>
  <library><event name="E"><project name="P"><sequence format="r1" duration="125/25s"><spine>
    <clip name="missing.mp4" ref="r2" offset="0s" duration="125/25s" start="0s" format="r1"/>
  </spine></sequence></project></event></library>
</fcpxml>`);
    const { clips: resolved, unresolved } = resolveFcpxmlEvents(parsed, [
      { id: camA, fileName: "interview-cam-a.mp4" },
    ]);
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual(["missing.mp4"]);
  });
});
