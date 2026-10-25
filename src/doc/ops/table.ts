import type { EditableDocument } from '../editable';
import { type DocPos, inCell } from '../position';

/** 캐럿이 있는 표 칸 (본문 표, 한 단계 깊이만) */
export interface CellContext {
  sec: number;
  para: number;
  ctrl: number;
  cell: number;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

interface CellInfo {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export function cellContext(doc: EditableDocument, pos: DocPos | null): CellContext | null {
  if (!pos || !inCell(pos) || pos.cellPath.length !== 1) return null;
  const { controlIndex: ctrl, cellIndex: cell } = pos.cellPath[0];
  try {
    const info = JSON.parse(doc.raw.getCellInfo(pos.sec, pos.para, ctrl, cell)) as CellInfo;
    return { sec: pos.sec, para: pos.para, ctrl, cell, ...info };
  } catch {
    return null;
  }
}

function cellPos(ctx: CellContext, cell: number): DocPos {
  return { sec: ctx.sec, para: ctx.para, offset: 0, cellPath: [{ controlIndex: ctx.ctrl, cellIndex: cell, cellParaIndex: 0 }] };
}

/** (row, col)을 덮는 칸 번호를 찾는다. 없으면 마지막 칸. */
function findCell(doc: EditableDocument, ctx: CellContext, row: number, col: number): number {
  let last = 0;
  for (let i = 0; i < 2000; i += 1) {
    let info: CellInfo;
    try {
      info = JSON.parse(doc.raw.getCellInfo(ctx.sec, ctx.para, ctx.ctrl, i)) as CellInfo;
    } catch {
      break;
    }
    last = i;
    if (row >= info.row && row < info.row + info.rowSpan && col >= info.col && col < info.col + info.colSpan) return i;
  }
  return last;
}

export type TableOp =
  | 'rowAbove'
  | 'rowBelow'
  | 'colLeft'
  | 'colRight'
  | 'deleteRow'
  | 'deleteCol'
  | 'mergeRight'
  | 'mergeDown'
  | 'split'
  | 'deleteTable';

/** 표 편집을 한 뒤 캐럿을 둘 자리를 돌려준다. */
export function tableOp(doc: EditableDocument, ctx: CellContext, op: TableOp): DocPos {
  const { sec, para, ctrl, row, col } = ctx;
  const raw = doc.raw;
  let target: [number, number] = [row, col];
  switch (op) {
    case 'rowAbove':
      raw.insertTableRow(sec, para, ctrl, row, false);
      target = [row + 1, col];
      break;
    case 'rowBelow':
      raw.insertTableRow(sec, para, ctrl, row + ctx.rowSpan - 1, true);
      break;
    case 'colLeft':
      raw.insertTableColumn(sec, para, ctrl, col, false);
      target = [row, col + 1];
      break;
    case 'colRight':
      raw.insertTableColumn(sec, para, ctrl, col + ctx.colSpan - 1, true);
      break;
    case 'deleteRow':
      raw.deleteTableRow(sec, para, ctrl, row);
      target = [Math.max(0, row - 1), col];
      break;
    case 'deleteCol':
      raw.deleteTableColumn(sec, para, ctrl, col);
      target = [row, Math.max(0, col - 1)];
      break;
    case 'mergeRight':
      raw.mergeTableCells(sec, para, ctrl, row, col, row + ctx.rowSpan - 1, col + ctx.colSpan);
      break;
    case 'mergeDown':
      raw.mergeTableCells(sec, para, ctrl, row, col, row + ctx.rowSpan, col + ctx.colSpan - 1);
      break;
    case 'split':
      raw.splitTableCell(sec, para, ctrl, row, col);
      break;
    case 'deleteTable':
      raw.deleteTableControl(sec, para, ctrl);
      return { sec, para, offset: 0 };
  }
  return cellPos(ctx, findCell(doc, ctx, ...target));
}

/** 셀 속성 중 일부만 바꾼다. 엔진은 넘기지 않은 테두리를 0(가장 가는 선)으로 되돌리므로 지금 테두리를 함께 넘긴다. */
function patchCell(doc: EditableDocument, ctx: CellContext, cell: number, patch: Record<string, unknown>): void {
  const current = JSON.parse(doc.raw.getCellProperties(ctx.sec, ctx.para, ctx.ctrl, cell)) as Record<string, unknown>;
  const keep = Object.fromEntries(['borderLeft', 'borderRight', 'borderTop', 'borderBottom'].map((k) => [k, current[k]]));
  doc.raw.setCellProperties(ctx.sec, ctx.para, ctx.ctrl, cell, JSON.stringify({ ...keep, ...patch }));
}

export function setCellFill(doc: EditableDocument, ctx: CellContext, color: string | null): void {
  patchCell(doc, ctx, ctx.cell, color ? { fillType: 'solid', fillColor: color } : { fillType: 'none' });
}

/** 표 칸 하나의 자리와 쪽 위 상자 (getTableCellBboxes) */
export interface CellBox {
  cellIdx: number;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tableCells(doc: EditableDocument, ctx: CellContext): CellBox[] {
  try {
    return JSON.parse(doc.raw.getTableCellBboxes(ctx.sec, ctx.para, ctx.ctrl)) as CellBox[];
  } catch {
    return [];
  }
}

/** 표의 줄·칸 수 */
export function tableSize(cells: CellBox[]): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const c of cells) {
    rows = Math.max(rows, c.row + c.rowSpan);
    cols = Math.max(cols, c.col + c.colSpan);
  }
  return { rows, cols };
}

/** 캐럿 칸에서 아래로 rows줄, 오른쪽으로 cols칸 범위 (합쳐진 칸이 걸치면 범위를 넓힌다) */
export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function cellRange(ctx: CellContext, cells: CellBox[], rows: number, cols: number): CellRange {
  const range = { r0: ctx.row, c0: ctx.col, r1: ctx.row + Math.max(rows, ctx.rowSpan) - 1, c1: ctx.col + Math.max(cols, ctx.colSpan) - 1 };
  // 걸친 합쳐진 칸을 모두 품을 때까지 넓힌다.
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of cellsIn(cells, range)) {
      const r1 = c.row + c.rowSpan - 1;
      const c1 = c.col + c.colSpan - 1;
      if (c.row < range.r0 || c.col < range.c0 || r1 > range.r1 || c1 > range.c1) {
        range.r0 = Math.min(range.r0, c.row);
        range.c0 = Math.min(range.c0, c.col);
        range.r1 = Math.max(range.r1, r1);
        range.c1 = Math.max(range.c1, c1);
        changed = true;
      }
    }
  }
  return range;
}

