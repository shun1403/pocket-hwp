import type { EditableDocument } from '../doc/editable';

interface PageSlot {
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  width: number; // 96dpi px
  height: number;
  renderedVersion: number;
  renderedScale: number;
}

export interface PagePoint {
  page: number;
  x: number;
  y: number;
}

const GAP = 12;
const PAD = 12;
/** iOS WebView 캔버스 한 장당 픽셀 한도(약 16.7M)보다 조금 작게 잡는다. */
const MAX_CANVAS_PIXELS = 14_000_000;
/** 화면에서 이만큼(뷰포트 높이 배수) 벗어난 페이지 캔버스는 메모리를 반납한다. */
const RELEASE_DISTANCE = 4;

/**
 * 연속 스크롤 페이지 뷰.
 *
 * 페이지 자리는 문서 크기대로 미리 잡아 두고, 화면 근처의 페이지만 캔버스로 그린다.
 * 확대 배율(zoom)은 "96dpi 페이지 px → CSS px" 비율이다.
 */
export class PageView {
  readonly scroller: HTMLDivElement;
  readonly inner: HTMLDivElement;
  private slots: PageSlot[] = [];
  private doc: EditableDocument | null = null;
  private version = 0;
  private frame = 0;
  private priority = -1;
  private fitZoom = 1;
  private zoomFactor = 1;
  /** 렌더링 품질 상한 (편집 중에는 낮춰 반응성을 높인다) */
  maxPixelRatio = 3;
  onScroll: (() => void) | null = null;
  onLayout: (() => void) | null = null;
  private readonly onResize = () => this.relayout();

  constructor() {
    this.scroller = document.createElement('div');
    this.scroller.className = 'page-scroller';
    this.inner = document.createElement('div');
    this.inner.className = 'page-inner';
    this.inner.style.padding = `${PAD}px`;
    this.inner.style.gap = `${GAP}px`;
    this.scroller.append(this.inner);
    this.scroller.addEventListener(
      'scroll',
      () => {
        this.schedule();
        this.onScroll?.();
      },
      { passive: true },
    );
    window.addEventListener('resize', this.onResize);
  }

