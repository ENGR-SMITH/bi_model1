// ---------------------------------------------------------------------------
// AAF interchange — the export-only tail of the format ladder (VCS design §4:
// "EDL first → FCPXML → OTIO (canonical); AAF export-only"). Advanced
// Authoring Format is the Avid/NLE interchange: a binary OLE2 (CFB) container
// whose object graph is stored in "properties-streams" mode — every AAF object
// is a CFB storage directory entry (class AUID in its CLSID field) holding a
// `properties` stream of PID-keyed property records.
//
// This writer mirrors the canonical pure-Python implementation (pyaaf2) at the
// byte level: same CFB parameters (4096-byte sectors, 64-byte mini sectors,
// 4096-byte mini-stream cutoff), same property stream layout, same index
// streams for reference vectors/sets, the same mangle_name directory naming,
// and the same "/referenced properties" weak-reference table. Export-only by
// design — there is no import path for AAF (the design calls it one-directional).
//
// Structure emitted: Header → ContentStorage → Mobs [MasterMob + one SourceMob
// per unique source]. The master's timeline slot carries the cut (Sequence of
// SourceClips, each relinked to its SourceMob by MobID); each SourceMob holds
// a FileDescriptor with a NetworkLocator pointing back into the vault, the AAF
// analogue of the EDL's `* FROM CLIP:` comments. A self-contained
// MetaDictionary (ClassDefinitions + TypeDefinitions for exactly the classes
// used) rides in the root, as the spec requires.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { type EdlAssetRef, type EdlClip } from "./edl";

/** Frame rate used for AAF edit rates (PAL default, like the other formats). */
export const AAF_FPS = 25;

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function u8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

function u16le(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value & 0xffff, 0);
  return b;
}

function u32le(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0, 0);
  return b;
}

function s32le(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value | 0, 0);
  return b;
}

function s64le(value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(Math.trunc(value)), 0);
  return b;
}

/** UTF-16LE + null terminator — the AAF string / reference-name encoding. */
function utf16(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "utf16le"), Buffer.from([0, 0])]);
}

// ---------------------------------------------------------------------------
// AUID / MobID — AAF identifiers are stored as 16-byte little-endian AUIDs
// (GUID byte order) and 32-byte SMPTE UMIDs for mobs.
// ---------------------------------------------------------------------------

/** Parse "0d010101-0101-2f00-060e-2b3402060101" → 16 LE bytes (GUID byte order). */
export function parseAuid(value: string): Buffer {
  const hex = value.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`Invalid AUID: ${value}`);
  const b = Buffer.from(hex, "hex");
  // GUID little-endian layout: Data1 (4), Data2 (2), Data3 (2), Data4 (8).
  return Buffer.from([
    b[3], b[2], b[1], b[0],
    b[5], b[4],
    b[7], b[6],
    ...b.subarray(8, 16),
  ]);
}

/** A random AUID (uuid v4 → 16 LE bytes). */
export function randomAuid(): Buffer {
  return parseAuid(randomUUID());
}

const ZERO_AUID = Buffer.alloc(16);

/**
 * A SMPTE UMID (32 bytes): 12-byte UL + length(0x13) + 3-byte instance number
 * + 16-byte material (uuid v4 in GUID byte order), matching pyaaf2's
 * `UniqueMobID()`.
 */
export function randomMobId(): Buffer {
  const material = parseAuid(randomUUID());
  return Buffer.from([
    0x06, 0x0a, 0x2b, 0x34, 0x01, 0x01, 0x01, 0x05, 0x01, 0x01, 0x0f, 0x20,
    0x13, 0x00, 0x00, 0x00,
    ...material,
  ]);
}

const ZERO_MOBID = Buffer.alloc(32);

// ---------------------------------------------------------------------------
// Class / typedef AUIDs (from the SMPTE 335M dictionary, as pyaaf2 models it)
// ---------------------------------------------------------------------------

const AUIDS = {
  Root: "b3b398a5-1c90-11d4-8053-080036210804",
  MetaDictionary: "0d010101-0225-0000-060e-2b3402060101",
  MetaDefinition: "0d010101-0224-0000-060e-2b3402060101",
  ClassDefinition: "0d010101-0201-0000-060e-2b3402060101",
  PropertyDefinition: "0d010101-0202-0000-060e-2b3402060101",
  TypeDefinition: "0d010101-0203-0000-060e-2b3402060101",
  TypeDefinitionInteger: "0d010101-0204-0000-060e-2b3402060101",
  TypeDefinitionStrongObjectReference: "0d010101-0205-0000-060e-2b3402060101",
  TypeDefinitionWeakObjectReference: "0d010101-0206-0000-060e-2b3402060101",
  TypeDefinitionEnumeration: "0d010101-0207-0000-060e-2b3402060101",
  TypeDefinitionFixedArray: "0d010101-0208-0000-060e-2b3402060101",
  TypeDefinitionVariableArray: "0d010101-0209-0000-060e-2b3402060101",
  TypeDefinitionSet: "0d010101-020a-0000-060e-2b3402060101",
  TypeDefinitionString: "0d010101-020b-0000-060e-2b3402060101",
  TypeDefinitionRecord: "0d010101-020d-0000-060e-2b3402060101",
  TypeDefinitionRename: "0d010101-020e-0000-060e-2b3402060101",
  TypeDefinitionCharacter: "0d010101-0223-0000-060e-2b3402060101",
  InterchangeObject: "0d010101-0101-0100-060e-2b3402060101",
  DefinitionObject: "0d010101-0101-1a00-060e-2b3402060101",
  DataDefinition: "0d010101-0101-1b00-060e-2b3402060101",
  Dictionary: "0d010101-0101-2200-060e-2b3402060101",
  ContentStorage: "0d010101-0101-1800-060e-2b3402060101",
  Header: "0d010101-0101-2f00-060e-2b3402060101",
  Identification: "0d010101-0101-3000-060e-2b3402060101",
  EssenceDescriptor: "0d010101-0101-2400-060e-2b3402060101",
  FileDescriptor: "0d010101-0101-2500-060e-2b3402060101",
  NetworkLocator: "0d010101-0101-3200-060e-2b3402060101",
  Locator: "0d010101-0101-3100-060e-2b3402060101",
  Mob: "0d010101-0101-3400-060e-2b3402060101",
  MasterMob: "0d010101-0101-3600-060e-2b3402060101",
  SourceMob: "0d010101-0101-3700-060e-2b3402060101",
  MobSlot: "0d010101-0101-3800-060e-2b3402060101",
  TimelineMobSlot: "0d010101-0101-3b00-060e-2b3402060101",
  Component: "0d010101-0101-0200-060e-2b3402060101",
  Segment: "0d010101-0101-0300-060e-2b3402060101",
  SourceReference: "0d010101-0101-1000-060e-2b3402060101",
  SourceClip: "0d010101-0101-1100-060e-2b3402060101",
  Sequence: "0d010101-0101-0f00-060e-2b3402060101",

  // Data definitions (the dictionary entries sequences reference weakly)
  DataDef_Picture: "01030202-0100-0000-060e-2b3404010101",
  DataDef_Sound: "01030202-0200-0000-060e-2b3404010101",

  // Header.OperationalPattern — "Edit Protocol"
  OPDef_EditProtocol: "0d011201-0100-0000-060e-2b3404010105",
} as const;

const TYPEDEFS = {
  // ints
  aafUInt8: "01010100-0000-0000-060e-2b3401040101",
  aafUInt16: "01010200-0000-0000-060e-2b3401040101",
  aafUInt32: "01010300-0000-0000-060e-2b3401040101",
  aafUInt64: "01010400-0000-0000-060e-2b3401040101",
  aafInt8: "01010500-0000-0000-060e-2b3401040101",
  aafInt16: "01010600-0000-0000-060e-2b3401040101",
  aafInt32: "01010700-0000-0000-060e-2b3401040101",
  aafInt64: "01010800-0000-0000-060e-2b3401040101",
  // enum
  Boolean: "01040100-0000-0000-060e-2b3401040101",
  ProductReleaseType: "02010101-0000-0000-060e-2b3401040101",
  // records
  AUID: "01030100-0000-0000-060e-2b3401040101",
  MobIDType: "01030200-0000-0000-060e-2b3401040101",
  Rational: "03010100-0000-0000-060e-2b3401040101",
  ProductVersion: "03010200-0000-0000-060e-2b3401040101",
  VersionType: "03010300-0000-0000-060e-2b3401040101",
  DateStruct: "03010500-0000-0000-060e-2b3401040101",
  TimeStruct: "03010600-0000-0000-060e-2b3401040101",
  TimeStamp: "03010700-0000-0000-060e-2b3401040101",
  // renames
  aafPositionType: "01012001-0000-0000-060e-2b3401040101",
  aafLengthType: "01012002-0000-0000-060e-2b3401040101",
  // strings
  aafString: "01100200-0000-0000-060e-2b3401040101",
  aafCharacter: "01100100-0000-0000-060e-2b3401040101",
  // fixed / var arrays
  aafUInt8Array8: "04010800-0000-0000-060e-2b3401040101",
  aafUInt8Array12: "04010200-0000-0000-060e-2b3401040101",
  aafInt64Array: "04010400-0000-0000-060e-2b3401040101",
  aafStringArray: "04010500-0000-0000-060e-2b3401040101",
  aafAUIDArray: "04010600-0000-0000-060e-2b3401040101",
  // strong refs
  HeaderStrongRefence: "05022800-0000-0000-060e-2b3401040101",
  MetaDictionaryStrongReference: "05022700-0000-0000-060e-2b3401040101",
  DictionaryStrongReference: "05020200-0000-0000-060e-2b3401040101",
  ContentStorageStrongReference: "05020100-0000-0000-060e-2b3401040101",
  SegmentStrongReference: "05020600-0000-0000-060e-2b3401040101",
  DataDefinitionStrongReference: "05020e00-0000-0000-060e-2b3401040101",
  EssenceDescriptorStrongReference: "05020300-0000-0000-060e-2b3401040101",
  IdentificationStrongReference: "05021000-0000-0000-060e-2b3401040101",
  NetworkLocatorStrongReference: "05020400-0000-0000-060e-2b3401040101",
  LocatorStrongReference: "05021200-0000-0000-060e-2b3401040101",
  MobStrongReference: "05021300-0000-0000-060e-2b3401040101",
  MobSlotStrongReference: "05021400-0000-0000-060e-2b3401040101",
  ComponentStrongReference: "05020b00-0000-0000-060e-2b3401040101",
  PropertyDefinitionStrongReference: "05021900-0000-0000-060e-2b3401040101",
  ClassDefinitionStrongReference: "05020900-0000-0000-060e-2b3401040101",
  TypeDefinitionStrongReference: "05021b00-0000-0000-060e-2b3401040101",
  // strong ref vectors
  ComponentStrongReferenceVector: "05060100-0000-0000-060e-2b3401040101",
  IdentificationStrongReferenceVector: "05060300-0000-0000-060e-2b3401040101",
  MobSlotStrongReferenceVector: "05060500-0000-0000-060e-2b3401040101",
  LocatorStrongReferenceVector: "05060400-0000-0000-060e-2b3401040101",
  // strong ref sets
  ClassDefinitionStrongReferenceSet: "05050100-0000-0000-060e-2b3401040101",
  TypeDefinitionStrongReferenceSet: "05050c00-0000-0000-060e-2b3401040101",
  MobStrongReferenceSet: "05050700-0000-0000-060e-2b3401040101",
  DataDefinitionStrongReferenceSet: "05050400-0000-0000-060e-2b3401040101",
  PropertyDefinitionStrongReferenceSet: "05050b00-0000-0000-060e-2b3401040101",
  // weak refs
  ClassDefinitionWeakReference: "05010100-0000-0000-060e-2b3401040101",
  DataDefinitionWeakReference: "05010300-0000-0000-060e-2b3401040101",
  TypeDefinitionWeakReference: "05010900-0000-0000-060e-2b3401040101",
  TypeDefinitionWeakReferenceVector: "05040200-0000-0000-060e-2b3401040101",
} as const;

