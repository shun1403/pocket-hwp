import { describe, expect, it } from 'vitest';
import { SENTINEL, compositionText, diffInput } from '../../src/doc/input-diff';

describe('diffInput', () => {
  it('변화가 없으면 동작도 없다', () => {
    expect(diffInput(SENTINEL)).toEqual([]);
  });

  it('표식 뒤에 붙은 글은 입력이다', () => {
    expect(diffInput(`${SENTINEL}한글`)).toEqual([{ kind: 'insert', text: '한글' }]);
  });

  it('표식이 지워지면 Backspace다 (안드로이드 키보드)', () => {
    expect(diffInput('')).toEqual([{ kind: 'backspace', count: 1 }]);
  });

  it('줄바꿈은 Enter로 나눈다', () => {
    expect(diffInput(`${SENTINEL}가\n나`)).toEqual([
      { kind: 'insert', text: '가' },
      { kind: 'enter' },
      { kind: 'insert', text: '나' },
    ]);
    expect(diffInput(`${SENTINEL}\r\n`)).toEqual([{ kind: 'enter' }]);
  });

  it('키보드가 표식을 바꿔 써도 글만 넣는다', () => {
    expect(diffInput('abc')).toEqual([{ kind: 'insert', text: 'abc' }]);
  });

  it('조합 중 미리보기에서는 표식을 뺀다', () => {
    expect(compositionText(`${SENTINEL}하`)).toBe('하');
  });
});
