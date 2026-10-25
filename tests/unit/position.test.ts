import { describe, expect, it } from 'vitest';
import {
  comparePos,
  innerPara,
  orderRange,
  posFromHit,
  sameContainer,
  samePos,
  withInnerPara,
  wordBounds,
} from '../../src/doc/position';

const cell = (para: number, cellPara: number, offset: number, cellIndex = 1) => ({
  sec: 0,
  para,
  offset,
  cellPath: [{ controlIndex: 0, cellIndex, cellParaIndex: cellPara }],
});

describe('posFromHit', () => {
  it('본문 hit은 문단 번호를 그대로 쓴다', () => {
    expect(posFromHit({ sectionIndex: 0, paragraphIndex: 3, charOffset: 5 })).toEqual({ sec: 0, para: 3, offset: 5 });
  });

  it('셀 hit은 바깥 문단과 cellPath를 쓴다', () => {
    const pos = posFromHit({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 2,
      parentParaIndex: 4,
      cellPath: [{ controlIndex: 0, cellIndex: 1, cellParaIndex: 2 }],
    });
    expect(pos).toEqual(cell(4, 2, 2));
    expect(innerPara(pos)).toBe(2);
  });
});

describe('컨테이너 비교', () => {
  it('같은 셀의 다른 문단은 같은 컨테이너다', () => {
    expect(sameContainer(cell(4, 0, 0), cell(4, 3, 1))).toBe(true);
  });

  it('다른 셀이나 본문은 다른 컨테이너다', () => {
    expect(sameContainer(cell(4, 0, 0), cell(4, 0, 0, 2))).toBe(false);
    expect(sameContainer(cell(4, 0, 0), { sec: 0, para: 4, offset: 0 })).toBe(false);
    expect(sameContainer({ sec: 0, para: 1, offset: 0 }, { sec: 1, para: 1, offset: 0 })).toBe(false);
  });

  it('위치 순서를 정한다', () => {
    const a = { sec: 0, para: 2, offset: 5 };
    const b = { sec: 0, para: 1, offset: 9 };
    expect(comparePos(a, b)).toBeGreaterThan(0);
    expect(orderRange(a, b)).toEqual([b, a]);
    expect(samePos(a, { ...a })).toBe(true);
  });

  it('withInnerPara는 원본 cellPath를 건드리지 않는다', () => {
    const src = cell(4, 0, 3);
    const moved = withInnerPara(src, 2, 0);
    expect(innerPara(moved)).toBe(2);
    expect(innerPara(src)).toBe(0);
  });
});

describe('wordBounds', () => {
  it('한글 낱말을 고른다', () => {
    expect(wordBounds('국립국어원 업무계획', 2)).toEqual([0, 5]);
    expect(wordBounds('국립국어원 업무계획', 7)).toEqual([6, 10]);
  });

  it('낱말 끝에 캐럿이 있으면 앞 낱말을 고른다', () => {
    expect(wordBounds('hello world', 5)).toEqual([0, 5]);
  });

  it('기호 위에서는 한 글자만 고른다', () => {
    expect(wordBounds('a , b', 2)).toEqual([2, 3]);
  });
});
