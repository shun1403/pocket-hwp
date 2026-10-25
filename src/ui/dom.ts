type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

/** 작은 DOM 생성 도우미: h('button.primary', { onclick }, '열기') */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}`,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name as K);
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      el.className = `${el.className} ${String(value)}`.trim();
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/**
 * 버튼을 눌러도 문서 입력칸에서 포커스(=키보드)가 빠지지 않게 한다.
 * 편집 툴바·선택 메뉴 버튼에 쓴다.
 */
export function keepFocus(el: HTMLElement): HTMLElement {
  el.addEventListener('pointerdown', (e) => e.preventDefault());
  el.addEventListener('mousedown', (e) => e.preventDefault());
  return el;
}
