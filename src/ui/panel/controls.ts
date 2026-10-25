import { h, keepFocus } from '../dom';
import { type IconName, icon } from '../icons';

/** 패널 안 묶음: 작은 제목 + 내용 */
export function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section.panel-section', {}, h('h3.panel-label', {}, title), ...children);
}

export interface ButtonSpec {
  label: string;
  content?: Node | string;
  icon?: IconName;
  onClick: () => void;
  /** 눌림 상태를 다시 계산할 때 쓴다 */
  active?: () => boolean;
  disabled?: () => boolean;
  danger?: boolean;
}

/** 상태가 바뀔 때마다 눌림·비활성 표시를 다시 계산하는 버튼들을 모은다. */
export class Bindings {
  private readonly items: { el: HTMLButtonElement; spec: ButtonSpec }[] = [];
  private readonly texts: { el: HTMLElement; value: () => string }[] = [];

  /** 상태에 따라 글이 바뀌는 칸 (현재 글자 크기 등) */
  text(cls: string, value: () => string): HTMLElement {
    const el = h(`output.${cls}` as 'output', {}, value());
    this.texts.push({ el, value });
    return el;
  }

  button(cls: string, spec: ButtonSpec): HTMLButtonElement {
    const body: (Node | string)[] = [];
    if (spec.icon) body.push(icon(spec.icon, 22));
    if (spec.content !== undefined) body.push(spec.content);
    else if (!spec.icon) body.push(spec.label);
    const el = h(`button.${cls}${spec.danger ? '.danger' : ''}` as 'button', { type: 'button', 'aria-label': spec.label, title: spec.label, onclick: spec.onClick }, ...body);
    keepFocus(el);
    this.items.push({ el, spec });
    return el;
  }

  refresh(): void {
    for (const { el, spec } of this.items) {
      if (spec.active) {
        const on = spec.active();
        el.classList.toggle('on', on);
        el.setAttribute('aria-pressed', String(on));
      }
      if (spec.disabled) el.disabled = spec.disabled();
    }
    for (const t of this.texts) t.el.textContent = t.value();
  }
}

/** 같은 크기 버튼이 가로로 꽉 차게 늘어선 줄 (정렬·꾸밈 등) */
export function buttonRow(b: Bindings, specs: ButtonSpec[]): HTMLElement {
  return h('div.btn-row', {}, ...specs.map((s) => b.button('seg', s)));
}

/** 줄바꿈되는 칩 묶음 (크기·줄 간격 등) */
export function chips(b: Bindings, specs: ButtonSpec[]): HTMLElement {
  return h('div.chips', {}, ...specs.map((s) => b.button('chip-btn', s)));
}

/** 아이콘 + 이름 타일 (입력 탭) */
export function tiles(b: Bindings, specs: ButtonSpec[]): HTMLElement {
  return h(
    'div.tiles',
    {},
    ...specs.map((s) => {
      const el = b.button('tile', { ...s, content: h('span.tile-label', {}, s.label) });
      return el;
    }),
  );
}

/** − 값 + */
export function stepper(b: Bindings, label: string, value: () => string, dec: () => void, inc: () => void): HTMLElement {
  return h(
    'div.stepper-row',
    {},
    h('span.stepper-label', {}, label),
    b.button('round', { label: `${label} 줄이기`, icon: 'minus', onClick: dec }),
    b.text('stepper-value', value),
    b.button('round', { label: `${label} 늘리기`, icon: 'plus', onClick: inc }),
  );
}

/** 색 고르기. none 이면 맨 앞에 "없음"을 둔다. */
export function swatches(b: Bindings, colors: string[], current: () => string | undefined, pick: (c: string | null) => void, none?: string): HTMLElement {
  const items: HTMLElement[] = [];
  if (none) {
    items.push(b.button('swatch.none', { label: none, content: h('span.swatch-x', { 'aria-hidden': 'true' }), onClick: () => pick(null) }));
  }
  for (const c of colors) {
    const el = b.button('swatch', {
      label: c,
      content: '',
      onClick: () => pick(c),
      active: () => current()?.toLowerCase() === c,
    });
    el.style.setProperty('--swatch', c);
    items.push(el);
  }
  return h('div.swatches', {}, ...items);
}
