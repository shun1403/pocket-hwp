import { describe, expect, it } from 'vitest';
import { parsePageRange } from '../../src/export/images';

describe('쪽 범위', () => {
  it('쉼표·붙임표·물결로 쓴 범위를 읽는다', () => {
    expect(parsePageRange('1-3, 5', 6)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('2~4', 6)).toEqual([1, 2, 3]);
    expect(parsePageRange(' 3 1 3 ', 6)).toEqual([0, 2]);
  });
  it('잘못된 범위는 null', () => {
    expect(parsePageRange('', 3)).toBeNull();
    expect(parsePageRange('0', 3)).toBeNull();
    expect(parsePageRange('4', 3)).toBeNull();
    expect(parsePageRange('3-1', 3)).toBeNull();
    expect(parsePageRange('첫쪽', 3)).toBeNull();
  });
});

describe('암호 건 HWPX', () => {
  it('암호로 다시 연다', async () => {
    const { HwpDocument } = await import('@rhwp/core');
    const { blankDocument } = await import('./engine');
    const { exportDocument } = await import('../../src/export/exporters');
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '비밀 문서');
    const { bytes } = exportDocument(doc.raw, 'hwpx', 'pocket123');
    expect(() => new HwpDocument(bytes)).toThrow();
    const reopened = HwpDocument.openWithPassword(bytes, 'pocket123');
    expect(reopened.getTextRange(0, 0, 0, 5)).toBe('비밀 문서');
  });
});
