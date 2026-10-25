import type { CharProps, EditableDocument, ParaProps } from '../doc/editable';
import { History } from '../doc/history';
import type { InputAction } from '../doc/input-diff';
import {
  type CaretRect,
  type DocPos,
  type PageRect,
  innerPara,
  orderRange,
  sameContainer,
  samePos,
  withInnerPara,
  wordBounds,
} from '../doc/position';
import { type PageObject, objectAt } from '../doc/ops/objects';
import { haptic } from '../platform/files';
import { attachGestures } from '../view/gestures';
import { PageView } from '../view/page-view';
import { Overlay, type HandleSide } from './overlay';
import { TextInput } from './text-input';

export type EditorMode = 'view' | 'edit';

export interface EditorState {
  mode: EditorMode;
  hasCaret: boolean;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  char: CharProps;
  para: ParaProps;
}

export interface EditorHost {
  /** 문서 내용이 바뀌었다 (자동 저장 트리거) */
  changed(): void;
  /** 툴바 갱신이 필요하다 */
  state(state: EditorState): void;
  /** 보기 모드에서 화면을 한 번 탭했다 (상·하단 바 숨기기/보이기) */
  toggleChrome(): void;
  /** 선택 범위 메뉴를 띄울 화면 좌표 (null이면 숨김) */
  selectionMenu(anchor: { x: number; top: number; bottom: number } | null): void;
  /** 단축키 중 앱이 처리할 것 (저장 등) */
  shortcut(key: string): boolean;
  /** 개체를 골랐다 (메뉴를 띄울 화면 좌표). null이면 선택 해제 */
  objectSelected(obj: PageObject | null, anchor: { x: number; top: number; bottom: number } | null): void;
}

type Move = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

/**
 * 모바일 편집기의 중심. 페이지 뷰·제스처·입력을 엮어 캐럿과 선택을 관리하고
 * 모든 편집을 실행 취소 기록과 함께 문서에 반영한다.
 */
export class Editor {
  readonly view = new PageView();
  readonly input: TextInput;
  private readonly overlay: Overlay;
  private doc: EditableDocument | null = null;
  private history: History | null = null;
  private mode: EditorMode = 'view';
  private caret: DocPos | null = null;
  private anchor: DocPos | null = null;
  private stickyX: number | null = null;
  private pendingChar: CharProps | null = null;
  private viewTapTimer = 0;
  private dragging: HandleSide | null = null;
  private readonly disposer = new AbortController();
  /** 도구 패널이 키보드 자리를 쓰는 동안: 선택해도 키보드를 올리지 않는다 */
  keyboardSuppressed = false;
  private caretHandle = false;
  private object: PageObject | null = null;

  constructor(
    host: HTMLElement,
    private readonly hostApi: EditorHost,
  ) {
    this.overlay = new Overlay(this.view);
    this.input = new TextInput({
      actions: (a) => this.applyInput(a),
      composing: (t) => this.showComposition(t),
      key: (e) => this.onKey(e),
      paste: (t) => this.insertText(t),
    });
    host.append(this.view.scroller, this.input.el);
    this.view.onLayout = () => this.paint(false);
    this.view.onScroll = () => this.positionMenu();
    attachGestures(this.view, {
      tap: (x, y) => this.onTap(x, y),
      doubleTap: (x, y) => this.onDoubleTap(x, y),
      longPress: (x, y) => this.onLongPress(x, y),
      drag: (x, y, phase) => this.onMouseDrag(x, y, phase),
    });
    this.attachHandleDrag();
  }

  get document(): EditableDocument | null {
    return this.doc;
  }

  get currentMode(): EditorMode {
    return this.mode;
  }

  load(doc: EditableDocument): void {
    this.history?.reset();
    this.doc = doc;
    this.history = new History(doc.raw, Math.max(4, Math.min(40, doc.raw.snapshotCapacity() - 2)));
    this.caret = null;
    this.anchor = null;
    this.overlay.clear();
    this.view.setDocument(doc);
    this.setMode('view');
  }

