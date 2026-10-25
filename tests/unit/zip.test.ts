import { describe, expect, it } from 'vitest';
import { buildZip, crc32, readZip } from '../../src/export/zip';

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
});
