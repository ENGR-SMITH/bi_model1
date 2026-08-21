import { describe, expect, it } from "vitest";
import { buildTimelineAaf } from "./aaf";
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

// ---------------------------------------------------------------------------
// A minimal CFB (OLE2 compound file) reader — just enough to walk the
// directory tree and read stream contents so the test verifies the container
// structure and the AAF object graph independently of the writer.
// ---------------------------------------------------------------------------
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

interface CfbEntry {
  name: string;
  type: number;
  dirIndex: number;
  left: number;
  right: number;
  child: number;
  startSector: number;
  streamSize: number;
  clsid: Buffer;
}

class CfbReader {
  private buf: Buffer;
  private sectorSize: number;
  private miniSectorSize: number;
  private dirStart: number;
  private miniFatStart: number;
  private miniStreamStart: number;
  private miniStreamSize: number;
  private fat: number[];
  private miniFat: number[];
  constructor(buf: Buffer) {
    this.buf = buf;
    const magic = buf.subarray(0, 8);
    expect(magic.toString("hex")).toBe("d0cf11e0a1b11ae1");
    this.sectorSize = 1 << buf.readUInt16LE(30);
    this.miniSectorSize = 1 << buf.readUInt16LE(32);
    this.dirStart = buf.readUInt32LE(48);
    const fatStart = buf.readUInt32LE(76);
    const fatSectors = buf.readUInt32LE(44);
    this.fat = [];
    for (let s = 0; s < fatSectors; s++) {
      const off = (fatStart + s + 1) * this.sectorSize;
      for (let i = 0; i < this.sectorSize / 4; i++) {
        this.fat.push(buf.readUInt32LE(off + i * 4));
      }
    }
    this.miniFatStart = buf.readUInt32LE(60);
    const miniFatSectors = buf.readUInt32LE(64);
    this.miniFat = [];
    for (let s = 0; s < miniFatSectors; s++) {
      const off = (this.miniFatStart + s + 1) * this.sectorSize;
      for (let i = 0; i < this.sectorSize / 4; i++) {
        this.miniFat.push(buf.readUInt32LE(off + i * 4));
      }
    }
    this.readDir();
    // The mini stream's location is stored in the root entry (index 0).
    const root = this.entries.get(0);
    this.miniStreamStart = root?.startSector ?? FREESECT;
    this.miniStreamSize = root?.streamSize ?? 0;
  }

  readonly entries = new Map<number, CfbEntry>();

  private readDir(): void {
    const perSector = this.sectorSize / 128;
    let sector = this.dirStart;
    let chainPos = 0;
    let guard = 0;
    while (sector !== ENDOFCHAIN && sector !== FREESECT && guard++ < 1000) {
      const off = (sector + 1) * this.sectorSize;
      for (let i = 0; i < perSector; i++) {
        const e = this.buf.subarray(off + i * 128, off + i * 128 + 128);
        const nameLen = e.readUInt16LE(64);
        if (nameLen === 0 || nameLen > 64) continue;
        const name = e.subarray(0, nameLen).toString("utf16le").replace(/\u0000+$/, "");
        if (!name) continue;
        // Directory entries are indexed sequentially across the chain.
        const index = chainPos * perSector + i;
        this.entries.set(index, {
          name,
          type: e.readUInt8(66),
          dirIndex: index,
          left: e.readUInt32LE(68),
          right: e.readUInt32LE(72),
          child: e.readUInt32LE(76),
          startSector: e.readUInt32LE(116),
          streamSize: Number(e.readBigUInt64LE(120)),
          clsid: Buffer.from(e.subarray(80, 96)),
        });
      }
      sector = this.fat[sector];
      chainPos++;
    }
  }

  /** Walk a directory tree starting at a child pointer. */
  children(parent: CfbEntry): CfbEntry[] {
    const out: CfbEntry[] = [];
    const visit = (id: number): void => {
      const e = this.entries.get(id);
      if (!e) return;
      out.push(e);
      visit(e.left);
      visit(e.right);
    };
    visit(parent.child);
    return out;
  }

  get(name: string): CfbEntry {
    const root = this.entries.get(0);
    if (!root) throw new Error("missing Root Entry");
    const found = this.walkTree(root).find((e) => e.name === name);
    if (!found) throw new Error(`missing entry: ${name}`);
    return found;
  }

