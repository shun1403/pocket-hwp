import type { EditableDocument } from '../editable';
import { type DocPos, inCell, innerPara, withInnerPara } from '../position';
import { type FormTarget, clickFields, emptyCells, setTargetValue, tableCells } from './fields';
import { insertPicture } from './inserts';

/** '내 정보'에 저장하는 항목 (주민등록번호는 일부러 두지 않는다) */
export type ProfileKey =
  | 'name'
  | 'nameHanja'
  | 'nameEn'
  | 'birth'
  | 'gender'
  | 'mobile'
  | 'phone'
  | 'email'
  | 'address'
  | 'zip'
  | 'org'
  | 'title'
  | 'grade'
  | 'klass'
  | 'number'
  | 'relation';

/** 채울 칸의 종류: 내 정보 항목, 오늘 날짜, 서명 */
export type SlotKey = ProfileKey | 'today' | 'signature';

export interface Profile {
  id: string;
  /** 사람 이름표 (나, 자녀1 …) */
  label: string;
  /** child 면 '학생·자녀' 칸에 먼저 제안한다 */
  kind: 'self' | 'child' | 'family';
  values: Partial<Record<ProfileKey, string>>;
  updatedAt: number;
}

export const PROFILE_FIELDS: { key: ProfileKey; label: string; type?: 'date' | 'tel' | 'email'; placeholder?: string }[] = [
  { key: 'name', label: '이름', placeholder: '홍길동' },
  { key: 'nameHanja', label: '한자 이름', placeholder: '洪吉童' },
  { key: 'nameEn', label: '영문 이름', placeholder: 'HONG GILDONG' },
  { key: 'birth', label: '생년월일', type: 'date' },
  { key: 'gender', label: '성별', placeholder: '남 / 여' },
  { key: 'mobile', label: '휴대전화', type: 'tel', placeholder: '010-0000-0000' },
  { key: 'phone', label: '집 전화', type: 'tel' },
  { key: 'email', label: '이메일', type: 'email' },
  { key: 'address', label: '주소', placeholder: '도로명 주소' },
  { key: 'zip', label: '우편번호' },
  { key: 'org', label: '소속 (학교·회사)' },
  { key: 'title', label: '직위·직급' },
  { key: 'grade', label: '학년' },
  { key: 'klass', label: '반' },
  { key: 'number', label: '번호' },
  { key: 'relation', label: '관계 (부·모·보호자 등)' },
];

export const SLOT_NAMES: Record<SlotKey, string> = {
  ...(Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, f.label])) as Record<ProfileKey, string>),
  today: '오늘 날짜',
  signature: '서명',
};

/**
 * 칸 이름표 → 항목. 앞쪽 규칙이 먼저 걸린다(한자 이름이 이름보다, 기관명이 이름보다 먼저).
 * 이름표는 공백·기호를 뺀 뒤 비교한다(`성 명` = `성명`).
 */
const RULES: [SlotKey, RegExp][] = [
  ['nameHanja', /(성명|이름).*한자|한자.*(성명|이름)/],
  ['nameEn', /(성명|이름).*(영문|영어)|(영문|영어).*(성명|이름)/],
  ['birth', /생년월일|생일|출생/],
  ['zip', /우편번호/],
  ['email', /이메일|e?mail|전자우편|메일/],
  ['phone', /자택전화|집전화|유선전화|자택번호/],
  ['mobile', /휴대전화|휴대폰|핸드폰|휴대번호|연락처|전화번호|전화|^hp$|mobile/],
  ['address', /주소|거주지|소재지/],
  ['relation', /관계/],
  ['gender', /^성별$/],
  ['grade', /^학년$/],
  ['klass', /^반$/],
  ['number', /^번호$|^번$/],
  ['title', /직위|직급|직책/],
  ['org', /소속|학교|직장|회사|근무처|기관/],
  ['today', /^(작성|신청|제출|접수)?(일|일자|날짜)$/],
  ['name', /성명|이름|성함|신청인|신청자|지원자|참가자|작성자|대표자|학생명|아동명|원아명/],
];

const CHILD = /학생|자녀|아동|원아|유아|피보호자|아들|딸/;

export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[\s:：*※·•\-_.,()[\]{}<>「」『』【】〔〕]/g, '');
}