/** Property AUIDs for the weak-reference target paths (Root → set). */
const PROP_AUIDS = {
  RootMetaDictionary: "0d010301-0101-0100-060e-2b3401010102",
  MetaDictionaryClassDefinitions: "06010107-0700-0000-060e-2b3401010102",
  MetaDictionaryTypeDefinitions: "06010107-0800-0000-060e-2b3401010102",
  RootHeader: "0d010301-0102-0100-060e-2b3401010102",
  HeaderDictionary: "06010104-0202-0000-060e-2b3401010102",
  DictionaryDataDefinitions: "06010104-0505-0000-060e-2b3401010102",
} as const;

// ---------------------------------------------------------------------------
// Directory entry names — the same mangle_name scheme pyaaf2 uses so that a
// pyaaf2 reader finds every referenced subdirectory.
// ---------------------------------------------------------------------------

function squeezeName(name: string, size: number): string {
  if (name.length <= size) return name;
  const half = Math.floor(size / 2);
  let out = "";
  for (let i = 0; i < size; i++) {
    if (i < half) out += name[i];
    else if (i === half) out += "-";
    else out += name[name.length - (size - i)];
  }
  return out;
}

function mangleName(name: string, pid: number, size: number): string {
  const p = pid.toString(16);
  return `${squeezeName(name, size - p.length - 2)}-${p}`;
}

/** mangle_name for strong-ref subdirectory names (32-char budget). */
function refName(propertyName: string, pid: number): string {
  return mangleName(propertyName, pid, 32);
}

/** mangle_name for vector/set index names (22-char budget). */
function indexName(propertyName: string, pid: number): string {
  return mangleName(propertyName, pid, 22);
}

// ---------------------------------------------------------------------------
// OLE2 Compound File Binary writer
// ---------------------------------------------------------------------------

const SECTOR_SIZE = 4096;
const MINI_SECTOR_SIZE = 64;
const MINI_CUTOFF = 4096;
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;

/** A node in the CFB directory tree. */
export interface CfbDir {
  name: string;
  /** 1 = storage, 2 = stream, 5 = root storage. */
  type: 1 | 2 | 5;
  clsid: Buffer;
  streams: Map<string, Buffer>;
  // red-black tree links over siblings (object references during build)
  left: CfbDir | null;
  right: CfbDir | null;
  child: CfbDir | null;
  red: boolean;
  // serialization
  dirIndex: number;
  startSector: number;
  streamSize: number;
}

function newDir(name: string, type: 1 | 2 | 5, clsid: Buffer): CfbDir {
  return {
    name,
    type,
    clsid,
    streams: new Map(),
    left: null,
    right: null,
    child: null,
    red: true,
    dirIndex: 0,
    startSector: 0,
    streamSize: 0,
  };
}

function isRed(node: CfbDir | null): boolean {
  return node !== null && node.red;
}

function dirLess(a: CfbDir, b: CfbDir): boolean {
  if (a.name.length === b.name.length) return a.name.toUpperCase() < b.name.toUpperCase();
  return a.name.length < b.name.length;
}

function getChild(node: { left: CfbDir | null; right: CfbDir | null }, direction: 0 | 1): CfbDir | null {
  return direction === 0 ? node.left : node.right;
}

function setChild(node: { left: CfbDir | null; right: CfbDir | null }, direction: 0 | 1, value: CfbDir | null): void {
  if (direction === 0) node.left = value;
  else node.right = value;
}

function jswSingle(root: CfbDir, direction: 0 | 1): CfbDir {
  const other = (1 - direction) as 0 | 1;
  const newRoot = getChild(root, other)!;
  setChild(root, other, getChild(newRoot, direction));
  setChild(newRoot, direction, root);
  root.red = true;
  newRoot.red = false;
  return newRoot;
}

function jswDouble(root: CfbDir, direction: 0 | 1): CfbDir {
  const other = (1 - direction) as 0 | 1;
  setChild(root, other, jswSingle(getChild(root, other)!, other));
  return jswSingle(root, direction);
}

/**
 * Top-down red-black insertion (the eternallyconfuzzled algorithm pyaaf2 uses)
 * — keeps the sibling tree balanced and valid per the CFB spec.
 */
function rbInsert(parent: CfbDir, entry: CfbDir): void {
  const head: { left: CfbDir | null; right: CfbDir | null; red: boolean } = { left: null, right: null, red: true };
  let gggp: CfbDir | null = null;
  let ggp: CfbDir | null | typeof head = head;
  let gp: CfbDir | null = null;
  let p: CfbDir | null = null;
  let direction: 0 | 1 = 0;
  let last: 0 | 1 = 0;

  entry.red = true;
  let node = parent.child;
  parent.child = null;
  head.right = node;

  while (true) {
    if (node === null) {
      node = entry;
      setChild(p!, direction, node);
    } else if (isRed(node.left) && isRed(node.right)) {
      node.red = true;
      if (node.left) node.left.red = false;
      if (node.right) node.right.red = false;
    }

    if (isRed(node) && p !== null && isRed(p)) {
      const ggpNode = ggp as CfbDir;
      const direction2: 0 | 1 = ggpNode.left === gp ? 0 : 1;
      if (node === getChild(p, last)) {
        setChild(ggpNode, direction2, jswSingle(gp!, (1 - last) as 0 | 1));
        gp = ggpNode;
        ggp = gggp;
      } else if (node === getChild(p, (1 - last) as 0 | 1)) {
        setChild(ggpNode, direction2, jswDouble(gp!, (1 - last) as 0 | 1));
        p = ggpNode as CfbDir;
        gp = p === head ? null : gggp;
        ggp = null;
      }
    }

    if (node === entry) break;

    last = direction;
    direction = dirLess(entry, node) ? 0 : 1;
    if (ggp !== null) gggp = ggp as CfbDir;
    if (gp !== null) ggp = gp;
    gp = p;
    p = node;
    node = getChild(node, direction);
  }

  parent.child = head.right;
  if (parent.child) parent.child.red = false;
}

/** Add a child dir to a storage, keeping the red-black tree valid. */
function addChild(parent: CfbDir, entry: CfbDir): void {
  if (parent.child === null) {
    parent.child = entry;
    entry.red = false;
  } else {
    rbInsert(parent, entry);
  }
}

/**
 * Serialize a CFB directory tree into a complete compound file. Every stream
 * written here is below the 4096-byte mini-stream cutoff, so the mini stream
 * holds them all; the directory, mini FAT, and mini stream are regular
 * FAT-chained streams, exactly as pyaaf2 lays files out.
 */
