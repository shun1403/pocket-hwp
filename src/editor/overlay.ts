import type { CaretRect, PageRect } from '../doc/position';
import type { PageView } from '../view/page-view';

export type HandleSide = 'start' | 'end' | 'caret';

/**
 * 캐럿·선택 영역·선택 손잡이·조합 중 글자를 페이지 위에 그린다.
 * 좌표는 96dpi 페이지 px로 받아 현재 확대 배율을 곱해 배치한다.
 */
export class Overlay {
  private readonly caret = document.createElement('div');
  private readonly preview = document.createElement('div');
  private readonly handles: Record<HandleSide, HTMLDivElement> = {
    start: document.createElement('div'),
    end: document.createElement('div'),
    caret: document.createElement('div'),
  };
  private readonly objectBox = document.createElement('div');
  private selection: HTMLDivElement[] = [];
  private highlight: { rects: PageRect[]; els: HTMLDivElement[] } = { rects: [], els: [] };

  constructor(private readonly view: PageView) {
    this.caret.className = 'caret';
    this.preview.className = 'composition';
    this.objectBox.className = 'object-box';
    for (const side of ['start', 'end', 'caret'] as const) {
      const h = this.handles[side];
      h.className = `sel-handle sel-handle-${side}`;
      h.dataset.handle = side;
    }
  }

  handle(side: HandleSide): HTMLDivElement {
    return this.handles[side];
  }

  showCaret(rect: CaretRect | null, blink = true, handle = false): void {
    if (!rect || !this.place(this.caret, rect.pageIndex, rect.x, rect.y, 0, rect.height)) {
      this.caret.remove();
      this.handles.caret.remove();
      return;
    }
    // 손잡이: 끌어서 캐럿을 정확히 옮긴다.
    if (handle) this.place(this.handles.caret, rect.pageIndex, rect.x, rect.y + rect.height, 0, 0);
    else this.handles.caret.remove();
    // 깜빡임 애니메이션을 처음부터 다시 시작해 이동 직후엔 항상 보이게 한다.
    this.caret.classList.remove('blink');
    if (blink) {
      void this.caret.offsetWidth;
      this.caret.classList.add('blink');
    }
  }

  showComposition(text: string | null, rect: CaretRect | null, fontPx: number): void {
    if (!text || !rect) {
      this.preview.remove();
      return;
    }
    const z = this.view.zoom;
    this.preview.textContent = text;
    this.preview.style.fontSize = `${Math.max(fontPx * z, 12)}px`;
    this.place(this.preview, rect.pageIndex, rect.x, rect.y, 0, rect.height);
  }

  showSelection(rects: PageRect[], start: CaretRect | null, end: CaretRect | null, withHandles: boolean): void {
    this.clearSelection();
    for (const r of rects) {
      const el = document.createElement('div');
      el.className = 'sel-rect';
      if (this.place(el, r.pageIndex, r.x, r.y, r.width, r.height)) this.selection.push(el);
    }
    if (withHandles && start && end) {
      this.place(this.handles.start, start.pageIndex, start.x, start.y + start.height, 0, 0);
      this.place(this.handles.end, end.pageIndex, end.x, end.y + end.height, 0, 0);
    } else {
      this.handles.start.remove();
      this.handles.end.remove();
    }
  }

  clearSelection(): void {
    this.selection.forEach((el) => el.remove());
    this.selection = [];
    this.handles.start.remove();
    this.handles.end.remove();
  }

  /** 표에서 고른 칸 범위처럼 캐럿·선택과 따로 보여 줄 영역. 빈 배열이면 지운다. */
  setHighlight(rects: PageRect[]): void {
    this.highlight.rects = rects;
    this.drawHighlight();
  }

  /** 확대·다시 그리기 뒤 위치를 다시 맞춘다. */
  drawHighlight(): void {
    this.highlight.els.forEach((el) => el.remove());
    this.highlight.els = [];
    for (const r of this.highlight.rects) {
      const el = document.createElement('div');
      el.className = 'range-rect';
      if (this.place(el, r.pageIndex, r.x, r.y, r.width, r.height)) this.highlight.els.push(el);
    }
  }

  /** 선택한 개체(그림·수식·글상자) 테두리 */
  showObject(o: { page: number; x: number; y: number; w: number; h: number } | null): void {
    if (!o) {
      this.objectBox.remove();
      return;
    }
    this.place(this.objectBox, o.page, o.x, o.y, o.w, o.h);
  }

  clear(): void {
    this.clearSelection();
    this.caret.remove();
    this.handles.caret.remove();
    this.preview.remove();
    this.objectBox.remove();
  }

  private place(el: HTMLElement, page: number, x: number, y: number, w: number, h: number): boolean {
    const host = this.view.overlay(page);
    if (!host) return false;
    const z = this.view.zoom;
    el.style.transform = `translate(${x * z}px, ${y * z}px)`;
    // 크기 0은 CSS 기본 크기(캐럿 두께, 손잡이 크기)를 쓰라는 뜻이다.
    el.style.width = w > 0 ? `${w * z}px` : '';
    el.style.height = h > 0 ? `${h * z}px` : '';
    if (el.parentElement !== host) host.append(el);
    return true;
  }
}
