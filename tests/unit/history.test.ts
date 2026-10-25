import { describe, expect, it } from 'vitest';
import { History, type SnapshotStore } from '../../src/doc/history';

/** 문자열 하나를 문서로 보는 가짜 스냅샷 저장소 */
class FakeDoc implements SnapshotStore {
  text = '';
  private snaps = new Map<number, string>();
  private next = 0;
  saveSnapshot(): number {
    this.snaps.set(this.next, this.text);
    return this.next++;
  }
  restoreSnapshot(id: number): string {
    this.text = this.snaps.get(id) ?? '';
    return '{"ok":true}';
  }
  discardSnapshot(id: number): void {
    this.snaps.delete(id);
  }
  get live(): number {
    return this.snaps.size;
  }
}

const caret = (offset: number) => ({ sec: 0, para: 0, offset });

describe('History', () => {
  it('실행 취소와 다시 실행', () => {
    const doc = new FakeDoc();
    let t = 0;
    const h = new History(doc, 10, 1000, () => t);
    h.record(caret(0));
    doc.text = 'a';
    t += 5000;
    h.record(caret(1));
    doc.text = 'ab';
    expect(h.undo(caret(2))).toEqual(caret(1));
    expect(doc.text).toBe('a');
    expect(h.redo(caret(1))).toEqual(caret(2));
    expect(doc.text).toBe('ab');
  });

  it('연속 타이핑은 한 단계로 묶는다', () => {
    const doc = new FakeDoc();
    let t = 0;
    const h = new History(doc, 10, 1000, () => t);
    for (const ch of 'abc') {
      h.record(caret(doc.text.length), 'type');
      doc.text += ch;
      t += 100;
    }
    h.undo(caret(3));
    expect(doc.text).toBe('');
    expect(h.canUndo).toBe(false);
  });

  it('새 편집은 다시 실행 기록을 버리고 스냅샷을 해제한다', () => {
    const doc = new FakeDoc();
    const h = new History(doc, 10, 0);
    h.record(caret(0));
    doc.text = 'a';
    h.undo(caret(1));
    expect(h.canRedo).toBe(true);
    h.record(caret(0));
    expect(h.canRedo).toBe(false);
    expect(doc.live).toBe(1);
  });

  it('한도를 넘으면 오래된 스냅샷부터 해제한다', () => {
    const doc = new FakeDoc();
    const h = new History(doc, 3, 0);
    for (let i = 0; i < 6; i += 1) h.record(caret(i));
    expect(doc.live).toBe(3);
  });
});
