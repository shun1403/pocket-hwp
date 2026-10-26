import {
  MARGINS,
  PAGE_BORDERS,
  PAGE_NUMBER_STYLES,
  PAPERS,
  type PageNumberStyle,
  columnCount,
  getPageDef,
  marginOf,
  pageBorderFill,
  paperOf,
  setColumns,
  setPageBorder,
  setPageDef,
  setPageFill,
  setPageNumber,
} from '../../../doc/ops/page';
import { openHeaderFooterSheet } from '../../doc-tools';
import { openPageSetupSheet } from '../page-setup-sheet';
import { h } from '../../dom';
import { Bindings, buttonRow, chips, section, swatches } from '../controls';

const PAGE_COLORS = ['#fffdf5', '#fff8e1', '#fce8e6', '#e6f4ea', '#e8f0fe', '#f3e8fd', '#f1f3f4'];
import type { TabDef } from '../context';

export const pageTab: TabDef = {
  id: 'page',
  label: '쪽',
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const sec = () => ed.caretPos?.sec ?? 0;
    const def = () => (ed.document ? getPageDef(ed.document, sec()) : null);
    const page = (patch: Parameters<typeof setPageDef>[2]) => ed.command((doc) => setPageDef(doc, sec(), patch));
    const editHf = (isHeader: boolean) => void openHeaderFooterSheet(ed, { sec: sec(), isHeader, applyTo: 0 });
    const border = () => (ed.document ? pageBorderFill(ed.document, sec()) : { border: null, fill: null });
    let numberAlign: 'left' | 'center' | 'right' = 'center';
    let numberStyle: PageNumberStyle | null = null;
    const putNumber = () => numberStyle && ed.command((doc) => setPageNumber(doc, sec(), numberStyle!, numberAlign));
    const el = h(
      'div.tab-body',
      {},
      section(
        '편집 용지',
        buttonRow(b, [{ label: '편집 용지', content: '여백·크기 자세히 (F7)', onClick: () => openPageSetupSheet(ed) }]),
      ),
      section(
        '용지',
        chips(
          b,
          PAPERS.map((p) => ({
            label: p.label,
            onClick: () => page({ width: p.width, height: p.height }),
            active: () => {
              const d = def();
              return !!d && paperOf(d) === p.id;
            },
          })),
        ),
      ),
      section(
        '방향',
        buttonRow(b, [
          { label: '세로', icon: 'portrait', content: '세로', onClick: () => page({ landscape: false }), active: () => def()?.landscape === false },
          { label: '가로', icon: 'landscape', content: '가로', onClick: () => page({ landscape: true }), active: () => def()?.landscape === true },
        ]),
      ),
      section(
        '여백',
        chips(
          b,
          MARGINS.map((m) => ({
            label: m.label,
            onClick: () => page({ marginLeft: m.side, marginRight: m.side, marginTop: m.top, marginBottom: m.bottom, marginHeader: m.hf, marginFooter: m.hf }),
            active: () => {
              const d = def();
              return !!d && marginOf(d) === m.id;
            },
          })),
        ),
      ),
      section(
        '다단',
        chips(
          b,
          [1, 2, 3].map((n) => ({
            label: `${n}단`,
            onClick: () => ed.command((doc) => setColumns(doc, sec(), n)),
            active: () => !!ed.document && columnCount(ed.document, sec()) === n,
          })),
        ),
      ),
      section(
        '머리말·꼬리말',
        buttonRow(b, [
          { label: '머리말', content: '머리말 고치기', onClick: () => editHf(true) },
          { label: '꼬리말', content: '꼬리말 고치기', onClick: () => editHf(false) },
        ]),
        h('p.panel-note', {}, '문서에서 머리말·꼬리말이나 각주를 눌러도 바로 고칠 수 있어요.'),
      ),
      section(
        '쪽 테두리',
        chips(
          b,
          PAGE_BORDERS.map((p) => ({
            label: p.label,
            active: () => border().border === p.id,
            onClick: () => ed.command((doc) => setPageBorder(doc, sec(), p.id)),
          })),
        ),
      ),
      section(
        '쪽 배경',
        swatches(b, PAGE_COLORS, () => border().fill ?? undefined, (c) => ed.command((doc) => setPageFill(doc, sec(), c)), '배경 없음'),
      ),
      section(
        '쪽 번호',
        chips(
          b,
          PAGE_NUMBER_STYLES.map((s) => ({
            label: `쪽 번호 ${s.label}`,
            content: s.label,
            active: () => numberStyle === s.id,
            onClick: () => {
              numberStyle = s.id;
              putNumber();
            },
          })),
        ),
        buttonRow(
          b,
          (['left', 'center', 'right'] as const).map((a) => ({
            label: { left: '왼쪽', center: '가운데', right: '오른쪽' }[a],
            icon: ({ left: 'alignLeft', center: 'alignCenter', right: 'alignRight' } as const)[a],
            active: () => numberAlign === a,
            onClick: () => {
              numberAlign = a;
              putNumber();
              b.refresh();
            },
          })),
        ),
        h('p.panel-note', {}, '꼬리말에 넣어요. 꼬리말에 있던 글은 쪽 번호로 바뀌어요. 지우려면 꼬리말을 비워 두고 넣으세요.'),
      ),
    );
    return { el, refresh: () => b.refresh() };
  },
};
