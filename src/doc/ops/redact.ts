/**
 * 보내기 전 개인정보 가리기: 글에서 주민번호·전화·이메일·계좌·카드·여권·운전면허 번호를 찾아
 * 글자 수를 그대로 둔 채 ●로 가린다. 모두 기기 안에서 처리한다.
 */

export type PiiKind = 'rrn' | 'card' | 'license' | 'phone' | 'email' | 'account' | 'passport';

export const PII_NAMES: Record<PiiKind, string> = {
  rrn: '주민·외국인등록번호',
  card: '카드번호',
  license: '운전면허번호',
  phone: '전화번호',
  email: '이메일',
  account: '계좌번호',
  passport: '여권번호',
};

export interface PiiMatch {
  kind: PiiKind;
  /** 문서에 쓰인 그대로 */
  text: string;
  /** 가린 모양 (글자 수 같음) */
  masked: string;
  index: number;
}

const DOT = '●';

/** 글자·숫자만 세어 앞 keepStart 개와 뒤 keepEnd 개를 남기고 ●로 바꾼다. 붙임표·공백은 그대로 둔다. */
export function maskChars(text: string, keepStart: number, keepEnd: number): string {
  const chars = Array.from(text);
  const slots = chars.map((c, i) => (/[\p{L}\p{N}]/u.test(c) ? i : -1)).filter((i) => i >= 0);
  const hide = new Set(slots.slice(keepStart, Math.max(keepStart, slots.length - keepEnd)));
  return chars.map((c, i) => (hide.has(i) ? DOT : c)).join('');
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const validDate = (mm: string, dd: string) => Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31;

const BANK = /계좌|은행|입금|예금주|송금|농협|국민|신한|우리|하나|기업|카카오|토스|새마을|우체국|수협|씨티|케이뱅크|부산|대구|경남|광주|전북|제주/;

interface Rule {
  kind: PiiKind;
  re: RegExp;
  accept?: (m: RegExpExecArray, text: string) => boolean;
  mask: (s: string) => string;
}

/** 앞 규칙이 먼저 잡는다 (카드·면허 번호를 계좌로, 주민번호를 전화로 오인하지 않게). */
const RULES: Rule[] = [
  {
    kind: 'rrn',
    re: /(?<!\d)(\d{2})(\d{2})(\d{2})[ ]?-?[ ]?([1-8])(\d{6})(?!\d)/g,
    accept: (m) => validDate(m[2], m[3]),
    mask: (s) => maskChars(s, 7, 0),
  },
  {
    kind: 'card',
    re: /(?<!\d)\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}(?!\d)/g,
    accept: (m) => luhn(m[0].replace(/\D/g, '')),
    mask: (s) => maskChars(s, 4, 4),
  },
  {
    kind: 'license',
    re: /(?<!\d)\d{2}-\d{2}-\d{6}-\d{2}(?!\d)/g,
    mask: (s) => maskChars(s, 4, 0),
  },
  {
    kind: 'phone',
    re: /(?<!\d)(?:01[016789]|070|0(?:2|[3-6][1-5]))[-. )]?\d{3,4}[-. ]?\d{4}(?!\d)/g,
    mask: (s) => {
      // 가운데 묶음을 가린다: 010-1234-5678 → 010-●●●●-5678
      const parts = s.split(/([-. )])/);
      if (parts.length >= 5) return parts.map((p, i) => (i === 2 ? DOT.repeat(Array.from(p).length) : p)).join('');
      return maskChars(s, 3, 4);
    },
  },
  {
    kind: 'email',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
    mask: (s) => {
      const at = s.indexOf('@');
      return maskChars(s.slice(0, at), Math.min(2, at), 0) + s.slice(at);
    },
  },
  {
    kind: 'account',
    re: /(?<![\d-])\d{2,6}(?:-\d{2,7}){1,4}(?![\d-])|(?<!\d)\d{10,14}(?!\d)/g,
    // 은행·계좌 같은 말이 바로 앞에 있을 때만 (날짜·문서 번호를 가리지 않게)
    accept: (m, text) => BANK.test(text.slice(Math.max(0, m.index - 20), m.index)) && m[0].replace(/\D/g, '').length >= 10,
    mask: (s) => maskChars(s, 3, 2),
  },
  {
    kind: 'passport',
    re: /(?<![A-Za-z0-9])[MSROD](?:\d{8}|\d{3}[A-Z]\d{4})(?![A-Za-z0-9])/g,
    mask: (s) => maskChars(s, 2, 0),
  },
];

/** 글에서 개인정보를 찾는다. 겹치면 앞 규칙을 남긴다. */
export function findPii(text: string): PiiMatch[] {
  const found: PiiMatch[] = [];
  const taken: [number, number][] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const exec = m as unknown as RegExpExecArray;
      if (rule.accept && !rule.accept(exec, text)) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      found.push({ kind: rule.kind, text: m[0], masked: rule.mask(m[0]), index: start });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** 같은 글은 한 번만 (가릴 때는 엔진의 '모두 바꾸기'로 한꺼번에 바꾼다) */
export function uniquePii(matches: PiiMatch[]): (PiiMatch & { count: number })[] {
  const byText = new Map<string, PiiMatch & { count: number }>();
  for (const m of matches) {
    const seen = byText.get(m.text);
    if (seen) seen.count += 1;
    else byText.set(m.text, { ...m, count: 1 });
  }
  return [...byText.values()];
}