export function buildCfb(root: CfbDir): Buffer {
  // 1. Collect directory entries (root first, then preorder over the sibling
  // trees) and the streams they hold. A type-2 stream node's own content is
  // stored under `streams.get("")`; a storage/root node's named streams (e.g.
  // an AAF object's `properties`) become child stream dirs, exactly as pyaaf2
  // materializes them via `dir.touch("properties")`.
  const dirs: CfbDir[] = [];
  const streamEntries: { node: CfbDir; data: Buffer }[] = [];
  const collect = (node: CfbDir): void => {
    node.dirIndex = dirs.length;
    dirs.push(node);
    if (node.type === 2) {
      // The stream node itself carries its content.
      for (const data of node.streams.values()) streamEntries.push({ node, data });
    } else {
      // Materialize each named stream as a child stream dir.
      for (const [name, data] of node.streams) {
        const streamDir = newDir(name, 2, Buffer.alloc(16));
        streamEntries.push({ node: streamDir, data });
        addChild(node, streamDir);
      }
      node.streams.clear();
    }
    if (node.child) collectSubtree(node.child);
  };
  const collectSubtree = (node: CfbDir): void => {
    collect(node);
    if (node.left) collectSubtree(node.left);
    if (node.right) collectSubtree(node.right);
  };
  collect(root);
  if (process.env.AAF_DEBUG) {
    console.error(`aaf: ${dirs.length} dirs, ${streamEntries.length} streams, ${streamEntries.reduce((n, s) => n + s.data.length, 0)} stream bytes`);
    // BST invariant check over every sibling tree
    const check = (node: CfbDir | null): { min: string; max: string } | null => {
      if (!node) return null;
      if (node.name === undefined) console.error("UNDEFINED NAME node", node);
      const l = check(node.left);
      const r = check(node.right);
      const min = l ? l.min : node.name;
      const max = r ? r.max : node.name;
      const nameLess = (a: string, b: string): boolean =>
        a.length === b.length ? a.toUpperCase() < b.toUpperCase() : a.length < b.length;
      if (l && !(l.max === node.name || nameLess(l.max, node.name))) console.error(`BST L violation at ${node.name} (left max ${l.max})`);
      if (r && !(r.min === node.name || nameLess(node.name, r.min))) console.error(`BST R violation at ${node.name} (right min ${r.min})`);
      return { min, max };
    };
    const visitAll = (node: CfbDir): void => {
      if (node.child) check(node.child);
      const walk = (n: CfbDir | null): void => {
        if (!n) return;
        if (n.child) check(n.child);
        walk(n.left);
        walk(n.right);
      };
      walk(node.child);
    };
    visitAll(root);
  }

  // 2. Lay out the mini stream (all streams are mini here).
  let miniBytes = 0;
  for (const stream of streamEntries) {
    stream.node.streamSize = stream.data.length;
    miniBytes += Math.ceil(stream.data.length / MINI_SECTOR_SIZE) * MINI_SECTOR_SIZE;
  }
  const miniEntries = miniBytes / MINI_SECTOR_SIZE;

  const dirSectors = Math.max(1, Math.ceil(dirs.length / (SECTOR_SIZE / 128)));
  const miniFatSectors = miniEntries > 0 ? Math.max(1, Math.ceil(miniEntries / (SECTOR_SIZE / 4))) : 0;
  const miniStreamSectors = Math.ceil(miniBytes / SECTOR_SIZE);
  const fatSectors = 1;
  const totalSectors = 1 + fatSectors + miniFatSectors + dirSectors + miniStreamSectors;
  if (totalSectors > SECTOR_SIZE / 4) {
    throw new Error(`AAF export too large for single FAT sector (${totalSectors} sectors)`);
  }

  // 3. Sector assignment.
  const fatStart = 1;
  const miniFatStart = fatStart + fatSectors;
  const dirStart = miniFatStart + miniFatSectors;
  const miniStreamStart = dirStart + dirSectors;

  // 4. FAT: [header][fat chain][miniFat chain][dir chain][mini stream chain]
  const fat = new Array<number>(totalSectors).fill(FREESECT);
  fat[0] = FREESECT;
  for (let i = 0; i < fatSectors; i++) fat[fatStart + i] = FATSECT;
  for (let i = 0; i < miniFatSectors; i++) {
    fat[miniFatStart + i] = i === miniFatSectors - 1 ? ENDOFCHAIN : miniFatStart + i + 1;
  }
  for (let i = 0; i < dirSectors; i++) {
    fat[dirStart + i] = i === dirSectors - 1 ? ENDOFCHAIN : dirStart + i + 1;
  }
  for (let i = 0; i < miniStreamSectors; i++) {
    fat[miniStreamStart + i] = i === miniStreamSectors - 1 ? ENDOFCHAIN : miniStreamStart + i + 1;
  }

  // 5. Mini stream + mini FAT.
  const miniStream = Buffer.alloc(miniBytes);
  const miniFat = new Array<number>(miniEntries).fill(FREESECT);
  let miniCursor = 0;
  for (const stream of streamEntries) {
    stream.data.copy(miniStream, miniCursor);
    const count = Math.ceil(stream.data.length / MINI_SECTOR_SIZE);
    for (let i = 0; i < count; i++) {
      const index = miniCursor / MINI_SECTOR_SIZE + i;
      miniFat[index] = i === count - 1 ? ENDOFCHAIN : index + 1;
    }
    stream.node.startSector = miniCursor / MINI_SECTOR_SIZE;
    miniCursor += count * MINI_SECTOR_SIZE;
  }

  // 6. Directory entries.
  const dirData = Buffer.alloc(dirSectors * SECTOR_SIZE);
  const writeDirEntry = (node: CfbDir, offset: number): void => {
    const nameBytes = Buffer.from(node.name, "utf16le");
    if (nameBytes.length > 62) throw new Error(`CFB name too long: ${node.name}`);
    nameBytes.copy(dirData, offset);
    dirData.writeUInt16LE(nameBytes.length + 2, offset + 64); // includes null terminator
    dirData.writeUInt8(node.type, offset + 66);
    dirData.writeUInt8(node.red ? 0 : 1, offset + 67);
    dirData.writeUInt32LE(node.left ? node.left.dirIndex : FREESECT, offset + 68);
    dirData.writeUInt32LE(node.right ? node.right.dirIndex : FREESECT, offset + 72);
    dirData.writeUInt32LE(node.child ? node.child.dirIndex : FREESECT, offset + 76);
    node.clsid.copy(dirData, offset + 80);
    // state bits + timestamps stay zero
    if (node.type === 5) {
      dirData.writeUInt32LE(miniStreamSectors > 0 ? miniStreamStart : ENDOFCHAIN, offset + 116);
      dirData.writeBigUInt64LE(BigInt(miniBytes), offset + 120);
    } else {
      dirData.writeUInt32LE(node.startSector, offset + 116);
      if (node.type === 2) dirData.writeBigUInt64LE(BigInt(node.streamSize), offset + 120);
    }
  };
  for (const node of dirs) writeDirEntry(node, node.dirIndex * 128);

  // 7. Assemble the file. The header occupies bytes 0..SECTOR_SIZE, so data
  // sector `s` lives at `(s + 1) * SECTOR_SIZE`; the file must extend one
  // sector past the last data sector to hold it.
  const file = Buffer.alloc((totalSectors + 1) * SECTOR_SIZE);
  // header
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(file, 0);
  file.writeUInt16LE(0x003e, 24); // minor version
  file.writeUInt16LE(0x0003, 26); // major version
  file.writeUInt16LE(0xfffe, 28); // little-endian
  file.writeUInt16LE(12, 30); // sector shift (4096)
  file.writeUInt16LE(6, 32); // mini sector shift (64)
  file.writeUInt32LE(dirSectors, 40);
  file.writeUInt32LE(fatSectors, 44);
  file.writeUInt32LE(dirStart, 48);
  file.writeUInt32LE(0, 52); // transaction signature
  file.writeUInt32LE(MINI_CUTOFF, 56);
  file.writeUInt32LE(miniFatSectors > 0 ? miniFatStart : ENDOFCHAIN, 60);
  file.writeUInt32LE(miniFatSectors, 64);
  file.writeUInt32LE(ENDOFCHAIN, 68); // no DIFAT sectors beyond the header
  file.writeUInt32LE(0, 72);
  file.writeUInt32LE(fatStart, 76); // DIFAT[0]
  for (let i = 1; i < 109; i++) file.writeUInt32LE(FREESECT, 76 + i * 4);

  // FAT / mini FAT / directory / mini stream. The FAT and mini FAT sectors
  // are fully written (padded with FREESECT) so unused entries never read as
  // chain pointers to sector 0.
  const fatEntriesPerSector = SECTOR_SIZE / 4;
  for (let i = 0; i < fatSectors * fatEntriesPerSector; i++) {
    file.writeUInt32LE(i < fat.length ? fat[i] : FREESECT, (fatStart + 1) * SECTOR_SIZE + i * 4);
  }
  for (let i = 0; i < miniFatSectors * fatEntriesPerSector; i++) {
    file.writeUInt32LE(i < miniFat.length ? miniFat[i] : FREESECT, (miniFatStart + 1) * SECTOR_SIZE + i * 4);
  }
  dirData.copy(file, (dirStart + 1) * SECTOR_SIZE);
  miniStream.copy(file, (miniStreamStart + 1) * SECTOR_SIZE);

  return file;
}

// ---------------------------------------------------------------------------
// AAF object emission — properties-streams mode
// ---------------------------------------------------------------------------

// Property storage formats (AAF spec / pyaaf2)
const F_DATA = 0x82;
const F_STRONG_REF = 0x22;
const F_STRONG_REF_VECTOR = 0x32;
const F_STRONG_REF_SET = 0x3a;
const F_WEAK_REF = 0x02;
const F_WEAK_REF_VECTOR = 0x12;

export interface AafProp {
  pid: number;
  format: number;
  data: Buffer;
}

const propData = (pid: number, data: Buffer): AafProp => ({ pid, format: F_DATA, data });
const propRef = (pid: number, refName: string): AafProp => ({ pid, format: F_STRONG_REF, data: utf16(refName) });
const propVector = (pid: number, indexName: string): AafProp => ({ pid, format: F_STRONG_REF_VECTOR, data: utf16(indexName) });
const propSet = (pid: number, indexName: string): AafProp => ({ pid, format: F_STRONG_REF_SET, data: utf16(indexName) });
const propWeakRef = (pid: number, index: number, keyPid: number, ref: Buffer): AafProp => ({
  pid,
  format: F_WEAK_REF,
  data: Buffer.concat([u16le(index), u16le(keyPid), u8(16), ref]),
});
const propWeakVector = (pid: number, indexName: string): AafProp => ({ pid, format: F_WEAK_REF_VECTOR, data: utf16(indexName) });

/** Serialize an object's property entries into its `properties` stream. */
function encodeProperties(props: AafProp[]): Buffer {
  const table = Buffer.alloc(4 + 6 * props.length);
  table.writeUInt8(0x4c, 0); // little-endian
  table.writeUInt8(32, 1); // property stream version
  table.writeUInt16LE(props.length, 2);
  let offset = 4;
  for (const prop of props) {
    table.writeUInt16LE(prop.pid, offset);
    table.writeUInt16LE(prop.format, offset + 2);
    table.writeUInt16LE(prop.data.length, offset + 4);
    offset += 6;
  }
  return Buffer.concat([table, ...props.map((prop) => prop.data)]);
}

/** Reference-vector index stream: count, next/last keys, then local keys. */
function vectorIndex(keys: number[]): Buffer {
  return Buffer.concat([
    u32le(keys.length),
    u32le(keys.length),
    u32le(0xffffffff),
    ...keys.map((key) => u32le(key)),
  ]);
}

/** Reference-set index stream: count, keys, key_pid/key_size, then items. */
function setIndex(items: { localKey: number; key: Buffer }[], keyPid: number, keySize: number): Buffer {
  return Buffer.concat([
    u32le(items.length),
    u32le(items.length),
    u32le(0xffffffff),
    u16le(keyPid),
    u8(keySize),
    ...items.map((item) => Buffer.concat([u32le(item.localKey), u32le(1), item.key])),
  ]);
}

