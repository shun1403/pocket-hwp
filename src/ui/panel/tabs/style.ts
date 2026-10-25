import { type StyleInfo, applyStyle, paragraphStyles, styleAt } from '../../../doc/ops/lists';
import { h } from '../../dom';
import { Bindings, section } from '../controls';
import type { TabDef } from '../context';

/** 스타일 이름별 미리보기 모양 (한글 기본 스타일 이름 기준) */
function previewClass(name: string): string {
  if (/^개요 1/.test(name)) return 'style-h1';
  if (/^개요 [23]/.test(name)) return 'style-h2';
  if (/^개요/.test(name)) return 'style-h3';
  if (/쪽 번호|머리말|각주|미주|메모|캡션/.test(name)) return 'style-small';
  return 'style-body';
}

export const styleTab: TabDef = {
  id: 'style',
  label: '스타일',
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const styles: StyleInfo[] = ed.document ? paragraphStyles(ed.document) : [];
    const current = () => {
      const caret = ed.caretPos;
      return caret && ed.document ? styleAt(ed.document, caret) : null;
    };
    const list = h(
      'div.style-list',
      {},
      ...styles.map((s) =>
        b.button(`style-btn.${previewClass(s.name)}`, {
          label: s.name,
          content: s.name,
          active: () => current() === s.id,
          onClick: () =>
            ed.command((doc, caret, sel) => {
              const [a, z] = sel ?? [caret, caret];
              applyStyle(doc, a, z, s.id);
            }),
        }),
      ),
    );
    const el = h(
      'div.tab-body',
      {},
      section('문단 스타일', styles.length ? list : h('p.panel-note', {}, '이 문서에는 스타일이 없어요.')),
      h('p.panel-note', {}, '개요 1~7을 쓰면 문서 구조(제목 단계)가 생겨요.'),
    );
    return { el, refresh: () => b.refresh() };
  },
};
