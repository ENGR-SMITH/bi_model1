// ---------------------------------------------------------------------------
// A tiny, dependency-free ZIP writer used by the Finish export page.
//
// Entries are stored *uncompressed* (method 0). That is fine here because the
// files being zipped — mp4 / jpg / wav / html — are either already compressed
// or small, and it keeps the writer ~100 lines with zero dependencies.
//
// Layout produced (per the ZIP spec):
//   [local file header + data] × n
//   [central directory] × n
//   [end of central directory record]
// ---------------------------------------------------------------------------

export interface ZipEntry {
  /** Path inside the archive, e.g. "media/foo.mp4". */
  name: string;
  data: Uint8Array;
}

// CRC-32 (IEEE 802.3, reflected) — the standard table-driven implementation.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_EPOCH = Date.UTC(1980, 0, 1, 0, 0, 0);

function dosDateTime(now = new Date()): { date: number; time: number } {
  // Clamp to the DOS-encodable range (1980–2107).
  const d = now.getTime() < DOS_EPOCH ? new Date(DOS_EPOCH) : now;
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { date, time };
}

function utf8Name(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Build a valid store-only ZIP archive from the given entries. */
export function buildZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const { date, time } = dosDateTime(now);
  const names = entries.map((entry) => utf8Name(entry.name));
  const crcs = entries.map((entry) => crc32(entry.data));
  const offsets: number[] = [];

  // Local headers + data. Each local header is 30 bytes + name length.
  const localSize = entries.reduce(
    (sum, entry, i) => sum + 30 + names[i].length + entry.data.length,
    0,
  );
  const centralSize = entries.reduce((sum, _e, i) => sum + 46 + names[i].length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const w = view(out);

  let cursor = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const name = names[i];
    offsets[i] = cursor;

    // -- Local file header --
    w.setUint32(cursor, 0x04034b50, true); // signature
    w.setUint16(cursor + 4, 20, true); // version needed
    w.setUint16(cursor + 6, 0x0800, true); // flags: UTF-8 names
    w.setUint16(cursor + 8, 0, true); // method: stored
    w.setUint16(cursor + 10, time, true);
    w.setUint16(cursor + 12, date, true);
    w.setUint32(cursor + 14, crcs[i], true);
    w.setUint32(cursor + 18, entry.data.length, true); // compressed size
    w.setUint32(cursor + 22, entry.data.length, true); // uncompressed size
    w.setUint16(cursor + 26, name.length, true);
    w.setUint16(cursor + 28, 0, true); // extra length
    out.set(name, cursor + 30);
    cursor += 30 + name.length;

    out.set(entry.data, cursor);
    cursor += entry.data.length;
  }

  const centralStart = cursor;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const name = names[i];

    // -- Central directory header --
    w.setUint32(cursor, 0x02014b50, true); // signature
    w.setUint16(cursor + 4, 20, true); // version made by
    w.setUint16(cursor + 6, 20, true); // version needed
    w.setUint16(cursor + 8, 0x0800, true); // flags
    w.setUint16(cursor + 10, 0, true); // method
    w.setUint16(cursor + 12, time, true);
    w.setUint16(cursor + 14, date, true);
    w.setUint32(cursor + 16, crcs[i], true);
    w.setUint32(cursor + 20, entry.data.length, true);
    w.setUint32(cursor + 24, entry.data.length, true);
    w.setUint16(cursor + 28, name.length, true);
    w.setUint16(cursor + 30, 0, true); // extra
    w.setUint16(cursor + 32, 0, true); // comment
    w.setUint16(cursor + 34, 0, true); // disk number
    w.setUint16(cursor + 36, 0, true); // internal attrs
    w.setUint32(cursor + 38, 0, true); // external attrs
    w.setUint32(cursor + 42, offsets[i], true); // local header offset
    out.set(name, cursor + 46);
    cursor += 46 + name.length;
  }

  // -- End of central directory --
  w.setUint32(cursor, 0x06054b50, true); // signature
  w.setUint16(cursor + 4, 0, true); // disk number
  w.setUint16(cursor + 6, 0, true); // central dir disk
  w.setUint16(cursor + 8, entries.length, true); // entries on this disk
  w.setUint16(cursor + 10, entries.length, true); // total entries
  w.setUint32(cursor + 12, centralSize, true); // central dir size
  w.setUint32(cursor + 16, centralStart, true); // central dir offset
  w.setUint16(cursor + 20, 0, true); // comment length

  return out;
}
