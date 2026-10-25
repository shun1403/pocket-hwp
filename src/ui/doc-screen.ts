import { backScope } from '../app/back';
import type { DocumentSession } from '../app/session';
import { Editor, type EditorState } from '../editor/editor';
import { copyText, readText } from '../platform/clipboard';
import { askText } from './dialog';
import { openExportSheet, openInfoSheet, openPagesSheet } from './doc-sheets';
import { h, keepFocus } from './dom';
import { openFormatSheet, openInsertSheet } from './edit-sheets';
import { FormatToolbar } from './format-toolbar';
import { icon } from './icons';
import { openReader } from './reader';
import { SearchBar } from './search-bar';
import { Sheet } from './sheet';
import { toast } from './toast';

/**
 * 문서 화면. 보기 모드(읽기·확대·찾기)와 편집 모드(키보드·서식 도구)를 오간다.
 */
export class DocScreen {
  readonly el: HTMLElement;
  private readonly editor: Editor;
  private readonly toolbar: FormatToolbar;
  private readonly title = h('div.app-title');
  private readonly status = h('div.app-status');
  private readonly appBar: HTMLElement;
  private readonly pill = h('div.page-pill', { 'aria-hidden': 'true' });
  private readonly fab: HTMLButtonElement;
  private readonly menu = h('div.selection-menu', { role: 'menu' });
  private readonly search: SearchBar;
  private pillTimer = 0;
  private editBack: { dismiss: () => void } | null = null;
  private searchBack: { dismiss: () => void } | null = null;
  private state: EditorState | null = null;

  constructor(
    private readonly session: DocumentSession,
    private readonly onExit: () => void,
  ) {
    const body = h('div.doc-body');
    this.editor = new Editor(body, {
      changed: () => {
        session.markDirty();
        this.setStatus('저장 중…');
      },
      state: (s) => this.onState(s),
      toggleChrome: () => this.el.classList.toggle('immersive'),
      selectionMenu: (a) => this.positionMenu(a),
      bottomInset: () => this.bottomInset(),
      shortcut: (k) => {
        if (k === 's') {
          void session.save().then(() => toast('보관함에 저장했어요.'));
          return true;
        }
        if (k === 'f') {
          this.openSearch();
          return true;
        }
        return false;
      },
    });
    session.onSaved = () => this.setStatus('자동 저장됨');
    this.toolbar = new FormatToolbar(this.editor, {
      openFormatSheet: () => openFormatSheet(this.editor),
      openInsertSheet: () => openInsertSheet(this.editor),
      toggleKeyboard: () => (this.editor.input.focused ? this.editor.input.blur() : this.editor.input.focus()),
    });
    this.search = new SearchBar(this.editor, () => this.closeSearch());
    this.appBar = h('header.app-bar.doc-bar');
    this.fab = h('button.fab', { 'aria-label': '편집하기', onclick: () => this.setEditing(true) }, icon('edit'), h('span', {}, '편집'));
    this.el = h('main.screen.doc', {}, this.appBar, this.search.el, body, this.pill, this.fab, this.menu, this.toolbar.el);
    this.search.el.hidden = true;
    this.menu.hidden = true;
    const menuOnScroll = this.editor.view.onScroll;
    this.editor.view.onScroll = () => {
      menuOnScroll?.();
      this.showPill();
    };
    this.renderAppBar();
  }

