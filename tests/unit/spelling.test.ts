import { describe, expect, it } from 'vitest';
import { checkSpelling } from '../../src/doc/spelling';

const fixes = (t: string) => checkSpelling(t).map((h) => `${h.text}→${h.fix}`);

describe('맞춤법 규칙', () => {
  it('자주 틀리는 말', () => {
    expect(fixes('몇일 뒤에 뵈요. 금새 끝날 거예요.')).toEqual(['몇일→며칠', '뵈요→봬요', '금새→금세']);
    expect(fixes('내일 할께요. 일일히 확인했어요.')).toEqual(['할께→할게', '일일히→일일이']);
    expect(fixes('그러면 안되요')).toEqual(['안되→안 되']);
  });
  it('띄어쓰기: 할수있다·안 돼', () => {
    expect(fixes('혼자 할수있어요')).toEqual(['할수있→할 수 있']);
    expect(fixes('이건 안돼.')).toEqual(['안돼→안 돼']);
    // 받침 ㄹ이 아니면 다른 말이다
    expect(fixes('가수있는 무대')).toEqual([]);
  });
  it('맞는 말은 짚지 않는다', () => {
    expect(fixes('며칠 뒤에 봬요. 어떻게 해요? 안 돼요. 할 수 있어요. 되어요. 왠지 웬일이야.')).toEqual([]);
    expect(fixes('그는 대학교 행정이 되요소를')).toEqual([]);
  });
  it('위치는 글자 단위', () => {
    const [h] = checkSpelling('😀 몇일');
    expect([h.from, h.to]).toEqual([2, 4]);
  });
});