  setMode(mode: EditorMode): void {
    this.mode = mode;
    this.view.maxPixelRatio = mode === 'edit' ? 2 : 3;
    if (mode === 'view') {
      this.input.commitComposition();
      this.input.blur();
      this.anchor = null;
    } else if (!this.caret && this.doc) {
      this.caret = this.firstVisiblePos();
    }
    this.paint(mode === 'edit');
    if (mode === 'edit') this.input.focus();
  }

  // ───────────── 제스처 ─────────────

  private onTap(x: number, y: number): void {
    if (this.mode === 'view') {
      if (this.anchor) {
        this.anchor = null;
        this.paint(false);
        return;
      }
      // 두 번 탭(확대)과 구분하려고 잠깐 기다린다.
      window.clearTimeout(this.viewTapTimer);
      this.viewTapTimer = window.setTimeout(() => this.hostApi.toggleChrome(), 260);
      return;
    }
    if (this.selectObjectAt(x, y)) return;
    const pos = this.hit(x, y);
    if (!pos) return;
    this.input.commitComposition();
    this.caretHandle = true;
    this.setCaret(pos, null);
    this.input.focus();
  }

  /** 탭한 자리에 그림·수식·글상자가 있으면 고른다. */
  private selectObjectAt(clientX: number, clientY: number): boolean {
    const p = this.view.clientToPage(clientX, clientY);
    const obj = p && this.doc ? objectAt(this.doc, p.page, p.x, p.y) : null;
    if (!obj) {
      this.clearObject();
      return false;
    }
    this.input.commitComposition();
    this.input.blur();
    this.anchor = null;
    this.object = obj;
    this.paint(false);
    return true;
  }

  get selectedObject(): PageObject | null {
    return this.object;
  }

  clearObject(): void {
    if (!this.object) return;
    this.object = null;
    this.paint(false);
  }

  /** 고른 개체에 대한 편집 (크기·삭제 등). 끝나면 선택을 푼다. */
  objectCommand(fn: (doc: EditableDocument, obj: PageObject) => void): void {
    const obj = this.object;
    if (!obj) return;
    this.object = null;
    this.command((doc) => fn(doc, obj));
  }

  private onDoubleTap(x: number, y: number): void {
    if (this.mode === 'view') {
      window.clearTimeout(this.viewTapTimer);
      // 두 번 탭: 쪽 전체 ↔ 본문 폭 맞춤 (휴대폰에서 글자를 읽기 좋은 크기)
      if (this.view.zoomFactorValue > 1.05) this.view.setZoomFactor(1, x, y);
      else this.view.fitBody(y);
      return;
    }
    this.selectWordAt(x, y);
  }

  private onLongPress(x: number, y: number): void {
    haptic();
    this.selectWordAt(x, y);
  }

  private onMouseDrag(x: number, y: number, phase: 'start' | 'move' | 'end'): void {
    const pos = this.hit(x, y);
    if (!pos) return;
    if (phase === 'start') {
      this.input.commitComposition();
      this.anchor = pos;
      this.caret = pos;
    } else if (this.anchor && sameContainer(this.anchor, pos)) {
      this.caret = pos;
    }
    this.paint(phase === 'end');
    if (phase === 'end' && this.mode === 'edit' && !this.keyboardSuppressed) this.input.focus();
  }

  private selectWordAt(x: number, y: number): void {
    const pos = this.hit(x, y);
    if (!pos || !this.doc) return;
    this.input.commitComposition();
    const [s, e] = wordBounds(this.doc.paraText(pos), pos.offset);
    this.anchor = { ...pos, offset: s };
    this.caret = { ...pos, offset: e };
    this.caretHandle = false;
    this.object = null;
    this.pendingChar = null;
    this.paint(true);
    if (this.mode === 'edit' && !this.keyboardSuppressed) this.input.focus();
  }

