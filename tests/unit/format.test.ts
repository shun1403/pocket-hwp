import { describe, expect, it } from 'vitest';
import { readLoss } from '../../src/export/exporters';
import { nextFontSize } from '../../src/ui/format-toolbar';

describe('nextFontSize', () => {
  it('단계를 따라 커지고 작아진다', () => {
    expect(nextFontSize(10, 1)).toBe(11);
    expect(nextFontSize(16, 1)).toBe(18);
    expect(nextFontSize(10.5, -1)).toBe(10);
    expect(nextFontSize(6, -1)).toBe(6);
    expect(nextFontSize(72, 1)).toBe(72);
  });
});

describe('readLoss', () => {
  it('손실이 없으면 빈 목록', () => {
    expect(readLoss('{"schemaVersion":1,"count":0,"losses":[]}')).toEqual([]);
  });

  it('손실 항목을 문장으로 바꾼다', () => {
    expect(readLoss('{"count":2,"losses":[{"message":"그림 1개"},{"code":7}]}')).toEqual(['그림 1개', '{"code":7}']);
  });

  it('깨진 보고서는 무시한다', () => {
    expect(readLoss('not json')).toEqual([]);
  });
});
