import { describe, expect, it } from 'vitest';
import { isShortcutKey, keyName, type KeyLike } from '../../src/editor/keys';
import { nextWordOffset, prevWordOffset } from '../../src/doc/position';

const ev = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('단축키 이름', () => {
  it('한글 입력 상태에서 자모로 와도 글쇠 자리로 알아본다', () => {
    expect(keyName(ev('ㅠ', 'KeyB', { ctrlKey: true }))).toBe('Ctrl+B');
    expect(keyName(ev('Process', 'KeyS', { ctrlKey: true }))).toBe('Ctrl+S');
    expect(keyName(ev('ㅣ', 'KeyL', { altKey: true }))).toBe('Alt+L');
    expect(keyName(ev('¬', 'KeyL', { altKey: true }))).toBe('Alt+L'); // Mac ⌥
  });

  it('⌘ 는 Ctrl 로, 조합 순서는 Ctrl·Alt·Shift', () => {
    expect(keyName(ev('l', 'KeyL', { metaKey: true, shiftKey: true }))).toBe('Ctrl+Shift+L');
    expect(keyName(ev('E', 'KeyE', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+E');
    expect(keyName(ev(']', 'BracketRight', { ctrlKey: true }))).toBe('Ctrl+]');
    expect(keyName(ev('Enter', 'Enter', { ctrlKey: true }))).toBe('Ctrl+Enter');
    expect(keyName(ev('F7', 'F7'))).toBe('F7');
    expect(keyName(ev('F10', 'F10', { ctrlKey: true }))).toBe('Ctrl+F10');
  });

  it('글쇠 자리를 모르면(가상 키보드) 글자로 본다', () => {
    expect(keyName(ev('z', '', { ctrlKey: true }))).toBe('Ctrl+Z');
    expect(keyName(ev('ArrowLeft', ''))).toBe('ArrowLeft');
  });

  it('조합 중에 받아 줄 단축키를 가린다', () => {
    expect(isShortcutKey(ev('Process', 'KeyB', { ctrlKey: true }))).toBe(true);
    expect(isShortcutKey(ev('F7', 'F7'))).toBe(true);
    expect(isShortcutKey(ev('Control', 'ControlLeft', { ctrlKey: true }))).toBe(false);
    expect(isShortcutKey(ev('ㅎ', 'KeyG'))).toBe(false);
    expect(isShortcutKey(ev('Process', 'Space'))).toBe(false);
  });
});

describe('낱말 단위 이동', () => {
  const text = '보고서 초안, 2026년 10월';
  it('다음 낱말 처음으로', () => {
    expect(nextWordOffset(text, 0)).toBe(4);
    expect(nextWordOffset(text, 4)).toBe(6);
    expect(nextWordOffset(text, 6)).toBe(8);
    expect(nextWordOffset(text, 14)).toBe(17);
  });
  it('앞 낱말 처음으로', () => {
    expect(prevWordOffset(text, 17)).toBe(14);
    expect(prevWordOffset(text, 8)).toBe(6);
    expect(prevWordOffset(text, 6)).toBe(4);
    expect(prevWordOffset(text, 2)).toBe(0);
  });
});
