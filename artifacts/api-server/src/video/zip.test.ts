import { describe, expect, test } from "vitest";
import { buildZip, crc32, listZipEntries, readZipEntry } from "./zip";

describe("zip (store-only writer)", () => {
  test("builds an archive listing all entries in order", () => {
    const zip = buildZip([
      { name: "project-cut-v1.edl", data: Buffer.from("001  AX       V     C        00:00:00:00 00:00:05:00", "utf8") },
      { name: "project-cut-v1.otio", data: Buffer.from("{\"OTIO_SCHEMA\": \"Timeline\"}", "utf8") },
      { name: "media/clip.mov", data: Buffer.from("fake mov bytes") },
    ]);

    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local header magic
    expect(listZipEntries(zip)).toEqual([
      "project-cut-v1.edl",
      "project-cut-v1.otio",
      "media/clip.mov",
    ]);
  });

  test("round-trips entry data byte-for-byte", () => {
    const payload = Buffer.from("006  AX       V     C        00:00:25:00 00:00:10:00", "utf8");
    const zip = buildZip([{ name: "clip.edl", data: payload }]);
    expect(readZipEntry(zip, "clip.edl")?.equals(payload)).toBe(true);
  });

  test("returns null for missing entries", () => {
    const zip = buildZip([{ name: "a.edl", data: Buffer.from("x") }]);
    expect(readZipEntry(zip, "nope")).toBeNull();
  });

  test("supports binary data and nested paths", () => {
    const binary = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x80, 0x7f]);
    const zip = buildZip([
      { name: "media/shot-01.mp4", data: binary },
      { name: "manifest.json", data: Buffer.from("{}", "utf8") },
    ]);
    expect(readZipEntry(zip, "media/shot-01.mp4")?.equals(binary)).toBe(true);
    expect(listZipEntries(zip)).toEqual(["media/shot-01.mp4", "manifest.json"]);
  });

  test("crc32 matches known vectors", () => {
    expect(crc32(Buffer.from("123456789", "ascii"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  test("store mode keeps offsets stable (data directly after local header)", () => {
    const data = Buffer.from("hello");
    const zip = buildZip([{ name: "f.txt", data }]);
    // Local header (30) + name (5) → data starts at 35.
    expect(zip.readUInt32LE(35 + data.length - 5)).toBe(0x6c6c6568); // "hell" little-endian
    expect(zip.subarray(35, 40).toString("utf8")).toBe("hello");
  });
});
