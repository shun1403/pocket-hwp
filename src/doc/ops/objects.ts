import type { EditableDocument } from '../editable';

/** shape = 사각형·타원·글상자, line = 선, group = 묶은 도형, chart = 차트 */
export type ObjectKind = 'image' | 'equation' | 'shape' | 'line' | 'group' | 'chart';

const KINDS: Record<string, ObjectKind> = { image: 'image', equation: 'equation', shape: 'shape', line: 'line', group: 'group', ole: 'chart' };

/** 쪽 위에 놓인 개체 (그림·수식·도형·차트) */
export interface PageObject {
  kind: ObjectKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  sec: number;
  para: number;
  ctrl: number;
}

interface LayoutControl {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  secIdx: number;
  paraIdx: number;
  controlIdx: number;
}

export function objectsOnPage(doc: EditableDocument, page: number): PageObject[] {
  try {
    const layout = JSON.parse(doc.raw.getPageControlLayout(page)) as { controls: LayoutControl[] };
    return layout.controls
      .filter((c) => KINDS[c.type] && (c.type !== 'ole' || isChart(doc, c)))
      .map((c) => ({ kind: KINDS[c.type], page, x: c.x, y: c.y, w: c.w, h: c.h, sec: c.secIdx, para: c.paraIdx, ctrl: c.controlIdx }));
  } catch {
    return [];
  }
}

function isChart(doc: EditableDocument, c: LayoutControl): boolean {
  try {
    const charts = JSON.parse(doc.raw.listCharts()) as { section: number; paragraph: number; control: number }[];
    return charts.some((x) => x.section === c.secIdx && x.paragraph === c.paraIdx && x.control === c.controlIdx);
  } catch {
    return false;
  }
}

/**
 * 점 위에 있는 개체. 도형(글상자)은 안쪽에 글을 쓸 수 있도록 테두리 근처만 잡고,
 * 가는 선은 손가락으로 집기 쉽게 둘레를 넓혀 잡는다.
 */
export function objectAt(doc: EditableDocument, page: number, x: number, y: number): PageObject | null {
  const edge = 10;
  const hits = objectsOnPage(doc, page).filter((o) => {
    const pad = o.kind === 'line' ? 12 : 0;
    const inside = x >= o.x - pad && x <= o.x + o.w + pad && y >= o.y - pad && y <= o.y + o.h + pad;
    if (!inside) return false;
    if (o.kind !== 'shape') return true;
    return x - o.x < edge || o.x + o.w - x < edge || y - o.y < edge || o.y + o.h - y < edge;
  });
  return hits.pop() ?? null;
}

export function deleteObject(doc: EditableDocument, o: PageObject): void {
  if (o.kind === 'image') doc.raw.deletePictureControl(o.sec, o.para, o.ctrl);
  else if (o.kind === 'equation') doc.raw.deleteEquationControl(o.sec, o.para, o.ctrl);
  else if (o.kind === 'chart') doc.raw.deleteShapeControl(o.sec, o.para, o.ctrl);
  else doc.raw.deleteShapeControl(o.sec, o.para, o.ctrl);
}

/** 그림·글상자 크기를 비율 그대로 바꾼다. */
export function scaleObject(doc: EditableDocument, o: PageObject, factor: number): void {
  if (o.kind === 'equation' || o.kind === 'chart') return;
  const get = o.kind === 'image' ? doc.raw.getPictureProperties.bind(doc.raw) : doc.raw.getShapeProperties.bind(doc.raw);
  const set = o.kind === 'image' ? doc.raw.setPictureProperties.bind(doc.raw) : doc.raw.setShapeProperties.bind(doc.raw);
  const props = JSON.parse(get(o.sec, o.para, o.ctrl)) as { width: number; height: number };
  set(o.sec, o.para, o.ctrl, JSON.stringify({ width: Math.round(props.width * factor), height: Math.round(props.height * factor) }));
}

/** 그림 배치: 글자처럼(본문 흐름) ↔ 어울림(글이 그림 둘레로) */
export function setImageInline(doc: EditableDocument, o: PageObject, inline: boolean): void {
  if (o.kind !== 'image') return;
  doc.raw.setPictureProperties(o.sec, o.para, o.ctrl, JSON.stringify(inline ? { treatAsChar: true } : { treatAsChar: false, textWrap: 'Square', vertRelTo: 'Para', horzRelTo: 'Column' }));
}

export function isImageInline(doc: EditableDocument, o: PageObject): boolean {
  if (o.kind !== 'image') return true;
  try {
    return (JSON.parse(doc.raw.getPictureProperties(o.sec, o.para, o.ctrl)) as { treatAsChar: boolean }).treatAsChar;
  } catch {
    return true;
  }
}

/** 본문 수식의 스크립트 (한글 수식 문법) */
export function equationScript(doc: EditableDocument, o: PageObject): string {
  try {
    return (JSON.parse(doc.raw.getEquationProperties(o.sec, o.para, o.ctrl, -1, -1)) as { script?: string }).script ?? '';
  } catch {
    return '';
  }
}

export function setEquationScript(doc: EditableDocument, o: PageObject, script: string): void {
  doc.raw.setEquationProperties(o.sec, o.para, o.ctrl, -1, -1, JSON.stringify({ script }));
}
