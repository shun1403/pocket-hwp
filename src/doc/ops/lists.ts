import type { EditableDocument } from '../editable';
import { type DocPos, inCell, innerPara, orderRange } from '../position';

export const BULLETS = ['●', '■', '◆', '▶', '○', '□', '-', '✓'] as const;

export interface NumberingPreset {
  id: string;
  label: string;
  /** 7개 수준의 번호 모양. ^n 은 n수준 번호 자리 */
  levelFormats: string[];
  /** 수준별 번호 종류: 0=1,2,3  1=①②③  2=Ⅰ,Ⅱ  8=가,나,다 */
  numberFormats: number[];
}

/** 공문서·보고서에서 흔히 쓰는 번호 모양 */
export const NUMBERING_PRESETS: NumberingPreset[] = [
  {
    id: 'gov',
    label: '1. 가. 1) 가)',
    levelFormats: ['^1.', '^2.', '^3)', '^4)', '(^5)', '(^6)', '^7'],
    numberFormats: [0, 8, 0, 8, 0, 8, 1],
  },
  { id: 'digit', label: '1. 2. 3.', levelFormats: ['^1.', '^2.', '^3.', '^4.', '^5.', '^6.', '^7.'], numberFormats: [0, 0, 0, 0, 0, 0, 0] },
  { id: 'hangul', label: '가. 나. 다.', levelFormats: ['^1.', '^2.', '^3.', '^4.', '^5.', '^6.', '^7.'], numberFormats: [8, 8, 8, 8, 8, 8, 8] },
  { id: 'circled', label: '① ② ③', levelFormats: ['^1', '^2', '^3', '^4', '^5', '^6', '^7'], numberFormats: [1, 1, 1, 1, 1, 1, 1] },
  { id: 'paren', label: '(1) (2) (3)', levelFormats: ['(^1)', '(^2)', '(^3)', '(^4)', '(^5)', '(^6)', '(^7)'], numberFormats: [0, 0, 0, 0, 0, 0, 0] },
  { id: 'roman', label: 'Ⅰ. Ⅱ. Ⅲ.', levelFormats: ['^1.', '^2.', '^3.', '^4.', '^5.', '^6.', '^7.'], numberFormats: [2, 2, 2, 2, 2, 2, 2] },
];

/** 문서마다 만든 번호 정의를 다시 쓰려고 기억해 둔다. */
const created = new WeakMap<object, Map<string, number>>();

export function numberingId(doc: EditableDocument, preset: NumberingPreset): number {
  let ids = created.get(doc.raw);
  if (!ids) created.set(doc.raw, (ids = new Map()));
  const cached = ids.get(preset.id);
  if (cached) return cached;
  const id = doc.raw.createNumbering(
    JSON.stringify({ levelFormats: preset.levelFormats, numberFormats: preset.numberFormats, startNumber: 1 }),
  );
  ids.set(preset.id, id);
  return id;
}

export function bulletId(doc: EditableDocument, char: string): number {
  return doc.raw.ensureDefaultBullet(char);
}

export interface StyleInfo {
  id: number;
  name: string;
  type: number;
}

/** 문단 스타일 목록 (글자 스타일 제외) */
export function paragraphStyles(doc: EditableDocument): StyleInfo[] {
  try {
    return (JSON.parse(doc.raw.getStyleList()) as StyleInfo[]).filter((s) => s.type === 0);
  } catch {
    return [];
  }
}

export function styleAt(doc: EditableDocument, pos: DocPos): number | null {
  if (inCell(pos)) {
    try {
      const outer = pos.cellPath[0];
      const r = JSON.parse(
        doc.raw.getCellStyleAt(pos.sec, pos.para, outer.controlIndex, outer.cellIndex, innerPara(pos)),
      ) as { id?: number };
      return r.id ?? null;
    } catch {
      return null;
    }
  }
  try {
    return (JSON.parse(doc.raw.getStyleAt(pos.sec, pos.para)) as { id: number }).id;
  } catch {
    return null;
  }
}

export function applyStyle(doc: EditableDocument, a: DocPos, b: DocPos, styleId: number): void {
  const [s, e] = orderRange(a, b);
  for (let p = innerPara(s); p <= innerPara(e); p += 1) {
    if (!inCell(s)) doc.raw.applyStyle(s.sec, p, styleId);
    else if (s.cellPath.length === 1) {
      const outer = s.cellPath[0];
      doc.raw.applyCellStyle(s.sec, s.para, outer.controlIndex, outer.cellIndex, p, styleId);
    }
  }
}

const STYLE_CHAR_KEYS = ['fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'strikethrough', 'textColor', 'shadeColor', 'superscript', 'subscript', 'ratios', 'spacings'] as const;
const STYLE_PARA_KEYS = ['alignment', 'lineSpacing', 'lineSpacingType', 'marginLeft', 'indent', 'spacingBefore', 'spacingAfter'] as const;

function pick<T extends object>(obj: T, keys: readonly string[]): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => keys.includes(k) && v !== undefined)) as Partial<T>;
}

/** 캐럿 자리의 글자·문단 모양을 스타일에 담는다. */
export function redefineStyle(doc: EditableDocument, styleId: number, pos: DocPos): void {
  const char = pick(doc.charProps(pos), STYLE_CHAR_KEYS);
  const para = pick(doc.paraProps(pos), STYLE_PARA_KEYS);
  doc.raw.updateStyleShapes(styleId, JSON.stringify(char), JSON.stringify(para));
}

/** 캐럿 자리 모양으로 새 문단 스타일을 만들고 그 문단에 건다. 새 스타일 id를 돌려준다. */
export function createStyleFromPos(doc: EditableDocument, pos: DocPos, name: string): number {
  const id = doc.raw.createStyle(JSON.stringify({ name, englishName: name, type: 0, nextStyleId: 0 }));
  redefineStyle(doc, id, pos);
  // 새 스타일은 다음 문단도 같은 스타일로 이어지게 한다.
  doc.raw.updateStyle(id, JSON.stringify({ name, englishName: name, nextStyleId: id }));
  applyStyle(doc, pos, pos, id);
  return id;
}

export function renameStyle(doc: EditableDocument, styleId: number, name: string): void {
  const s = (JSON.parse(doc.raw.getStyleList()) as { id: number; englishName?: string; nextStyleId?: number }[]).find((x) => x.id === styleId);
  doc.raw.updateStyle(styleId, JSON.stringify({ name, englishName: s?.englishName ?? name, nextStyleId: s?.nextStyleId ?? styleId }));
}

/** 이 문단부터 번호를 start 로 새로 시작한다. */
export function restartNumbering(doc: EditableDocument, pos: DocPos, start: number): void {
  if (inCell(pos)) return;
  // mode 2: 새 번호로 시작 (0: 앞 번호에 이어, 1: 이전 목록에 이어)
  doc.raw.setNumberingRestart(pos.sec, pos.para, 2, start);
}
