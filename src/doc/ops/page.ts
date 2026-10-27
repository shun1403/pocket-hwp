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

/** HWPUNIT → mm (소수 한 자리) */
export const toMm = (v: number) => Math.round((v / 283.465) * 10) / 10;

/** 한글 편집 용지(F7)의 용지 종류. B4·B5는 한글과 같은 46배판 크기다. */
export const PAPERS = [
  { id: 'A4', label: 'A4', width: mm(210), height: mm(297) },
  { id: 'A3', label: 'A3', width: mm(297), height: mm(420) },
  { id: 'A5', label: 'A5', width: mm(148), height: mm(210) },
  { id: 'B4', label: 'B4', width: mm(257), height: mm(364) },
  { id: 'B5', label: 'B5', width: mm(182), height: mm(257) },
  { id: 'Letter', label: 'Letter', width: 61200, height: 79200 },
  { id: 'Legal', label: 'Legal', width: 61200, height: 100800 },
  { id: 'Shinguk', label: '신국판', width: mm(152), height: mm(225) },
] as const;

/** 제본: 0 한쪽(왼쪽), 1 맞쪽(홀짝 쪽이 거울처럼), 2 위로 넘기기 */
export const BINDINGS = [
  { id: 0, label: '한쪽' },
  { id: 1, label: '맞쪽' },
  { id: 2, label: '위로' },
] as const;

/** 여백을 뺀 본문 크기 (HWPUNIT). 가로 방향이면 폭·길이를 바꿔 잰다. */
export function bodySize(def: PageDef): { width: number; height: number } {
  const w = def.landscape ? def.height : def.width;
  const hgt = def.landscape ? def.width : def.height;
  const sideGutter = def.binding === 2 ? 0 : def.marginGutter;
  const topGutter = def.binding === 2 ? def.marginGutter : 0;
  return {
    width: w - def.marginLeft - def.marginRight - sideGutter,
    height: hgt - def.marginTop - def.marginBottom - def.marginHeader - def.marginFooter - topGutter,
  };
}

/** 편집 용지 값이 맞지 않으면 사람이 읽을 이유, 맞으면 null */
export function pageSetupError(def: PageDef): string | null {
  const values = [def.width, def.height, def.marginLeft, def.marginRight, def.marginTop, def.marginBottom, def.marginHeader, def.marginFooter, def.marginGutter];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return '숫자를 바르게 넣어 주세요.';
  if (def.width < mm(30) || def.height < mm(30) || def.width > mm(1500) || def.height > mm(1500)) return '용지 폭과 길이는 30~1500mm 사이로 넣어 주세요.';
  const body = bodySize(def);
  if (body.width < mm(10) || body.height < mm(10)) return '여백이 너무 커서 글을 쓸 자리가 없어요. 여백을 줄여 주세요.';
  return null;
}

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

/** 꼬리말 쪽 번호 모양 */
export const PAGE_NUMBER_STYLES = [
  { id: 'plain', label: '1', parts: ['', 'page', ''] },
  { id: 'dash', label: '- 1 -', parts: ['- ', 'page', ' -'] },
  { id: 'total', label: '1 / 5', parts: ['', 'page', ' / ', 'total', ''] },
  { id: 'korean', label: '1쪽', parts: ['', 'page', '쪽'] },
] as const;

export type PageNumberStyle = (typeof PAGE_NUMBER_STYLES)[number]['id'];

/** rhwp 머리말/꼬리말 필드 종류: 1 = 현재 쪽, 2 = 전체 쪽 수 */
const HF_FIELD = { page: 1, total: 2 } as const;

/**
 * 꼬리말에 쪽 번호를 넣는다. 꼬리말에 있던 글은 쪽 번호로 바뀐다.
 * 쪽 번호는 엔진 필드라서 쪽마다 알맞은 번호로 그려지고, HWP/HWPX로 저장해도 남는다.
 */
export function setPageNumber(doc: EditableDocument, sec: number, style: PageNumberStyle, alignment: 'left' | 'center' | 'right'): void {
  const raw = doc.raw;
  const exists = (JSON.parse(raw.getHeaderFooter(sec, false, 0)) as { exists?: boolean }).exists;
  if (exists) raw.deleteHeaderFooter(sec, false, 0);
  raw.createHeaderFooter(sec, false, 0);
  const spec = PAGE_NUMBER_STYLES.find((s) => s.id === style) ?? PAGE_NUMBER_STYLES[0];
  let at = 0;
  for (const part of spec.parts) {
    if (part === 'page' || part === 'total') {
      raw.insertFieldInHf(sec, false, 0, 0, at, HF_FIELD[part]);
      at += 1;
    } else if (part) {
      raw.insertTextInHeaderFooter(sec, false, 0, 0, at, part);
      at += part.length;
    }
  }
  raw.applyParaFormatInHf(sec, false, 0, 0, JSON.stringify({ alignment }));
}

/** 쪽 테두리 모양 */
export const PAGE_BORDERS = [
  { id: 'none', label: '없음', line: { type: 0, width: 0 } },
  { id: 'thin', label: '가는 선', line: { type: 1, width: 1 } },
  { id: 'thick', label: '굵은 선', line: { type: 1, width: 7 } },
  { id: 'dot', label: '점선', line: { type: 3, width: 1 } },
] as const;

export type PageBorderStyle = (typeof PAGE_BORDERS)[number]['id'];

interface BorderLine {
  type: number;
  width: number;
  color: string;
}

interface PageBorderFill {
  borderLeft: BorderLine;
  fillType: string;
  fillColor: string;
}

export function pageBorderFill(doc: EditableDocument, sec: number): { border: PageBorderStyle | null; fill: string | null } {
  try {
    const r = JSON.parse(doc.raw.getPageBorderFill(sec)) as PageBorderFill;
    const b = PAGE_BORDERS.find((p) => p.line.type === r.borderLeft.type && (p.line.type === 0 || p.line.width === r.borderLeft.width));
    return { border: b?.id ?? null, fill: r.fillType === 'solid' ? r.fillColor : null };
  } catch {
    return { border: null, fill: null };
  }
}

/** 엔진은 빠진 항목을 기본값으로 되돌리므로 지금 값에 바꿀 것만 덮어써서 넘긴다. */
function patchPageBorderFill(doc: EditableDocument, sec: number, patch: Record<string, unknown>): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(doc.raw.getPageBorderFill(sec)) as Record<string, unknown>;
  } catch {
    // 처음 설정
  }
  doc.raw.setPageBorderFill(sec, JSON.stringify({ ...current, ...patch }));
}

/** 쪽 테두리를 네 변 모두 같은 모양으로 바꾼다. */
export function setPageBorder(doc: EditableDocument, sec: number, style: PageBorderStyle, color = '#000000'): void {
  const spec = PAGE_BORDERS.find((p) => p.id === style) ?? PAGE_BORDERS[0];
  const line = { ...spec.line, color };
  patchPageBorderFill(doc, sec, { borderLeft: line, borderRight: line, borderTop: line, borderBottom: line });
}

/** 쪽 배경색. null 이면 없앤다. */
export function setPageFill(doc: EditableDocument, sec: number, color: string | null): void {
  patchPageBorderFill(doc, sec, color ? { fillType: 'solid', fillColor: color } : { fillType: 'none' });
}
