import {
  CELL_BORDERS,
  type CellBorderStyle,
  type TableOp,
  applyFormula,
  joinNextTable,
  quickFormula,
  resizeCell,
  setCellBorders,
  splitTableAt,
  cellContext,
  cellRange,
  cellsIn,
  clearRange,
  fillRange,
  mergeRange,
  setCellFill,
  tableCells,
  tableOp,
  tableSize,
} from '../../../doc/ops/table';
import { askConfirm, askText } from '../../dialog';
import { toast } from '../../toast';
import { h } from '../../dom';
import { Bindings, chips, section, stepper, swatches, tiles } from '../controls';
import type { PanelContext, TabDef } from '../context';

const CELL_COLORS = ['#f1f3f4', '#fce8e6', '#fef7e0', '#e6f4ea', '#e8f0fe', '#f3e8fd', '#fff475', '#cbf0f8'];

export const tableTab: TabDef = {
  id: 'table',
  label: '표',
  visible: (ctx) => !!cellOf(ctx),
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const run = (op: TableOp) => () =>
      ed.command((doc, caret) => {
        const cell = cellContext(doc, caret);
        return cell ? tableOp(doc, cell, op) : undefined;
      });
    const disabled = () => !cellOf(ctx);
    // 여러 칸 고르기: 캐럿 칸에서 아래로 rows줄, 오른쪽으로 cols칸
    let rows = 1;
    let cols = 1;
    let anchorKey = '';
    const range = () => {
      const doc = ed.document;
      const cell = cellOf(ctx);
      if (!doc || !cell) return null;
      const cells = tableCells(doc, cell);
      const r = cellRange(cell, cells, rows, cols);
      return { doc, cell, cells, r, picked: cellsIn(cells, r), size: tableSize(cells) };
    };
    const multi = () => rows > 1 || cols > 1;
    const showRange = () => {
      const x = multi() ? range() : null;
      ed.highlight(x ? x.picked.map((c) => ({ pageIndex: c.pageIndex, x: c.x, y: c.y, width: c.w, height: c.h })) : null);
    };
    const grow = (dr: number, dc: number) => () => {
      const x = range();
      if (!x) return;
      rows = Math.max(1, Math.min(rows + dr, x.size.rows - x.cell.row));
      cols = Math.max(1, Math.min(cols + dc, x.size.cols - x.cell.col));
      showRange();
      b.refresh();
    };
    const resetRange = () => {
      rows = 1;
      cols = 1;
      showRange();
      b.refresh();
    };
    // 칸 크기 한 걸음: 2mm
    const SIZE_STEP = 567;
    const size = (dw: number, dh: number) =>
      ed.command((doc, caret) => {
        const cell = cellContext(doc, caret);
        if (cell) resizeCell(doc, cell, dw, dh);
      });
    const border = (style: CellBorderStyle, outer: boolean) => {
      const x = range();
      if (!x) return;
      ed.command((doc) => setCellBorders(doc, x.cell, multi() ? x.picked : x.picked.filter((c) => c.cellIdx === x.cell.cell), style, outer));
      showRange();
    };
    const quick = (fn: 'SUM' | 'AVG', dir: 'up' | 'left') => {
      const cell = cellOf(ctx);
      return cell ? quickFormula(cell, fn, dir) : null;
    };
    const formula = (f: string | null) => {
      if (!f) return;
      const out: { value?: number | null } = {};
      ed.command((doc, caret) => {
        const cell = cellContext(doc, caret);
        if (cell) out.value = applyFormula(doc, cell, f);
      });
      toast(out.value === null || out.value === undefined ? '계산식을 이해하지 못했어요. 예: =SUM(A1:A3)' : `${f} → ${out.value.toLocaleString('ko-KR')}`);
    };
    const customFormula = async () => {
      const f = await askText('계산식', quick('SUM', 'up') ?? '=SUM(A1:A3)', '계산', {
        message: '쓸 수 있는 함수: SUM(합계), AVG(평균), MIN, MAX, 그리고 + - * / 계산. 예: =A1+B2*3',
      });
      if (f) formula(f);
    };
    const el = h(
      'div.tab-body',
      {},
      section(
        '줄',
        tiles(b, [
          { label: '위에 줄 넣기', icon: 'rowAbove', onClick: run('rowAbove'), disabled },
          { label: '아래에 줄 넣기', icon: 'rowBelow', onClick: run('rowBelow'), disabled },
          { label: '줄 지우기', icon: 'trash', onClick: run('deleteRow'), disabled },
        ]),
      ),
      section(
        '칸',
        tiles(b, [
          { label: '왼쪽에 칸 넣기', icon: 'colLeft', onClick: run('colLeft'), disabled },
          { label: '오른쪽에 칸 넣기', icon: 'colRight', onClick: run('colRight'), disabled },
          { label: '칸 지우기', icon: 'trash', onClick: run('deleteCol'), disabled },
        ]),
      ),
      section(
        '셀',
        tiles(b, [
          { label: '오른쪽 셀과 합치기', icon: 'mergeRight', onClick: run('mergeRight'), disabled },
          { label: '아래 셀과 합치기', icon: 'mergeDown', onClick: run('mergeDown'), disabled },
          { label: '셀 나누기', icon: 'split', onClick: run('split'), disabled: () => {
            const c = cellOf(ctx);
            return !c || (c.rowSpan === 1 && c.colSpan === 1);
          } },
        ]),
      ),
      section(
        '여러 칸 고르기',
        stepper(b, '아래로', () => `${rows}줄`, grow(-1, 0), grow(1, 0)),
        stepper(b, '오른쪽으로', () => `${cols}칸`, grow(0, -1), grow(0, 1)),
        tiles(b, [
          {
            label: '고른 칸 합치기',
            icon: 'mergeRight',
            disabled: () => disabled() || !multi(),
            onClick: () => {
              const x = range();
              if (!x) return;
              ed.command((doc) => mergeRange(doc, x.cell, x.r));
              resetRange();
            },
          },
          {
            label: '고른 칸 글 지우기',
            icon: 'trash',
            disabled: () => disabled() || !multi(),
            onClick: () => {
              const x = range();
              if (!x) return;
              ed.command((doc) => clearRange(doc, x.cell, x.picked));
              showRange();
            },
          },
        ]),
        h('p.panel-note', {}, '캐럿이 있는 칸에서 시작해요. 고른 칸은 파랗게 보이고, 아래 배경색도 고른 칸 모두에 칠해요.'),
      ),
      section(
        '칸 크기',
        stepper(b, '칸 너비', () => '2mm씩', () => size(-SIZE_STEP, 0), () => size(SIZE_STEP, 0)),
        stepper(b, '줄 높이', () => '2mm씩', () => size(0, -SIZE_STEP), () => size(0, SIZE_STEP)),
      ),
      section(
        '테두리',
        chips(
          b,
          CELL_BORDERS.map((bd) => ({
            label: bd.label,
            onClick: () => border(bd.id, false),
          })),
        ),
        chips(b, [
          { label: '바깥 테두리만 굵게', onClick: () => border('thick', true) },
          { label: '바깥 테두리만 가늘게', onClick: () => border('thin', true) },
        ]),
        h('p.panel-note', {}, '위 "여러 칸 고르기"로 범위를 고르면 그 칸들에 함께 적용돼요.'),
      ),
      section(
        '계산식',
        tiles(b, [
          { label: '위 칸 합계', icon: 'calc', disabled: () => !quick('SUM', 'up'), onClick: () => formula(quick('SUM', 'up')) },
          { label: '왼쪽 칸 합계', icon: 'calc', disabled: () => !quick('SUM', 'left'), onClick: () => formula(quick('SUM', 'left')) },
          { label: '위 칸 평균', icon: 'calc', disabled: () => !quick('AVG', 'up'), onClick: () => formula(quick('AVG', 'up')) },
          { label: '계산식 쓰기', icon: 'edit', disabled, onClick: () => void customFormula() },
        ]),
        h('p.panel-note', {}, '결과는 캐럿이 있는 칸에 들어가요. 칸 이름은 A1(첫 칸), B2처럼 써요.'),
      ),
      section(
        '표 나누기·붙이기',
        tiles(b, [
          {
            label: '여기서 표 나누기',
            icon: 'split',
            disabled: () => (cellOf(ctx)?.row ?? 0) === 0,
            onClick: () => ed.command((doc, caret) => {
              const cell = cellContext(doc, caret);
              if (cell && !splitTableAt(doc, cell)) toast('표를 나누지 못했어요.');
            }),
          },
          {
            label: '다음 표와 붙이기',
            icon: 'mergeDown',
            disabled,
            onClick: () => ed.command((doc, caret) => {
              const cell = cellContext(doc, caret);
              if (cell && !joinNextTable(doc, cell)) toast('바로 아래에 붙일 표가 없어요.');
            }),
          },
        ]),
      ),
      section(
        '셀 배경',
        swatches(b, CELL_COLORS, () => undefined, (color) => {
          const x = multi() ? range() : null;
          ed.command((doc, caret) => {
            if (x) {
              fillRange(doc, x.cell, x.picked, color);
              return;
            }
            const cell = cellContext(doc, caret);
            if (cell) setCellFill(doc, cell, color);
          });
          showRange();
        },
        '배경 없음'),
      ),
      h(
        'div.panel-actions',
        {},
        b.button('wide-btn', {
          label: '표 지우기',
          danger: true,
          disabled,
          onClick: async () => {
            const ok = await askConfirm({ title: '표 지우기', message: '이 표와 안의 내용을 모두 지울까요? 실행 취소로 되돌릴 수 있어요.', confirmLabel: '지우기', danger: true });
            if (ok) run('deleteTable')();
          },
        }),
      ),
    );
    return {
      el,
      refresh: () => {
        // 캐럿이 다른 칸으로 가면 고른 범위를 처음부터 다시 잡는다.
        const c = cellOf(ctx);
        const key = c ? `${c.sec}:${c.para}:${c.ctrl}:${c.cell}` : '';
        if (key !== anchorKey) {
          anchorKey = key;
          rows = 1;
          cols = 1;
          showRange();
        }
        b.refresh();
      },
      dispose: () => ed.highlight(null),
    };
  },
};

function cellOf(ctx: PanelContext) {
  const doc = ctx.editor.document;
  return doc ? cellContext(doc, ctx.editor.caretPos) : null;
}