export function cellsIn(cells: CellBox[], r: CellRange): CellBox[] {
  return cells.filter((c) => c.row <= r.r1 && c.row + c.rowSpan - 1 >= r.r0 && c.col <= r.c1 && c.col + c.colSpan - 1 >= r.c0);
}

export function mergeRange(doc: EditableDocument, ctx: CellContext, r: CellRange): DocPos {
  doc.raw.mergeTableCells(ctx.sec, ctx.para, ctx.ctrl, r.r0, r.c0, r.r1, r.c1);
  return cellPos(ctx, findCell(doc, ctx, r.r0, r.c0));
}

export function fillRange(doc: EditableDocument, ctx: CellContext, cells: CellBox[], color: string | null): void {
  for (const c of cells) setCellFill(doc, { ...ctx, cell: c.cellIdx }, color);
}

/** 고른 칸들의 글을 모두 지운다 (칸은 남긴다). */
export function clearRange(doc: EditableDocument, ctx: CellContext, cells: CellBox[]): void {
  for (const c of cells) {
    const first = cellPos(ctx, c.cellIdx);
    const lastPara = doc.paraCount(first) - 1;
    const last: DocPos = { ...first, cellPath: [{ controlIndex: ctx.ctrl, cellIndex: c.cellIdx, cellParaIndex: lastPara }] };
    const end = { ...last, offset: doc.paraLength(last) };
    if (lastPara > 0 || end.offset > 0) doc.deleteRange(first, end);
  }
}

/** 칸 너비·줄 높이를 HWPUNIT 만큼 바꾼다 (같은 칸의 줄·칸 전체가 함께 바뀐다). */
export function resizeCell(doc: EditableDocument, ctx: CellContext, widthDelta: number, heightDelta: number): void {
  const edit: Record<string, number> = { cellIdx: ctx.cell };
  if (widthDelta) edit.widthDelta = widthDelta;
  if (heightDelta) edit.heightDelta = heightDelta;
  doc.raw.resizeTableCells(ctx.sec, ctx.para, ctx.ctrl, JSON.stringify([edit]));
}

