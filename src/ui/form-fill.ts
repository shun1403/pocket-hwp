import { backScope } from '../app/back';
import { type FormTarget, formTargets, setTargetValue, targetRange, targetValue } from '../doc/ops/fields';
import { type DocPos, innerPara } from '../doc/position';

const innerParaEqual = (a: DocPos, b: DocPos) => innerPara(a) === innerPara(b);
import type { Editor } from '../editor/editor';
import { h, keepFocus } from './dom';
import { icon } from './icons';
import { toast } from './toast';

/**
 * 서식 채우기: 신청서·공문 양식의 빈칸(누름틀, 없으면 표의 빈 칸)을 차례로 돌며 채운다.
 *
 * 작은 칸을 손가락으로 하나씩 누르는 대신, 큰 입력칸 하나에 쓰고 "다음"으로 넘어간다.
 * 값은 다음/이전으로 넘어가거나 닫을 때 Editor.command()로 넣어서 실행 취소가 된다.
 */
export class FormFill {
  readonly el: HTMLElement;
  private readonly label = h('div.ff-label');
  private readonly counter = h('div.ff-count');
  private readonly input = h('input.ff-input', {
    type: 'text',
    enterkeyhint: 'next',
    autocomplete: 'off',
    'aria-label': '빈칸에 넣을 내용',
  }) as HTMLInputElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private targets: FormTarget[] = [];
  private index = 0;
  private original = '';
  private back: { dismiss: () => void } | null = null;
  /** 열고 닫을 때 (문서 화면이 도구 줄을 숨기고 보인다) */
  onToggle: ((open: boolean) => void) | null = null;

  constructor(private readonly editor: Editor) {
    const btn = (name: Parameters<typeof icon>[0], label: string, onClick: () => void) =>
      keepFocus(h('button.icon-btn', { type: 'button', 'aria-label': label, title: label, onclick: onClick }, icon(name))) as HTMLButtonElement;
    this.prevBtn = btn('back', '이전 빈칸', () => this.go(-1));
    this.nextBtn = btn('forward', '다음 빈칸', () => this.go(1));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (this.index < this.targets.length - 1) this.go(1);
        else this.close();
      }
    });
    this.el = h(
      'div.form-fill',
      { role: 'group', 'aria-label': '서식 채우기' },
      h('div.ff-head', {}, this.label, this.counter, keepFocus(h('button.ff-done', { type: 'button', onclick: () => this.close() }, '완료'))),
      h('div.ff-row', {}, this.prevBtn, this.input, this.nextBtn),
    );
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** 빈칸이 없으면 false */
  open(): boolean {
    const doc = this.editor.document;
    if (!doc) return false;
    this.targets = formTargets(doc);
    if (this.targets.length === 0) {
      toast('채울 빈칸(누름틀이나 표의 빈 칸)을 찾지 못했어요.');
      return false;
    }
    this.el.hidden = false;
    this.back = backScope(() => {
      this.back = null;
      this.close();
    });
    this.onToggle?.(true);
    this.show(0);
    return true;
  }

  close(): void {
    if (!this.isOpen) return;
    this.commit();
    this.editor.highlight(null);
    this.el.hidden = true;
    this.input.blur();
    this.back?.dismiss();
    this.back = null;
    this.onToggle?.(false);
  }

  private go(step: number): void {
    this.commit();
    const next = this.index + step;
    if (next < 0 || next >= this.targets.length) return;
    this.show(next);
  }

  private show(i: number): void {
    const doc = this.editor.document!;
    this.index = i;
    const t = this.targets[i];
    this.original = targetValue(doc, t);
    this.input.value = this.original;
    this.input.placeholder = t.label;
    this.label.textContent = t.label;
    this.counter.textContent = `${i + 1} / ${this.targets.length}`;
    this.prevBtn.disabled = i === 0;
    this.nextBtn.disabled = i === this.targets.length - 1;
    this.input.enterKeyHint = i === this.targets.length - 1 ? 'done' : 'next';
    this.mark(...targetRange(doc, t));
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  /** 입력칸 값이 바뀌었으면 문서에 넣는다. */
  private commit(): void {
    const t = this.targets[this.index];
    const value = this.input.value;
    if (!t || value === this.original) return;
    const filled: { range?: [DocPos, DocPos] } = {};
    this.editor.command((doc) => {
      filled.range = setTargetValue(doc, t, value);
      return filled.range[1];
    });
    this.original = value;
    if (filled.range) this.mark(...filled.range);
  }

  /**
   * 채우는 빈칸을 문서에서 보여 준다. 글을 고르는 대신(복사·붙여넣기 메뉴가 뜨므로) 캐럿만 두고
   * 빈칸 자리를 강조한다. 빈 누름틀은 폭이 없으니 캐럿 오른쪽에 작은 상자를 그린다.
   */
  private mark(start: DocPos, end: DocPos): void {
    const doc = this.editor.document!;
    this.editor.select(start, start);
    const rects = start.offset === end.offset && innerParaEqual(start, end) ? [] : doc.selectionRects(start, end);
    if (rects.length === 0) {
      const c = doc.caretRect(start);
      if (c) rects.push({ pageIndex: c.pageIndex, x: c.x, y: c.y, width: 48, height: c.height });
    }
    this.editor.highlight(rects);
  }
}
