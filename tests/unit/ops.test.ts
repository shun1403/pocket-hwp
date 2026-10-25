import { describe, expect, it } from 'vitest';
import { documentStats } from '../../src/doc/ops/inserts';
import { NUMBERING_PRESETS } from '../../src/doc/ops/lists';
import { MARGINS, PAPERS, type PageDef, marginOf, mm, paperOf } from '../../src/doc/ops/page';

const page = (patch: Partial<PageDef>): PageDef => ({
  width: mm(210),
  height: mm(297),
  marginLeft: mm(30),
  marginRight: mm(30),
  marginTop: mm(20),
  marginBottom: mm(15),
  marginHeader: mm(15),
  marginFooter: mm(15),
  marginGutter: 0,
  landscape: false,
  binding: 0,
  ...patch,
});

describe('쪽 설정', () => {
  it('한글 기본 A4(59528×84186)를 A4로 알아본다', () => {
    expect(paperOf(page({ width: 59528, height: 84186 }))).toBe('A4');
    expect(paperOf(page({ width: 61200, height: 79200 }))).toBe('Letter');
    expect(paperOf(page({ width: 1000, height: 1000 }))).toBeNull();
  });

  it('여백 묶음을 알아본다', () => {
    expect(marginOf(page({}))).toBe('normal');
    const narrow = MARGINS.find((m) => m.id === 'narrow')!;
    expect(marginOf(page({ marginLeft: narrow.side, marginTop: narrow.top }))).toBe('narrow');
  });

  it('용지 목록은 세로 방향 크기다', () => {
    for (const p of PAPERS) expect(p.height).toBeGreaterThan(p.width);
  });
});

describe('문단 번호', () => {
  it('모든 번호 모양은 7개 수준을 가진다', () => {
    for (const p of NUMBERING_PRESETS) {
      expect(p.levelFormats).toHaveLength(7);
      expect(p.numberFormats).toHaveLength(7);
    }
  });

  it('공문서 번호는 1. 가. 1) 가) 순서다', () => {
    const gov = NUMBERING_PRESETS.find((p) => p.id === 'gov')!;
    expect(gov.levelFormats.slice(0, 4)).toEqual(['^1.', '^2.', '^3)', '^4)']);
    expect(gov.numberFormats.slice(0, 4)).toEqual([0, 8, 0, 8]);
  });
});

describe('documentStats', () => {
  it('글자·낱말·문단을 센다', () => {
    const s = documentStats('가나 다\n\nabc', 2);
    expect(s).toEqual({ chars: 7, charsNoSpace: 6, words: 3, paragraphs: 2, pages: 2 });
  });
});
