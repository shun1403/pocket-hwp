import type { CharProps, EditableDocument, ParaProps } from '../doc/editable';
import { History } from '../doc/history';
import type { InputAction } from '../doc/input-diff';
import {
  type CaretRect,
  type DocPos,
  type PageRect,
  inCell,
  innerPara,
  nextWordOffset,
  orderRange,
  prevWordOffset,
  sameContainer,
  samePos,
  withInnerPara,
  wordBounds,
} from '../doc/position';
import { type LinkInfo, linkAt } from '../doc/ops/links';
import { type SpecialHit, specialAt } from '../doc/ops/notes';
import { memoCount, memoRanges } from '../doc/ops/memos';
import { type PageObject, copyObject, deleteObject, objectAt, tableObjectAt } from '../doc/ops/objects';
import { cellContext, tableCells } from '../doc/ops/table';
import { HwpDocument } from '../engine/rhwp';
import { haptic } from '../platform/files';
import { attachGestures } from '../view/gestures';
import { PageView } from '../view/page-view';
import { keyName } from './keys';
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
  /** 앱이 처리할 단축키 ('Ctrl+S', 'Alt+L', 'F7' 처럼 keyName 형식). 처리했으면 true */
  shortcut(name: string): boolean;
  /** 개체를 골랐다 (메뉴를 띄울 화면 좌표). null이면 선택 해제 */
  objectSelected(obj: PageObject | null, anchor: { x: number; top: number; bottom: number } | null): void;
  /** 편집 중 머리말·꼬리말·각주를 눌렀다 */
  special(hit: SpecialHit): void;
  /** 링크를 눌렀다 */
  link(pos: DocPos, link: LinkInfo): void;
  /** 보기 중 메모를 단 글을 눌렀다 */
  memo(id: number): void;
}

