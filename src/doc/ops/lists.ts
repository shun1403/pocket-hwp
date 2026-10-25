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