/** Weak-reference-vector index stream (used for record MemberTypes). */
function weakVectorIndex(keys: Buffer[], weakrefIndex: number, keyPid: number): Buffer {
  return Buffer.concat([
    u32le(keys.length),
    u16le(weakrefIndex),
    u16le(keyPid),
    u8(16),
    ...keys,
  ]);
}

/** TimeStamp record: date (u16 year, u8 month, u8 day) + time (u8 h/m/s, u8 fraction). */
function timestampBytes(date: Date): Buffer {
  return Buffer.from([
    date.getUTCFullYear() & 0xff,
    (date.getUTCFullYear() >> 8) & 0xff,
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    0,
  ]);
}

/** Rational record: two int32s. */
function rationalBytes(numerator: number, denominator: number): Buffer {
  return Buffer.concat([s32le(numerator), s32le(denominator)]);
}

function frames(ms: number, fps: number): number {
  return Math.max(0, Math.round((ms / 1000) * fps));
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export interface AafExportOptions {
  title: string;
  version?: number | null;
  clips: EdlClip[];
  assetById: Map<string, EdlAssetRef>;
  fps?: number;
  /** Overridable clock for deterministic tests. */
  now?: Date;
  /** Data definition for the timeline ("picture" or "sound"). */
  mediaKind?: "picture" | "sound";
}

/**
 * Build an AAF file (export-only) for a timeline snapshot. Returns the raw
 * `.aaf` bytes: a CFB container holding the Header → ContentStorage → Mobs
 * graph plus a self-contained MetaDictionary.
 */
export function buildTimelineAaf(args: AafExportOptions): Buffer {
  const fps = args.fps ?? AAF_FPS;
  const now = args.now ?? new Date();
  const mediaKind = args.mediaKind ?? "picture";
  const dataDefAuid = mediaKind === "sound" ? AUIDS.DataDef_Sound : AUIDS.DataDef_Picture;
  const clips = [...args.clips].sort((a, b) => (a.inMs ?? 0) - (b.inMs ?? 0));

  // Unique sources in first-use order.
  const sources: { assetId: string; fileName: string; mobId: Buffer; durationFrames: number }[] = [];
  const sourceIndex = new Map<string, number>();
  for (const clip of clips) {
    const assetId = clip.assetId ?? clip.id;
    if (sourceIndex.has(assetId)) continue;
    sources.push({
      assetId,
      fileName: args.assetById.get(assetId)?.fileName ?? assetId,
      mobId: randomMobId(),
      durationFrames: 0,
    });
    sourceIndex.set(assetId, sources.length - 1);
  }
  for (const clip of clips) {
    const assetId = clip.assetId ?? clip.id;
    const index = sourceIndex.get(assetId);
    if (index === undefined) continue;
    const srcOut = clip.srcOutMs ?? clip.outMs ?? 0;
    sources[index].durationFrames = Math.max(sources[index].durationFrames, frames(srcOut, fps));
  }

  // Weak-reference table (order defines the indices used in property data):
  //   0: Root.MetaDictionary.ClassDefinitions
  //   1: Root.Header.Dictionary.DataDefinitions
  //   2: Root.MetaDictionary.TypeDefinitions
  const weakrefPaths = [
    [0x0001, 0x0003],
    [0x0002, 0x3b04, 0x2605],
    [0x0001, 0x0004],
  ];

  // -------------------------------------------------------------------------
  // Directory tree
  // -------------------------------------------------------------------------
  const root = newDir("Root Entry", 5, parseAuid(AUIDS.Root));

  const metadict = newDir("MetaDictionary-1", 1, parseAuid(AUIDS.MetaDictionary));
  const headerObj = newDir("Header-2", 1, parseAuid(AUIDS.Header));
  const referencedProps = newDir("referenced properties", 2, Buffer.alloc(16));
  addChild(root, metadict);
  addChild(root, headerObj);
  addChild(root, referencedProps);

  // "/referenced properties" — the weak-ref table.
  {
    let pidCount = 0;
    for (const path of weakrefPaths) pidCount += path.length + 1;
    referencedProps.streams.set(
      "",
      Buffer.concat([
        u8(0x4c),
        u16le(weakrefPaths.length),
        u32le(pidCount),
        ...weakrefPaths.flatMap((path) => [...path.map((pid) => u16le(pid)), u16le(0)]),
      ]),
    );
  }

  // -------------------------------------------------------------------------
  // Helper: create an AAF object = storage dir + `properties` stream.
  // -------------------------------------------------------------------------
  const makeObject = (name: string, classAuid: string, props: AafProp[]): CfbDir => {
    const dir = newDir(name, 1, parseAuid(classAuid));
    dir.streams.set("properties", encodeProperties(props));
    return dir;
  };

  // Attach a strong-ref subdirectory (the ref property points at its name).
  const refDir = (parent: CfbDir, propertyName: string, pid: number): CfbDir => {
    const dir = newDir(refName(propertyName, pid), 1, Buffer.alloc(16));
    addChild(parent, dir);
    return dir;
  };

  // Attach a vector's index stream + rename/attach the given child dirs.
  const vectorChildren = (parent: CfbDir, propertyName: string, pid: number, dirs: CfbDir[]): string => {
    const name = indexName(propertyName, pid);
    const indexStream = newDir(`${name} index`, 2, Buffer.alloc(16));
    indexStream.streams.set("", vectorIndex(Array.from({ length: dirs.length }, (_, i) => i)));
    addChild(parent, indexStream);
    dirs.forEach((dir, i) => {
      dir.name = `${name}{${i.toString(16)}}`;
      addChild(parent, dir);
    });
    return name;
  };

  // Attach a set's index stream + rename/attach the given child dirs.
  const setChildren = (
    parent: CfbDir,
    propertyName: string,
    pid: number,
    items: { key: Buffer; dir: CfbDir }[],
    keyPid: number,
    keySize: number,
  ): string => {
    const name = indexName(propertyName, pid);
    const indexStream = newDir(`${name} index`, 2, Buffer.alloc(16));
    indexStream.streams.set(
      "",
      setIndex(
        items.map((item, i) => ({ localKey: i, key: item.key })),
        keyPid,
        keySize,
      ),
    );
    addChild(parent, indexStream);
    items.forEach((item, i) => {
      item.dir.name = `${name}{${i.toString(16)}}`;
      addChild(parent, item.dir);
    });
    return name;
  };

  // -------------------------------------------------------------------------
  // MetaDictionary — ClassDefinitions + TypeDefinitions
  // -------------------------------------------------------------------------
  const classDefDirs = emitClassDefinitions(makeObject);
  const typeDefDirs = emitTypeDefinitions(makeObject);
  const classSetIndex = setChildren(metadict, "ClassDefinitions", 0x0003, classDefDirs, 0x0005, 16);
  const typeSetIndex = setChildren(metadict, "TypeDefinitions", 0x0004, typeDefDirs, 0x0005, 16);
  metadict.streams.set(
    "properties",
    encodeProperties([propSet(0x0003, classSetIndex), propSet(0x0004, typeSetIndex)]),
  );

  // -------------------------------------------------------------------------
  // Header object
  // -------------------------------------------------------------------------
  const identification = makeObject("", AUIDS.Identification, [
    propData(0x3c01, utf16("Creators Den")),
    propData(0x3c02, utf16("Creators Den VCS")),
    propData(0x3c04, utf16("1.0.0")),
    propData(0x3c05, randomAuid()),
    propData(0x3c06, timestampBytes(now)),
    propData(0x3c09, randomAuid()),
  ]);
  vectorChildren(headerObj, "IdentificationList", 0x3b06, [identification]);

  // Dictionary — empty shell holding the DataDefinitions set (sequences
  // reference DataDef_Picture weakly through Header → Dictionary).
  const dictionary = makeObject(refName("Dictionary", 0x3b04), AUIDS.Dictionary, []);
  addChild(headerObj, dictionary);
  const dataDef = makeObject("", AUIDS.DataDefinition, [
    propData(0x1b01, parseAuid(dataDefAuid)),
    propData(0x1b02, utf16(mediaKind === "sound" ? "DataDef_Sound" : "DataDef_Picture")),
  ]);
  const dataDefsIndex = setChildren(dictionary, "DataDefinitions", 0x2605, [
    { key: parseAuid(dataDefAuid), dir: dataDef },
  ], 0x1b01, 16);
  dictionary.streams.set("properties", encodeProperties([propSet(0x2605, dataDefsIndex)]));

  const content = makeObject(refName("Content", 0x3b03), AUIDS.ContentStorage, []);
  addChild(headerObj, content);

  headerObj.streams.set(
    "properties",
    encodeProperties([
      propData(0x3b01, u16le(0x4949)),
      propData(0x3b02, timestampBytes(now)),
      propRef(0x3b03, refName("Content", 0x3b03)),
      propRef(0x3b04, refName("Dictionary", 0x3b04)),
      propData(0x3b05, Buffer.from([1, 2])), // VersionType {major: 1, minor: 2}
      propVector(0x3b06, indexName("IdentificationList", 0x3b06)),
      propData(0x3b07, u32le(1)), // ObjectModelVersion
      propData(0x3b09, parseAuid(AUIDS.OPDef_EditProtocol)),
    ]),
  );

  // -------------------------------------------------------------------------
  // Master mob — timeline slot with the cut (Sequence of SourceClips).
  // -------------------------------------------------------------------------
  const masterMobId = randomMobId();
  const masterMob = makeObject("", AUIDS.MasterMob, []);
  const masterSlot = makeObject("", AUIDS.TimelineMobSlot, []);
  const sequence = makeObject(refName("Segment", 0x4803), AUIDS.Sequence, []);

  const clipDirs = clips.map((clip) => {
    const sourceIdx = sourceIndex.get(clip.assetId ?? clip.id) ?? 0;
    const source = sources[sourceIdx];
    const length = frames((clip.outMs ?? 0) - (clip.inMs ?? 0), fps);
    const start = frames(clip.srcInMs ?? clip.inMs ?? 0, fps);
    return makeObject("", AUIDS.SourceClip, [
      propWeakRef(0x0201, 1, 0x1b01, parseAuid(dataDefAuid)),
      propData(0x0202, s64le(length)),
      propData(0x1101, source.mobId),
      propData(0x1102, u32le(1)),
      propData(0x1201, s64le(start)),
    ]);
  });
  const componentsIndex = vectorChildren(sequence, "Components", 0x1001, clipDirs);

  sequence.streams.set(
    "properties",
    encodeProperties([
      propWeakRef(0x0201, 1, 0x1b01, parseAuid(dataDefAuid)),
      propVector(0x1001, componentsIndex),
    ]),
  );
  masterSlot.streams.set(
    "properties",
    encodeProperties([
      propData(0x4801, u32le(1)),
      propData(0x4802, utf16("Video")),
      propRef(0x4803, refName("Segment", 0x4803)),
      propData(0x4b01, rationalBytes(fps, 1)),
      propData(0x4b02, s64le(0)),
    ]),
  );
  addChild(masterSlot, sequence);
  const masterSlotsIndex = vectorChildren(masterMob, "Slots", 0x4403, [masterSlot]);
  masterMob.streams.set(
    "properties",
    encodeProperties([
      propData(0x4401, masterMobId),
      propData(0x4402, utf16(args.title)),
      propVector(0x4403, masterSlotsIndex),
      propData(0x4404, timestampBytes(now)),
      propData(0x4405, timestampBytes(now)),
    ]),
  );

  // -------------------------------------------------------------------------
  // Source mobs — one per unique source, each with a slot + FileDescriptor.
  // -------------------------------------------------------------------------
  const sourceMobDirs = sources.map((source) =>
    emitSourceMob(source, fps, now, makeObject, refDir, vectorChildren),
  );
  const mobsIndex = setChildren(content, "Mobs", 0x1901, [
    { key: masterMobId, dir: masterMob },
    ...sources.map((source, i) => ({ key: source.mobId, dir: sourceMobDirs[i] })),
  ], 0x4401, 32);
  content.streams.set("properties", encodeProperties([propSet(0x1901, mobsIndex)]));

  // Root properties.
  root.streams.set(
    "properties",
    encodeProperties([
      propRef(0x0001, "MetaDictionary-1"),
      propRef(0x0002, "Header-2"),
    ]),
  );

  return buildCfb(root);
}

/** Build a SourceMob (parentless; the Mobs set attaches it) with its slot. */
function emitSourceMob(
  source: { assetId: string; fileName: string; mobId: Buffer; durationFrames: number },
  fps: number,
  now: Date,
  makeObject: (name: string, classAuid: string, props: AafProp[]) => CfbDir,
  refDir: (parent: CfbDir, propertyName: string, pid: number) => CfbDir,
  vectorChildren: (parent: CfbDir, propertyName: string, pid: number, dirs: CfbDir[]) => string,
): CfbDir {
  const mob = makeObject("", AUIDS.SourceMob, []);

  // Source slot: TimelineMobSlot → Sequence → a bare SourceClip (the "tape" clip).
  const slot = makeObject("", AUIDS.TimelineMobSlot, []);
  const seq = makeObject(refName("Segment", 0x4803), AUIDS.Sequence, []);
  const clip = makeObject("", AUIDS.SourceClip, [
    propWeakRef(0x0201, 1, 0x1b01, parseAuid(AUIDS.DataDef_Picture)),
    propData(0x0202, s64le(source.durationFrames)),
    propData(0x1101, ZERO_MOBID),
    propData(0x1102, u32le(0)),
    propData(0x1201, s64le(0)),
  ]);
  const componentsIndex = vectorChildren(seq, "Components", 0x1001, [clip]);
  seq.streams.set(
    "properties",
    encodeProperties([
      propWeakRef(0x0201, 1, 0x1b01, parseAuid(AUIDS.DataDef_Picture)),
      propVector(0x1001, componentsIndex),
    ]),
  );
  slot.streams.set(
    "properties",
    encodeProperties([
      propData(0x4801, u32le(1)),
      propData(0x4802, utf16("Video")),
      propRef(0x4803, refName("Segment", 0x4803)),
      propData(0x4b01, rationalBytes(fps, 1)),
      propData(0x4b02, s64le(0)),
    ]),
  );
  addChild(slot, seq);
  const slotsIndex = vectorChildren(mob, "Slots", 0x4403, [slot]);
  mob.streams.set(
    "properties",
    encodeProperties([
      propData(0x4401, source.mobId),
      propData(0x4402, utf16(source.fileName)),
      propVector(0x4403, slotsIndex),
      propData(0x4404, timestampBytes(now)),
      propData(0x4405, timestampBytes(now)),
    ]),
  );

  // FileDescriptor with a NetworkLocator back into the vault.
  const descriptor = makeObject(refName("EssenceDescription", 0x4701), AUIDS.FileDescriptor, []);
  const locator = makeObject("", AUIDS.NetworkLocator, [
    propData(0x4001, utf16(`file:///vault/${source.fileName}`)),
  ]);
  const locatorIndex = vectorChildren(descriptor, "Locator", 0x2f01, [locator]);
  descriptor.streams.set(
    "properties",
    encodeProperties([
      propData(0x3001, rationalBytes(fps, 1)),
      propData(0x3002, s64le(source.durationFrames)),
      propVector(0x2f01, locatorIndex),
    ]),
  );
  addChild(mob, descriptor);
  void refDir;

  return mob;
}

// ---------------------------------------------------------------------------
// MetaDictionary tables — the exact classes / properties / typedefs used,
// mirroring the SMPTE dictionary entries pyaaf2 writes for a new file.
// ---------------------------------------------------------------------------

type DefProp = {
  name: string;
  auid: string;
  pid: number;
  typedef: string;
  optional?: boolean;
  unique?: boolean;
};

type DefClass = {
  name: string;
  auid: string;
  parent: string | null;
  concrete: boolean;
  props: DefProp[];
};

const CLASS_DEFINITIONS: DefClass[] = [
  {
    name: "MetaDefinition", auid: AUIDS.MetaDefinition, parent: null, concrete: false,
    props: [
      { name: "Identification", auid: "06010107-1300-0000-060e-2b3401010102", pid: 0x0005, typedef: TYPEDEFS.AUID, unique: true },
      { name: "Name", auid: "03020401-0201-0000-060e-2b3401010102", pid: 0x0006, typedef: TYPEDEFS.aafString },
      { name: "Description", auid: "06010107-1401-0000-060e-2b3401010102", pid: 0x0007, typedef: TYPEDEFS.aafString, optional: true },
    ],
  },
  {
    name: "ClassDefinition", auid: AUIDS.ClassDefinition, parent: AUIDS.MetaDefinition, concrete: true,
    props: [
      { name: "ParentClass", auid: "06010107-0100-0000-060e-2b3401010102", pid: 0x0008, typedef: TYPEDEFS.ClassDefinitionWeakReference },
      { name: "Properties", auid: "06010107-0200-0000-060e-2b3401010102", pid: 0x0009, typedef: TYPEDEFS.PropertyDefinitionStrongReferenceSet, optional: true },
      { name: "IsConcrete", auid: "06010107-0300-0000-060e-2b3401010102", pid: 0x000a, typedef: TYPEDEFS.Boolean },
    ],
  },
  {
    name: "PropertyDefinition", auid: AUIDS.PropertyDefinition, parent: AUIDS.MetaDefinition, concrete: true,
    props: [
      { name: "Type", auid: "06010107-0400-0000-060e-2b3401010102", pid: 0x000b, typedef: TYPEDEFS.AUID },
      { name: "IsOptional", auid: "03010202-0100-0000-060e-2b3401010102", pid: 0x000c, typedef: TYPEDEFS.Boolean },
      { name: "LocalIdentification", auid: "06010107-0500-0000-060e-2b3401010102", pid: 0x000d, typedef: TYPEDEFS.aafUInt16 },
      { name: "IsUniqueIdentifier", auid: "06010107-0600-0000-060e-2b3401010102", pid: 0x000e, typedef: TYPEDEFS.Boolean, optional: true },
    ],
  },
  {
    name: "TypeDefinition", auid: AUIDS.TypeDefinition, parent: AUIDS.MetaDefinition, concrete: false, props: [],
  },
  {
    name: "TypeDefinitionInteger", auid: AUIDS.TypeDefinitionInteger, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "Size", auid: "03010203-0100-0000-060e-2b3401010102", pid: 0x000f, typedef: TYPEDEFS.aafUInt8 },
      { name: "IsSigned", auid: "03010203-0200-0000-060e-2b3401010102", pid: 0x0010, typedef: TYPEDEFS.Boolean },
    ],
  },
  {
    name: "TypeDefinitionStrongObjectReference", auid: AUIDS.TypeDefinitionStrongObjectReference, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "ReferencedType", auid: "06010107-0900-0000-060e-2b3401010102", pid: 0x0011, typedef: TYPEDEFS.ClassDefinitionWeakReference },
    ],
  },
  {
    name: "TypeDefinitionWeakObjectReference", auid: AUIDS.TypeDefinitionWeakObjectReference, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "ReferencedType", auid: "06010107-0a00-0000-060e-2b3401010102", pid: 0x0012, typedef: TYPEDEFS.ClassDefinitionWeakReference },
      { name: "TargetSet", auid: "03010203-0b00-0000-060e-2b3401010102", pid: 0x0013, typedef: TYPEDEFS.aafAUIDArray },
    ],
  },
  {
    name: "TypeDefinitionEnumeration", auid: AUIDS.TypeDefinitionEnumeration, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "ElementType", auid: "06010107-0b00-0000-060e-2b3401010102", pid: 0x0014, typedef: TYPEDEFS.TypeDefinitionWeakReference },
      { name: "ElementNames", auid: "03010203-0400-0000-060e-2b3401010102", pid: 0x0015, typedef: TYPEDEFS.aafStringArray },
      { name: "ElementValues", auid: "03010203-0500-0000-060e-2b3401010102", pid: 0x0016, typedef: TYPEDEFS.aafInt64Array },
    ],
  },
  {
    name: "TypeDefinitionFixedArray", auid: AUIDS.TypeDefinitionFixedArray, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "ElementType", auid: "06010107-0c00-0000-060e-2b3401010102", pid: 0x0017, typedef: TYPEDEFS.TypeDefinitionWeakReference },
      { name: "ElementCount", auid: "03010203-0300-0000-060e-2b3401010102", pid: 0x0018, typedef: TYPEDEFS.aafUInt32 },
    ],
  },
  {
    name: "TypeDefinitionVariableArray", auid: AUIDS.TypeDefinitionVariableArray, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "ElementType", auid: "06010107-0d00-0000-060e-2b3401010102", pid: 0x0019, typedef: TYPEDEFS.TypeDefinitionWeakReference },
    ],
  },
  {
    name: "TypeDefinitionSet", auid: AUIDS.TypeDefinitionSet, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "ElementType", auid: "06010107-0e00-0000-060e-2b3401010102", pid: 0x001a, typedef: TYPEDEFS.TypeDefinitionWeakReference },
    ],
  },
  {
    name: "TypeDefinitionString", auid: AUIDS.TypeDefinitionString, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "ElementType", auid: "06010107-0f00-0000-060e-2b3401010102", pid: 0x001b, typedef: TYPEDEFS.TypeDefinitionWeakReference },
    ],
  },
  {
    name: "TypeDefinitionRecord", auid: AUIDS.TypeDefinitionRecord, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "MemberTypes", auid: "06010107-1100-0000-060e-2b3401010102", pid: 0x001c, typedef: TYPEDEFS.TypeDefinitionWeakReferenceVector },
      { name: "MemberNames", auid: "03010203-0600-0000-060e-2b3401010102", pid: 0x001d, typedef: TYPEDEFS.aafStringArray },
    ],
  },
  {
    name: "TypeDefinitionRename", auid: AUIDS.TypeDefinitionRename, parent: AUIDS.TypeDefinition, concrete: true,
    props: [
      { name: "RenamedType", auid: "06010107-1200-0000-060e-2b3401010102", pid: 0x001e, typedef: TYPEDEFS.TypeDefinitionWeakReference },
    ],
  },
  {
    name: "TypeDefinitionCharacter", auid: AUIDS.TypeDefinitionCharacter, parent: AUIDS.TypeDefinition, concrete: true, props: [],
  },
  {
    name: "InterchangeObject", auid: AUIDS.InterchangeObject, parent: null, concrete: false, props: [],
  },
  {
    name: "DefinitionObject", auid: AUIDS.DefinitionObject, parent: AUIDS.InterchangeObject, concrete: false,
    props: [
      { name: "Identification", auid: "01011503-0000-0000-060e-2b3401010102", pid: 0x1b01, typedef: TYPEDEFS.AUID, unique: true },
      { name: "Name", auid: "01070102-0301-0000-060e-2b3401010102", pid: 0x1b02, typedef: TYPEDEFS.aafString },
    ],
  },
  {
    name: "DataDefinition", auid: AUIDS.DataDefinition, parent: AUIDS.DefinitionObject, concrete: true, props: [],
  },
  {
    name: "Dictionary", auid: AUIDS.Dictionary, parent: AUIDS.InterchangeObject, concrete: true,
    props: [
      { name: "DataDefinitions", auid: "06010104-0505-0000-060e-2b3401010102", pid: 0x2605, typedef: TYPEDEFS.DataDefinitionStrongReferenceSet, optional: true },
    ],
  },
  {
    name: "ContentStorage", auid: AUIDS.ContentStorage, parent: AUIDS.InterchangeObject, concrete: true,
    props: [
      { name: "Mobs", auid: "06010104-0501-0000-060e-2b3401010102", pid: 0x1901, typedef: TYPEDEFS.MobStrongReferenceSet },
    ],
  },
  {
    name: "Header", auid: AUIDS.Header, parent: AUIDS.InterchangeObject, concrete: true,
    props: [
      { name: "ByteOrder", auid: "03010201-0200-0000-060e-2b3401010101", pid: 0x3b01, typedef: TYPEDEFS.aafUInt16 },
      { name: "LastModified", auid: "07020110-0204-0000-060e-2b3401010102", pid: 0x3b02, typedef: TYPEDEFS.TimeStamp },
      { name: "Content", auid: "06010104-0201-0000-060e-2b3401010102", pid: 0x3b03, typedef: TYPEDEFS.ContentStorageStrongReference },
      { name: "Dictionary", auid: "06010104-0202-0000-060e-2b3401010102", pid: 0x3b04, typedef: TYPEDEFS.DictionaryStrongReference },
      { name: "Version", auid: "03010201-0500-0000-060e-2b3401010102", pid: 0x3b05, typedef: TYPEDEFS.VersionType },
      { name: "IdentificationList", auid: "06010104-0604-0000-060e-2b3401010102", pid: 0x3b06, typedef: TYPEDEFS.IdentificationStrongReferenceVector },
      { name: "ObjectModelVersion", auid: "03010201-0400-0000-060e-2b3401010102", pid: 0x3b07, typedef: TYPEDEFS.aafUInt32, optional: true },
      { name: "OperationalPattern", auid: "01020203-0000-0000-060e-2b3401010105", pid: 0x3b09, typedef: TYPEDEFS.AUID, optional: true },
    ],
  },
  {
    name: "Identification", auid: AUIDS.Identification, parent: AUIDS.InterchangeObject, concrete: true,
    props: [
      { name: "CompanyName", auid: "05200701-0201-0000-060e-2b3401010102", pid: 0x3c01, typedef: TYPEDEFS.aafString },
      { name: "ProductName", auid: "05200701-0301-0000-060e-2b3401010102", pid: 0x3c02, typedef: TYPEDEFS.aafString },
      { name: "ProductVersionString", auid: "05200701-0501-0000-060e-2b3401010102", pid: 0x3c04, typedef: TYPEDEFS.aafString },
      { name: "ProductID", auid: "05200701-0700-0000-060e-2b3401010102", pid: 0x3c05, typedef: TYPEDEFS.AUID },
      { name: "Date", auid: "07020110-0203-0000-060e-2b3401010102", pid: 0x3c06, typedef: TYPEDEFS.TimeStamp },
      { name: "GenerationAUID", auid: "05200701-0100-0000-060e-2b3401010102", pid: 0x3c09, typedef: TYPEDEFS.AUID },
    ],
  },
  {
    name: "EssenceDescriptor", auid: AUIDS.EssenceDescriptor, parent: AUIDS.InterchangeObject, concrete: false,
    props: [
      { name: "Locator", auid: "06010104-0603-0000-060e-2b3401010102", pid: 0x2f01, typedef: TYPEDEFS.LocatorStrongReferenceVector, optional: true },
    ],
  },
  {
    name: "FileDescriptor", auid: AUIDS.FileDescriptor, parent: AUIDS.EssenceDescriptor, concrete: false,
    props: [
      { name: "SampleRate", auid: "04060101-0000-0000-060e-2b3401010101", pid: 0x3001, typedef: TYPEDEFS.Rational },
      { name: "Length", auid: "04060102-0000-0000-060e-2b3401010101", pid: 0x3002, typedef: TYPEDEFS.aafLengthType },
    ],
  },
  {
    name: "Locator", auid: AUIDS.Locator, parent: AUIDS.InterchangeObject, concrete: false, props: [],
  },
  {
    name: "NetworkLocator", auid: AUIDS.NetworkLocator, parent: AUIDS.Locator, concrete: true,
    props: [
      { name: "URLString", auid: "01020101-0100-0000-060e-2b3401010101", pid: 0x4001, typedef: TYPEDEFS.aafString },
    ],
  },
  {
    name: "Mob", auid: AUIDS.Mob, parent: AUIDS.InterchangeObject, concrete: false,
    props: [
      { name: "MobID", auid: "01011510-0000-0000-060e-2b3401010101", pid: 0x4401, typedef: TYPEDEFS.MobIDType, unique: true },
      { name: "Name", auid: "01030302-0100-0000-060e-2b3401010101", pid: 0x4402, typedef: TYPEDEFS.aafString, optional: true },
      { name: "Slots", auid: "06010104-0605-0000-060e-2b3401010102", pid: 0x4403, typedef: TYPEDEFS.MobSlotStrongReferenceVector },
      { name: "LastModified", auid: "07020110-0205-0000-060e-2b3401010102", pid: 0x4404, typedef: TYPEDEFS.TimeStamp },
      { name: "CreationTime", auid: "07020110-0103-0000-060e-2b3401010102", pid: 0x4405, typedef: TYPEDEFS.TimeStamp },
    ],
  },
  {
    name: "MasterMob", auid: AUIDS.MasterMob, parent: AUIDS.Mob, concrete: true, props: [],
  },
  {
    name: "SourceMob", auid: AUIDS.SourceMob, parent: AUIDS.Mob, concrete: true,
    props: [
      { name: "EssenceDescription", auid: "06010104-0203-0000-060e-2b3401010102", pid: 0x4701, typedef: TYPEDEFS.EssenceDescriptorStrongReference },
    ],
  },
  {
    name: "MobSlot", auid: AUIDS.MobSlot, parent: AUIDS.InterchangeObject, concrete: false,
    props: [
      { name: "SlotID", auid: "01070101-0000-0000-060e-2b3401010102", pid: 0x4801, typedef: TYPEDEFS.aafUInt32 },
      { name: "SlotName", auid: "01070102-0100-0000-060e-2b3401010102", pid: 0x4802, typedef: TYPEDEFS.aafString, optional: true },
      { name: "Segment", auid: "06010104-0204-0000-060e-2b3401010102", pid: 0x4803, typedef: TYPEDEFS.SegmentStrongReference },
    ],
  },
  {
    name: "TimelineMobSlot", auid: AUIDS.TimelineMobSlot, parent: AUIDS.MobSlot, concrete: true,
    props: [
      { name: "EditRate", auid: "05300405-0000-0000-060e-2b3401010102", pid: 0x4b01, typedef: TYPEDEFS.Rational },
      { name: "Origin", auid: "07020103-0103-0000-060e-2b3401010102", pid: 0x4b02, typedef: TYPEDEFS.aafPositionType },
    ],
  },
  {
    name: "Component", auid: AUIDS.Component, parent: AUIDS.InterchangeObject, concrete: false,
    props: [
      { name: "DataDefinition", auid: "04070100-0000-0000-060e-2b3401010102", pid: 0x0201, typedef: TYPEDEFS.DataDefinitionWeakReference },
      { name: "Length", auid: "07020201-0103-0000-060e-2b3401010102", pid: 0x0202, typedef: TYPEDEFS.aafLengthType, optional: true },
    ],
  },
  {
    name: "Segment", auid: AUIDS.Segment, parent: AUIDS.Component, concrete: false, props: [],
  },
  {
    name: "SourceReference", auid: AUIDS.SourceReference, parent: AUIDS.Segment, concrete: false,
    props: [
      { name: "SourceID", auid: "06010103-0100-0000-060e-2b3401010102", pid: 0x1101, typedef: TYPEDEFS.MobIDType, optional: true },
      { name: "SourceMobSlotID", auid: "06010103-0200-0000-060e-2b3401010102", pid: 0x1102, typedef: TYPEDEFS.aafUInt32 },
    ],
  },
  {
    name: "SourceClip", auid: AUIDS.SourceClip, parent: AUIDS.SourceReference, concrete: true,
    props: [
      { name: "StartTime", auid: "07020103-0104-0000-060e-2b3401010102", pid: 0x1201, typedef: TYPEDEFS.aafPositionType, optional: true },
    ],
  },
  {
    name: "Sequence", auid: AUIDS.Sequence, parent: AUIDS.Segment, concrete: true,
    props: [
      { name: "Components", auid: "06010104-0609-0000-060e-2b3401010102", pid: 0x1001, typedef: TYPEDEFS.ComponentStrongReferenceVector },
    ],
  },
  {
    name: "MetaDictionary", auid: AUIDS.MetaDictionary, parent: null, concrete: true,
    props: [
      { name: "ClassDefinitions", auid: "06010107-0700-0000-060e-2b3401010102", pid: 0x0003, typedef: TYPEDEFS.ClassDefinitionStrongReferenceSet, optional: true },
      { name: "TypeDefinitions", auid: "06010107-0800-0000-060e-2b3401010102", pid: 0x0004, typedef: TYPEDEFS.TypeDefinitionStrongReferenceSet, optional: true },
    ],
  },
];

