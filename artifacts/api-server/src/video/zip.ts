// Dependency-free store-only ZIP writer (no compression — the checkout bundle
// is interchange text + small JSON; store keeps it byte-deterministic and fast
// without pulling in an archive dependency, matching the interchange layer's
// no-deps convention). Format: local file headers + central directory + EOCD.

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const STORE = 0; // no compression

export interface ZipEntry {
  name: string;
  data: Buffer;
}

// Standard CRC-32 (IEEE 802.3), the checksum ZIP uses.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** POSIX-style timestamp for ZIP headers (DOS format). */
function dosTime(date: Date): number {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >>> 1);
  const day = (date.getFullYear() - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  return ((day & 0xffff) << 16) | (time & 0xffff);
}

/**
 * Pack entries into a store-only ZIP archive. Entry names are stored UTF-8
 * (flag bit 11 set). Returns the complete archive as a Buffer.
 */
export function buildZip(entries: ZipEntry[], now = new Date()): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(STORE, 8);
    const stamp = dosTime(now);
    local.writeUInt16LE(stamp & 0xffff, 10);
    local.writeUInt16LE((stamp >>> 16) & 0xffff, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    chunks.push(local, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CENTRAL_DIRECTORY, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8); // flags
    cd.writeUInt16LE(STORE, 10);
    cd.writeUInt16LE(stamp & 0xffff, 12);
    cd.writeUInt16LE((stamp >>> 16) & 0xffff, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, name);

    offset += local.length + name.length + data.length;
  }

  const cdSize = central.reduce((n, b) => n + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIR, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, ...central, eocd]);
}

/** Read back entry names from a store-only archive (used by tests). */
export function listZipEntries(zip: Buffer): string[] {
  // EOCD is the last 22+ bytes; scan for its signature from the end.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return [];
  const count = zip.readUInt16LE(eocd + 10);
  let cdOffset = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = zip.readUInt16LE(cdOffset + 28);
    const extraLen = zip.readUInt16LE(cdOffset + 30);
    const commentLen = zip.readUInt16LE(cdOffset + 32);
    names.push(zip.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString("utf8"));
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * Read one entry's data back from a store-only archive (used by tests).
 * Walks the central directory; entry offsets are stable in store mode.
 */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let cdOffset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = zip.readUInt16LE(cdOffset + 28);
    const extraLen = zip.readUInt16LE(cdOffset + 30);
    const commentLen = zip.readUInt16LE(cdOffset + 32);
    const entryName = zip.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString("utf8");
    if (entryName === name) {
      const localOffset = zip.readUInt32LE(cdOffset + 42);
      const localNameLen = zip.readUInt16LE(localOffset + 26);
      const localExtraLen = zip.readUInt16LE(localOffset + 28);
      const dataLen = zip.readUInt32LE(localOffset + 22);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      return zip.subarray(dataStart, dataStart + dataLen);
    }
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
