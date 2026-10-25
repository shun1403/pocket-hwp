import { MARGINS, PAGE_NUMBER_STYLES, PAPERS, type PageNumberStyle, columnCount, getPageDef, headerFooterText, marginOf, paperOf, setColumns, setHeaderFooterText, setPageDef, setPageNumber } from '../../../doc/ops/page';
import { askText } from '../../dialog';
import { h } from '../../dom';
import { Bindings, buttonRow, chips, section } from '../controls';
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
    const editHf = async (isHeader: boolean) => {
      const doc = ed.document;
      if (!doc) return;
      const name = isHeader ? '머리말' : '꼬리말';
      const text = await askText(`${name} (모든 쪽 가운데)`, headerFooterText(doc, sec(), isHeader), '넣기');
      if (text === null) return;
      ed.command((d) => setHeaderFooterText(d, sec(), isHeader, text, 'center'));
    };
    let numberAlign: 'left' | 'center' | 'right' = 'center';
    let numberStyle: PageNumberStyle | null = null;
    const putNumber = () => numberStyle && ed.command((doc) => setPageNumber(doc, sec(), numberStyle!, numberAlign));
    const el = h(
      'div.tab-body',
      {},
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
          { label: '머리말', content: '머리말 쓰기', onClick: () => void editHf(true) },
          { label: '꼬리말', content: '꼬리말 쓰기', onClick: () => void editHf(false) },
        ]),
        h('p.panel-note', {}, '비워 두고 넣으면 지워져요.'),
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
