import { SENTINEL, compositionText, diffInput, type InputAction } from '../doc/input-diff';

export interface TextInputHandlers {
  actions(actions: InputAction[]): void;
  composing(text: string | null): void;
  key(e: KeyboardEvent): boolean;
  /** html 이 있으면 서식 있는 붙여넣기 */
  paste(text: string, html: string | null): void;
}

/**
 * 가상 키보드와 문서 엔진 사이의 다리.
 *
 * 화면에 보이지 않는 textarea가 포커스를 받아 키보드를 띄우고, 입력이 끝날 때마다
 * 값 변화를 해석해 문서 편집 동작으로 바꾼다. 한글 조합 중에는 값을 건드리지 않는다.
 */
export class TextInput {
  readonly el: HTMLTextAreaElement;
  private composing = false;

  constructor(private readonly h: TextInputHandlers) {
    const ta = document.createElement('textarea');
    ta.className = 'ime-input';
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('aria-label', '문서 입력');
    ta.setAttribute('enterkeyhint', 'enter');
    this.el = ta;
    this.reset();

    ta.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    ta.addEventListener('compositionend', () => {
      this.composing = false;
      this.flush();
    });
    ta.addEventListener('input', (e) => {
      if (this.composing || (e as InputEvent).isComposing) {
        this.h.composing(compositionText(ta.value));
        return;
      }
      this.flush();
    });
    ta.addEventListener('keydown', (e) => {
      if (this.composing || e.isComposing || e.keyCode === 229) return;
      if (this.h.key(e)) e.preventDefault();
    });
    ta.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const html = e.clipboardData?.getData('text/html') || null;
      e.preventDefault();
      if (text || html) this.h.paste(text, html);
    });
    // 선택 위치가 표식 앞으로 가면 Backspace 감지가 깨진다.
    ta.addEventListener('select', () => this.keepCaretAtEnd());
  }

  get isComposing(): boolean {
    return this.composing;
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
    this.keepCaretAtEnd();
  }

  blur(): void {
    this.el.blur();
  }

  get focused(): boolean {
    return document.activeElement === this.el;
  }

  /** 화면에 그려진 캐럿 위치로 옮겨 iOS 확대경·키보드 후보창이 엉뚱한 곳에 뜨지 않게 한다. */
  moveTo(clientX: number, clientY: number, height: number): void {
    const s = this.el.style;
    s.left = `${Math.round(clientX)}px`;
    s.top = `${Math.round(clientY)}px`;
    s.height = `${Math.max(16, Math.round(height))}px`;
  }

  /** 조합을 강제로 끝낸다 (캐럿을 다른 곳으로 옮기기 전). */
  commitComposition(): void {
    if (!this.composing) return;
    this.composing = false;
    this.flush();
    // 키보드의 조합 상태를 끊기 위해 포커스를 잠깐 뺐다 되돌린다.
    if (this.focused) {
      this.el.blur();
      this.focus();
    }
  }

  private flush(): void {
    const actions = diffInput(this.el.value);
    this.reset();
    this.h.composing(null);
    if (actions.length > 0) this.h.actions(actions);
  }

  private reset(): void {
    if (this.el.value !== SENTINEL) this.el.value = SENTINEL;
    this.keepCaretAtEnd();
  }

  private keepCaretAtEnd(): void {
    if (this.composing) return;
    const end = this.el.value.length;
    if (this.el.selectionStart !== end || this.el.selectionEnd !== end) this.el.setSelectionRange(end, end);
  }
}