  /** Depth-first walk of the whole directory tree. */
  walkTree(parent: CfbEntry): CfbEntry[] {
    const out: CfbEntry[] = [];
    const seen = new Set<number>();
    const visit = (id: number): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const e = this.entries.get(id);
      if (!e) return;
      out.push(e);
      visit(e.left);
      visit(e.right);
      visit(e.child);
    };
    visit(parent.child);
    return out;
  }

  /** Read a stream's full content (mini streams only in our writer). */
  stream(entry: CfbEntry): Buffer {
    if (entry.streamSize === 0) return Buffer.alloc(0);
    // Sector 0 holds the CFB header, so data sector s lives at (s + 1) * sectorSize.
    const miniOffset = (this.miniStreamStart + 1) * this.sectorSize;
    const chunks: Buffer[] = [];
    let sector = entry.startSector;
    let guard = 0;
    while (sector !== ENDOFCHAIN && sector !== FREESECT && guard++ < 10000) {
      chunks.push(
        this.buf.subarray(miniOffset + sector * this.miniSectorSize, miniOffset + (sector + 1) * this.miniSectorSize),
      );
      sector = this.miniFat[sector];
    }
    return Buffer.concat(chunks).subarray(0, entry.streamSize);
  }
}

/**
 * Decode an AAF object's `properties` stream into a pid → {format, data} map.
 * Layout: u8(0x4c) u8(version) u16(count), then the full table of 6-byte
 * (pid, format, size) entries, then all data concatenated — exactly as
 * pyaaf2 writes it.
 */
function decodeProps(buf: Buffer): Map<number, { format: number; data: Buffer }> {
  expect(buf.readUInt8(0)).toBe(0x4c); // little-endian byte order
  const count = buf.readUInt16LE(2);
  const out = new Map<number, { format: number; data: Buffer }>();
  const entries: { pid: number; format: number; size: number }[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    entries.push({
      pid: buf.readUInt16LE(off),
      format: buf.readUInt16LE(off + 2),
      size: buf.readUInt16LE(off + 4),
    });
    off += 6;
  }
  let dataOff = off;
  for (const entry of entries) {
    out.set(entry.pid, { format: entry.format, data: buf.subarray(dataOff, dataOff + entry.size) });
    dataOff += entry.size;
  }
  return out;
}

const u16le = (b: Buffer, off: number): number => b.readUInt16LE(off);
const u32le = (b: Buffer, off: number): number => b.readUInt32LE(off);
const s64le = (b: Buffer, off: number): bigint => b.readBigInt64LE(off);

/** Read an object's `properties` stream (the child stream named `properties`). */
function propsOf(cfb: CfbReader, entry: CfbEntry): Buffer {
  const props = cfb.children(entry).find((e) => e.name === "properties" && e.type === 2);
  if (!props) throw new Error(`missing properties stream under ${entry.name}`);
  return cfb.stream(props);
}

describe("buildTimelineAaf (CFB container)", () => {
  it("writes a valid CFB header and directory tree", () => {
    const bytes = buildTimelineAaf({ title: "Test Project", version: 2, clips: clips(), assetById: assets });
    const cfb = new CfbReader(bytes);
    expect(cfb.get("MetaDictionary-1").type).toBe(1);
    expect(cfb.get("Header-2").type).toBe(1);
    const referenced = cfb.get("referenced properties");
    expect(referenced.type).toBe(2);
    // weak-ref table: 3 paths, pid count 3+3+3
    const table = cfb.stream(referenced);
    expect(table.readUInt16LE(1)).toBe(3);
    expect(u32le(table, 3)).toBe(10); // 2+3+2 pids + 3 null terminators
  });

  it("stores each object's properties in a `properties` stream child", () => {
    const bytes = buildTimelineAaf({ title: "P", version: 1, clips: clips(), assetById: assets });
    const cfb = new CfbReader(bytes);
    const root = cfb.entries.get(0)!;
    expect(root.name).toBe("Root Entry");
    const rootChildren = cfb.children(root);
    expect(rootChildren.some((e) => e.name === "properties" && e.type === 2)).toBe(true);
  });

  it("serializes the root with MetaDictionary + Header strong refs", () => {
    const bytes = buildTimelineAaf({ title: "P", version: 1, clips: clips(), assetById: assets });
    const cfb = new CfbReader(bytes);
    const rootProps = decodeProps(cfb.stream(cfb.get("properties")));
    // pid 0x0001 → MetaDictionary-1, pid 0x0002 → Header-2
    expect(rootProps.get(0x0001)?.data.toString("utf16le")).toContain("MetaDictionary-1");
    expect(rootProps.get(0x0002)?.data.toString("utf16le")).toContain("Header-2");
  });
});