type TypedefDef =
  | { kind: "int"; name: string; auid: string; size: number; signed: boolean }
  | { kind: "enum"; name: string; auid: string; element: string; names: string[]; values: number[] }
  | { kind: "record"; name: string; auid: string; members: { name: string; typedef: string }[] }
  | { kind: "rename"; name: string; auid: string; renamed: string }
  | { kind: "string"; name: string; auid: string; element: string }
  | { kind: "character"; name: string; auid: string }
  | { kind: "fixed-array"; name: string; auid: string; element: string; count: number }
  | { kind: "var-array"; name: string; auid: string; element: string }
  | { kind: "set"; name: string; auid: string; element: string }
  | { kind: "strong-ref"; name: string; auid: string; target: string }
  | { kind: "weak-ref"; name: string; auid: string; target: string; path: string[] };

const TYPEDEF_DEFINITIONS: TypedefDef[] = [
  { kind: "int", name: "aafUInt8", auid: TYPEDEFS.aafUInt8, size: 1, signed: false },
  { kind: "int", name: "aafUInt16", auid: TYPEDEFS.aafUInt16, size: 2, signed: false },
  { kind: "int", name: "aafUInt32", auid: TYPEDEFS.aafUInt32, size: 4, signed: false },
  { kind: "int", name: "aafUInt64", auid: TYPEDEFS.aafUInt64, size: 8, signed: false },
  { kind: "int", name: "aafInt8", auid: TYPEDEFS.aafInt8, size: 1, signed: true },
  { kind: "int", name: "aafInt16", auid: TYPEDEFS.aafInt16, size: 2, signed: true },
  { kind: "int", name: "aafInt32", auid: TYPEDEFS.aafInt32, size: 4, signed: true },
  { kind: "int", name: "aafInt64", auid: TYPEDEFS.aafInt64, size: 8, signed: true },
  { kind: "enum", name: "Boolean", auid: TYPEDEFS.Boolean, element: TYPEDEFS.aafUInt8, names: ["False", "True"], values: [0, 1] },
  {
    kind: "enum", name: "ProductReleaseType", auid: TYPEDEFS.ProductReleaseType, element: TYPEDEFS.aafUInt8,
    names: ["VersionUnknown", "VersionReleased", "VersionDebug", "VersionPatched", "VersionBeta", "VersionPrivateBuild"],
    values: [0, 1, 2, 3, 4, 5],
  },
  { kind: "record", name: "AUID", auid: TYPEDEFS.AUID, members: [
    { name: "Data1", typedef: TYPEDEFS.aafUInt32 },
    { name: "Data2", typedef: TYPEDEFS.aafUInt16 },
    { name: "Data3", typedef: TYPEDEFS.aafUInt16 },
    { name: "Data4", typedef: TYPEDEFS.aafUInt8Array8 },
  ] },
  { kind: "record", name: "MobIDType", auid: TYPEDEFS.MobIDType, members: [
    { name: "SMPTELabel", typedef: TYPEDEFS.aafUInt8Array12 },
    { name: "length", typedef: TYPEDEFS.aafUInt8 },
    { name: "instanceHigh", typedef: TYPEDEFS.aafUInt8 },
    { name: "instanceMid", typedef: TYPEDEFS.aafUInt8 },
    { name: "instanceLow", typedef: TYPEDEFS.aafUInt8 },
    { name: "material", typedef: TYPEDEFS.AUID },
  ] },
  { kind: "record", name: "Rational", auid: TYPEDEFS.Rational, members: [
    { name: "Numerator", typedef: TYPEDEFS.aafInt32 },
    { name: "Denominator", typedef: TYPEDEFS.aafInt32 },
  ] },
  { kind: "record", name: "ProductVersion", auid: TYPEDEFS.ProductVersion, members: [
    { name: "major", typedef: TYPEDEFS.aafUInt16 },
    { name: "minor", typedef: TYPEDEFS.aafUInt16 },
    { name: "tertiary", typedef: TYPEDEFS.aafUInt16 },
    { name: "patchLevel", typedef: TYPEDEFS.aafUInt16 },
    { name: "type", typedef: TYPEDEFS.ProductReleaseType },
  ] },
  { kind: "record", name: "VersionType", auid: TYPEDEFS.VersionType, members: [
    { name: "major", typedef: TYPEDEFS.aafInt8 },
    { name: "minor", typedef: TYPEDEFS.aafInt8 },
  ] },
  { kind: "record", name: "DateStruct", auid: TYPEDEFS.DateStruct, members: [
    { name: "year", typedef: TYPEDEFS.aafUInt16 },
    { name: "month", typedef: TYPEDEFS.aafUInt8 },
    { name: "day", typedef: TYPEDEFS.aafUInt8 },
  ] },
  { kind: "record", name: "TimeStruct", auid: TYPEDEFS.TimeStruct, members: [
    { name: "hour", typedef: TYPEDEFS.aafUInt8 },
    { name: "minute", typedef: TYPEDEFS.aafUInt8 },
    { name: "second", typedef: TYPEDEFS.aafUInt8 },
    { name: "fraction", typedef: TYPEDEFS.aafUInt8 },
  ] },
  { kind: "record", name: "TimeStamp", auid: TYPEDEFS.TimeStamp, members: [
    { name: "date", typedef: TYPEDEFS.DateStruct },
    { name: "time", typedef: TYPEDEFS.TimeStruct },
  ] },
  { kind: "rename", name: "aafPositionType", auid: TYPEDEFS.aafPositionType, renamed: TYPEDEFS.aafInt64 },
  { kind: "rename", name: "aafLengthType", auid: TYPEDEFS.aafLengthType, renamed: TYPEDEFS.aafInt64 },
  { kind: "string", name: "aafString", auid: TYPEDEFS.aafString, element: TYPEDEFS.aafCharacter },
  { kind: "character", name: "aafCharacter", auid: TYPEDEFS.aafCharacter },
  { kind: "fixed-array", name: "aafUInt8Array8", auid: TYPEDEFS.aafUInt8Array8, element: TYPEDEFS.aafUInt8, count: 8 },
  { kind: "fixed-array", name: "aafUInt8Array12", auid: TYPEDEFS.aafUInt8Array12, element: TYPEDEFS.aafUInt8, count: 12 },
  { kind: "var-array", name: "aafInt64Array", auid: TYPEDEFS.aafInt64Array, element: TYPEDEFS.aafInt64 },
  { kind: "var-array", name: "aafStringArray", auid: TYPEDEFS.aafStringArray, element: TYPEDEFS.aafCharacter },
  { kind: "var-array", name: "aafAUIDArray", auid: TYPEDEFS.aafAUIDArray, element: TYPEDEFS.AUID },
  { kind: "strong-ref", name: "HeaderStrongRefence", auid: TYPEDEFS.HeaderStrongRefence, target: AUIDS.Header },
  { kind: "strong-ref", name: "MetaDictionaryStrongReference", auid: TYPEDEFS.MetaDictionaryStrongReference, target: AUIDS.MetaDictionary },
  { kind: "strong-ref", name: "DictionaryStrongReference", auid: TYPEDEFS.DictionaryStrongReference, target: AUIDS.Dictionary },
  { kind: "strong-ref", name: "ContentStorageStrongReference", auid: TYPEDEFS.ContentStorageStrongReference, target: AUIDS.ContentStorage },
  { kind: "strong-ref", name: "SegmentStrongReference", auid: TYPEDEFS.SegmentStrongReference, target: AUIDS.Segment },
  { kind: "strong-ref", name: "DataDefinitionStrongReference", auid: TYPEDEFS.DataDefinitionStrongReference, target: AUIDS.DataDefinition },
  { kind: "strong-ref", name: "EssenceDescriptorStrongReference", auid: TYPEDEFS.EssenceDescriptorStrongReference, target: AUIDS.EssenceDescriptor },
  { kind: "strong-ref", name: "IdentificationStrongReference", auid: TYPEDEFS.IdentificationStrongReference, target: AUIDS.Identification },
  { kind: "strong-ref", name: "NetworkLocatorStrongReference", auid: TYPEDEFS.NetworkLocatorStrongReference, target: AUIDS.NetworkLocator },
  { kind: "strong-ref", name: "LocatorStrongReference", auid: TYPEDEFS.LocatorStrongReference, target: AUIDS.Locator },
  { kind: "strong-ref", name: "MobStrongReference", auid: TYPEDEFS.MobStrongReference, target: AUIDS.Mob },
  { kind: "strong-ref", name: "MobSlotStrongReference", auid: TYPEDEFS.MobSlotStrongReference, target: AUIDS.MobSlot },
  { kind: "strong-ref", name: "ComponentStrongReference", auid: TYPEDEFS.ComponentStrongReference, target: AUIDS.Component },
  { kind: "strong-ref", name: "PropertyDefinitionStrongReference", auid: TYPEDEFS.PropertyDefinitionStrongReference, target: AUIDS.PropertyDefinition },
  { kind: "strong-ref", name: "ClassDefinitionStrongReference", auid: TYPEDEFS.ClassDefinitionStrongReference, target: AUIDS.ClassDefinition },
  { kind: "strong-ref", name: "TypeDefinitionStrongReference", auid: TYPEDEFS.TypeDefinitionStrongReference, target: AUIDS.TypeDefinition },
  { kind: "var-array", name: "ComponentStrongReferenceVector", auid: TYPEDEFS.ComponentStrongReferenceVector, element: TYPEDEFS.ComponentStrongReference },
  { kind: "var-array", name: "IdentificationStrongReferenceVector", auid: TYPEDEFS.IdentificationStrongReferenceVector, element: TYPEDEFS.IdentificationStrongReference },
  { kind: "var-array", name: "MobSlotStrongReferenceVector", auid: TYPEDEFS.MobSlotStrongReferenceVector, element: TYPEDEFS.MobSlotStrongReference },
  { kind: "var-array", name: "LocatorStrongReferenceVector", auid: TYPEDEFS.LocatorStrongReferenceVector, element: TYPEDEFS.LocatorStrongReference },
  { kind: "set", name: "ClassDefinitionStrongReferenceSet", auid: TYPEDEFS.ClassDefinitionStrongReferenceSet, element: TYPEDEFS.ClassDefinitionStrongReference },
  { kind: "set", name: "TypeDefinitionStrongReferenceSet", auid: TYPEDEFS.TypeDefinitionStrongReferenceSet, element: TYPEDEFS.TypeDefinitionStrongReference },
  { kind: "set", name: "MobStrongReferenceSet", auid: TYPEDEFS.MobStrongReferenceSet, element: TYPEDEFS.MobStrongReference },
  { kind: "set", name: "DataDefinitionStrongReferenceSet", auid: TYPEDEFS.DataDefinitionStrongReferenceSet, element: TYPEDEFS.DataDefinitionStrongReference },
  { kind: "set", name: "PropertyDefinitionStrongReferenceSet", auid: TYPEDEFS.PropertyDefinitionStrongReferenceSet, element: TYPEDEFS.PropertyDefinitionStrongReference },
  { kind: "weak-ref", name: "ClassDefinitionWeakReference", auid: TYPEDEFS.ClassDefinitionWeakReference, target: AUIDS.ClassDefinition, path: [PROP_AUIDS.RootMetaDictionary, PROP_AUIDS.MetaDictionaryClassDefinitions] },
  { kind: "weak-ref", name: "DataDefinitionWeakReference", auid: TYPEDEFS.DataDefinitionWeakReference, target: AUIDS.DataDefinition, path: [PROP_AUIDS.RootHeader, PROP_AUIDS.HeaderDictionary, PROP_AUIDS.DictionaryDataDefinitions] },
  { kind: "weak-ref", name: "TypeDefinitionWeakReference", auid: TYPEDEFS.TypeDefinitionWeakReference, target: AUIDS.TypeDefinition, path: [PROP_AUIDS.RootMetaDictionary, PROP_AUIDS.MetaDictionaryTypeDefinitions] },
  { kind: "var-array", name: "TypeDefinitionWeakReferenceVector", auid: TYPEDEFS.TypeDefinitionWeakReferenceVector, element: TYPEDEFS.TypeDefinitionWeakReference },
];

