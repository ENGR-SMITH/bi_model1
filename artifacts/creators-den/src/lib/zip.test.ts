import { describe, expect, it } from 'vitest';
import { buildZip, crc32 } from './zip';

function readAscii(u8: Uint8Array): string {
  return new TextDecoder().decode(u8);
}

describe('crc32', () => {
  it('matches the well-known check value for "123456789"', () => {
    const bytes = new TextEncoder().encode('123456789');
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it('is 0 for the empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('buildZip', () => {
  it('produces a parseable archive with the expected entries and payloads', () => {
    const text = new TextEncoder().encode('hello zip');
    const zip = buildZip([
      { name: 'hello.txt', data: text },
      { name: 'media/video.mp4', data: new Uint8Array([0, 1, 2, 3]) },
    ]);

    // Signature + "PK\x03\x04" local headers, "PK\x01\x02" central directory,
    // "PK\x05\x06" end record.
    const sig = (offset: number) => readAscii(zip.slice(offset, offset + 4));
    expect(sig(0)).toBe('PK\x03\x04');
    expect(sig(30 + 9 + 9)).toBe('PK\x03\x04'); // second local header: 30 + name(9) + data(9)
    expect(sig(zip.length - 22)).toBe('PK\x05\x06');
    expect(zip.length - 22).toBeGreaterThan(0);
    // The end record sits right after the central directory.
    const eocd = new DataView(zip.buffer, zip.byteOffset + zip.length - 22, 22);
    expect(eocd.getUint16(8, true)).toBe(2); // entry count
  });

  it('round-trips entry names and file bytes from the central directory', () => {
    const payload = new TextEncoder().encode('alpha');
    const zip = buildZip([{ name: 'dir/alpha.txt', data: payload }]);

    const name = 'dir/alpha.txt';
    const bytes = new TextEncoder().encode(name);
    // Local header at 0: name at offset 30, data at 30 + name.length.
    const dataStart = 30 + bytes.length;
    const data = zip.slice(dataStart, dataStart + payload.length);
    expect(data).toEqual(payload);

    // Central directory header starts right after the local data.
    const central = dataStart + payload.length;
    const centralView = new DataView(zip.buffer, zip.byteOffset + central, 46);
    expect(centralView.getUint32(0, true)).toBe(0x02014b50);
    const centralName = readAscii(zip.slice(central + 46, central + 46 + bytes.length));
    expect(centralName).toBe(name);
    // Local header offset field points back to 0.
    expect(centralView.getUint32(42, true)).toBe(0);
  });

  it('stores entries uncompressed (method 0) with matching sizes', () => {
    const data = new TextEncoder().encode('x'.repeat(100));
    const zip = buildZip([{ name: 'big.txt', data }]);
    const view = new DataView(zip.buffer, zip.byteOffset, 30);
    expect(view.getUint16(8, true)).toBe(0); // method: stored
    expect(view.getUint32(18, true)).toBe(100); // compressed size
    expect(view.getUint32(22, true)).toBe(100); // uncompressed size
  });

  it('handles the empty archive', () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    const eocd = new DataView(zip.buffer, zip.byteOffset, 22);
    expect(eocd.getUint32(0, true)).toBe(0x06054b50);
    expect(eocd.getUint16(8, true)).toBe(0);
  });
});
