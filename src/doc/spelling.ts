/**
 * 자주 틀리는 맞춤법·띄어쓰기를 규칙으로 찾는다. 폰 안에서만 하며, 틀리게 짚지 않도록
 * 확실한 것만 넣었다 (사전 기반 검사기가 아니다).
 */

export interface SpellHit {
  /** 글 안의 위치 (코드 포인트) */
  from: number;
  to: number;
  text: string;
  fix: string;
  why: string;
}

interface Rule {
  re: RegExp;
  fix: (m: RegExpMatchArray) => string;
  why: string;
}

const word = (wrong: string, right: string, why: string): Rule => ({ re: new RegExp(wrong, 'g'), fix: () => right, why });

/** 받침 ㄹ로 끝나는 한글 음절인가 (할, 갈, 볼 …) */
const endsWithRieul = (ch: string) => {
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 === 8;
};

const RULES: Rule[] = [
  word('몇일', '며칠', "'며칠'이 맞아요"),
  word('어떻해', '어떡해', "'어떻게 해'를 줄이면 '어떡해'예요"),
  // 말끝의 '되요'만 ('되요소'처럼 다음 말이 이어지면 아니다)
  word('(?<![가-힣])되요(?=[.!?,~\\s]|$)', '돼요', "'되어요'를 줄이면 '돼요'예요"),
  word('됬', '됐', "'되었'을 줄이면 '됐'이에요"),
  word('됀', '된', "'된'이 맞아요"),
  word('뵈요', '봬요', "'뵈어요'를 줄이면 '봬요'예요"),
  word('금새', '금세', "'금시에'를 줄인 '금세'가 맞아요"),
  word('오랫만', '오랜만', "'오래간만'을 줄인 '오랜만'이 맞아요"),
  word('설겆이', '설거지', "'설거지'가 맞아요"),
  word('희안', '희한', "'희한하다'가 맞아요"),
  word('역활', '역할', "'역할'이 맞아요"),
  word('어의없', '어이없', "'어이없다'가 맞아요"),
  word('웬지', '왠지', "'왜인지'를 줄인 '왠지'가 맞아요"),
  word('왠일', '웬일', "'웬일'이 맞아요"),
  word('왠만', '웬만', "'웬만하다'가 맞아요"),
  word('구지', '굳이', "'굳이'가 맞아요"),
  word('내노라', '내로라', "'내로라하다'가 맞아요"),
  word('일일히', '일일이', "'일일이'가 맞아요"),
  word('깨끗히', '깨끗이', "'깨끗이'가 맞아요"),
  word('곰곰히', '곰곰이', "'곰곰이'가 맞아요"),
  word('틈틈히', '틈틈이', "'틈틈이'가 맞아요"),
  word('번번히', '번번이', "'번번이'가 맞아요"),
  word('따듯히', '따뜻이', "'따뜻이'가 맞아요"),
  word('할께', '할게', "'-ㄹ게'가 맞아요"),
  word('갈께', '갈게', "'-ㄹ게'가 맞아요"),
  word('줄께', '줄게', "'-ㄹ게'가 맞아요"),
  word('볼께', '볼게', "'-ㄹ게'가 맞아요"),
  word('올께', '올게', "'-ㄹ게'가 맞아요"),
  word('할려고', '하려고', "'-려고'가 맞아요"),
  word('갈려고', '가려고', "'-려고'가 맞아요"),
  word('볼려고', '보려고', "'-려고'가 맞아요"),
  word('할려면', '하려면', "'-려면'이 맞아요"),
  word('않되', '안 되', "'안 되다'가 맞아요 ('않'은 '-지 않다'에만 써요)"),
  word('않해', '안 해', "'안 하다'가 맞아요 ('않'은 '-지 않다'에만 써요)"),
  word('않한', '안 한', "'안 하다'가 맞아요 ('않'은 '-지 않다'에만 써요)"),
  word('안돼(?=[요.!?,\\s]|$)', '안 돼', "'안 돼'로 띄어 써요"),
  word('안되(?=[요나는서고며면지었겠]|$)', '안 되', "'안 되다'로 띄어 써요"),
  {
    // 할수있다 → 할 수 있다 ('수'는 띄어 써요)
    re: /([가-힣])수(있|없)/g,
    fix: (m) => `${m[1]} 수 ${m[2]}`,
    why: "'-ㄹ 수 있다/없다'는 띄어 써요",
  },
];

/** 글에서 고칠 곳을 찾는다. 겹치면 앞의 것을 남긴다. */
export function checkSpelling(text: string): SpellHit[] {
  const hits: SpellHit[] = [];
  const cp = (utf16: number) => Array.from(text.slice(0, utf16)).length;
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      // '할수있'은 앞 글자가 받침 ㄹ일 때만 ('가수있'의 '수'는 다른 말이다)
      if (rule.re.source.startsWith('([가-힣])수') && !endsWithRieul(m[1])) continue;
      const from = cp(m.index);
      const to = from + Array.from(m[0]).length;
      if (hits.some((x) => from < x.to && to > x.from)) continue;
      hits.push({ from, to, text: m[0], fix: rule.fix(m), why: rule.why });
    }
  }
  return hits.sort((a, b) => a.from - b.from);
}