/**
 * Emit the ClassDefinition objects (one per class in CLASS_DEFINITIONS, each
 * with its PropertyDefinition objects in a `Properties` set). Parentless —
 * the MetaDictionary's ClassDefinitions set attaches them.
 */
function emitClassDefinitions(
  makeObject: (name: string, classAuid: string, props: AafProp[]) => CfbDir,
): { key: Buffer; dir: CfbDir }[] {
  return CLASS_DEFINITIONS.map((def) => {
    const dir = makeObject("", AUIDS.ClassDefinition, [
      propData(0x0005, parseAuid(def.auid)),
      propData(0x0006, utf16(def.name)),
      propWeakRef(0x0008, 0, 0x0005, parseAuid(def.parent ?? def.auid)),
      propData(0x000a, u8(def.concrete ? 1 : 0)),
    ]);

    if (def.props.length > 0) {
      const propertyDirs = def.props.map((prop) => {
        const props: AafProp[] = [
          propData(0x0005, parseAuid(prop.auid)),
          propData(0x0006, utf16(prop.name)),
          propData(0x000b, parseAuid(prop.typedef)),
          propData(0x000c, u8(prop.optional ? 1 : 0)),
          propData(0x000d, u16le(prop.pid)),
        ];
        if (prop.unique) props.push(propData(0x000e, u8(1)));
        return makeObject("", AUIDS.PropertyDefinition, props);
      });
      const propertiesIndex = mangleName("Properties", 0x0009, 22);
      const indexStream = newDir(`${propertiesIndex} index`, 2, Buffer.alloc(16));
      indexStream.streams.set(
        "",
        setIndex(
          propertyDirs.map((_, i) => ({ localKey: i, key: parseAuid(def.props[i].auid) })),
          0x0005,
          16,
        ),
      );
      addChild(dir, indexStream);
      propertyDirs.forEach((propDir, i) => {
        propDir.name = `${propertiesIndex}{${i.toString(16)}}`;
        addChild(dir, propDir);
      });
      dir.streams.set(
        "properties",
        encodeProperties([
          propData(0x0005, parseAuid(def.auid)),
          propData(0x0006, utf16(def.name)),
          propWeakRef(0x0008, 0, 0x0005, parseAuid(def.parent ?? def.auid)),
          propSet(0x0009, propertiesIndex),
          propData(0x000a, u8(def.concrete ? 1 : 0)),
        ]),
      );
    }

    return { key: parseAuid(def.auid), dir };
  });
}