  /** 문서를 닫을 때: 창 이벤트를 떼고 엔진 참조를 놓는다. */
  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.doc = null;
  }

  get zoom(): number {
    return this.fitZoom * this.zoomFactor;
  }

  get pageCount(): number {
    return this.slots.length;
  }

  setDocument(doc: EditableDocument): void {
    this.doc = doc;
    this.zoomFactor = 1;
    this.slots.forEach((s) => s.el.remove());
    this.slots = [];
    for (let i = 0; i < doc.pageCount(); i += 1) this.createSlot(i);
    this.readPageSizes();
    this.version += 1;
    this.relayout(false);
    this.scroller.scrollTo(0, 0);
  }

  /**
   * 편집 뒤 호출: 모든 쪽을 다시 그리도록 표시한다. 그리기는 다음 프레임에 몰아서 하므로
   * 빠르게 타이핑해도 한 프레임에 한 번만 그린다. `priorityPage`(캐럿이 있는 쪽)를 먼저 그린다.
   */
  refresh(priorityPage = -1): void {
    if (!this.doc) return;
    this.version += 1;
    this.priority = priorityPage;
    const count = this.doc.pageCount();
    if (count !== this.slots.length) {
      while (this.slots.length > count) this.slots.pop()?.el.remove();
      for (let i = this.slots.length; i < count; i += 1) this.createSlot(i);
      this.readPageSizes();
      this.relayout(false);
    }
    this.schedule();
  }

  private readPageSizes(): void {
    if (!this.doc) return;
    this.slots.forEach((slot, i) => {
      const info = JSON.parse(this.doc!.raw.getPageInfo(i)) as { width: number; height: number };
      slot.width = info.width;
      slot.height = info.height;
    });
  }

  private createSlot(index: number): PageSlot {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(index);
    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    const overlay = document.createElement('div');
    overlay.className = 'page-overlay';
    el.append(canvas, overlay);
    this.inner.append(el);
    const slot: PageSlot = { el, canvas, overlay, width: 0, height: 0, renderedVersion: -1, renderedScale: 0 };
    this.slots[index] = slot;
    return slot;
  }

  private relayout(keepAnchor = true): void {
    if (this.slots.length === 0) return;
    const anchor = keepAnchor ? this.centerPoint() : null;
    const maxW = Math.max(...this.slots.map((s) => s.width));
    const avail = Math.max(this.scroller.clientWidth - PAD * 2, 200);
    this.fitZoom = avail / maxW;
    const z = this.zoom;
    for (const s of this.slots) {
      s.el.style.width = `${s.width * z}px`;
      s.el.style.height = `${s.height * z}px`;
    }
    if (anchor) this.scrollPointTo(anchor, this.scroller.clientWidth / 2, this.scroller.clientHeight / 2);
    this.onLayout?.();
    this.schedule();
  }

  /** 확대 배율을 바꾼다. (cx, cy) 화면 좌표의 문서 지점이 제자리에 남는다. */
  setZoomFactor(factor: number, cx?: number, cy?: number): void {
    const clamped = Math.min(Math.max(factor, 0.5), 5);
    const rect = this.scroller.getBoundingClientRect();
    const fx = cx ?? rect.left + rect.width / 2;
    const fy = cy ?? rect.top + rect.height / 2;
    const anchor = this.clientToPage(fx, fy, true);
    this.zoomFactor = clamped;
    this.relayout(false);
    if (anchor) this.scrollPointTo(anchor, fx - rect.left, fy - rect.top);
  }

  /**
   * 본문 폭 맞춤: 쪽 여백을 화면 밖으로 밀어 글자를 크게 본다.
   * (clientY) 높이의 문서 지점은 제자리에 두고, 가로는 본문 왼쪽 끝에 맞춘다.
   */
  fitBody(clientY: number): void {
    const anchor = this.clientToPage(this.scroller.getBoundingClientRect().left + 1, clientY, true);
    if (!anchor || !this.doc) return;
    const info = JSON.parse(this.doc.raw.getPageInfo(anchor.page)) as { width: number; bodyLeft: number; bodyRight: number };
    const bodyWidth = info.bodyRight - info.bodyLeft;
    if (bodyWidth <= 0) return;
    const margin = 10;
    // 본문 폭 × 배율 = 화면 폭 − 양옆 여백 이 되도록
    const factor = (this.scroller.clientWidth - margin * 2) / (bodyWidth * this.fitZoom);
    const rect = this.scroller.getBoundingClientRect();
    this.zoomFactor = Math.min(Math.max(factor, 1), 5);
    this.relayout(false);
    const slot = this.slots[anchor.page];
    this.scroller.scrollTop = slot.el.offsetTop + anchor.y * this.zoom - (clientY - rect.top);
    this.scroller.scrollLeft = slot.el.offsetLeft + info.bodyLeft * this.zoom - margin;
  }

  get zoomFactorValue(): number {
    return this.zoomFactor;
  }

  /** 화면 좌표 → 페이지 좌표. clamp=true면 페이지 사이 여백도 가까운 페이지로 붙인다. */
  clientToPage(clientX: number, clientY: number, clamp = false): PagePoint | null {
    const z = this.zoom;
    for (let i = 0; i < this.slots.length; i += 1) {
      const r = this.slots[i].el.getBoundingClientRect();
      const inside = clientY >= r.top && clientY <= r.bottom;
      const nearBelow = clamp && clientY < r.top;
      if (inside || nearBelow) {
        const x = Math.min(Math.max((clientX - r.left) / z, 0), this.slots[i].width);
        const y = Math.min(Math.max((clientY - r.top) / z, 0), this.slots[i].height);
        if (!inside && !clamp) return null;
        return { page: i, x, y };
      }
    }
    if (clamp && this.slots.length > 0) {
      const last = this.slots.length - 1;
      return { page: last, x: 0, y: this.slots[last].height };
    }
    return null;
  }

  /** 페이지 좌표 → 스크롤 콘텐츠 좌표 */
  pageToContent(p: PagePoint): { x: number; y: number } {
    const slot = this.slots[p.page];
    return { x: slot.el.offsetLeft + p.x * this.zoom, y: slot.el.offsetTop + p.y * this.zoom };
  }

  private scrollPointTo(p: PagePoint, viewX: number, viewY: number): void {
    if (!this.slots[p.page]) return;
    const c = this.pageToContent(p);
    this.scroller.scrollLeft = c.x - viewX;
    this.scroller.scrollTop = c.y - viewY;
  }

  private centerPoint(): PagePoint | null {
    const r = this.scroller.getBoundingClientRect();
    return this.clientToPage(r.left + r.width / 2, r.top + r.height / 2, true);
  }

  /** 화면 가운데 걸친 쪽 번호 (0부터) */
  currentPage(): number {
    return this.centerPoint()?.page ?? 0;
  }

  scrollToPage(index: number): void {
    const slot = this.slots[index];
    if (slot) this.scroller.scrollTo({ top: slot.el.offsetTop - PAD, behavior: 'auto' });
  }

  /** 페이지 좌표의 세로 구간이 화면 안에 보이도록 스크롤한다. */
  reveal(page: number, x: number, y: number, h: number): void {
    const slot = this.slots[page];
    if (!slot) return;
    const top = slot.el.offsetTop + y * this.zoom;
    const bottom = top + h * this.zoom;
    const left = slot.el.offsetLeft + x * this.zoom;
    const margin = 48;
    const viewTop = this.scroller.scrollTop;
    const viewBottom = viewTop + this.scroller.clientHeight;
    if (top < viewTop + margin) this.scroller.scrollTop = top - margin;
    else if (bottom > viewBottom - margin) this.scroller.scrollTop = bottom - this.scroller.clientHeight + margin;
    const viewLeft = this.scroller.scrollLeft;
    if (left < viewLeft + 24 || left > viewLeft + this.scroller.clientWidth - 24) {
      this.scroller.scrollLeft = left - this.scroller.clientWidth / 2;
    }
  }

  overlay(page: number): HTMLDivElement | null {
    return this.slots[page]?.overlay ?? null;
  }

  schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNext();
    });
  }

  /** 화면 가까운 쪽부터 한 프레임에 한 쪽씩 그린다. */
  private renderNext(): void {
    const prio = this.slots[this.priority];
    this.priority = -1;
    if (prio && this.needsRender(prio)) {
      this.renderSlot(this.slots.indexOf(prio));
      this.schedule();
      return;
    }
    const view = this.scroller.getBoundingClientRect();
    const center = view.top + view.height / 2;
    let best = -1;
    let bestDist = Infinity;
    this.slots.forEach((slot, i) => {
      const r = slot.el.getBoundingClientRect();
      const dist = r.bottom < view.top ? view.top - r.bottom : r.top > view.bottom ? r.top - view.bottom : 0;
      if (dist > view.height * RELEASE_DISTANCE) {
        if (slot.renderedVersion !== -1) this.release(slot);
        return;
      }
      if (dist > view.height * 0.75) return;
      if (!this.needsRender(slot)) return;
      const d = Math.abs((r.top + r.bottom) / 2 - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best >= 0) {
      this.renderSlot(best);
      this.schedule();
    }
  }

  private targetScale(slot: PageSlot): number {
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const wanted = this.zoom * ratio;
    const cap = Math.sqrt(MAX_CANVAS_PIXELS / (slot.width * slot.height));
    return Math.min(wanted, cap);
  }

  private needsRender(slot: PageSlot): boolean {
    if (slot.renderedVersion !== this.version) return true;
    const want = this.targetScale(slot);
    return Math.abs(slot.renderedScale - want) / want > 0.15;
  }

  renderSlot(index: number): void {
    const slot = this.slots[index];
    if (!slot || !this.doc) return;
    const scale = this.targetScale(slot);
    try {
      this.doc.raw.renderPageToCanvas(index, slot.canvas, scale);
    } catch (err) {
      console.warn('page render failed', index, err);
    }
    slot.renderedVersion = this.version;
    slot.renderedScale = scale;
  }

  private release(slot: PageSlot): void {
    slot.canvas.width = 0;
    slot.canvas.height = 0;
    slot.renderedVersion = -1;
    slot.renderedScale = 0;
  }
}