describe("buildTimelineAaf (object graph)", () => {
  it("emits Header → ContentStorage → MasterMob + SourceMobs", () => {
    const bytes = buildTimelineAaf({
      title: "Test Project — CUT",
      version: 3,
      clips: clips(),
      assetById: assets,
      now: new Date("2026-01-02T03:04:05Z"),
    });
    const cfb = new CfbReader(bytes);

    const headerProps = decodeProps(propsOf(cfb, cfb.get("Header-2")));
    expect(headerProps.get(0x3b03)?.data.toString("utf16le")).toContain("Content");
    expect(headerProps.get(0x3b04)?.data.toString("utf16le")).toContain("Dictionary");
    // 0x3b05 = Version record {major: 1, minor: 2}; 0x3b07 = ObjectModelVersion;
    // 0x3b09 = OperationalPattern (Edit Protocol AUID, 16 bytes)
    expect(headerProps.get(0x3b05)?.data).toEqual(Buffer.from([1, 2]));
    expect(u32le(headerProps.get(0x3b07)!.data, 0)).toBe(1);
    expect(headerProps.get(0x3b09)?.data.length).toBe(16);

    const contentProps = decodeProps(propsOf(cfb, cfb.get("Content-3b03")));
    const mobsIndex = contentProps.get(0x1901);
    expect(mobsIndex).toBeTruthy();
    // The set property data is the base ref name; the index stream is `${name} index`.
    expect(mobsIndex!.data.toString("utf16le")).toContain("Mobs-1901");
    // 3 mobs in the strong-ref set
    const mobsIdxStream = cfb.stream(cfb.get("Mobs-1901 index"));
    expect(u32le(mobsIdxStream, 0)).toBe(3);

    // Find the three mob storage dirs
    const mobDirs = cfb
      .children(cfb.get("Content-3b03"))
      .filter((e) => e.name.startsWith("Mobs-1901{") && e.type === 1);
    expect(mobDirs).toHaveLength(3);
    const names = mobDirs.map((d) => {
      const props = decodeProps(propsOf(cfb, d));
      return props.get(0x4402)!.data.toString("utf16le").replace(/\u0000+$/, ""); // Mob.Name
    });
    expect(names).toContain("Test Project — CUT");
    expect(names).toContain("interview-cam-a.mp4");
    expect(names).toContain("broll-shot.mp4");
  });

  it("writes a MasterMob sequence with clips matching the snapshot", () => {
    const bytes = buildTimelineAaf({ title: "P", version: 1, clips: clips(), assetById: assets });
    const cfb = new CfbReader(bytes);

    const mobDirs = cfb
      .children(cfb.get("Content-3b03"))
      .filter((e) => e.name.startsWith("Mobs-1901{") && e.type === 1);
    // The MasterMob is the first entry in the Mobs set (index 0).
    const master = mobDirs.find((d) => {
      const props = decodeProps(propsOf(cfb, d));
      return props.get(0x4402)?.data.toString("utf16le").includes("P");
    })!;
    const masterProps = decodeProps(propsOf(cfb, master));

    // MobID present; Name contains the em-dash title
    expect(masterProps.get(0x4401)?.data.length).toBe(32);
    expect(masterProps.get(0x4402)?.data.toString("utf16le")).toContain("P");

    // The slot dir → Segment dir → Sequence dir
    const slots = cfb.children(master).filter((e) => e.name.startsWith("Slots-4403{") && e.type === 1);
    expect(slots).toHaveLength(1);
    const slotProps = decodeProps(propsOf(cfb, slots[0]));
    const segmentName = slotProps.get(0x4803)!.data.toString("utf16le").replace(/\u0000+$/, "");
    const segment = cfb.get(segmentName);
    const segProps = decodeProps(propsOf(cfb, segment));
    // Sequence → components vector (property data is the base ref name)
    const compsIndexName = segProps.get(0x1001)!.data.toString("utf16le").replace(/\u0000+$/, "");
    expect(compsIndexName).toContain("Components-1001");
    const compsIdx = cfb.stream(cfb.get("Components-1001 index"));
    expect(u32le(compsIdx, 0)).toBe(2); // the vector holds exactly the clips

    // Read the SourceClip components and check lengths/start times.
    const compDirs = cfb
      .children(segment)
      .filter((e) => e.name.startsWith("Components-1001{") && e.type === 1);
    // components vector holds exactly the clips
    const lengths = compDirs.map((d) => {
      const props = decodeProps(propsOf(cfb, d));
      return {
        length: s64le(props.get(0x0202)!.data, 0), // Length
        start: s64le(props.get(0x1201)!.data, 0), // StartTime
      };
    });
    expect(lengths).toHaveLength(2);
    // clip 1: src 0→5000ms @25fps = 0..125 frames; clip 2: src 2000→6000ms = 50..150
    expect(lengths).toContainEqual({ length: 125n, start: 0n });
    expect(lengths).toContainEqual({ length: 100n, start: 50n });
  });
});
