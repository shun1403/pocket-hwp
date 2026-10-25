import { equationPreview, insertEquation } from '../../doc/ops/inserts';
import type { Editor } from '../../editor/editor';
import { h } from '../dom';
import { Sheet } from '../sheet';

/** 한글 수식 문법 예시 */
const TEMPLATES: [string, string][] = [
  ['분수', '{a} over {b}'],
  ['제곱근', 'sqrt {x}'],
  ['거듭제곱', 'x ^{2}'],
  ['아래첨자', 'a _{n}'],
  ['합', 'sum _{i=1} ^{n} {a _{i}}'],
  ['적분', 'int _{a} ^{b} {f(x)dx}'],
  ['극한', 'lim _{x -> 0} {f(x)}'],
  ['근의 공식', 'x = {-b +- sqrt {b ^{2} - 4ac}} over {2a}'],
  ['행렬', 'pmatrix {a & b # c & d}'],
  ['그리스 문자', 'alpha beta gamma pi theta'],
];

/**
 * 수식 넣기·고치기: 한글 수식 문법을 쓰면 바로 미리 보여 준다.
 * edit 를 주면 기존 수식을 고친다.
 */
export function openEquationSheet(editor: Editor, edit?: { script: string; apply: (script: string) => void }): void {
  const doc = editor.document;
  if (!doc) return;
  let url = '';
  const title = edit ? '수식 고치기' : '수식 넣기';
  const sheet = new Sheet({ title, onClose: () => url && URL.revokeObjectURL(url) });
  const input = h('textarea.equation-input', { rows: 3, 'aria-label': '수식', placeholder: '예: {a} over {b}', spellcheck: 'false', autocapitalize: 'off' });
  const preview = h('div.equation-preview', { 'aria-live': 'polite' });
  // 엔진이 만든 SVG는 그림(img)으로 보여 준다 — 스크립트가 실행될 여지가 없다.
  const render = () => {
    const svg = input.value.trim() ? equationPreview(doc, input.value) : '';
    if (url) URL.revokeObjectURL(url);
    url = svg ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) : '';
    preview.replaceChildren(url ? h('img', { src: url, alt: '수식 미리보기' }) : h('span.muted', {}, '수식을 입력하면 여기에 보여요'));
  };
  input.addEventListener('input', render);
  sheet.body.append(
    preview,
    input,
    h(
      'div.chips',
      {},
      ...TEMPLATES.map(([label, script]) =>
        h('button.chip-btn', { type: 'button', onclick: () => ((input.value = script), render(), input.focus()) }, label),
      ),
    ),
    h(
      'button.primary-btn',
      {
        onclick: () => {
          const script = input.value.trim();
          if (!script) return;
          sheet.close();
          if (edit) edit.apply(script);
          else editor.command((d, caret) => insertEquation(d, caret, script));
        },
      },
      title,
    ),
  );
  input.value = edit?.script ?? '';
  render();
  sheet.open();
}