/** 셀 테두리 모양 (한글 선 종류: 0 없음, 1 실선, 3 점선 / 굵기: 1 = 0.12mm, 7 = 0.5mm) */
export const CELL_BORDERS = [
  { id: 'thin', label: '가는 실선', line: { type: 1, width: 1 } },
  { id: 'thick', label: '굵은 실선', line: { type: 1, width: 7 } },
  { id: 'dot', label: '점선', line: { type: 3, width: 1 } },
  { id: 'none', label: '선 없음', line: { type: 0, width: 0 } },
] as const;

export type CellBorderStyle = (typeof CELL_BORDERS)[number]['id'];

/**
 * 고른 칸들에 테두리를 건다. outer 면 범위 바깥쪽 변에만 건다.
 * 이웃 칸과 맞닿은 변은 엔진이 두 칸 모두 맞춰 준다.
 */
export function setCellBorders(doc: EditableDocument, ctx: CellContext, cells: CellBox[], style: CellBorderStyle, outer = false, color = '#000000'): void {
  const spec = CELL_BORDERS.find((b) => b.id === style) ?? CELL_BORDERS[0];
  const line = { ...spec.line, color };
  const r0 = Math.min(...cells.map((c) => c.row));
  const c0 = Math.min(...cells.map((c) => c.col));
  const r1 = Math.max(...cells.map((c) => c.row + c.rowSpan - 1));
  const c1 = Math.max(...cells.map((c) => c.col + c.colSpan - 1));
  for (const c of cells) {
    const sides: Record<string, typeof line> = {};
    if (!outer || c.col === c0) sides.borderLeft = line;
    if (!outer || c.col + c.colSpan - 1 === c1) sides.borderRight = line;
    if (!outer || c.row === r0) sides.borderTop = line;
    if (!outer || c.row + c.rowSpan - 1 === r1) sides.borderBottom = line;
    if (Object.keys(sides).length) patchCell(doc, ctx, c.cellIdx, sides);
  }
}

/** 0 → A, 25 → Z, 26 → AA (표 계산식의 칸 이름) */
export function columnName(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 캐럿 칸 위쪽·왼쪽 칸들을 더하거나 평균 내는 계산식 */
export function quickFormula(ctx: CellContext, fn: 'SUM' | 'AVG', dir: 'up' | 'left'): string | null {
  if (dir === 'up') {
    if (ctx.row === 0) return null;
    const col = columnName(ctx.col);
    return `=${fn}(${col}1:${col}${ctx.row})`;
  }
  if (ctx.col === 0) return null;
  return `=${fn}(A${ctx.row + 1}:${columnName(ctx.col - 1)}${ctx.row + 1})`;
}

/** 계산식 결과를 캐럿 칸에 쓴다. 결과를 돌려주고, 식이 틀리면 null */
export function applyFormula(doc: EditableDocument, ctx: CellContext, formula: string): number | null {
  const f = formula.trim().startsWith('=') ? formula.trim() : `=${formula.trim()}`;
  try {
    const r = JSON.parse(doc.raw.evaluateTableFormula(ctx.sec, ctx.para, ctx.ctrl, ctx.row, ctx.col, f, true)) as { ok: boolean; result?: number };
    return r.ok && typeof r.result === 'number' && Number.isFinite(r.result) ? r.result : null;
  } catch {
    return null;
  }
}

/** 캐럿 줄에서 표를 둘로 나눈다 (캐럿 줄이 아래 표의 첫 줄이 된다). */
export function splitTableAt(doc: EditableDocument, ctx: CellContext): boolean {
  if (ctx.row === 0) return false;
  return (JSON.parse(doc.raw.splitTable(ctx.sec, ctx.para, ctx.ctrl, ctx.row)) as { ok: boolean }).ok;
}

/** 바로 다음 표를 이 표 아래에 붙인다. */
export function joinNextTable(doc: EditableDocument, ctx: CellContext): boolean {
  try {
    return (JSON.parse(doc.raw.mergeTableWithNext(ctx.sec, ctx.para, ctx.ctrl)) as { ok: boolean }).ok;
  } catch {
    return false;
  }
}
