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

export function setCellFill(doc: EditableDocument, ctx: CellContext, color: string | null): void {
  const props = color ? { fillType: 'solid', fillColor: color } : { fillType: 'none' };
  doc.raw.setCellProperties(ctx.sec, ctx.para, ctx.ctrl, ctx.cell, JSON.stringify(props));
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