  private attachHandleDrag(): void {
    const onStart = (side: HandleSide) => (e: TouchEvent | PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.dragging = side;
      if (side === 'caret') return;
      // 움직이는 쪽이 caret, 고정된 쪽이 anchor가 되도록 바꿔 둔다.
      if (!this.caret || !this.anchor) return;
      const [s, en] = orderRange(this.anchor, this.caret);
      this.anchor = side === 'start' ? en : s;
      this.caret = side === 'start' ? s : en;
    };
    const onMove = (clientX: number, clientY: number) => {
      if (!this.dragging || !this.caret) return;
      const lift = (this.caretRect(this.caret)?.height ?? 16) * this.view.zoom * 0.8;
      const pos = this.hit(clientX, clientY - lift);
      if (!pos) return;
      if (this.dragging === 'caret') {
        this.input.commitComposition();
        this.caret = pos;
        this.pendingChar = null;
        this.paint(false);
        return;
      }
      if (!this.anchor || !sameContainer(pos, this.anchor) || samePos(pos, this.anchor)) return;
      this.caret = pos;
      this.paint(false);
    };
    const onEnd = () => {
      if (!this.dragging) return;
      this.dragging = null;
      this.paint(false);
    };
    for (const side of ['start', 'end', 'caret'] as const) {
      const el = this.overlay.handle(side);
      el.addEventListener('touchstart', onStart(side), { passive: false });
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') onStart(side)(e);
      });
    }
    const signal = this.disposer.signal;
    window.addEventListener(
      'touchmove',
      (e) => {
        if (!this.dragging) return;
        e.preventDefault();
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: false, signal },
    );
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'mouse') onMove(e.clientX, e.clientY);
      },
      { signal },
    );
    window.addEventListener('touchend', onEnd, { signal });
    window.addEventListener('pointerup', onEnd, { signal });
  }

  /** 문서를 닫을 때 호출: 창 이벤트를 떼고 실행 취소 스냅샷을 해제한다. */
  destroy(): void {
    window.clearTimeout(this.viewTapTimer);
    this.disposer.abort();
    this.history?.reset();
    this.history = null;
    this.view.destroy();
    this.doc = null;
  }

  private hit(clientX: number, clientY: number): DocPos | null {
    const p = this.view.clientToPage(clientX, clientY, true);
    if (!p || !this.doc) return null;
    return this.doc.hitTest(p.page, p.x, p.y);
  }

  private firstVisiblePos(): DocPos {
    const page = this.view.currentPage();
    return this.doc?.hitTest(page, 0, 0) ?? { sec: 0, para: 0, offset: 0 };
  }

  // ───────────── 캐럿·그리기 ─────────────

  private caretRect(pos: DocPos): CaretRect | null {
    return this.doc?.caretRect(pos) ?? null;
  }

  get selection(): [DocPos, DocPos] | null {
    if (!this.caret || !this.anchor || samePos(this.caret, this.anchor)) return null;
    return orderRange(this.anchor, this.caret);
  }

  private setCaret(pos: DocPos, anchor: DocPos | null, keepSticky = false): void {
    this.caret = pos;
    this.anchor = anchor;
    if (!keepSticky) this.stickyX = null;
    this.pendingChar = null;
    this.history?.breakGroup();
    this.paint(true);
  }

  /** 캐럿·선택을 다시 그리고 상태를 알린다. reveal이면 캐럿이 보이도록 스크롤한다. */
  private paint(reveal: boolean): void {
    const doc = this.doc;
    if (!doc || !this.caret) {
      this.overlay.clear();
      this.hostApi.selectionMenu(null);
      this.emitState();
      return;
    }
    const sel = this.selection;
    const rect = this.caretRect(this.caret);
    const editing = this.mode === 'edit' && !this.object;
    if (sel) {
      const rects = doc.selectionRects(sel[0], sel[1]);
      this.overlay.showSelection(rects, this.caretRect(sel[0]), this.caretRect(sel[1]), true);
      this.overlay.showCaret(editing ? rect : null);
    } else {
      this.overlay.clearSelection();
      this.overlay.showCaret(editing ? rect : null, true, editing && this.caretHandle);
    }
    this.overlay.showObject(this.object);
    this.overlay.drawHighlight();
    if (rect) {
      if (reveal) this.view.reveal(rect.pageIndex, rect.x, rect.y, rect.height);
      this.syncInputPosition(rect);
    }
    this.positionMenu();
    this.emitState();
  }

  private syncInputPosition(rect: CaretRect): void {
    const overlay = this.view.overlay(rect.pageIndex);
    if (!overlay) return;
    const r = overlay.getBoundingClientRect();
    const z = this.view.zoom;
    this.input.moveTo(r.left + rect.x * z, r.top + rect.y * z, rect.height * z);
  }

  private positionMenu(): void {
    if (this.object) {
      const overlay = this.view.overlay(this.object.page);
      const r = overlay?.getBoundingClientRect();
      const z = this.view.zoom;
      const o = this.object;
      this.hostApi.selectionMenu(null);
      this.hostApi.objectSelected(o, r ? { x: r.left + (o.x + o.w / 2) * z, top: r.top + o.y * z, bottom: r.top + (o.y + o.h) * z } : null);
      return;
    }
    this.hostApi.objectSelected(null, null);
    const sel = this.selection;
    if (!sel || this.dragging) {
      this.hostApi.selectionMenu(null);
      return;
    }
    const a = this.caretRect(sel[0]);
    const b = this.caretRect(sel[1]);
    const oa = a && this.view.overlay(a.pageIndex)?.getBoundingClientRect();
    const ob = b && this.view.overlay(b.pageIndex)?.getBoundingClientRect();
    if (!a || !b || !oa || !ob) {
      this.hostApi.selectionMenu(null);
      return;
    }
    const z = this.view.zoom;
    const top = oa.top + a.y * z;
    const bottom = ob.top + (b.y + b.height) * z;
    const x = (oa.left + a.x * z + ob.left + b.x * z) / 2;
    this.hostApi.selectionMenu({ x, top, bottom });
  }

  private showComposition(text: string | null): void {
    if (!this.caret || !this.doc) return;
    if (text && this.selection) {
      // 선택 영역 위에서 조합을 시작하면 선택 영역을 먼저 지운다.
      this.edit('type', () => this.doc!.deleteRange(...this.selection!));
    }
    const rect = this.caretRect(this.caret);
    const fontPt = (this.pendingChar?.fontSize ?? this.doc.charProps(this.caret).fontSize ?? 1000) / 100;
    this.overlay.showComposition(text, rect, (fontPt * 96) / 72);
    this.overlay.showCaret(text ? null : rect, !text);
  }

  private emitState(): void {
    const doc = this.doc;
    const caret = this.caret;
    const charAt = caret && doc ? (this.selection ? this.selection[0] : caret) : null;
    const charProps = charAt && doc ? doc.charProps(charAt.offset > 0 && !this.selection ? { ...charAt, offset: charAt.offset - 1 } : charAt) : {};
    this.hostApi.state({
      mode: this.mode,
      hasCaret: !!caret,
      hasSelection: !!this.selection,
      canUndo: this.history?.canUndo ?? false,
      canRedo: this.history?.canRedo ?? false,
      char: { ...charProps, ...this.pendingChar },
      para: caret && doc ? doc.paraProps(caret) : {},
    });
  }

  // ───────────── 편집 ─────────────

  /** 모든 문서 변경은 여기를 거친다: 실행 취소 기록 → 변경 → 다시 그리기. */
  private edit(group: string | null, fn: () => DocPos): boolean {
    const doc = this.doc;
    if (!doc || !this.caret || !this.history) return false;
    this.history.record(this.caret, group);
    this.caretHandle = false;
    this.object = null;
    try {
      this.caret = fn();
    } catch (err) {
      console.warn('edit failed', err);
      return false;
    } finally {
      this.anchor = null;
    }
    this.stickyX = null;
    const rect = this.caretRect(this.caret);
    this.view.refresh(rect?.pageIndex ?? -1);
    this.paint(true);
    this.hostApi.changed();
    return true;
  }

  private applyInput(actions: InputAction[]): void {
    for (const a of actions) {
      if (a.kind === 'insert') this.insertText(a.text);
      else if (a.kind === 'enter') this.enter();
      else for (let i = 0; i < a.count; i += 1) this.backspace();
    }
  }

  insertText(text: string): void {
    if (this.mode !== 'edit' || !text) return;
    const pending = this.pendingChar;
    this.edit('type', () => {
      const doc = this.doc!;
      const sel = this.selection;
      const start = sel ? doc.deleteRange(sel[0], sel[1]) : this.caret!;
      const end = doc.insertText(start, text);
      if (pending && innerPara(start) === innerPara(end)) doc.applyCharProps(start, end, pending);
      return end;
    });
    this.pendingChar = pending;
  }

  enter(): void {
    if (this.mode !== 'edit') return;
    this.edit(null, () => {
      const doc = this.doc!;
      const sel = this.selection;
      return doc.splitParagraph(sel ? doc.deleteRange(sel[0], sel[1]) : this.caret!);
    });
  }

  backspace(): void {
    if (this.mode !== 'edit') return;
    const sel = this.selection;
    this.edit('delete', () => (sel ? this.doc!.deleteRange(sel[0], sel[1]) : this.doc!.deleteBackward(this.caret!)));
  }

  deleteForward(): void {
    if (this.mode !== 'edit') return;
    const sel = this.selection;
    this.edit('delete', () => (sel ? this.doc!.deleteRange(sel[0], sel[1]) : this.doc!.deleteForward(this.caret!)));
  }

  undo(): void {
    this.restore(this.history?.undo(this.caret ?? { sec: 0, para: 0, offset: 0 }) ?? null);
  }

  redo(): void {
    this.restore(this.history?.redo(this.caret ?? { sec: 0, para: 0, offset: 0 }) ?? null);
  }

  private restore(pos: DocPos | null): void {
    if (!pos) return;
    this.input.commitComposition();
    this.caret = pos;
    this.anchor = null;
    const rect = this.caretRect(pos);
    this.view.refresh(rect?.pageIndex ?? -1);
    this.paint(true);
    this.hostApi.changed();
  }

  /** 글자 모양: 선택이 있으면 바로 적용, 없으면 다음 입력에 적용한다. */
  applyChar(props: CharProps): void {
    if (!this.caret) return;
    const sel = this.selection;
    if (!sel) {
      this.pendingChar = { ...this.pendingChar, ...props };
      this.emitState();
      return;
    }
    const keep = { anchor: this.anchor, caret: this.caret };
    this.edit(null, () => {
      this.doc!.applyCharProps(sel[0], sel[1], props);
      return keep.caret;
    });
    this.anchor = keep.anchor;
    this.paint(false);
  }

  applyPara(props: ParaProps): void {
    if (!this.caret) return;
    const [s, e] = this.selection ?? [this.caret, this.caret];
    const keep = { anchor: this.anchor, caret: this.caret };
    this.edit(null, () => {
      this.doc!.applyParaProps(s, e, props);
      return keep.caret;
    });
    this.anchor = keep.anchor;
    this.paint(false);
  }

  selectAll(): void {
    if (!this.doc || !this.caret) return;
    const doc = this.doc;
    const last = doc.paraCount(this.caret) - 1;
    const end = withInnerPara(this.caret, last, 0);
    this.anchor = withInnerPara(this.caret, 0, 0);
    this.caret = { ...end, offset: doc.paraLength(end) };
    this.paint(false);
  }

  selectedText(): string {
    const sel = this.selection;
    return sel && this.doc ? this.doc.textBetween(sel[0], sel[1]) : '';
  }

  clearSelection(): void {
    if (!this.anchor) return;
    this.anchor = null;
    this.paint(false);
  }

  insertTable(rows: number, cols: number): boolean {
    if (!this.caret) return false;
    let ok = false;
    this.edit(null, () => {
      const next = this.doc!.insertTable(this.caret!, rows, cols);
      ok = !!next;
      return next ?? this.caret!;
    });
    return ok;
  }

  /** 캐럿이 있는 쪽의 본문 폭 (px) — 그림·글상자 크기 기준 */
  bodyWidth(): number {
    const page = this.caret ? (this.caretRect(this.caret)?.pageIndex ?? 0) : 0;
    try {
      const info = JSON.parse(this.doc!.raw.getPageInfo(page)) as { bodyLeft: number; bodyRight: number };
      return info.bodyRight - info.bodyLeft;
    } catch {
      return 600;
    }
  }

  /**
   * 도구 패널의 편집 명령. 실행 취소 기록과 다시 그리기를 함께 처리한다.
   * fn 이 새 캐럿 위치를 돌려주면 그리로 옮기고, 돌려주지 않으면 캐럿·선택을 그대로 둔다.
   */
  command(fn: (doc: EditableDocument, caret: DocPos, selection: [DocPos, DocPos] | null) => DocPos | void): boolean {
    if (!this.caret || !this.doc) return false;
    const keep = { anchor: this.anchor, caret: this.caret };
    const sel = this.selection;
    let moved = false;
    const ok = this.edit(null, () => {
      const next = fn(this.doc!, keep.caret, sel);
      moved = !!next;
      return next ?? keep.caret;
    });
    if (ok && !moved && keep.anchor) {
      this.anchor = keep.anchor;
      this.paint(false);
    }
    return ok;
  }

  /** 표 칸 범위 같은 강조 영역 (null 이면 지운다) */
  highlight(rects: PageRect[] | null): void {
    this.overlay.setHighlight(rects ?? []);
  }

  /** 문서 표시 방식만 바꿨을 때 (조판 부호 보기 등) */
  rerender(): void {
    this.view.refresh(this.caret ? (this.caretRect(this.caret)?.pageIndex ?? -1) : -1);
    this.paint(false);
  }

  replaceAll(query: string, replacement: string): number {
    if (!this.doc || !query) return 0;
    let count = 0;
    const caret = this.caret ?? { sec: 0, para: 0, offset: 0 };
    if (!this.caret) this.caret = caret;
    this.edit(null, () => {
      const r = JSON.parse(this.doc!.raw.replaceAll(query, replacement, false)) as { count?: number };
      count = r.count ?? 0;
      return { sec: 0, para: 0, offset: 0 };
    });
    return count;
  }

  /** 찾은 위치를 선택하고 화면에 보여 준다. */
  select(start: DocPos, end: DocPos): void {
    this.input.commitComposition();
    this.anchor = start;
    this.caret = end;
    this.paint(true);
  }

  /** 캐럿이 있는 높이를 기준으로 본문 폭 맞춤 확대를 한다. */
  fitBodyAtCaret(): void {
    const rect = this.caret ? this.caretRect(this.caret) : null;
    const overlay = rect ? this.view.overlay(rect.pageIndex) : null;
    const y = rect && overlay ? overlay.getBoundingClientRect().top + rect.y * this.view.zoom : this.view.scroller.getBoundingClientRect().top + 80;
    this.view.fitBody(y);
    this.paint(true);
  }

  /** 캐럿이 화면(키보드·도구 패널 위)에 보이도록 스크롤한다. */
  revealCaret(): void {
    this.paint(true);
  }

  get caretPos(): DocPos | null {
    return this.caret;
  }

  // ───────────── 키보드 (하드웨어 키보드·데스크톱) ─────────────

  private onKey(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z') {
        if (e.shiftKey) this.redo();
        else this.undo();
        return true;
      }
      if (k === 'y') return this.redo(), true;
      if (k === 'a') return this.selectAll(), true;
      if (k === 'b') return this.applyChar({ bold: !this.currentChar().bold }), true;
      if (k === 'i') return this.applyChar({ italic: !this.currentChar().italic }), true;
      if (k === 'u') return this.applyChar({ underline: !this.currentChar().underline }), true;
      return this.hostApi.shortcut(k);
    }
    const moves: Record<string, Move> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      Home: 'home',
      End: 'end',
    };
    if (moves[e.key]) {
      this.move(moves[e.key], e.shiftKey);
      return true;
    }
    if (e.key === 'Delete') return this.deleteForward(), true;
    if (e.key === 'Tab') return this.insertText('\t'), true;
    if (e.key === 'Escape') return this.clearSelection(), true;
    return false;
  }

  currentChar(): CharProps {
    if (!this.caret || !this.doc) return {};
    return { ...this.doc.charProps(this.selection?.[0] ?? this.caret), ...this.pendingChar };
  }

  move(dir: Move, extend = false): void {
    const doc = this.doc;
    const from = this.caret;
    if (!doc || !from) return;
    const sel = this.selection;
    if (!extend && sel && (dir === 'left' || dir === 'right')) {
      this.setCaret(dir === 'left' ? sel[0] : sel[1], null);
      return;
    }
    const next = this.step(from, dir) ?? from;
    this.setCaret(next, extend ? (this.anchor ?? from) : null, dir === 'up' || dir === 'down');
  }

  private step(from: DocPos, dir: Move): DocPos | null {
    const doc = this.doc!;
    const para = innerPara(from);
    switch (dir) {
      case 'left':
        if (from.offset > 0) return { ...from, offset: from.offset - 1 };
        if (para === 0) return null;
        return this.paraEnd(withInnerPara(from, para - 1, 0));
      case 'right':
        if (from.offset < doc.paraLength(from)) return { ...from, offset: from.offset + 1 };
        if (para + 1 >= doc.paraCount(from)) return null;
        return withInnerPara(from, para + 1, 0);
      case 'home':
        return { ...from, offset: 0 };
      case 'end':
        return this.paraEnd(from);
      default:
        return this.vertical(from, dir === 'up' ? -1 : 1);
    }
  }

  private paraEnd(pos: DocPos): DocPos {
    return { ...pos, offset: this.doc!.paraLength(pos) };
  }

  /** 위/아래 줄로: 캐럿 바로 위·아래를 hit-test 한다. */
  private vertical(from: DocPos, dir: -1 | 1): DocPos | null {
    const doc = this.doc!;
    const rect = this.caretRect(from);
    if (!rect) return null;
    this.stickyX ??= rect.x;
    let page = rect.pageIndex;
    let y = dir < 0 ? rect.y - 2 : rect.y + rect.height + 2;
    for (let tries = 0; tries < 6; tries += 1) {
      const info = JSON.parse(doc.raw.getPageInfo(page)) as { height: number };
      if (y < 0) {
        if (page === 0) return null;
        page -= 1;
        y = (JSON.parse(doc.raw.getPageInfo(page)) as { height: number }).height - 1;
      } else if (y > info.height) {
        if (page + 1 >= doc.pageCount()) return null;
        page += 1;
        y = 1;
      }
      const hit = doc.hitTest(page, this.stickyX, y);
      if (hit && !samePos(hit, from)) return hit;
      y += dir * Math.max(rect.height / 2, 4);
    }
    return null;
  }
}
