import { backScope } from '../app/back';
import { h } from './dom';

export interface SheetOptions {
  title: string;
  /** 키보드를 유지해야 하는 편집 중 시트면 true (배경 탭으로 닫혀도 포커스를 돌려준다) */
  onClose?: () => void;
}

/**
 * 아래에서 올라오는 시트. 손잡이를 아래로 끌거나 배경을 탭하면 닫힌다.
 * 모바일에서 한 손으로 닿는 화면 아래쪽에 선택지를 모은다.
 */
export class Sheet {
  readonly body: HTMLDivElement;
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private closed = false;
  private back: { dismiss: () => void } | null = null;

  constructor(private readonly opts: SheetOptions) {
    this.body = h('div.sheet-body');
    const grip = h('div.sheet-grip', { 'aria-hidden': 'true' });
    this.panel = h(
      'div.sheet-panel',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
      grip,
      h('div.sheet-title', {}, opts.title),
      this.body,
    );
    this.root = h('div.sheet', {}, h('div.sheet-backdrop', { onclick: () => this.close() }), this.panel);
    this.attachDrag(grip);
  }

  open(): this {
    document.body.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('open'));
    document.addEventListener('keydown', this.onKey);
    this.back = backScope(() => this.close());
    return this;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.back?.dismiss();
    document.removeEventListener('keydown', this.onKey);
    this.root.classList.remove('open');
    window.setTimeout(() => this.root.remove(), 250);
    this.opts.onClose?.();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  private attachDrag(grip: HTMLElement): void {
    let startY = 0;
    let dy = 0;
    const targets = [grip, this.panel.querySelector('.sheet-title') as HTMLElement];
    for (const t of targets) {
      t.addEventListener(
        'touchstart',
        (e) => {
          startY = e.touches[0].clientY;
          dy = 0;
          this.panel.style.transition = 'none';
        },
        { passive: true },
      );
      t.addEventListener(
        'touchmove',
        (e) => {
          dy = Math.max(0, e.touches[0].clientY - startY);
          this.panel.style.transform = `translateY(${dy}px)`;
        },
        { passive: true },
      );
      t.addEventListener('touchend', () => {
        this.panel.style.transition = '';
        this.panel.style.transform = '';
        if (dy > 80) this.close();
      });
    }
  }
}