type Move = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'wordLeft' | 'wordRight' | 'docStart' | 'docEnd';

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
  /** 조합 중이라 문서에 넣어 둔 글의 자리 (확정 전) */
  private live: { start: DocPos; end: DocPos } | null = null;
  /** 쪽 위에 표시한 메모 자리 */
  private memoMarks: { id: number; rects: PageRect[] }[] = [];
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
  /** 엔진 안 클립보드에 개체를 복사하며 시스템 클립보드에 넣은 표식 글 */
  private controlMarker: string | null = null;
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
      key: (e) => this.handleKey(e),
      copy: () => this.clipboardData(),
      cut: () => this.cutClipboard(),
      paste: (t, html) => this.paste(t, html),
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
    this.live = null;
    this.doc = doc;
    this.history = new History(doc.raw, Math.max(4, Math.min(40, doc.raw.snapshotCapacity() - 2)));
    this.caret = null;
    this.anchor = null;
    this.overlay.clear();
    this.view.setDocument(doc);
    this.memoMarks = [];
    this.refreshMemos(memoCount(doc) > 0);
    this.setMode('view');
  }

  /**
   * 엔진 밖에서 고친 문서(메모를 단 HWPX)로 통째로 바꾼다. 글 위치는 그대로라 캐럿을 지킨다.
   * 엔진 스냅샷은 문서마다 따로라서 실행 취소 기록은 비워진다.
   */
  replaceDocument(bytes: Uint8Array): void {
    const doc = this.doc;
    if (!doc) return;
    this.settleComposition();
    this.input.commitComposition();
    const next = new HwpDocument(bytes);
    this.history?.reset();
    doc.replaceRaw(next);
    this.history = new History(next, Math.max(4, Math.min(40, next.snapshotCapacity() - 2)));
    this.object = null;
    this.anchor = null;
    const rect = this.caret ? this.caretRect(this.caret) : null;
    this.view.refresh(rect?.pageIndex ?? -1);
    this.refreshMemos(true);
    this.paint(false);
    this.hostApi.changed();
  }

  /** 메모 자리 표시를 다시 계산한다. 메모가 없던 문서는 편집해도 생기지 않으니 건너뛴다. */
  private refreshMemos(force = false): void {
    const doc = this.doc;
    if (!doc || (!force && this.memoMarks.length === 0)) return;
    this.memoMarks = memoRanges(doc).map((m) => {
      if (m.start.offset !== m.end.offset || innerPara(m.start) !== innerPara(m.end)) return { id: m.id, rects: doc.selectionRects(m.start, m.end) };
      const r = doc.caretRect(m.start);
      return { id: m.id, rects: r ? [{ pageIndex: r.pageIndex, x: r.x - 2, y: r.y, width: 8, height: r.height }] : [] };
    });
    this.overlay.setMarks(this.memoMarks.flatMap((m) => m.rects));
  }

  /** 점 근처에 있는 메모 (손가락으로 누르기 쉽게 둘레를 넓혀 잡는다) */
  private memoAtPoint(clientX: number, clientY: number): number | null {
    const p = this.view.clientToPage(clientX, clientY);
    if (!p) return null;
    const pad = 8 / this.view.zoom;
    const hit = this.memoMarks.find((m) => m.rects.some((r) => r.pageIndex === p.page && p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad));
    return hit?.id ?? null;
  }

  /** 캐럿(또는 선택)이 걸친 메모 */
  memoAtCaret(): number | null {
    const doc = this.doc;
    const caret = this.caret;
    if (!doc || !caret) return null;
    const hit = memoRanges(doc).find(
      (m) => sameContainer(m.start, caret) && innerPara(m.start) === innerPara(caret) && m.start.offset <= caret.offset && caret.offset <= m.end.offset,
    );
    return hit?.id ?? null;
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
      // 두 번 탭(확대)과 구분하려고 잠깐 기다린다. 링크 위면 링크를 연다.
      window.clearTimeout(this.viewTapTimer);
      this.viewTapTimer = window.setTimeout(() => {
        if (this.openLinkAt(x, y)) return;
        const memo = this.memoAtPoint(x, y);
        if (memo !== null) this.hostApi.memo(memo);
        else this.hostApi.toggleChrome();
      }, 260);
      return;
    }
    if (this.specialAt(x, y)) return;
    if (this.selectObjectAt(x, y)) return;
    const pos = this.hit(x, y);
    if (!pos) return;
    this.input.commitComposition();
    this.caretHandle = true;
    this.setCaret(pos, null);
    this.input.focus();
  }

  /** 머리말·꼬리말·각주를 눌렀으면 그걸 고치게 한다. */
  private specialAt(clientX: number, clientY: number): boolean {
    const p = this.view.clientToPage(clientX, clientY);
    const hit = p && this.doc ? specialAt(this.doc, p.page, p.x, p.y) : null;
    if (!hit) return false;
    this.input.commitComposition();
    this.hostApi.special(hit);
    return true;
  }

  private openLinkAt(clientX: number, clientY: number): boolean {
    const pos = this.hit(clientX, clientY);
    const link = pos && this.doc ? linkAt(this.doc, pos) : null;
    if (!pos || !link) return false;
    this.hostApi.link(pos, link);
    return true;
  }

  /** 캐럿 자리에 걸린 링크 */
  linkAtCaret(): { pos: DocPos; link: LinkInfo } | null {
    const pos = this.caret;
    const link = pos && this.doc ? linkAt(this.doc, pos) : null;
    return pos && link ? { pos, link } : null;
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
    const body = { sec: obj.sec, para: obj.para, offset: 0 };
    this.caret ??= body;
    // 표를 지우면 그 안에 있던 캐럿을 표가 있던 문단으로 옮긴다.
    const inTable = obj.kind === 'table' && inCell(this.caret) && this.caret.sec === obj.sec && this.caret.para === obj.para;
    this.command((doc) => {
      fn(doc, obj);
      return inTable ? body : undefined;
    });
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
    if (phase === 'move') this.edgeScroll(x, y, (cx, cy) => this.onMouseDrag(cx, cy, 'move'));
    else this.stopEdgeScroll();
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
      this.edgeScroll(clientX, clientY, onMove);
      if (!this.anchor || !sameContainer(pos, this.anchor) || samePos(pos, this.anchor)) return;
      this.caret = pos;
      this.paint(false);
    };
    const onEnd = () => {
      if (!this.dragging) return;
      this.dragging = null;
      this.stopEdgeScroll();
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

  private edge = { frame: 0, x: 0, y: 0, move: null as ((x: number, y: number) => void) | null };

  /**
   * 손잡이·마우스로 고르다가 화면 위·아래 끝에 닿으면 문서를 굴리면서 계속 넓힌다.
   * 끝에 가까울수록 빨리 굴린다.
   */
  private edgeScroll(x: number, y: number, move: (x: number, y: number) => void): void {
    Object.assign(this.edge, { x, y, move });
    if (this.edge.frame) return;
    const tick = () => {
      // run 안에서 다시 불린 edgeScroll 이 고리를 하나 더 만들지 않도록 frame 은 끝에서 바꾼다.
      const { move: run, x: cx, y: cy } = this.edge;
      if (!run) return void (this.edge.frame = 0);
      const box = this.view.scroller.getBoundingClientRect();
      // 아래쪽은 가상 키보드·빠른 도구 줄에 가리므로 보이는 화면 기준으로 넉넉히 잡는다.
      const bottom = Math.min(box.bottom, window.visualViewport?.height ?? box.bottom) - 72;
      const top = box.top + 40;
      const dy = cy > bottom ? Math.min(40, (cy - bottom) / 2 + 4) : cy < top ? -Math.min(40, (top - cy) / 2 + 4) : 0;
      if (!dy) return void (this.edge.frame = 0);
      this.view.scroller.scrollBy(0, dy);
      run(cx, cy);
      this.edge.frame = requestAnimationFrame(tick);
    };
    this.edge.frame = requestAnimationFrame(tick);
  }

  private stopEdgeScroll(): void {
    cancelAnimationFrame(this.edge.frame);
    this.edge.frame = 0;
    this.edge.move = null;
  }

  /** 문서를 닫을 때 호출: 창 이벤트를 떼고 실행 취소 스냅샷을 해제한다. */
  destroy(): void {
    window.clearTimeout(this.viewTapTimer);
    this.stopEdgeScroll();
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
      this.overlay.drawHighlight();
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
    this.overlay.setComposing(this.live ? doc.selectionRects(this.live.start, this.live.end) : []);
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

  /**
   * 조합 중인 글. 실제 글꼴·크기·자간·줄 간격 그대로 보이도록 문서에 바로 넣어 두고(실행 취소 기록 없이)
   * 밑줄로 표시한다. 조합이 끝나면(text 가 null) 넣어 둔 글을 빼고, 확정된 글을 평소처럼 넣는다.
   */
  private showComposition(text: string | null): void {
    if (!this.caret || !this.doc) return;
    if (text && this.selection && !this.live) {
      // 선택 영역 위에서 조합을 시작하면 선택 영역을 먼저 지운다.
      this.edit('type', () => this.doc!.deleteRange(...this.selection!));
    }
    // 보기로 바뀌는 중에도 넣어 둔 글은 반드시 뺀다.
    if ((this.live || (text && this.mode === 'edit')) && this.showLive(text)) return;
    const rect = this.caretRect(this.caret);
    const fontPt = (this.pendingChar?.fontSize ?? this.doc.charProps(this.caret).fontSize ?? 1000) / 100;
    this.overlay.showComposition(text, rect, (fontPt * 96) / 72, text && rect ? this.textBounds(rect) : null);
    this.overlay.showCaret(text ? null : rect, !text);
  }

  /** 조합 중인 글을 문서에 넣어 둔다. 엔진이 넣지 못하면 false (떠 있는 미리보기로 대신한다). */
  private showLive(text: string | null): boolean {
    const doc = this.doc!;
    try {
      const at = this.live ? (samePos(this.live.start, this.live.end) ? this.live.start : doc.deleteRange(this.live.start, this.live.end)) : this.caret!;
      this.live = null;
      this.caret = at;
      if (text) {
        const end = doc.insertText(at, text);
        if (this.pendingChar && innerPara(at) === innerPara(end)) doc.applyCharProps(at, end, this.pendingChar);
        this.live = { start: at, end };
        this.caret = end;
      }
    } catch (err) {
      console.warn('live composition failed', err);
      this.live = null;
      return false;
    }
    this.overlay.showComposition(null, null, 0);
    const rect = this.caretRect(this.caret!);
    this.view.refresh(rect?.pageIndex ?? -1);
    this.refreshMemos();
    this.paint(true);
    return true;
  }

  /** 조합 중이면 먼저 확정한다 (조합 글이 든 채로 실행 취소 기록이 남지 않게). */
  private settleComposition(): void {
    if (!this.live) return;
    this.input.commitComposition();
    // 키보드가 조합 끝을 알리지 않았으면 넣어 둔 글만 뺀다.
    if (this.live) this.showLive(null);
  }

  /** 캐럿 자리에서 글이 놓이는 가로 범위 (쪽 px): 표 칸이면 그 칸, 본문이면 그 단 */
  private textBounds(rect: CaretRect): { left: number; right: number } | null {
    const doc = this.doc!;
    const caret = this.caret!;
    if (inCell(caret)) {
      const ctx = cellContext(doc, caret);
      const box = ctx && tableCells(doc, ctx).find((c) => c.cellIdx === ctx.cell && c.pageIndex === rect.pageIndex);
      // 칸 안쪽 여백만큼 띄운다 (기본 1.8mm ≈ 7px).
      return box ? { left: box.x + 7, right: box.x + box.w - 7 } : null;
    }
    try {
      const info = JSON.parse(doc.raw.getPageInfo(rect.pageIndex)) as {
        bodyLeft: number;
        bodyRight: number;
        columns?: { x: number; width: number }[];
      };
      const col = info.columns?.find((c) => rect.x >= c.x - 1 && rect.x <= c.x + c.width + 1);
      return col ? { left: col.x, right: col.x + col.width } : { left: info.bodyLeft, right: info.bodyRight };
    } catch {
      return null;
    }
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
    this.settleComposition();
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
    this.refreshMemos();
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

  /**
   * 웹 페이지·다른 문서에서 복사한 글을 모양(굵게·표 등)과 함께 붙인다.
   * 엔진이 HTML을 읽지 못하면 글자만 붙인다.
   */
  pasteHtml(html: string, fallbackText: string): void {
    if (this.mode !== 'edit') return;
    const ok = this.edit(null, () => {
      const doc = this.doc!;
      const sel = this.selection;
      const at = sel ? doc.deleteRange(sel[0], sel[1]) : this.caret!;
      return doc.pasteHtml(at, html);
    });
    if (!ok && fallbackText) this.insertText(fallbackText);
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
    this.settleComposition();
    this.restore(this.history?.undo(this.caret ?? { sec: 0, para: 0, offset: 0 }) ?? null);
  }

  redo(): void {
    this.settleComposition();
    this.restore(this.history?.redo(this.caret ?? { sec: 0, para: 0, offset: 0 }) ?? null);
  }

  private restore(pos: DocPos | null): void {
    if (!pos) return;
    this.input.commitComposition();
    this.caret = pos;
    this.anchor = null;
    const rect = this.caretRect(pos);
    this.view.refresh(rect?.pageIndex ?? -1);
    this.refreshMemos();
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

  /**
   * Ctrl+C·X 로 클립보드에 넣을 글과 HTML. 고른 글이 없으면 null.
   * 표·그림을 통째로 골랐으면 엔진 안 클립보드에 복사하고 표식 글('[표]')만 넣는다.
   */
  clipboardData(): { text: string; html: string | null } | null {
    if (this.object && this.doc) {
      const marker = copyObject(this.doc, this.object);
      this.controlMarker = marker;
      return marker ? { text: marker, html: null } : null;
    }
    const sel = this.selection;
    if (!sel || !this.doc) return null;
    return { text: this.doc.textBetween(sel[0], sel[1]), html: this.doc.htmlBetween(sel[0], sel[1]) };
  }

  /** 잘라내기: 클립보드에 넣을 것을 돌려주고 고른 글·개체를 지운다. */
  cutClipboard(): { text: string; html: string | null } | null {
    const data = this.clipboardData();
    if (!data || this.mode !== 'edit') return data;
    if (this.object) this.objectCommand((doc, o) => deleteObject(doc, o));
    else this.backspace();
    return data;
  }

  /** 붙여넣기. 방금 복사한 표·그림의 표식 글이면 개체를 통째로 붙인다. */
  paste(text: string, html: string | null): void {
    if (this.mode !== 'edit') return;
    if (this.controlMarker && text === this.controlMarker && this.caret && !inCell(this.caret)) {
      const at = this.caret;
      const pasted = this.edit(null, () => {
        const next = this.doc!.pasteControl(at);
        if (!next) throw new Error('control paste failed');
        return next;
      });
      if (pasted) return;
    }
    if (html) this.pasteHtml(html, text);
    else if (text) this.insertText(text);
  }

  /** 캐럿이 든 표를 통째로 고른다 (복사·잘라내기·지우기). 표 안이 아니면 false */
  selectTable(): boolean {
    const obj = this.caret && this.doc ? tableObjectAt(this.doc, this.caret) : null;
    if (!obj) return false;
    this.input.commitComposition();
    this.input.blur();
    this.anchor = null;
    this.object = obj;
    this.paint(false);
    return true;
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
    this.settleComposition();
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

  /** 문서의 한 자리로 가서 보여 준다 (목차·책갈피 이동). 선택은 만들지 않는다. */
  goTo(pos: DocPos): void {
    this.input.commitComposition();
    this.anchor = null;
    this.object = null;
    this.caret = pos;
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

  /**
   * 하드웨어 키보드의 이동·지우기 키를 처리하고, 나머지 조합(Ctrl+B, Alt+L, F7 …)은
   * 앱의 단축키 목록(hostApi.shortcut)에 넘긴다. 처리했으면 true.
   */
  handleKey(e: KeyboardEvent): boolean {
    const name = keyName(e);
    if (this.object && this.mode === 'edit' && (name === 'Delete' || name === 'Backspace')) {
      this.objectCommand((doc, o) => deleteObject(doc, o));
      return true;
    }
    if (this.object && name === 'Escape') return this.clearObject(), true;
    const word = e.ctrlKey || e.metaKey;
    const moves: Record<string, Move> = {
      ArrowLeft: word ? 'wordLeft' : 'left',
      ArrowRight: word ? 'wordRight' : 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      Home: word ? 'docStart' : 'home',
      End: word ? 'docEnd' : 'end',
    };
    if (this.mode === 'edit' && moves[e.key] && !e.altKey) {
      this.move(moves[e.key], e.shiftKey);
      return true;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      const s = this.view.scroller;
      s.scrollBy({ top: (e.key === 'PageUp' ? -0.9 : 0.9) * s.clientHeight });
      return true;
    }
    if (this.mode === 'edit' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'Delete') return this.deleteForward(), true;
      if (e.key === 'Tab' && !e.shiftKey) return this.insertText('\t'), true;
      if (e.key === 'Escape' && this.anchor) return this.clearSelection(), true;
    }
    return this.hostApi.shortcut(name);
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
      case 'wordLeft': {
        if (from.offset === 0) return this.step(from, 'left');
        return { ...from, offset: prevWordOffset(doc.paraText(from), from.offset) };
      }
      case 'wordRight': {
        if (from.offset >= doc.paraLength(from)) return this.step(from, 'right');
        return { ...from, offset: nextWordOffset(doc.paraText(from), from.offset) };
      }
      case 'docStart':
        return withInnerPara(from, 0, 0);
      case 'docEnd':
        return this.paraEnd(withInnerPara(from, doc.paraCount(from) - 1, 0));
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