/** 이름표가 어떤 항목인지. 문장처럼 긴 글이나 모르는 이름표면 null */
export function matchLabel(label: string): { key: SlotKey; child: boolean } | null {
  const n = normalizeLabel(label);
  if (!n || n.length > 16) return null;
  const rule = RULES.find(([, re]) => re.test(n));
  return rule ? { key: rule[0], child: CHILD.test(n) } : null;
}

/** 채울 수 있는 자리 하나 */
export interface Slot {
  key: SlotKey;
  /** 문서에 쓰인 이름표 */
  label: string;
  /** '학생·자녀' 칸인가 */
  child: boolean;
  /**
   * field: 누름틀 · cell: 빈 표 칸 · inline: `성명: ____`의 밑줄·빈칸 ·
   * marker: `(서명)`·`(인)` 표시 · date: `년 월 일` 빈칸
   */
  kind: 'field' | 'cell' | 'inline' | 'marker' | 'date';
  target?: FormTarget;
  /** inline·marker·date 에서 바꿀 범위 (같은 문단) */
  start: DocPos;
  end: DocPos;
}

/** 본문과 본문 표 칸의 모든 문단 (첫 위치) */
function paragraphs(doc: EditableDocument): DocPos[] {
  const out: DocPos[] = [];
  let sections = 1;
  try {
    sections = doc.raw.getSectionCount();
  } catch {
    // 구역 수를 모르면 첫 구역만 본다.
  }
  for (let sec = 0; sec < sections; sec += 1) {
    const first = { sec, para: 0, offset: 0 };
    for (let p = 0; p < doc.paraCount(first); p += 1) out.push({ sec, para: p, offset: 0 });
  }
  for (const c of tableCells(doc)) {
    for (let p = 0; p < doc.paraCount(c.pos); p += 1) out.push(withInnerPara(c.pos, p, 0));
  }
  return out;
}

/** UTF-16 위치 → 엔진 글자 위치 (한 글자 = 코드 포인트 하나) */
const charIndex = (text: string, utf16: number) => Array.from(text.slice(0, utf16)).length;

// 이름표 안의 띄어쓰기는 한 칸까지만 (두 칸 넘게 띄운 앞 글은 이미 쓴 값이다).
const LABEL = '[가-힣A-Za-z](?:[가-힣A-Za-z()]|\\s(?!\\s)){0,12}?';
/** `성명 : ____  연락처 : ____` — 이름표 뒤 쌍점 다음이 빈칸(공백·밑줄)이고 줄 끝이나 다음 이름표가 오는 자리 */
const INLINE = new RegExp(`(${LABEL})\\s*[:：]([ \\t\\u3000_]*)(?=$|[ \\t\\u3000]*${LABEL}\\s*[:：])`, 'g');
const MARKER = /\((?:서명|인|날인|서명\s*또는\s*인|서명\s*또는\s*날인)\)/g;
const DATE = /(\d{2,4})?([ \t　]*)년([ \t　]*)(\d{1,2})?([ \t　]*)월([ \t　]*)(\d{1,2})?([ \t　]*)일/g;

