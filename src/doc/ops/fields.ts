import type { EditableDocument } from '../editable';
import type { CellStep, DocPos } from '../position';

/**
 * 서식 채우기에서 차례로 도는 빈칸.
 * - field: 한글 누름틀(클릭하여 내용 입력). 값은 엔진의 setFieldValue로 바꾼다.
 * - cell: 누름틀이 없는 양식이면 본문 표의 빈 칸을 대신 돈다.
 */
export interface FormTarget {
  kind: 'field' | 'cell';
  /** 빈칸의 시작 위치 */
  pos: DocPos;
  /** 사람에게 보여 줄 이름 (누름틀 안내문, 표라면 왼쪽·위 칸의 글) */
  label: string;
  fieldId?: number;
}

interface RawField {
  fieldId: number;
  fieldType: string;
  name?: string;
  guide?: string;
  editableInForm?: boolean;
  startCharIdx: number;
  endCharIdx: number;
  location: { sectionIndex: number; paraIndex: number; path?: { type: string; controlIndex: number; cellIndex: number; paraIndex: number }[] };
}

interface LayoutCell {
  row: number;
  col: number;
  cellIdx: number;
}

interface LayoutControl {
  type: string;
  secIdx: number;
  paraIdx: number;
  controlIdx: number;
  cells?: LayoutCell[];
}

function parse<T>(json: string): T {
  return JSON.parse(json) as T;
}

function rawFields(doc: EditableDocument): RawField[] {
  try {
    return parse<RawField[]>(doc.raw.getFieldList());
  } catch {
    return [];
  }
}

function fieldPos(f: RawField, offset: number): DocPos | null {
  const { sectionIndex: sec, paraIndex: para, path } = f.location;
  if (!path?.length) return { sec, para, offset };
  // 글상자 안 누름틀 등 표 칸이 아닌 경로는 아직 캐럿으로 갈 수 없다.
  if (path.some((s) => s.type !== 'cell')) return null;
  const cellPath: CellStep[] = path.map((s) => ({ controlIndex: s.controlIndex, cellIndex: s.cellIndex, cellParaIndex: s.paraIndex }));
  return { sec, para, offset, cellPath };
}

/** 누름틀 하나의 현재 범위 (값을 바꾸면 끝 위치가 달라진다) */
export function fieldRange(doc: EditableDocument, fieldId: number): [DocPos, DocPos] | null {
  const f = rawFields(doc).find((x) => x.fieldId === fieldId);
  if (!f) return null;
  const start = fieldPos(f, f.startCharIdx);
  const end = fieldPos(f, f.endCharIdx);
  return start && end ? [start, end] : null;
}

function cellPos(t: LayoutControl, cellIdx: number): DocPos {
  return { sec: t.secIdx, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: cellIdx, cellParaIndex: 0 }] };
}

function cellText(doc: EditableDocument, pos: DocPos): string {
  try {
    if (doc.paraCount(pos) > 1) return '…';
    return doc.paraText(pos).trim();
  } catch {
    return '';
  }
}

/** 본문 표들의 빈 칸. 왼쪽(없으면 위) 칸의 글을 이름으로 쓴다. */
function emptyCells(doc: EditableDocument): FormTarget[] {
  const out: FormTarget[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < doc.pageCount(); page += 1) {
    let controls: LayoutControl[];
    try {
      controls = parse<{ controls: LayoutControl[] }>(doc.raw.getPageControlLayout(page)).controls ?? [];
    } catch {
      continue;
    }
    for (const t of controls) {
      if (t.type !== 'table' || !t.cells) continue;
      const cells = [...t.cells].sort((a, b) => a.row - b.row || a.col - b.col);
      for (const c of cells) {
        const key = `${t.secIdx}:${t.paraIdx}:${t.controlIdx}:${c.cellIdx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pos = cellPos(t, c.cellIdx);
        if (cellText(doc, pos) !== '') continue;
        const near = (row: number, col: number) => cells.find((x) => x.row === row && x.col === col);
        const left = near(c.row, c.col - 1);
        const up = near(c.row - 1, c.col);
        const label = [left, up].map((n) => (n ? cellText(doc, cellPos(t, n.cellIdx)) : '')).find((s) => s && s !== '…') ?? '';
        out.push({ kind: 'cell', pos, label: label || `표 ${c.row + 1}행 ${c.col + 1}열` });
      }
    }
  }
  return out;
}

/** 채울 빈칸 목록. 누름틀이 있으면 누름틀만, 없으면 표의 빈 칸. */
export function formTargets(doc: EditableDocument): FormTarget[] {
  const fields: FormTarget[] = [];
  for (const f of rawFields(doc)) {
    if (f.fieldType !== 'clickhere' || f.editableInForm === false) continue;
    const pos = fieldPos(f, f.startCharIdx);
    if (!pos) continue;
    fields.push({ kind: 'field', pos, label: f.guide?.trim() || f.name?.trim() || '빈칸', fieldId: f.fieldId });
  }
  return fields.length ? fields : emptyCells(doc);
}

/** 누름틀이 몇 개인지 (문서를 열 때 서식 채우기를 권할지 정한다) */
export function fieldCount(doc: EditableDocument): number {
  return rawFields(doc).filter((f) => f.fieldType === 'clickhere' && f.editableInForm !== false).length;
}

export function targetValue(doc: EditableDocument, t: FormTarget): string {
  if (t.kind === 'field') {
    try {
      return parse<{ value?: string }>(doc.raw.getFieldValue(t.fieldId!)).value ?? '';
    } catch {
      return '';
    }
  }
  return doc.paraCount(t.pos) > 1 ? '' : doc.paraText(t.pos);
}

/** 빈칸에 값을 넣는다. 채운 글의 범위를 돌려준다. */
export function setTargetValue(doc: EditableDocument, t: FormTarget, value: string): [DocPos, DocPos] {
  const text = value.replace(/\r?\n/g, ' ');
  if (t.kind === 'field') {
    doc.raw.setFieldValue(t.fieldId!, text);
    return fieldRange(doc, t.fieldId!) ?? [t.pos, t.pos];
  }
  const start = { ...t.pos, offset: 0 };
  const len = doc.paraLength(start);
  const at = len > 0 ? doc.deleteRange(start, { ...start, offset: len }) : start;
  const end = text ? doc.insertText(at, text) : at;
  return [at, end];
}

/** 빈칸을 화면에 보일 때 고를 범위 */
export function targetRange(doc: EditableDocument, t: FormTarget): [DocPos, DocPos] {
  if (t.kind === 'field') return fieldRange(doc, t.fieldId!) ?? [t.pos, t.pos];
  const start = { ...t.pos, offset: 0 };
  return [start, { ...start, offset: doc.paraCount(start) > 1 ? 0 : doc.paraLength(start) }];
}
