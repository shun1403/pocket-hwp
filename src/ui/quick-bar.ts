import type { EditableDocument } from '../doc/editable';
import { bulletId } from '../doc/ops/lists';
import { cellContext } from '../doc/ops/table';
import type { Editor, EditorState } from '../editor/editor';
import { h, keepFocus } from './dom';
import { type IconName, icon } from './icons';
import { nextFontSize, ptLabel } from './panel/font-size';

export interface QuickBarActions {
  openPanel(tab: string): void;
  /** 키보드 ↔ 도구 패널 */
  toggleKeyboard(): void;
  panelTab(): string | null;
}

const ALIGN_ORDER = ['justify', 'left', 'center', 'right'] as const;
const ALIGN_ICON: Record<string, IconName> = {
  justify: 'alignJustify',
  left: 'alignLeft',
  center: 'alignCenter',
  right: 'alignRight',
  distribute: 'alignDistribute',
  split: 'alignJustify',
};

/**
 * 키보드(또는 도구 패널) 바로 위의 한 줄. 가장 자주 쓰는 것만 둔다:
 * 서식·입력 패널 열기, 굵게·기울임·밑줄, 글자 크기, 정렬, 글머리표, 키보드 내리기.
 */
export class QuickBar {
  readonly el: HTMLElement;
  private state: EditorState | null = null;
  private readonly toggles: Record<string, HTMLButtonElement> = {};
  private readonly size = h('span.qb-size', {}, '10');
  private readonly alignBtn: HTMLButtonElement;
  private readonly tableBtn: HTMLButtonElement;
  private readonly panelBtns: Record<string, HTMLButtonElement> = {};
  private readonly kbBtn: HTMLButtonElement;

  constructor(
    private readonly editor: Editor,
    private readonly actions: QuickBarActions,
  ) {
    const btn = (cls: string, label: string, content: (Node | string)[], onClick: () => void) =>
      keepFocus(h(`button.${cls}` as 'button', { type: 'button', 'aria-label': label, title: label, onclick: onClick }, ...content)) as HTMLButtonElement;
    const labeled = (id: string, iconName: IconName, label: string) => {
      const b = btn('qb.qb-labeled', `${label} 도구`, [icon(iconName, 22), h('span', {}, label)], () => actions.openPanel(id));
      this.panelBtns[id] = b;
      return b;
    };
    const toggle = (key: 'bold' | 'italic' | 'underline', label: string, glyph: Node) => {
      const b = btn('qb', label, [glyph], () => editor.applyChar({ [key]: !this.state?.char[key] }));
      this.toggles[key] = b;
      return b;
    };
    const fontSize = (dir: 1 | -1) => () => {
      const pt = (this.state?.char.fontSize ?? 1000) / 100;
      editor.applyChar({ fontSize: nextFontSize(pt, dir) * 100 });
    };
    this.alignBtn = btn('qb', '정렬 바꾸기', [icon('alignJustify')], () => {
      const cur = this.state?.para.alignment ?? 'justify';
      const i = ALIGN_ORDER.indexOf(cur as (typeof ALIGN_ORDER)[number]);
      editor.applyPara({ alignment: ALIGN_ORDER[(i + 1) % ALIGN_ORDER.length] });
    });
    const bullet = btn('qb', '글머리표 켜기/끄기', [h('span.qb-glyph', {}, '•≡')], () => {
      const doc = editor.document;
      if (!doc) return;
      if (this.state?.para.headType === 'Bullet') editor.applyPara({ headType: 'None' });
      else editor.applyPara({ headType: 'Bullet', numberingId: bulletId(doc, '●'), paraLevel: 0 });
    });
    this.toggles.bullet = bullet;
    this.tableBtn = labeled('table', 'table', '표');
    this.kbBtn = btn('qb.qb-kb', '키보드 내리기', [icon('keyboard')], () => actions.toggleKeyboard());

    this.el = h(
      'div.quick-bar',
      { role: 'toolbar', 'aria-label': '빠른 서식' },
      h(
        'div.qb-scroll',
        {},
        labeled('char', 'format', '서식'),
        labeled('insert', 'plusSquare', '입력'),
        this.tableBtn,
        h('span.qb-sep'),
        toggle('bold', '굵게', h('b', {}, '가')),
        toggle('italic', '기울임', h('i', {}, '가')),
        toggle('underline', '밑줄', h('u', {}, '가')),
        h('span.qb-sep'),
        btn('qb', '글자 작게', [icon('minus', 18)], fontSize(-1)),
        this.size,
        btn('qb', '글자 크게', [icon('plus', 18)], fontSize(1)),
        h('span.qb-sep'),
        this.alignBtn,
        bullet,
      ),
      this.kbBtn,
    );
  }

  update(state: EditorState, doc: EditableDocument | null): void {
    this.state = state;
    for (const key of ['bold', 'italic', 'underline'] as const) {
      const on = !!state.char[key];
      this.toggles[key].classList.toggle('on', on);
      this.toggles[key].setAttribute('aria-pressed', String(on));
    }
    const bulletOn = state.para.headType === 'Bullet';
    this.toggles.bullet.classList.toggle('on', bulletOn);
    this.toggles.bullet.setAttribute('aria-pressed', String(bulletOn));
    this.size.textContent = ptLabel(state.char.fontSize);
    this.alignBtn.replaceChildren(icon(ALIGN_ICON[state.para.alignment ?? 'justify'] ?? 'alignJustify'));
    this.tableBtn.hidden = !(doc && cellContext(doc, this.editor.caretPos));
    this.syncPanel();
  }

  /** 패널이 열렸는지·어느 탭인지에 맞춰 버튼 모양을 바꾼다. */
  syncPanel(): void {
    const tab = this.actions.panelTab();
    for (const [id, b] of Object.entries(this.panelBtns)) b.classList.toggle('on', tab === id || (id === 'char' && !!tab && !['insert', 'table'].includes(tab)));
    const panelOpen = tab !== null;
    this.kbBtn.setAttribute('aria-label', panelOpen ? '키보드 열기' : '키보드 내리기');
    this.kbBtn.title = this.kbBtn.getAttribute('aria-label')!;
    this.kbBtn.classList.toggle('show-kb', panelOpen);
  }
}
