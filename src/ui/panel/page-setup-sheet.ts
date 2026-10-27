import { BINDINGS, PAPERS, type PageDef, bodySize, getPageDef, mm, pageSetupError, paperOf, setPageDef, toMm } from '../../doc/ops/page';
import type { Editor } from '../../editor/editor';
import { h } from '../dom';
import { Sheet } from '../sheet';
import { toast } from '../toast';

type NumberKey = 'width' | 'height' | 'marginTop' | 'marginHeader' | 'marginLeft' | 'marginGutter' | 'marginBottom' | 'marginFooter' | 'marginRight';

/** 한글 편집 용지(F7)의 여백 칸 차례: 위·머리말 / 왼쪽·제본 / 아래·꼬리말 / 오른쪽 */
const MARGIN_FIELDS: [NumberKey, string][] = [
  ['marginTop', '위쪽'],
  ['marginHeader', '머리말'],
  ['marginLeft', '왼쪽'],
  ['marginGutter', '제본'],
  ['marginBottom', '아래쪽'],
  ['marginFooter', '꼬리말'],
  ['marginRight', '오른쪽'],
];

/**
 * 편집 용지 (한글 F7): 용지 종류·크기, 방향, 제본, 여백 일곱 가지를 mm로 바꾼다.
 * 구역이 여럿이면 지금 구역만 바꿀지 문서 전체를 바꿀지 고른다.
 */
export function openPageSetupSheet(editor: Editor): void {
  const doc = editor.document;
  if (!doc) return;
  const sec = editor.caretPos?.sec ?? 0;
  const draft: PageDef = { ...getPageDef(doc, sec) };
  const sections = doc.raw.getSectionCount();
  let allSections = false;

  const sheet = new Sheet({ title: '편집 용지' });
  const inputs = new Map<NumberKey, HTMLInputElement>();
  const field = (key: NumberKey, label: string) => {
    const input = h('input.text-field.mm-field', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: '0.1',
      'aria-label': `${label} (mm)`,
      value: String(toMm(draft[key])),
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      draft[key] = mm(Number(input.value));
      if (key === 'width' || key === 'height') drawPaper();
      update();
    });
    inputs.set(key, input);
    return h('label.mm-cell', {}, h('span', {}, label), h('span.mm-input', {}, input, h('span.mm-unit', {}, 'mm')));
  };

  const chipGroup = <T>(items: readonly { label: string; value: T }[], current: () => T, pick: (v: T) => void) => {
    const group = h('div.chips', {});
    const draw = () =>
      group.replaceChildren(
        ...items.map((it) =>
          h(
            `button.chip-btn${it.value === current() ? '.on' : ''}` as 'button',
            { type: 'button', 'aria-pressed': String(it.value === current()), onclick: () => (pick(it.value), draw(), update()) },
            it.label,
          ),
        ),
      );
    draw();
    return { el: group, draw };
  };

  const paper = chipGroup(
    [...PAPERS.map((p) => ({ label: p.label, value: p.id as string })), { label: '사용자 정의', value: 'custom' }],
    () => paperOf(draft) ?? 'custom',
    (id) => {
      const p = PAPERS.find((x) => x.id === id);
      if (!p) return;
      draft.width = p.width;
      draft.height = p.height;
      inputs.get('width')!.value = String(toMm(p.width));
      inputs.get('height')!.value = String(toMm(p.height));
    },
  );
  const drawPaper = () => paper.draw();
  const orient = chipGroup(
    [
      { label: '세로', value: false },
      { label: '가로', value: true },
    ],
    () => draft.landscape,
    (v) => (draft.landscape = v),
  );
  const binding = chipGroup(
    BINDINGS.map((b) => ({ label: b.label, value: b.id as number })),
    () => draft.binding,
    (v) => (draft.binding = v),
  );
  const scope = chipGroup(
    [
      { label: '지금 구역', value: false },
      { label: '문서 전체', value: true },
    ],
    () => allSections,
    (v) => (allSections = v),
  );

  const summary = h('p.sheet-note.page-summary', { 'aria-live': 'polite' });
  const apply = h('button.primary-btn', { type: 'button' }, '적용') as HTMLButtonElement;
  const update = () => {
    const err = pageSetupError(draft);
    const body = bodySize(draft);
    summary.classList.toggle('error', !!err);
    summary.textContent = err ?? `글 쓰는 자리: ${toMm(body.width)} × ${toMm(body.height)}mm`;
    apply.disabled = !!err;
  };

  apply.addEventListener('click', () => {
    if (pageSetupError(draft)) return;
    sheet.close();
    const targets = allSections ? Array.from({ length: sections }, (_, i) => i) : [sec];
    const ok = editor.command((d) => {
      // 구역마다 용지만 바꾸고, 그 구역의 다른 값은 그대로 둔다.
      for (const s of targets) setPageDef(d, s, { ...draft });
    });
    toast(ok ? '편집 용지를 바꿨어요.' : '편집 용지를 바꾸지 못했어요.');
  });

  sheet.body.append(
    h('p.field-label', {}, '용지 종류'),
    paper.el,
    h('div.mm-grid', {}, field('width', '폭'), field('height', '길이')),
    h('p.field-label', {}, '용지 방향'),
    orient.el,
    h('p.field-label', {}, '제본'),
    binding.el,
    h('p.panel-note', {}, '맞쪽은 홀수·짝수 쪽의 안쪽 여백이 마주 보게 놓여요. 제본 여백은 아래 "제본" 칸에 넣어요.'),
    h('p.field-label', {}, '용지 여백'),
    h('div.mm-grid', {}, ...MARGIN_FIELDS.map(([k, label]) => field(k, label))),
    ...(sections > 1 ? [h('p.field-label', {}, '적용 범위'), scope.el] : []),
    summary,
    h('div.dialog-actions', {}, h('button.secondary-btn', { type: 'button', onclick: () => sheet.close() }, '취소'), apply),
  );
  update();
  sheet.open();
}
