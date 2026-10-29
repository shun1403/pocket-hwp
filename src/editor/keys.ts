/** 단축키 이름에 필요한 키 이벤트 속성 (테스트에서 흉내 내기 쉽게 좁힌다) */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const CODE_NAMES: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Space: 'Space',
};

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'HangulMode', 'HanjaMode']);

/**
 * 키 이벤트를 'Ctrl+Shift+L', 'Alt+L', 'F7', 'Ctrl+Enter' 같은 이름으로 바꾼다.
 *
 * 한글 입력 상태에서는 e.key 가 'ㅠ' 처럼 자모로 오므로 글쇠 자리(e.code)를 먼저 본다.
 * Mac 의 ⌘ 는 Ctrl 로 친다.
 */
export function keyName(e: KeyLike): string {
  const code = e.code ?? '';
  let base: string;
  if (/^Key[A-Z]$/.test(code)) base = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) base = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) base = code.slice(6);
  else if (/^F[0-9]{1,2}$/.test(code)) base = code;
  else if (CODE_NAMES[code]) base = CODE_NAMES[code];
  else if (code === 'NumpadEnter') base = 'Enter';
  else if (e.key === ' ') base = 'Space';
  else base = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean);
  return [...mods, base].join('+');
}

/** 글자 입력이 아닌 단축키 조합인가 (Ctrl·Alt·⌘ 를 누른 채, 또는 기능 키) */
export function isShortcutKey(e: KeyLike): boolean {
  if (MODIFIER_KEYS.has(e.key) || /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(e.code ?? '')) return false;
  return e.ctrlKey || e.metaKey || e.altKey || /^F[0-9]{1,2}$/.test(e.code || e.key);
}
