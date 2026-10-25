import { h } from './dom';

let host: HTMLElement | null = null;

/** 화면 아래에 잠깐 떴다 사라지는 알림 */
export function toast(message: string, ms = 2200): void {
  host ??= document.body.appendChild(h('div.toast-host', { role: 'status', 'aria-live': 'polite' }));
  const el = h('div.toast', {}, message);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => {
    el.classList.remove('show');
    window.setTimeout(() => el.remove(), 300);
  }, ms);
}
