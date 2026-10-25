import type { EditableDocument } from '../editable';

/** HWPUNIT: 1mm ≈ 283.465 */
export const mm = (v: number) => Math.round(v * 283.465);

export interface PageDef {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  marginHeader: number;
  marginFooter: number;
  marginGutter: number;
  landscape: boolean;
  binding: number;
}

export const PAPERS = [
  { id: 'A4', label: 'A4', width: mm(210), height: mm(297) },
  { id: 'A3', label: 'A3', width: mm(297), height: mm(420) },
  { id: 'B5', label: 'B5', width: mm(182), height: mm(257) },
  { id: 'Letter', label: 'Letter', width: 61200, height: 79200 },
] as const;

export const MARGINS = [
  { id: 'narrow', label: '좁게', side: mm(15), top: mm(15), bottom: mm(15), hf: mm(10) },
  { id: 'normal', label: '보통', side: mm(30), top: mm(20), bottom: mm(15), hf: mm(15) },
  { id: 'wide', label: '넓게', side: mm(40), top: mm(30), bottom: mm(25), hf: mm(15) },
] as const;

export function getPageDef(doc: EditableDocument, sec: number): PageDef {
  return JSON.parse(doc.raw.getPageDef(sec)) as PageDef;
}

export function setPageDef(doc: EditableDocument, sec: number, patch: Partial<PageDef>): void {
  doc.raw.setPageDef(sec, JSON.stringify({ ...getPageDef(doc, sec), ...patch }));
}

/** 크기가 가장 가까운 용지 이름 */
export function paperOf(def: PageDef): string | null {
  const near = (a: number, b: number) => Math.abs(a - b) < mm(2);
  return PAPERS.find((p) => near(p.width, def.width) && near(p.height, def.height))?.id ?? null;
}

export function marginOf(def: PageDef): string | null {
  const near = (a: number, b: number) => Math.abs(a - b) < mm(1);
  return MARGINS.find((m) => near(m.side, def.marginLeft) && near(m.top, def.marginTop))?.id ?? null;
}

export function columnCount(doc: EditableDocument, sec: number): number {
  try {
    return (JSON.parse(doc.raw.getColumnDef(sec)) as { columnCount: number }).columnCount || 1;
  } catch {
    return 1;
  }
}

export function setColumns(doc: EditableDocument, sec: number, count: number): void {
  doc.raw.setColumnDef(sec, count, 0, 1, mm(8));
}

/** 머리말/꼬리말을 주어진 글 한 줄로 바꾼다. 빈 글이면 지운다. (양쪽 공통) */
export function setHeaderFooterText(
  doc: EditableDocument,
  sec: number,
  isHeader: boolean,
  text: string,
  alignment: 'left' | 'center' | 'right',
): void {
  const raw = doc.raw;
  const exists = (JSON.parse(raw.getHeaderFooter(sec, isHeader, 0)) as { exists?: boolean }).exists;
  if (exists) raw.deleteHeaderFooter(sec, isHeader, 0);
  if (!text.trim()) return;
  raw.createHeaderFooter(sec, isHeader, 0);
  raw.insertTextInHeaderFooter(sec, isHeader, 0, 0, 0, text);
  raw.applyParaFormatInHf(sec, isHeader, 0, 0, JSON.stringify({ alignment }));
}

export function headerFooterText(doc: EditableDocument, sec: number, isHeader: boolean): string {
  try {
    const exists = (JSON.parse(doc.raw.getHeaderFooter(sec, isHeader, 0)) as { exists?: boolean }).exists;
    if (!exists) return '';
    return (JSON.parse(doc.raw.getHeaderFooterParaInfo(sec, isHeader, 0, 0)) as { text?: string }).text ?? '';
  } catch {
    return '';
  }
}
