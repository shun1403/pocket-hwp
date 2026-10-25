import type { DocPos } from './position';

/** rhwp 스냅샷 API 중 히스토리가 쓰는 부분 */
export interface SnapshotStore {
  saveSnapshot(): number;
  restoreSnapshot(id: number): string;
  discardSnapshot(id: number): void;
}

interface Entry {
  snapshot: number;
  caret: DocPos;
}

/**
 * 스냅샷 기반 실행 취소/다시 실행.
 *
 * 연속 타이핑은 한 단계로 묶는다(`group` 키가 같고 `mergeWindowMs` 안에 들어온 편집).
 */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private lastGroup: string | null = null;
  private lastTime = 0;

  constructor(
    private readonly store: SnapshotStore,
    private readonly limit = 40,
    private readonly mergeWindowMs = 1200,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 편집 직전에 호출한다. */
  record(caret: DocPos, group: string | null = null): void {
    const t = this.now();
    const merge = group !== null && group === this.lastGroup && t - this.lastTime < this.mergeWindowMs;
    this.lastGroup = group;
    this.lastTime = t;
    this.clear(this.redoStack);
    if (merge && this.undoStack.length > 0) return;
    this.undoStack.push({ snapshot: this.store.saveSnapshot(), caret });
    while (this.undoStack.length > this.limit) {
      const dropped = this.undoStack.shift();
      if (dropped) this.store.discardSnapshot(dropped.snapshot);
    }
  }

  /** 편집 묶음을 끊는다 (캐럿 이동 등). */
  breakGroup(): void {
    this.lastGroup = null;
  }

  undo(current: DocPos): DocPos | null {
    return this.step(this.undoStack, this.redoStack, current);
  }

  redo(current: DocPos): DocPos | null {
    return this.step(this.redoStack, this.undoStack, current);
  }

  reset(): void {
    this.clear(this.undoStack);
    this.clear(this.redoStack);
    this.lastGroup = null;
  }

  private step(from: Entry[], to: Entry[], current: DocPos): DocPos | null {
    const entry = from.pop();
    if (!entry) return null;
    to.push({ snapshot: this.store.saveSnapshot(), caret: current });
    this.store.restoreSnapshot(entry.snapshot);
    this.store.discardSnapshot(entry.snapshot);
    this.lastGroup = null;
    return entry.caret;
  }

  private clear(stack: Entry[]): void {
    for (const e of stack) this.store.discardSnapshot(e.snapshot);
    stack.length = 0;
  }
}
