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
