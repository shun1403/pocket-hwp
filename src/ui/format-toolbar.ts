import type { ParaProps } from '../doc/editable';
import type { Editor, EditorState } from '../editor/editor';
import { h, keepFocus } from './dom';
import { type IconName, icon } from './icons';

export interface ToolbarActions {
  openFormatSheet(): void;
  openInsertSheet(): void;
  toggleKeyboard(): void;
}

const ALIGN_ORDER: NonNullable<ParaProps['alignment']>[] = ['justify', 'left', 'center', 'right'];
const ALIGN_ICON: Record<string, IconName> = {
  justify: 'alignJustify',
  left: 'alignLeft',
  center: 'alignCenter',
  right: 'alignRight',
  distribute: 'alignJustify',
  split: 'alignJustify',
};

/** 1pt 단위 글자 크기 단계 (모바일에서 +/− 한 번에 자연스럽게 움직이도록) */
const SIZE_STEPS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 60, 72];

export function nextFontSize(currentPt: number, dir: 1 | -1): number {
  if (dir > 0) return SIZE_STEPS.find((s) => s > currentPt + 0.01) ?? SIZE_STEPS[SIZE_STEPS.length - 1];
  return [...SIZE_STEPS].reverse().find((s) => s < currentPt - 0.01) ?? SIZE_STEPS[0];
}

/**
 * 키보드 바로 위에 붙는 편집 도구 줄.
 * 엄지로 누르기 쉬운 44px 버튼을 가로로 스크롤해 보여 준다. 버튼을 눌러도 키보드는 내려가지 않는다.
 */
export class FormatToolbar {
  readonly el: HTMLElement;
  private readonly buttons: Record<string, HTMLButtonElement> = {};
  private readonly sizeLabel = h('span.size-label', {}, '10');
  private readonly alignIcon = h('span.align-icon');
  private state: EditorState | null = null;

  constructor(editor: Editor, actions: ToolbarActions) {
    const btn = (key: string, label: string, content: Node | string, onClick: () => void, cls = '') => {
      const b = h(`button.tool${cls ? `.${cls}` : ''}` as 'button', { 'aria-label': label, title: label, onclick: onClick }, content);
      keepFocus(b);
      this.buttons[key] = b;
      return b;
    };
    const toggle = (key: 'bold' | 'italic' | 'underline' | 'strikethrough') => () => {
      const cur = this.state?.char[key] ?? false;
      editor.applyChar({ [key]: !cur });
    };
    const fontSize = (dir: 1 | -1) => () => {
      const pt = (this.state?.char.fontSize ?? 1000) / 100;
      editor.applyChar({ fontSize: nextFontSize(pt, dir) * 100 });
    };
    const cycleAlign = () => {
      const cur = this.state?.para.alignment ?? 'justify';
      const i = ALIGN_ORDER.indexOf(cur as (typeof ALIGN_ORDER)[number]);
      editor.applyPara({ alignment: ALIGN_ORDER[(i + 1) % ALIGN_ORDER.length] });
    };

    this.el = h(
      'div.format-toolbar',
      { role: 'toolbar', 'aria-label': '서식 도구' },
      h(
        'div.tool-scroll',
        {},
        btn('keyboard', '키보드 숨기기/보이기', icon('keyboard'), () => actions.toggleKeyboard()),
        h('span.tool-sep'),
        btn('bold', '굵게', h('b', {}, '가'), toggle('bold')),
        btn('italic', '기울임', h('i', {}, '가'), toggle('italic')),
        btn('underline', '밑줄', h('u', {}, '가'), toggle('underline')),
        btn('strikethrough', '취소선', h('s', {}, '가'), toggle('strikethrough')),
        h('span.tool-sep'),
        btn('smaller', '글자 작게', icon('minus', 20), fontSize(-1)),
        this.sizeLabel,
        btn('bigger', '글자 크게', icon('plus', 20), fontSize(1)),
        h('span.tool-sep'),
        btn('align', '문단 정렬', this.alignIcon, cycleAlign),
        btn('format', '글자·문단 모양', h('span.aa', {}, 'Aa'), () => actions.openFormatSheet()),
        btn('insert', '넣기 (표·그림·기호)', icon('plusSquare'), () => actions.openInsertSheet()),
      ),
    );
    this.alignIcon.append(icon('alignJustify'));
  }

  update(state: EditorState): void {
    this.state = state;
    for (const key of ['bold', 'italic', 'underline', 'strikethrough'] as const) {
      const on = !!state.char[key];
      this.buttons[key].classList.toggle('on', on);
      this.buttons[key].setAttribute('aria-pressed', String(on));
    }
    const pt = (state.char.fontSize ?? 1000) / 100;
    this.sizeLabel.textContent = Number.isInteger(pt) ? String(pt) : pt.toFixed(1);
    const align = state.para.alignment ?? 'justify';
    this.alignIcon.replaceChildren(icon(ALIGN_ICON[align] ?? 'alignJustify'));
  }
}
