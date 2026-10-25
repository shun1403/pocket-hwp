import { h } from '../../dom';
import { Bindings, buttonRow, chips, section, stepper, swatches } from '../controls';
import type { TabDef } from '../context';
import { nextFontSize, ptLabel } from '../font-size';

/** 한글 문서에서 흔히 쓰는 글꼴. 앞쪽 이름은 문서에 기록되고, 화면에는 비슷한 무료 글꼴로 보인다. */
export const FONTS: { name: string; preview: string }[] = [
  { name: '함초롬바탕', preview: "'Noto Serif KR', serif" },
  { name: '함초롬돋움', preview: "Pretendard, 'Noto Sans KR', sans-serif" },
  { name: '맑은 고딕', preview: "Pretendard, 'Noto Sans KR', sans-serif" },
  { name: '바탕', preview: "'Noto Serif KR', serif" },
  { name: '돋움', preview: "Pretendard, sans-serif" },
  { name: '굴림', preview: "Pretendard, sans-serif" },
  { name: '궁서', preview: "'Noto Serif KR', serif" },
  { name: '나눔고딕', preview: "NanumGothic, sans-serif" },
  { name: '나눔명조', preview: "NanumMyeongjo, serif" },
  { name: 'HY헤드라인M', preview: "Pretendard, sans-serif" },
  { name: '휴먼명조', preview: "'Noto Serif KR', serif" },
  { name: 'Pretendard', preview: 'Pretendard, sans-serif' },
];

const TEXT_COLORS = ['#000000', '#5f6368', '#c00000', '#d93025', '#e8710a', '#f9ab00', '#188038', '#0b8043', '#1a73e8', '#174ea6', '#7b1fa2', '#ffffff'];
const HIGHLIGHTS = ['#fff475', '#ccff90', '#a7ffeb', '#cbf0f8', '#aecbfa', '#fdcfe8', '#e6c9a8', '#e8eaed'];
const QUICK_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

function all7(v: number): number[] {
  return Array.from({ length: 7 }, () => v);
}

export const charTab: TabDef = {
  id: 'char',
  label: '글자',
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const char = () => ctx.state().char;
    const toggle = (key: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'superscript' | 'subscript') => () => {
      const on = !char()[key];
      // 위·아래 첨자는 함께 켤 수 없다.
      const extra = key === 'superscript' && on ? { subscript: false } : key === 'subscript' && on ? { superscript: false } : {};
      ed.applyChar({ [key]: on, ...extra });
    };
    const size = () => (char().fontSize ?? 1000) / 100;
    const ratio = () => char().ratios?.[0] ?? 100;
    const spacing = () => char().spacings?.[0] ?? 0;

    const fontList = h(
      'div.font-list',
      {},
      ...FONTS.map((f) => {
        const el = b.button('font-btn', {
          label: f.name,
          content: f.name,
          active: () => char().fontFamily === f.name,
          onClick: () => {
            const id = ed.document?.raw.findOrCreateFontId(f.name) ?? -1;
            if (id >= 0) ed.applyChar({ fontId: id, fontFamily: f.name });
          },
        });
        el.style.fontFamily = f.preview;
        return el;
      }),
    );

    const el = h(
      'div.tab-body',
      {},
      section(
        '꾸밈',
        buttonRow(b, [
          { label: '굵게', content: h('b', {}, '가'), onClick: toggle('bold'), active: () => !!char().bold },
          { label: '기울임', content: h('i', {}, '가'), onClick: toggle('italic'), active: () => !!char().italic },
          { label: '밑줄', content: h('u', {}, '가'), onClick: toggle('underline'), active: () => !!char().underline },
          { label: '취소선', content: h('s', {}, '가'), onClick: toggle('strikethrough'), active: () => !!char().strikethrough },
          { label: '위첨자', content: h('span', {}, '가', h('sup', {}, '2')), onClick: toggle('superscript'), active: () => !!char().superscript },
          { label: '아래첨자', content: h('span', {}, '가', h('sub', {}, '2')), onClick: toggle('subscript'), active: () => !!char().subscript },
        ]),
      ),
      section(
        '크기',
        stepper(b, '글자 크기', () => `${ptLabel(char().fontSize)}pt`, () => ed.applyChar({ fontSize: nextFontSize(size(), -1) * 100 }), () => ed.applyChar({ fontSize: nextFontSize(size(), 1) * 100 })),
        chips(
          b,
          QUICK_SIZES.map((pt) => ({ label: `${pt}`, onClick: () => ed.applyChar({ fontSize: pt * 100 }), active: () => size() === pt })),
        ),
      ),
      section('글자 색', swatches(b, TEXT_COLORS, () => char().textColor, (c) => ed.applyChar({ textColor: c ?? '#000000' }))),
      section('형광펜', swatches(b, HIGHLIGHTS, () => char().shadeColor, (c) => ed.applyChar({ shadeColor: c ?? '#ffffff' }), '형광펜 없음')),
      section('글꼴', fontList),
      section(
        '글자 간격',
        stepper(b, '자간', () => `${spacing()}%`, () => ed.applyChar({ spacings: all7(Math.max(-50, spacing() - 5)) }), () => ed.applyChar({ spacings: all7(Math.min(50, spacing() + 5)) })),
        stepper(b, '장평', () => `${ratio()}%`, () => ed.applyChar({ ratios: all7(Math.max(50, ratio() - 5)) }), () => ed.applyChar({ ratios: all7(Math.min(200, ratio() + 5)) })),
      ),
      h(
        'div.panel-actions',
        {},
        b.button('wide-btn', {
          label: '글자 모양 지우기',
          onClick: () =>
            ed.applyChar({
              bold: false,
              italic: false,
              underline: false,
              strikethrough: false,
              superscript: false,
              subscript: false,
              textColor: '#000000',
              shadeColor: '#ffffff',
              ratios: all7(100),
              spacings: all7(0),
            }),
        }),
      ),
    );
    return { el, refresh: () => b.refresh() };
  },
};
