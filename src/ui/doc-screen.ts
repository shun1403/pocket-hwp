import { backScope } from '../app/back';
import type { DocumentSession } from '../app/session';
import { Editor, type EditorState } from '../editor/editor';
import { fillClipboard } from '../editor/text-input';
import { copyText, readHtml, readText } from '../platform/clipboard';
import { isNative } from '../platform/files';
import { askText } from './dialog';
import { openExportSheet, openInfoSheet, openPagesSheet, printWithProgress, saveToOriginal } from './doc-sheets';
import { fieldCount } from '../doc/ops/fields';
import { documentStats } from '../doc/ops/inserts';
import { FormFill } from './form-fill';
import { type VersionActions, openVersionsSheet } from './versions-sheet';
import {
  addMemoAtCaret,
  openBookmarksSheet,
  openChartSheet,
  openHeaderFooterSheet,
  openLinkSheet,
  openMemoById,
  openMemosSheet,
  openNoteSheet,
  openOutlineSheet,
  openShapeSheet,
} from './doc-tools';
import { openPageSetupSheet } from './panel/page-setup-sheet';
import { maybeShowEditTips, openTips } from './tips';
import { h, keepFocus } from './dom';
import { icon } from './icons';
import { COPYABLE, type PageObject, deleteObject, equationScript, isImageInline, scaleObject, setEquationScript, setImageInline } from '../doc/ops/objects';
import { openEquationSheet } from './panel/equation-sheet';
import { ToolPanel } from './panel/tool-panel';
import { QuickBar } from './quick-bar';
import { openReader } from './reader';
import { SearchBar } from './search-bar';
import { type ShortcutActions, openShortcutsSheet, runShortcut } from './shortcuts';
import { Sheet } from './sheet';
import { openAutofill } from './autofill-sheet';
import { openDatesSheet } from './dates-sheet';
import { toast } from './toast';

/** 한 번 키보드 높이를 못 잰 환경이면 다음부터는 기다리지 않고 바로 위에 붙인다. */
let keyboardUnmeasurable = false;

/**
 * 문서 화면. 보기 모드(읽기·확대·찾기)와 편집 모드(키보드·서식 도구)를 오간다.
 */
export class DocScreen {
  readonly el: HTMLElement;
  private readonly editor: Editor;
  private readonly quickBar: QuickBar;
  private readonly panel: ToolPanel;
  private readonly title = h('div.app-title');
  private readonly status = h('div.app-status');
  private readonly appBar: HTMLElement;
  private readonly pill = h('div.page-pill', { 'aria-hidden': 'true' });
  private readonly viewBar: HTMLElement;
  private readonly menu = h('div.selection-menu', { role: 'menu' });
  private readonly search: SearchBar;
  private readonly formFill: FormFill;
  private readonly fillChip = h('button.fill-chip', { type: 'button' });
  private pillTimer = 0;
  private editBack: { dismiss: () => void } | null = null;
  private searchBack: { dismiss: () => void } | null = null;
  private state: EditorState | null = null;
  private baseStatus = '';
  private dockTimer = 0;
  private readonly keys: ShortcutActions;

