import { type StyleInfo, applyStyle, createStyleFromPos, paragraphStyles, redefineStyle, renameStyle, styleAt } from '../../../doc/ops/lists';
import { askText } from '../../dialog';
import { toast } from '../../toast';
import { h } from '../../dom';
import { Bindings, buttonRow, section } from '../controls';
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
    const currentStyle = () => styles.find((s) => s.id === current()) ?? null;
    const create = async () => {
      const name = await askText('새 스타일 이름', '', '만들기', { message: '캐럿이 있는 문단의 글자·문단 모양으로 스타일을 만들어요.' });
      if (!name) return;
      if (styles.some((s) => s.name === name)) {
        toast('같은 이름의 스타일이 있어요.');
        return;
      }
      ed.command((doc, caret) => void createStyleFromPos(doc, caret, name));
      ctx.openTab('style');
      toast(`“${name}” 스타일을 만들었어요.`);
    };
    const redefine = () => {
      const s = currentStyle();
      if (!s) return;
      ed.command((doc, caret) => redefineStyle(doc, s.id, caret));
      toast(`“${s.name}” 스타일을 지금 모양으로 바꿨어요. 이 스타일을 쓴 다른 문단에도 적용돼요.`);
    };
    const rename = async () => {
      const s = currentStyle();
      if (!s) return;
      const name = await askText('스타일 이름', s.name, '바꾸기');
      if (!name || name === s.name) return;
      ed.command((doc) => renameStyle(doc, s.id, name));
      ctx.openTab('style');
    };
    const el = h(
      'div.tab-body',
      {},
      section('문단 스타일', styles.length ? list : h('p.panel-note', {}, '이 문서에는 스타일이 없어요.')),
      h('p.panel-note', {}, '개요 1~7을 쓰면 문서 구조(제목 단계)가 생기고 목차로 이동할 수 있어요.'),
      section(
        '스타일 만들기·고치기',
        buttonRow(b, [
          { label: '지금 모양으로 새 스타일 만들기', content: '새 스타일', onClick: () => void create() },
          { label: '고른 스타일을 지금 모양으로 바꾸기', content: '지금 모양으로', disabled: () => !currentStyle(), onClick: redefine },
          { label: '스타일 이름 바꾸기', content: '이름 바꾸기', disabled: () => !currentStyle(), onClick: () => void rename() },
        ]),
      ),
    );
    return { el, refresh: () => b.refresh() };
  },
};
