import type { EditableDocument } from '../editable';
import { type DocPos, inCell } from '../position';
import type { PageObject } from './objects';

/** 한글 색 값은 0x00BBGGRR 정수다. */
export function hwpColor(hex: string): number {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export function cssColor(hwp: number): string {
  const r = hwp & 0xff;
  const g = (hwp >> 8) & 0xff;
  const b = (hwp >> 16) & 0xff;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

export type ShapeType = 'rectangle' | 'ellipse' | 'line';

/** 캐럿 자리에 글자처럼 놓이는 도형을 넣는다 (본문 전용). */
export function insertShape(doc: EditableDocument, pos: DocPos, type: ShapeType, widthPx: number): DocPos {
  if (inCell(pos)) return pos;
  const w = Math.round(widthPx * 75);
  const h = type === 'line' ? Math.round(w * 0.02) : Math.round(w * 0.5);
  doc.raw.createShapeControl(
    JSON.stringify({ sectionIdx: pos.sec, paraIdx: pos.para, charOffset: pos.offset, width: w, height: h, treatAsChar: true, shapeType: type }),
  );
  return pos;
}

interface ShapeProps {
  borderColor: number;
  fillBgColor: number;
  fillType: string;
}

export function shapeColors(doc: EditableDocument, o: PageObject): { line: string; fill: string | null } | null {
  try {
    const p = JSON.parse(doc.raw.getShapeProperties(o.sec, o.para, o.ctrl)) as ShapeProps;
    return { line: cssColor(p.borderColor), fill: p.fillType === 'none' ? null : cssColor(p.fillBgColor) };
  } catch {
    return null;
  }
}

export function setShapeLineColor(doc: EditableDocument, o: PageObject, color: string): void {
  doc.raw.setShapeProperties(o.sec, o.para, o.ctrl, JSON.stringify({ borderColor: hwpColor(color) }));
}

/** null 이면 채우기 없음 */
export function setShapeFill(doc: EditableDocument, o: PageObject, color: string | null): void {
  doc.raw.setShapeProperties(
    o.sec,
    o.para,
    o.ctrl,
    JSON.stringify(color ? { fillType: 'solid', fillBgColor: hwpColor(color) } : { fillType: 'none' }),
  );
}

/** 겹친 도형 순서: 맨 앞·앞으로·뒤로·맨 뒤 */
export function setShapeOrder(doc: EditableDocument, o: PageObject, op: 'front' | 'forward' | 'backward' | 'back'): void {
  doc.raw.changeShapeZOrder(o.sec, o.para, o.ctrl, op);
}

/** 같은 구역의 도형들을 하나로 묶는다. */
export function groupObjects(doc: EditableDocument, items: PageObject[]): void {
  if (items.length < 2) return;
  doc.raw.groupShapes(JSON.stringify({ sectionIdx: items[0].sec, targets: items.map((o) => ({ paraIdx: o.para, controlIdx: o.ctrl })) }));
}

export function ungroup(doc: EditableDocument, o: PageObject): void {
  doc.raw.ungroupShape(o.sec, o.para, o.ctrl);
}

/** 도형·글상자에 캡션("그림 1")을 단다. 엔진은 아직 그림·표 캡션을 지원하지 않는다. */
export function attachCaption(doc: EditableDocument, o: PageObject): boolean {
  const r = JSON.parse(doc.raw.attachCaptionAt(o.para, o.ctrl)) as { ok: boolean };
  return r.ok;
}
