import type { CaretRect, PageRect } from '../doc/position';
import type { PageView } from '../view/page-view';

export type HandleSide = 'start' | 'end';

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
  };
  private selection: HTMLDivElement[] = [];

  constructor(private readonly view: PageView) {
    this.caret.className = 'caret';
    this.preview.className = 'composition';
    for (const side of ['start', 'end'] as const) {
      const h = this.handles[side];
      h.className = `sel-handle sel-handle-${side}`;
      h.dataset.handle = side;
    }
  }

  handle(side: HandleSide): HTMLDivElement {
    return this.handles[side];
  }

  showCaret(rect: CaretRect | null, blink = true): void {
    if (!rect || !this.place(this.caret, rect.pageIndex, rect.x, rect.y, 0, rect.height)) {
      this.caret.remove();
      return;
    }
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

  clear(): void {
    this.clearSelection();
    this.caret.remove();
    this.preview.remove();
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
