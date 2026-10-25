import type { Editor } from '../../editor/editor';
import { h } from '../dom';
import { icon } from '../icons';
import { Sheet } from '../sheet';
import { toast } from '../toast';

/** 표 크기를 고르는 시트: 칸을 눌러 크기를 정하거나 +/−로 조절한다. */
export function openTableSheet(editor: Editor): void {
  const sheet = new Sheet({ title: '표 넣기' });
  let rows = 3;
  let cols = 3;
  const label = h('span.table-size');
  const grid = h('div.table-grid', { role: 'grid', 'aria-label': '표 크기' });
  const MAX = 8;
  const draw = () => {
    label.textContent = `${rows}줄 × ${cols}칸`;
    grid.replaceChildren(
      ...Array.from({ length: MAX * MAX }, (_, i) => {
        const r = Math.floor(i / MAX) + 1;
        const c = (i % MAX) + 1;
        return h('button.grid-cell', {
          type: 'button',
          class: r <= rows && c <= cols ? 'on' : '',
          'aria-label': `${r}줄 ${c}칸`,
          onclick: () => {
            rows = r;
            cols = c;
            draw();
          },
        });
      }),
    );
  };
  const step = (name: string, get: () => number, set: (v: number) => void) =>
    h(
      'div.stepper-row',
      {},
      h('span.stepper-label', {}, name),
      h('button.round', { type: 'button', 'aria-label': `${name} 줄이기`, onclick: () => (set(Math.max(1, get() - 1)), draw()) }, icon('minus', 20)),
      h('button.round', { type: 'button', 'aria-label': `${name} 늘리기`, onclick: () => (set(Math.min(30, get() + 1)), draw()) }, icon('plus', 20)),
    );
  draw();
  sheet.body.append(
    grid,
    h('div.table-controls', {}, label, step('줄', () => rows, (v) => (rows = v)), step('칸', () => cols, (v) => (cols = v))),
    h(
      'button.primary-btn',
      {
        onclick: () => {
          sheet.close();
          if (!editor.insertTable(rows, cols)) toast('표는 표 밖 본문에만 넣을 수 있어요.');
        },
      },
      icon('table', 20),
      '표 넣기',
    ),
  );
  sheet.open();
}
