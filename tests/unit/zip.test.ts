import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readManifest } from '../../src/app/backup';
import { buildZip, crc32, readZip } from '../../src/export/zip';

/** 압축(deflate)된 항목 하나짜리 ZIP. buildZip은 stored만 만들므로 압축 방식 칸을 고쳐 쓴다. */
function deflatedZip(name: string, raw: Uint8Array): Uint8Array {
  const zip = buildZip([{ name, bytes: deflateRawSync(raw) }]);
  const view = new DataView(zip.buffer);
  const central = view.getUint32(zip.length - 22 + 16, true);
  view.setUint16(8, 8, true);
  view.setUint16(central + 10, 8, true);
  return zip;
}

describe('zip', () => {
  it('CRC-32 표준 검사값', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('만들고 다시 읽으면 같은 파일이 나온다 (한글 이름 포함)', async () => {
    const a = new Uint8Array(1000).map((_, i) => i % 251);
    const b = new TextEncoder().encode('{"ok":true}');
    const zip = buildZip([
      { name: '보고서 최종.hwp', bytes: a },
      { name: 'pocket-hwp-backup.json', bytes: b },
    ]);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    const entries = await readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['보고서 최종.hwp', 'pocket-hwp-backup.json']);
    expect(entries[0].bytes).toEqual(a);
    expect(new TextDecoder().decode(entries[1].bytes)).toBe('{"ok":true}');
  });

  it('ZIP이 아니면 알려 준다', async () => {
    await expect(readZip(new Uint8Array(100))).rejects.toThrow('ZIP 파일이 아니에요');
  });

  it('압축된 항목을 푼다', async () => {
    const raw = new TextEncoder().encode('한글 문서 '.repeat(100));
    const [entry] = await readZip(deflatedZip('a.hwp', raw));
    expect(entry.bytes).toEqual(raw);
  });

  it('풀면 지나치게 커지는 ZIP(압축 폭탄)은 멈춘다', async () => {
    const zip = deflatedZip('bomb.hwp', new Uint8Array(20 * 1024 * 1024));
    expect(zip.length).toBeLessThan(100 * 1024);
    await expect(readZip(zip, { maxTotalBytes: 1024 * 1024 })).rejects.toThrow('너무 커요');
  });

  it('고르지 않은 항목은 풀지 않는다', async () => {
    const zip = deflatedZip('bomb.bin', new Uint8Array(20 * 1024 * 1024));
    await expect(readZip(zip, { accept: (n) => n.endsWith('.hwp'), maxTotalBytes: 1024 })).resolves.toEqual([]);
  });
});

describe('백업 목록 확인', () => {
  const now = 1_700_000_000_000;
  const manifest = (documents: unknown) => new TextEncoder().encode(JSON.stringify({ app: 'pocket-hwp', version: 1, documents }));

  it('올바른 항목은 그대로 읽는다', () => {
    const m = readManifest(manifest([{ id: 'abc-1', file: 'a.hwp', name: '보고서.hwp', format: 'hwp', updatedAt: 5, edited: true }]), now);
    expect(m.get('a.hwp')).toEqual({ id: 'abc-1', file: 'a.hwp', name: '보고서.hwp', format: 'hwp', updatedAt: 5, edited: true });
  });

  it('형식·id가 이상한 항목은 버리고, 이름의 경로 문자는 바꾼다', () => {
    const m = readManifest(
      manifest([
        { id: 'x', file: 'a.hwp', name: 'a', format: '../../evil', updatedAt: 1 },
        { id: '../x', file: 'b.hwp', name: 'b', format: 'hwp', updatedAt: 1 },
        { id: 'ok', file: 'c.hwp', name: '../../c.hwp', format: 'hwpx', updatedAt: now * 2, edited: 'yes' },
      ]),
      now,
    );
    expect([...m.keys()]).toEqual(['c.hwp']);
    expect(m.get('c.hwp')).toMatchObject({ name: '.._.._c.hwp', updatedAt: now, edited: false });
  });

  it('목록이 깨져 있으면 빈 목록으로 본다', () => {
    expect(readManifest(new TextEncoder().encode('{not json'), now).size).toBe(0);
    expect(readManifest(manifest('nope'), now).size).toBe(0);
    expect(readManifest(undefined, now).size).toBe(0);
  });
});
