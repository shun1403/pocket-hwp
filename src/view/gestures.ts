import type { PageView } from './page-view';

export interface GestureHandlers {
  tap(clientX: number, clientY: number): void;
  doubleTap(clientX: number, clientY: number): void;
  longPress(clientX: number, clientY: number): void;
  /** 마우스 끌기 (데스크톱에서 범위 선택) */
  drag?(clientX: number, clientY: number, phase: 'start' | 'move' | 'end'): void;
}

const TAP_SLOP = 10;
const LONG_PRESS_MS = 450;
const DOUBLE_TAP_MS = 300;

interface Pinch {
  d0: number;
  mx: number;
  my: number;
  factor0: number;
  scale: number;
}

function distance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * 페이지 뷰 위의 터치 제스처: 탭, 두 번 탭, 길게 누르기, 두 손가락 확대/축소.
 *
 * 브라우저 기본 확대는 viewport meta로 막고, 핀치는 CSS transform으로 미리 보여 준 뒤
 * 손을 떼면 실제 배율로 다시 그린다.
 */
export function attachGestures(view: PageView, h: GestureHandlers): void {
  const el = view.scroller;
  let start: { x: number; y: number; moved: boolean } | null = null;
  let pressTimer = 0;
  let longPressed = false;
  let pinch: Pinch | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  const clearPress = () => {
    window.clearTimeout(pressTimer);
    pressTimer = 0;
  };

  const emitTap = (x: number, y: number) => {
    const now = performance.now();
    const isDouble = now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < 30;
    if (isDouble) {
      lastTap = { t: 0, x, y };
      h.doubleTap(x, y);
    } else {
      lastTap = { t: now, x, y };
      h.tap(x, y);
    }
  };

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        clearPress();
        start = null;
        const [a, b] = [e.touches[0], e.touches[1]];
        const mx = (a.clientX + b.clientX) / 2;
        const my = (a.clientY + b.clientY) / 2;
        const rect = el.getBoundingClientRect();
        view.inner.style.transformOrigin = `${el.scrollLeft + mx - rect.left}px ${el.scrollTop + my - rect.top}px`;
        pinch = { d0: distance(a, b), mx, my, factor0: view.zoomFactorValue, scale: 1 };
        return;
      }
      if (e.touches.length !== 1 || pinch) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, moved: false };
      longPressed = false;
      clearPress();
      pressTimer = window.setTimeout(() => {
        if (!start || start.moved) return;
        longPressed = true;
        h.longPress(start.x, start.y);
      }, LONG_PRESS_MS);
    },
    { passive: true },
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      if (pinch && e.touches.length >= 2) {
        e.preventDefault();
        const raw = distance(e.touches[0], e.touches[1]) / pinch.d0;
        const min = 0.5 / pinch.factor0;
        const max = 5 / pinch.factor0;
        pinch.scale = Math.min(Math.max(raw, min), max);
        view.inner.style.transform = `scale(${pinch.scale})`;
        return;
      }
      if (!start) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_SLOP) {
        start.moved = true;
        clearPress();
      }
    },
    { passive: false },
  );

  const onEnd = (e: TouchEvent) => {
    if (pinch) {
      if (e.touches.length < 2) {
        const p = pinch;
        pinch = null;
        view.inner.style.transform = '';
        view.setZoomFactor(p.factor0 * p.scale, p.mx, p.my);
      }
      start = null;
      return;
    }
    clearPress();
    if (!start) return;
    const s = start;
    start = null;
    if (e.type === 'touchcancel' || s.moved) return;
    // 합성 click·기본 두 번 탭 확대를 막는다. 길게 누른 뒤에도 막아야 입력칸 포커스(=키보드)가 유지된다.
    if (e.cancelable) e.preventDefault();
    if (!longPressed) emitTap(s.x, s.y);
  };
  el.addEventListener('touchend', onEnd, { passive: false });
  el.addEventListener('touchcancel', onEnd, { passive: false });

  // iOS 사파리의 비표준 확대 제스처 차단
  el.addEventListener('gesturestart', (e) => e.preventDefault());

  attachMouse(el, h, emitTap);
}

function attachMouse(el: HTMLElement, h: GestureHandlers, emitTap: (x: number, y: number) => void): void {
  let down: { x: number; y: number; dragging: boolean } | null = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, dragging: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!down || e.pointerType !== 'mouse') return;
    if (!down.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) {
      down.dragging = true;
      h.drag?.(down.x, down.y, 'start');
    }
    if (down.dragging) h.drag?.(e.clientX, e.clientY, 'move');
  });
  el.addEventListener('pointerup', (e) => {
    if (!down || e.pointerType !== 'mouse') return;
    const d = down;
    down = null;
    if (d.dragging) h.drag?.(e.clientX, e.clientY, 'end');
    else emitTap(e.clientX, e.clientY);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    h.longPress(e.clientX, e.clientY);
  });
}
