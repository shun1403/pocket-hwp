import type { SearchMatch } from '../doc/editable';
import type { Editor } from '../editor/editor';
import { h, keepFocus } from './dom';
import { icon } from './icons';
import { toast } from './toast';

/**
 * 상단 바를 대신하는 찾기 줄. 편집 모드에서는 바꾸기 줄이 함께 열린다.
 */
export class SearchBar {
  readonly el: HTMLElement;
  private readonly query: HTMLInputElement;
  private readonly replacement: HTMLInputElement;
  private readonly count = h('span.search-count', { 'aria-live': 'polite' });
  private readonly replaceRow: HTMLElement;
  private matches: SearchMatch[] = [];
  private index = -1;
  private timer = 0;

  constructor(
    private readonly editor: Editor,
    onClose: () => void,
  ) {
    this.query = h('input.search-input', { type: 'search', placeholder: '문서에서 찾기', enterkeyhint: 'search', 'aria-label': '찾을 말' });
    this.replacement = h('input.search-input', { type: 'text', placeholder: '바꿀 말', 'aria-label': '바꿀 말' });
    this.query.addEventListener('input', () => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.run(), 250);
    });
    this.query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.matches.length === 0) this.run();
        else this.go(e.shiftKey ? -1 : 1);
      }
    });
    const nav = (dir: 1 | -1, label: string, d: string) =>
      keepFocus(h('button.icon-btn', { 'aria-label': label, onclick: () => this.go(dir) }, h('span.chev', {}, d)));
    this.replaceRow = h(
      'div.replace-row',
      {},
      this.replacement,
      h('button.chip', { onclick: () => this.replaceOne() }, '바꾸기'),
      h('button.chip', { onclick: () => this.replaceAll() }, '모두'),
    );
    this.el = h(
      'div.search-bar',
      {},
      h(
        'div.app-bar',
        {},
        h('button.icon-btn', { 'aria-label': '찾기 닫기', onclick: onClose }, icon('back')),
        this.query,
        this.count,
        nav(-1, '이전 찾기', '▲'),
        nav(1, '다음 찾기', '▼'),
      ),
      this.replaceRow,
    );
  }

  open(): void {
    this.replaceRow.hidden = this.editor.currentMode !== 'edit';
    this.query.focus();
    this.query.select();
  }

  private run(): void {
    const doc = this.editor.document;
    const q = this.query.value;
    this.matches = doc && q ? doc.search(q) : [];
    this.index = -1;
    if (this.matches.length === 0) {
      this.count.textContent = q ? '없음' : '';
      this.editor.clearSelection();
      return;
    }
    this.go(1);
  }

  private go(dir: 1 | -1): void {
    if (this.matches.length === 0) return;
    this.index = (this.index + dir + this.matches.length) % this.matches.length;
    const m = this.matches[this.index];
    this.editor.select(m.start, m.end);
    this.count.textContent = `${this.index + 1}/${this.matches.length}`;
  }

  private replaceOne(): void {
    if (this.index < 0 || !this.editor.selection) return;
    if (this.replacement.value) this.editor.insertText(this.replacement.value);
    else this.editor.backspace();
    this.run();
  }

  private replaceAll(): void {
    const n = this.editor.replaceAll(this.query.value, this.replacement.value);
    toast(n > 0 ? `${n}곳을 바꿨어요.` : '바꿀 곳이 없어요.');
    this.run();
  }
}