/**
 * Emit the TypeDefinition objects for the typedef closure used by the emitted
 * classes. Parentless — the MetaDictionary's TypeDefinitions set attaches them.
 */
function emitTypeDefinitions(
  makeObject: (name: string, classAuid: string, props: AafProp[]) => CfbDir,
): { key: Buffer; dir: CfbDir }[] {
  return TYPEDEF_DEFINITIONS.map((def) => {
    const dir = makeObject("", AUIDS.TypeDefinition, [
      propData(0x0005, parseAuid(def.auid)),
      propData(0x0006, utf16(def.name)),
    ]);
    const props: AafProp[] = [
      propData(0x0005, parseAuid(def.auid)),
      propData(0x0006, utf16(def.name)),
    ];
    const add = (prop: AafProp) => props.push(prop);
    let classAuid: string = AUIDS.TypeDefinition;

    switch (def.kind) {
      case "int":
        classAuid = AUIDS.TypeDefinitionInteger;
        add(propData(0x000f, u8(def.size)));
        add(propData(0x0010, u8(def.signed ? 1 : 0)));
        break;
      case "enum":
        classAuid = AUIDS.TypeDefinitionEnumeration;
        add(propWeakRef(0x0014, 2, 0x0005, parseAuid(def.element)));
        add(propData(0x0015, Buffer.concat(def.names.map((name) => utf16(name)))));
        add(propData(0x0016, Buffer.concat(def.values.map((value) => s64le(value)))));
        break;
      case "record": {
        classAuid = AUIDS.TypeDefinitionRecord;
        add(propData(0x001d, Buffer.concat(def.members.map((member) => utf16(member.name)))));
        const memberTypesIndex = mangleName("MemberTypes", 0x1c, 32);
        const keys = def.members.map((member) => parseAuid(member.typedef));
        const indexStream = newDir(`${memberTypesIndex} index`, 2, Buffer.alloc(16));
        indexStream.streams.set("", weakVectorIndex(keys, 2, 0x0005));
        addChild(dir, indexStream);
        add(propWeakVector(0x001c, memberTypesIndex));
        break;
      }
      case "rename":
        classAuid = AUIDS.TypeDefinitionRename;
        add(propWeakRef(0x001e, 2, 0x0005, parseAuid(def.renamed)));
        break;
      case "string":
        classAuid = AUIDS.TypeDefinitionString;
        add(propWeakRef(0x001b, 2, 0x0005, parseAuid(def.element)));
        break;
      case "fixed-array":
        classAuid = AUIDS.TypeDefinitionFixedArray;
        add(propWeakRef(0x0017, 2, 0x0005, parseAuid(def.element)));
        add(propData(0x0018, u32le(def.count)));
        break;
      case "var-array":
        classAuid = AUIDS.TypeDefinitionVariableArray;
        add(propWeakRef(0x0019, 2, 0x0005, parseAuid(def.element)));
        break;
      case "set":
        classAuid = AUIDS.TypeDefinitionSet;
        add(propWeakRef(0x001a, 2, 0x0005, parseAuid(def.element)));
        break;
      case "strong-ref":
        classAuid = AUIDS.TypeDefinitionStrongObjectReference;
        add(propWeakRef(0x0011, 0, 0x0005, parseAuid(def.target)));
        break;
      case "weak-ref":
        classAuid = AUIDS.TypeDefinitionWeakObjectReference;
        add(propWeakRef(0x0012, 0, 0x0005, parseAuid(def.target)));
        add(propData(0x0013, Buffer.concat(def.path.map((auid) => parseAuid(auid)))));
        break;
      case "character":
        classAuid = AUIDS.TypeDefinitionCharacter;
        break;
    }

    dir.clsid = parseAuid(classAuid);
    dir.streams.set("properties", encodeProperties(props));
    return { key: parseAuid(def.auid), dir };
  });
}