  constructor(
    private readonly session: DocumentSession,
    private readonly onExit: () => void,
    private readonly versionActions: VersionActions,
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
      objectSelected: (obj, anchor) => this.showObjectMenu(obj, anchor),
      special: (hit) => {
        if (hit.kind === 'headerFooter') void openHeaderFooterSheet(this.editor, hit.target);
        else void openNoteSheet(this.editor, hit.target);
      },
      link: (pos, link) => openLinkSheet(this.editor, pos, link),
      memo: (id) => void openMemoById(this.editor, id),
      shortcut: (name) => runShortcut(name, this.keys),
    });
    this.keys = {
      editor: this.editor,
      save: () => {
        if (session.sourceName) void saveToOriginal(session);
        else void session.save().then(() => toast('보관함에 저장했어요.'));
      },
      search: () => this.openSearch(),
      print: () => void printWithProgress(session),
      pageSetup: () => {
        if (this.editor.currentMode !== 'edit') this.setEditing(true, false);
        openPageSetupSheet(this.editor);
      },
      panel: (tab) => this.openPanel(tab),
      help: () => openShortcutsSheet(),
    };
    document.addEventListener('keydown', this.onDocKey);
    document.addEventListener('copy', this.onDocCopy);
    document.addEventListener('cut', this.onDocCut);
    document.addEventListener('paste', this.onDocPaste);
    session.onSaved = () => {
      // 메모를 넣으면 HWPX로 저장되며 이름 끝(.hwp → .hwpx)이 바뀔 수 있다.
      this.title.textContent = session.name;
      this.setStatus('자동 저장됨');
    };
    this.panel = new ToolPanel({
      editor: this.editor,
      session,
      state: () => this.state!,
      openSearch: () => this.openSearch(),
      openReader: () => this.openReader(),
      openPages: () => openPagesSheet(this.session, this.editor.view),
      openInfo: () => openInfoSheet(this.session),
      openTab: (id) => this.panel.open(id),
      openFormFill: () => this.openFormFill(),
    });
    this.panel.onToggle = (open) => {
      this.el.classList.toggle('panel-open', open);
      this.editor.keyboardSuppressed = open;
      this.quickBar.syncPanel();
      // 패널 높이만큼 문서가 가려지므로 캐럿이 보이게 다시 맞춘다.
      requestAnimationFrame(() => this.editor.revealCaret());
    };
    this.panel.onTabChange = () => this.quickBar.syncPanel();
    this.quickBar = new QuickBar(this.editor, {
      openPanel: (tab) => this.openPanel(tab),
      toggleKeyboard: () => {
        if (this.panel.isOpen) this.showKeyboard();
        else if (this.editor.input.focused) this.editor.input.blur();
        else this.editor.input.focus();
      },
      panelTab: () => this.panel.activeTab,
    });
    this.formFill = new FormFill(this.editor);
    this.formFill.onToggle = (open) => {
      this.el.classList.toggle('filling', open);
      this.fillChip.hidden = true;
      if (!open) requestAnimationFrame(() => this.editor.revealCaret());
    };
    this.formFill.el.addEventListener('focusin', () => this.watchKeyboard());
    this.fillChip.addEventListener('click', () => this.openFormFill());
    this.fillChip.hidden = true;
    // 글을 쓰려고 입력칸에 포커스가 가면(문서를 탭하면) 도구 패널과 서식 채우기를 닫는다.
    this.editor.input.el.addEventListener('focus', () => {
      this.panel.close();
      this.formFill.close();
      this.watchKeyboard();
    });
    this.editor.input.el.addEventListener('blur', () => {
      window.clearTimeout(this.dockTimer);
      if (!this.formFill.isOpen) this.setDockTop(false);
    });
    this.search = new SearchBar(this.editor, () => this.closeSearch());
    this.appBar = h('header.app-bar.doc-bar');
    const viewBtn = (name: Parameters<typeof icon>[0], label: string, aria: string, onClick: () => void) =>
      h('button.vb', { type: 'button', 'aria-label': aria, onclick: onClick }, icon(name, 22), h('span', {}, label));
    this.viewBar = h(
      'nav.view-bar',
      { 'aria-label': '문서 도구' },
      viewBtn('search', '찾기', '찾기', () => this.openSearch()),
      viewBtn('book', '읽기 모드', '읽기 모드', () => this.openReader()),
      viewBtn('pages', '쪽', '쪽 모아 보기', () => openPagesSheet(this.session, this.editor.view)),
      viewBtn('share', '보내기', '보내기', () => openExportSheet(this.session, this.editor.view.currentPage())),
      h('button.edit-btn', { type: 'button', 'aria-label': '편집하기', onclick: () => this.setEditing(true) }, icon('edit', 20), h('span', {}, '편집')),
    );
    this.el = h(
      'main.screen.doc',
      {},
      this.appBar,
      this.search.el,
      body,
      this.pill,
      this.fillChip,
      this.viewBar,
      this.menu,
      h('div.edit-dock', {}, this.formFill.el, this.quickBar.el, this.panel.el),
    );
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
    // 누름틀이 있는 양식이면 바로 채울 수 있게 권한다.
    const fields = fieldCount(this.session.doc);
    if (fields > 0) {
      this.fillChip.replaceChildren(icon('form', 20), `빈칸 ${fields}개 채우기`);
      this.fillChip.hidden = false;
    }
  }

  /** 서식 채우기를 연다 (편집 모드로 바뀐다). */
  openFormFill(): void {
    if (this.editor.currentMode !== 'edit') this.setEditing(true, false);
    this.panel.close();
    this.formFill.open();
  }

  private setStatus(text: string): void {
    this.baseStatus = text;
    this.renderStatus();
  }

  /** 글을 고르면 제목 아래 상태 줄에 고른 글자 수를 보여 준다 (자기소개서 등). */
  private renderStatus(): void {
    const text = this.state?.hasSelection ? this.editor.selectedText() : '';
    if (!text) {
      this.status.textContent = this.baseStatus;
      return;
    }
    const s = documentStats(text, 0);
    this.status.textContent = `고른 글 ${s.chars.toLocaleString('ko-KR')}자 · 공백 빼고 ${s.charsNoSpace.toLocaleString('ko-KR')}자`;
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
        this.session.sourceName
          ? btn('save', `원래 파일(${this.session.sourceName})에 저장`, () => void saveToOriginal(this.session))
          : btn('search', '찾기·바꾸기', () => this.openSearch()),
      );
    } else {
      this.appBar.replaceChildren(btn('back', '문서 닫기', () => this.onExit()), titleBox, btn('more', '더보기', () => this.more()));
    }
  }

  private more(): void {
    const sheet = new Sheet({ title: '더보기' });
    const row = (name: Parameters<typeof icon>[0], label: string, run: () => void) =>
      h('button.sheet-row', { onclick: () => (sheet.close(), run()) }, icon(name), label);
    sheet.body.append(
      row('form', '서식 채우기 (빈칸 차례로 채우기)', () => this.openFormFill()),
      row('person', '내 정보로 채우기 (이름·연락처·주소)', () => {
        if (this.editor.currentMode !== 'edit') this.setEditing(true, false);
        void openAutofill(this.editor);
      }),
      row('list', '목차 (제목으로 이동)', () => openOutlineSheet(this.editor)),
      row('bookmark', '책갈피', () => openBookmarksSheet(this.editor)),
      row('memo', '메모', () => void openMemosSheet(this.editor)),
      row('calendar', '일정 꺼내기 (캘린더에 넣기)', () => openDatesSheet(this.session)),
      row('pages', '쪽 모아 보기', () => openPagesSheet(this.session, this.editor.view)),
      row('zoomFit', '쪽 전체 보기', () => this.editor.view.setZoomFactor(1)),
      row('text', '본문 폭에 맞추기 (글자 크게)', () => this.editor.view.fitBody(window.innerHeight / 2)),
      row('edit', '이름 바꾸기', () => void this.rename()),
      row('clock', '버전 기록 (예전 내용으로 되돌리기)', () => void openVersionsSheet(this.session, this.versionActions)),
      row('info', '문서 정보', () => openInfoSheet(this.session)),
      row('sparkles', '사용법', () => openTips()),
      row('keyboard', '단축키 (키보드 연결 시)', () => openShortcutsSheet()),
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

  setEditing(on: boolean, showTips = true): void {
    if (on === (this.editor.currentMode === 'edit')) return;
    this.el.classList.toggle('editing', on);
    this.el.classList.remove('immersive');
    this.editor.setMode(on ? 'edit' : 'view');
    // 편집할 때는 글자가 읽히는 크기(본문 폭 맞춤)로 키운다.
    if (on && this.editor.view.zoomFactorValue < 1.05) this.editor.fitBodyAtCaret();
    if (on) {
      this.editBack = backScope(() => {
        this.editBack = null;
        this.setEditing(false);
      });
      // 처음 편집할 때 한 번 사용법을 보여 준다 (키보드는 안내를 닫은 뒤 문서를 누르면 올라온다).
      if (showTips && maybeShowEditTips()) this.editor.input.blur();
    } else {
      this.panel.close();
      this.formFill.close();
      this.editBack?.dismiss();
      this.editBack = null;
      void this.session.save();
    }
    this.renderAppBar();
  }

  /**
   * 키보드가 올라왔는데 화면이 줄지 않으면(앱 안 미리보기 창처럼 키보드 높이를 알 수 없는 곳)
   * 아래쪽 편집 도구가 키보드에 가려진다. 그때는 도구 줄을 화면 위로 옮긴다.
   */
  private watchKeyboard(): void {
    window.clearTimeout(this.dockTimer);
    if (isNative || !matchMedia('(pointer: coarse)').matches) return;
    if (keyboardUnmeasurable) this.setDockTop(true);
    // 키보드가 다 올라온 뒤 화면이 줄었는지 본다.
    this.dockTimer = window.setTimeout(() => {
      if (!this.editor.input.focused && !this.formFill.el.contains(document.activeElement)) return;
      keyboardUnmeasurable = !document.documentElement.classList.contains('kb-open');
      this.setDockTop(keyboardUnmeasurable);
    }, 500);
  }

  private setDockTop(on: boolean): void {
    if (this.el.classList.contains('dock-top') === on) return;
    this.el.classList.toggle('dock-top', on);
    requestAnimationFrame(() => this.editor.revealCaret());
  }

  /** 도구 패널을 연다 (키보드는 내린다). 같은 탭을 다시 누르면 키보드로 돌아간다. */
  openPanel(tab: string): void {
    if (this.panel.activeTab === tab) {
      this.showKeyboard();
      return;
    }
    if (this.editor.currentMode !== 'edit') this.setEditing(true);
    this.editor.input.blur();
    this.panel.open(tab);
  }

  private showKeyboard(): void {
    this.panel.close();
    this.editor.input.focus();
  }

  private onState(s: EditorState): void {
    const historyChanged = s.canUndo !== this.state?.canUndo || s.canRedo !== this.state?.canRedo;
    this.state = s;
    this.renderStatus();
    this.quickBar.update(s, this.editor.document);
    this.panel.refresh();
    if (historyChanged && s.mode === 'edit') this.renderAppBar();
  }

  private openReader(): void {
    openReader(this.session, this.editor.view.currentPage(), (page) => this.editor.view.scrollToPage(page));
  }

  /** 문서 안에서 text 를 찾아 첫 곳을 보여 준다 (보관함 본문 검색으로 열었을 때). */
  find(text: string): void {
    this.openSearch(text);
  }

  private openSearch(text?: string): void {
    if (!this.search.el.hidden) return;
    this.search.el.hidden = false;
    this.appBar.hidden = true;
    this.search.open(text);
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
      if (this.menu.dataset.mode !== 'object') this.menu.hidden = true;
      return;
    }
    if (this.menu.hidden || this.menu.dataset.mode !== this.editor.currentMode) this.fillMenu();
    this.menu.hidden = false;
    this.placeMenu({ ...anchor, bottom: anchor.bottom + 16 });
  }

  /** 고른 그림·수식·글상자 위에 띄우는 메뉴 */
  private showObjectMenu(obj: PageObject | null, anchor: { x: number; top: number; bottom: number } | null): void {
    if (!obj || !anchor) {
      if (this.menu.dataset.mode === 'object') this.menu.hidden = true;
      return;
    }
    const key = `object:${obj.kind}:${obj.para}:${obj.ctrl}`;
    if (this.menu.hidden || this.menu.dataset.mode !== 'object' || this.menu.dataset.key !== key) {
      const ed = this.editor;
      const item = (label: string, run: () => void) => keepFocus(h('button', { role: 'menuitem', onclick: run }, label));
      const items: HTMLElement[] = [];
      if (COPYABLE.includes(obj.kind)) {
        const copy = async (cut: boolean) => {
          const data = cut ? ed.cutClipboard() : ed.clipboardData();
          const ok = !!data && (await copyText(data.text));
          toast(ok ? (cut ? '잘라냈어요. 붙여넣기로 다른 곳에 넣어요.' : '복사했어요.') : '복사하지 못했어요.');
        };
        items.push(item('잘라내기', () => void copy(true)), item('복사', () => void copy(false)));
      }
      if (obj.kind === 'table') {
        items.push(
          item('표 도구', () => {
            ed.clearObject();
            this.openPanel('table');
          }),
        );
      }
      if (obj.kind !== 'equation' && obj.kind !== 'chart' && obj.kind !== 'table') {
        items.push(item('크게', () => ed.objectCommand((doc, o) => scaleObject(doc, o, 1.2))));
        items.push(item('작게', () => ed.objectCommand((doc, o) => scaleObject(doc, o, 1 / 1.2))));
      }
      if (obj.kind === 'shape' || obj.kind === 'line' || obj.kind === 'group') {
        items.push(
          item('모양', () => {
            ed.clearObject();
            openShapeSheet(ed, obj);
          }),
        );
      }
      if (obj.kind === 'chart') {
        items.push(
          item('차트 값 고치기', () => {
            ed.clearObject();
            openChartSheet(ed, obj);
          }),
        );
      }
      if (obj.kind === 'image' && ed.document) {
        const inline = isImageInline(ed.document, obj);
        items.push(item(inline ? '글 둘레로 배치' : '글자처럼 배치', () => ed.objectCommand((doc, o) => setImageInline(doc, o, !inline))));
      }
      if (obj.kind === 'equation' && ed.document) {
        const script = equationScript(ed.document, obj);
        items.push(
          item('수식 고치기', () => {
            ed.clearObject();
            openEquationSheet(ed, { script, apply: (next) => ed.command((doc) => setEquationScript(doc, obj, next)) });
          }),
        );
      }
      items.push(item('삭제', () => ed.objectCommand((doc, o) => deleteObject(doc, o))));
      this.menu.replaceChildren(...items);
      this.menu.dataset.mode = 'object';
      this.menu.dataset.key = key;
    }
    this.menu.hidden = false;
    this.placeMenu(anchor);
  }

  private placeMenu(anchor: { x: number; top: number; bottom: number }): void {
    const w = this.menu.offsetWidth;
    const hgt = this.menu.offsetHeight;
    const x = Math.min(Math.max(anchor.x - w / 2, 8), window.innerWidth - w - 8);
    const above = anchor.top - hgt - 12;
    const y = above > 64 ? above : anchor.bottom + 12;
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
          const [text, html] = await Promise.all([readText(), readHtml()]);
          if (text || html) this.editor.paste(text ?? '', html);
          else toast('붙여 넣을 글이 없어요.');
        }),
      item('모두 선택', () => this.editor.selectAll()),
      editing && item('메모', () => addMemoAtCaret(this.editor)),
      editing && item('서식', () => this.openPanel('char')),
      !editing && item('편집', () => this.setEditing(true)),
    ].filter((x): x is HTMLElement => !!x);
    this.menu.replaceChildren(...items);
    this.menu.dataset.mode = this.editor.currentMode;
  }

  flush(): Promise<void> {
    return this.session.save();
  }

  // ───────────── 하드웨어 키보드 ─────────────
  // 숨은 입력란에 포커스가 없을 때(보기 중, 도구 패널을 연 동안)도 단축키·복사·붙여넣기가 되게 한다.

  /** 입력란(편집기의 숨은 입력란은 스스로 처리)·시트·읽기 모드에서 난 이벤트면 true */
  private notForDocument(target: EventTarget | null): boolean {
    if (target === this.editor.input.el || document.querySelector('[role="dialog"]')) return true;
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  private readonly onDocKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || this.notForDocument(e.target)) return;
    if (this.editor.handleKey(e)) e.preventDefault();
  };

  private readonly onDocCopy = (e: ClipboardEvent) => {
    if (!this.notForDocument(e.target)) fillClipboard(e, this.editor.clipboardData());
  };

  private readonly onDocCut = (e: ClipboardEvent) => {
    if (this.notForDocument(e.target) || this.editor.currentMode !== 'edit') return;
    fillClipboard(e, this.editor.cutClipboard());
  };

  private readonly onDocPaste = (e: ClipboardEvent) => {
    if (this.notForDocument(e.target) || this.editor.currentMode !== 'edit') return;
    e.preventDefault();
    this.editor.paste(e.clipboardData?.getData('text/plain') ?? '', e.clipboardData?.getData('text/html') || null);
  };

  async close(): Promise<void> {
    document.removeEventListener('keydown', this.onDocKey);
    document.removeEventListener('copy', this.onDocCopy);
    document.removeEventListener('cut', this.onDocCut);
    document.removeEventListener('paste', this.onDocPaste);
    this.editBack?.dismiss();
    this.searchBack?.dismiss();
    this.editor.destroy();
    await this.session.close();
    this.el.remove();
  }
}