  /** 화면에 붙인 뒤 호출 (크기를 알아야 쪽 배율을 정할 수 있다) */
  mount(): void {
    this.editor.load(this.session.doc);
    this.title.textContent = this.session.name;
    this.setStatus(this.session.edited ? '앱 보관함에 저장됨' : `${this.session.doc.pageCount()}쪽`);
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  private bottomInset(): number {
    const kb = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb')) || 0;
    return kb + (this.editor.currentMode === 'edit' ? this.toolbar.el.offsetHeight : 0);
  }

  // ───────────── 상단 바 ─────────────

  private renderAppBar(): void {
    const editing = this.editor.currentMode === 'edit';
    const btn = (name: Parameters<typeof icon>[0], label: string, onClick: () => void, disabled = false) =>
      keepFocus(h('button.icon-btn', { 'aria-label': label, title: label, onclick: onClick, disabled }, icon(name)));
    const titleBox = h(
      'button.title-box',
      { onclick: () => void this.rename(), 'aria-label': '문서 이름 바꾸기' },
      this.title,
      this.status,
    );
    if (editing) {
      this.appBar.replaceChildren(
        keepFocus(h('button.done-btn', { onclick: () => this.setEditing(false) }, icon('check', 20), '완료')),
        titleBox,
        btn('undo', '실행 취소', () => this.editor.undo(), !this.state?.canUndo),
        btn('redo', '다시 실행', () => this.editor.redo(), !this.state?.canRedo),
        btn('search', '찾기·바꾸기', () => this.openSearch()),
      );
    } else {
      this.appBar.replaceChildren(
        btn('back', '문서 닫기', () => this.onExit()),
        titleBox,
        btn('search', '찾기', () => this.openSearch()),
        btn('book', '읽기 모드', () => this.openReader()),
        btn('share', '보내기', () => openExportSheet(this.session)),
        btn('more', '더보기', () => this.more()),
      );
    }
  }

  private more(): void {
    const sheet = new Sheet({ title: '더보기' });
    const row = (name: Parameters<typeof icon>[0], label: string, run: () => void) =>
      h('button.sheet-row', { onclick: () => (sheet.close(), run()) }, icon(name), label);
    sheet.body.append(
      row('pages', '쪽 모아 보기', () => openPagesSheet(this.session, this.editor.view)),
      row('zoomFit', '쪽 전체 보기', () => this.editor.view.setZoomFactor(1)),
      row('text', '본문 폭에 맞추기 (글자 크게)', () => this.editor.view.fitBody(window.innerHeight / 2)),
      row('edit', '이름 바꾸기', () => void this.rename()),
      row('info', '문서 정보', () => openInfoSheet(this.session)),
    );
    sheet.open();
  }

  private async rename(): Promise<void> {
    const next = await askText('문서 이름', this.session.name.replace(/\.hwpx?$/i, ''), '바꾸기');
    if (!next) return;
    await this.session.rename(next);
    this.title.textContent = this.session.name;
  }

  // ───────────── 모드 ─────────────

  setEditing(on: boolean): void {
    if (on === (this.editor.currentMode === 'edit')) return;
    this.el.classList.toggle('editing', on);
    this.el.classList.remove('immersive');
    this.editor.setMode(on ? 'edit' : 'view');
    if (on) {
      this.editBack = backScope(() => {
        this.editBack = null;
        this.setEditing(false);
      });
    } else {
      this.editBack?.dismiss();
      this.editBack = null;
      void this.session.save();
    }
    this.renderAppBar();
  }

  private onState(s: EditorState): void {
    const historyChanged = s.canUndo !== this.state?.canUndo || s.canRedo !== this.state?.canRedo;
    this.state = s;
    this.toolbar.update(s);
    if (historyChanged && s.mode === 'edit') this.renderAppBar();
  }

  private openReader(): void {
    openReader(this.session, this.editor.view.currentPage(), (page) => this.editor.view.scrollToPage(page));
  }

  private openSearch(): void {
    if (!this.search.el.hidden) return;
    this.search.el.hidden = false;
    this.appBar.hidden = true;
    this.search.open();
    this.searchBack = backScope(() => {
      this.searchBack = null;
      this.closeSearch();
    });
  }

  private closeSearch(): void {
    this.search.el.hidden = true;
    this.appBar.hidden = false;
    this.searchBack?.dismiss();
    this.searchBack = null;
    if (this.editor.currentMode === 'edit') this.editor.input.focus();
  }

  // ───────────── 쪽 표시·선택 메뉴 ─────────────

  private showPill(): void {
    const total = this.editor.view.pageCount;
    if (total === 0) return;
    this.pill.textContent = `${this.editor.view.currentPage() + 1} / ${total}`;
    this.pill.classList.add('show');
    window.clearTimeout(this.pillTimer);
    this.pillTimer = window.setTimeout(() => this.pill.classList.remove('show'), 1200);
  }

  private positionMenu(anchor: { x: number; top: number; bottom: number } | null): void {
    if (!anchor) {
      this.menu.hidden = true;
      return;
    }
    if (this.menu.hidden || this.menu.dataset.mode !== this.editor.currentMode) this.fillMenu();
    this.menu.hidden = false;
    const w = this.menu.offsetWidth;
    const hgt = this.menu.offsetHeight;
    const x = Math.min(Math.max(anchor.x - w / 2, 8), window.innerWidth - w - 8);
    const above = anchor.top - hgt - 12;
    const y = above > 64 ? above : anchor.bottom + 28;
    this.menu.style.transform = `translate(${x}px, ${y}px)`;
  }

  private fillMenu(): void {
    const editing = this.editor.currentMode === 'edit';
    const item = (label: string, run: () => void | Promise<void>) =>
      keepFocus(h('button', { role: 'menuitem', onclick: () => void run() }, label));
    const copy = async () => {
      const ok = await copyText(this.editor.selectedText());
      toast(ok ? '복사했어요.' : '복사하지 못했어요.');
    };
    const items = [
      editing &&
        item('잘라내기', async () => {
          if (await copyText(this.editor.selectedText())) this.editor.backspace();
        }),
      item('복사', copy),
      editing &&
        item('붙여넣기', async () => {
          const text = await readText();
          if (text) this.editor.insertText(text);
          else toast('붙여 넣을 글이 없어요.');
        }),
      item('모두 선택', () => this.editor.selectAll()),
      editing && item('서식', () => openFormatSheet(this.editor)),
      !editing && item('편집', () => this.setEditing(true)),
    ].filter((x): x is HTMLElement => !!x);
    this.menu.replaceChildren(...items);
    this.menu.dataset.mode = this.editor.currentMode;
  }

  flush(): Promise<void> {
    return this.session.save();
  }

  async close(): Promise<void> {
    this.editBack?.dismiss();
    this.searchBack?.dismiss();
    this.editor.destroy();
    await this.session.close();
    this.el.remove();
  }
}
