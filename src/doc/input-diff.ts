/**
 * 숨은 textarea 기반 입력 해석.
 *
 * 모바일 가상 키보드(특히 안드로이드 Gboard·삼성 키보드)는 빈 입력칸에서 Backspace를
 * 보내지 않고, beforeinput 취소도 일관되지 않다. 그래서 textarea에 보이지 않는 표식 문자를
 * 하나 넣어 두고, 입력 이벤트가 끝난 뒤의 값을 표식과 비교해 "무엇이 일어났는지"를 알아낸다.
 */
export const SENTINEL = '​';

export type InputAction =
  | { kind: 'insert'; text: string }
  | { kind: 'enter' }
  | { kind: 'backspace'; count: number };

export function diffInput(value: string): InputAction[] {
  if (value === SENTINEL) return [];
  if (!value.startsWith(SENTINEL)) {
    const rest = value.split(SENTINEL).join('');
    if (rest.length === 0) return [{ kind: 'backspace', count: 1 }];
    return textActions(rest);
  }
  return textActions(value.slice(SENTINEL.length).split(SENTINEL).join(''));
}

function textActions(text: string): InputAction[] {
  const actions: InputAction[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, i) => {
      if (i > 0) actions.push({ kind: 'enter' });
      if (line.length > 0) actions.push({ kind: 'insert', text: line });
    });
  return actions;
}

/** 조합 중인 글자(미리보기용) */
export function compositionText(value: string): string {
  return value.split(SENTINEL).join('');
}
