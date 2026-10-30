/**
 * 보관함 전체 검색에 쓰는 글 찾기. 띄어쓰기·줄바꿈과 대소문자를 무시하고,
 * 찾을 말이 자음만이면(ㄱㅌㅅ) 초성으로 찾는다.
 */

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 한글 음절을 초성으로 (그 밖의 글자는 그대로) */
export function chosungOf(ch: string): string {
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 ? CHOSUNG[Math.floor(code / 588)] : ch;
}

export const isChosungQuery = (q: string) => /^[ㄱ-ㅎ]+$/.test(q);

export interface TextHit {
  /** 찾은 곳 수 */
  count: number;
  /** 첫 곳 앞뒤 글 (한 줄) */
  before: string;
  /** 문서에 쓰인 그대로의 찾은 글 (문서 안 찾기에 넘긴다) */
  match: string;
  after: string;
}

/** 글에서 찾는다. 없으면 null */
export function searchText(text: string, query: string): TextHit | null {
  const q = Array.from(query.replace(/\s+/g, '').toLowerCase());
  if (q.length === 0) return null;
  const cho = isChosungQuery(q.join(''));
  const chars = Array.from(text);
  // 공백을 뺀 글자들과 원래 위치
  const norm: string[] = [];
  const at: number[] = [];
  chars.forEach((c, i) => {
    if (/\s/.test(c)) return;
    norm.push(cho ? chosungOf(c) : c.toLowerCase());
    at.push(i);
  });
  let count = 0;
  let first = -1;
  for (let i = 0; i + q.length <= norm.length; i += 1) {
    let ok = true;
    for (let j = 0; j < q.length && ok; j += 1) ok = norm[i + j] === q[j];
    if (!ok) continue;
    count += 1;
    if (first < 0) first = i;
    i += q.length - 1;
  }
  if (first < 0) return null;
  const start = at[first];
  const end = at[first + q.length - 1] + 1;
  const line = (s: string) => s.replace(/\s+/g, ' ');
  const lineStart = chars.lastIndexOf('\n', start - 1) + 1;
  const nl = chars.indexOf('\n', end);
  const lineEnd = nl < 0 ? chars.length : nl;
  const beforeFrom = Math.max(lineStart, start - 16);
  const afterTo = Math.min(lineEnd, end + 30);
  return {
    count,
    before: (beforeFrom > lineStart ? '…' : '') + line(chars.slice(beforeFrom, start).join('')),
    match: chars.slice(start, end).join(''),
    after: line(chars.slice(end, afterTo).join('')) + (afterTo < lineEnd ? '…' : ''),
  };
}
