import { type TableOp, cellContext, setCellFill, tableOp } from '../../../doc/ops/table';
import { askConfirm } from '../../dialog';
import { h } from '../../dom';
import { Bindings, section, swatches, tiles } from '../controls';
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
        '셀 배경',
        swatches(b, CELL_COLORS, () => undefined, (color) =>
          ed.command((doc, caret) => {
            const cell = cellContext(doc, caret);
            if (cell) setCellFill(doc, cell, color);
          }),
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
    return { el, refresh: () => b.refresh() };
  },
};

function cellOf(ctx: PanelContext) {
  const doc = ctx.editor.document;
  return doc ? cellContext(doc, ctx.editor.caretPos) : null;
}