/** 문단 글에서 채울 자리를 찾는다 (순수 함수, 단위 테스트용) */
export function scanText(text: string): { kind: 'inline' | 'marker' | 'date'; key: SlotKey; label: string; child: boolean; from: number; to: number }[] {
  const out: ReturnType<typeof scanText> = [];
  for (const m of text.matchAll(INLINE)) {
    const hit = matchLabel(m[1]);
    if (!hit || hit.key === 'signature') continue;
    // 빈칸은 밑줄이 있거나, 두 칸 넘게 비었거나, 줄 끝이어야 한다 (`성명: 김철수`의 한 칸은 빈칸이 아니다).
    const atEnd = m.index + m[0].length === text.length;
    if (!m[2].includes('_') && m[2].length < 2 && !atEnd) continue;
    const from = m.index + m[0].length - m[2].length;
    out.push({ kind: 'inline', key: hit.key, label: m[1].trim(), child: hit.child, from: charIndex(text, from), to: charIndex(text, from + m[2].length) });
  }
  for (const m of text.matchAll(MARKER)) {
    out.push({ kind: 'marker', key: 'signature', label: m[0], child: false, from: charIndex(text, m.index), to: charIndex(text, m.index + m[0].length) });
  }
  for (const m of text.matchAll(DATE)) {
    const [, y, , gapY, mo, gapM, gapM2, d, gapD] = m;
    // 이미 다 쓴 날짜는 건드리지 않는다.
    if (y?.length === 4 && mo && d) continue;
    // 년·월·일 사이가 비어 있어야 한다 ('생년월일'의 '년월일'은 날짜 칸이 아니다).
    if (!(gapY + (mo ?? '') + gapM) || !(gapM2 + (d ?? '') + gapD)) continue;
    // 본문의 '3년 2월 1일'처럼 한 칸씩 띄운 날짜는 숫자가 하나라도 있으면 쓴 날짜로 본다.
    if ((mo || d) && !/[ \t　]{2,}/.test(m[0])) continue;
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    const key: SlotKey = /생년|출생|생일/.test(before) ? 'birth' : 'today';
    out.push({ kind: 'date', key, label: key === 'birth' ? '생년월일' : '날짜', child: CHILD.test(before), from: charIndex(text, m.index), to: charIndex(text, m.index + m[0].length) });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** 문서에서 채울 수 있는 자리를 모두 찾는다. */
export function findSlots(doc: EditableDocument): Slot[] {
  const slots: Slot[] = [];
  const asSlot = (t: FormTarget): Slot | null => {
    const hit = matchLabel(t.label);
    return hit ? { key: hit.key, label: t.label, child: hit.child, kind: t.kind, target: t, start: t.pos, end: t.pos } : null;
  };
  for (const t of [...clickFields(doc), ...emptyCells(doc)]) {
    const s = asSlot(t);
    if (s) slots.push(s);
  }
  for (const pos of paragraphs(doc)) {
    let text: string;
    try {
      text = doc.paraText(pos);
    } catch {
      continue;
    }
    if (!text) continue;
    for (const hit of scanText(text)) {
      slots.push({ key: hit.key, label: hit.label, child: hit.child, kind: hit.kind, start: { ...pos, offset: hit.from }, end: { ...pos, offset: hit.to } });
    }
  }
  return slots;
}

/** 2026-10-30 같은 날짜를 한글 양식에 흔한 모양으로 */
export function koreanDate(iso: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(iso);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : iso;
}

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** 자리에 넣을 값 (사람 정보에서). 없으면 '' */
export function slotValue(slot: Slot, profile: Profile | null, now = new Date()): string {
  if (slot.key === 'signature') return '';
  if (slot.key === 'today') return koreanDate(todayIso(now));
  const v = profile?.values[slot.key]?.trim() ?? '';
  return slot.key === 'birth' ? koreanDate(v) : v;
}

export interface SignatureImage {
  png: Uint8Array;
  width: number;
  height: number;
}

export interface FillItem {
  slot: Slot;
  /** 글 값 (서명이면 무시) */
  value: string;
}

/** 같은 문단 목록(본문 구역·같은 칸)끼리 묶는 열쇠 */
function containerKey(pos: DocPos): string {
  return inCell(pos) ? `${pos.sec}:${pos.para}:${pos.cellPath.map((c) => `${c.controlIndex}.${c.cellIndex}`).join('/')}` : `${pos.sec}`;
}

/**
 * 고른 자리를 한 번에 채운다(실행 취소 한 번으로 되돌리도록 Editor.command 안에서 부른다).
 * 같은 문단 안에서 앞 자리를 채우면 뒤 자리 위치가 밀리므로 뒤에서부터 채운다.
 * 첫 자리의 위치를 돌려준다.
 */
export function applyFill(doc: EditableDocument, items: FillItem[], signature: SignatureImage | null, signWidthPx = 110): DocPos | undefined {
  const order = [...items].sort((a, b) => {
    const ka = containerKey(a.slot.start);
    const kb = containerKey(b.slot.start);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return innerPara(b.slot.start) - innerPara(a.slot.start) || b.slot.start.offset - a.slot.start.offset;
  });
  for (const { slot, value } of order) {
    if (slot.kind === 'field' || slot.kind === 'cell') {
      if (value) setTargetValue(doc, slot.target!, value);
      continue;
    }
    if (slot.kind === 'marker') {
      if (!signature) continue;
      const at = doc.deleteRange(slot.start, slot.end);
      insertPicture(doc, at, signature.png, { width: signature.width, height: signature.height }, 'png', signWidthPx);
      continue;
    }
    if (!value) continue;
    const at = slot.end.offset > slot.start.offset ? doc.deleteRange(slot.start, slot.end) : slot.start;
    doc.insertText(at, slot.kind === 'inline' ? ` ${value} ` : value);
  }
  return items[0]?.slot.start;
}
