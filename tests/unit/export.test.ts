import { describe, expect, it } from 'vitest';
import { toParagraphs } from '../../src/doc/text';
import { buildImagePdf } from '../../src/export/pdf';
import { base64ToBytes, baseName, bytesToBase64, detectFormat, fileNameFromUrl, safeFileName } from '../../src/platform/bytes';

describe('buildImagePdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildImagePdf([
    { jpeg, pixelWidth: 10, pixelHeight: 14, widthPt: 595.28, heightPt: 841.89 },
    { jpeg, pixelWidth: 14, pixelHeight: 10, widthPt: 841.89, heightPt: 595.28 },
  ]);
  const text = new TextDecoder('latin1').decode(pdf);

  it('PDF 머리와 끝이 있다', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
  });

  it('xref 오프셋이 실제 객체 위치를 가리킨다', () => {
    const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    // 카탈로그·쪽 목록 + 쪽마다 (쪽·내용·이미지) 3개
    expect(offsets).toHaveLength(2 + 2 * 3);
    offsets.forEach((off, i) => expect(text.slice(off).startsWith(`${i + 1} 0 obj\n`)).toBe(true));
  });
});

describe('bytes', () => {
  it('base64 왕복', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes('data:application/octet-stream;base64,AQID')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('형식을 내용으로 판별한다', () => {
    expect(detectFormat('a.hwp', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('hwpx');
    expect(detectFormat('a.hwpx', new Uint8Array([0xd0, 0xcf]))).toBe('hwp');
    expect(detectFormat('a.hwpx', new Uint8Array([]))).toBe('hwpx');
  });

  it('파일 이름 다루기', () => {
    expect(baseName('보고서.HWPX')).toBe('보고서');
    expect(safeFileName('a/b:c?.hwp')).toBe('a_b_c_.hwp');
    expect(safeFileName('  ')).toBe('문서');
    expect(fileNameFromUrl('file:///var/mobile/Inbox/%EB%B3%B4%EA%B3%A0%EC%84%9C.hwp')).toBe('보고서.hwp');
    expect(fileNameFromUrl('weird')).toBe('받은 문서.hwp');
  });
});

describe('toParagraphs', () => {
  it('빈 줄과 끝 공백을 걷어낸다', () => {
    expect(toParagraphs('\n\n□ 첫 문단  \n\n ㅇ 둘째\n')).toEqual(['□ 첫 문단', ' ㅇ 둘째']);
  });
});
