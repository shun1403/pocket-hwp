import type { DocFormat } from './bytes';
import type { FileSource } from './document-files';
import { tx } from './db';
import { searchIndex } from './search-index';

/** 앱 안에 보관하는 문서 (최근 문서 + 자동 저장본) */
export interface LibraryEntry {
  id: string;
  name: string;
  format: DocFormat;
  bytes: Uint8Array;
  size: number;
  pages: number;
  openedAt: number;
  updatedAt: number;
  edited: boolean;
  thumbnail?: string;
  /** 마지막으로 앱 밖(공유·내려받기·백업)으로 내보낸 때 */
  exportedAt?: number;
  /** 최근 목록 맨 위에 고정 */
  pinned?: boolean;
  /** 원래 파일 자리 (다시 저장할 수 있을 때) */
  source?: FileSource;
}

/** 편집한 뒤 아직 앱 밖으로 내보내지 않은 문서인가 (지워지면 되살릴 수 없다) */
export function needsBackup(e: Pick<LibraryEntry, 'edited' | 'updatedAt' | 'exportedAt'>): boolean {
  return e.edited && (e.exportedAt ?? 0) < e.updatedAt;
}

export type LibrarySummary = Omit<LibraryEntry, 'bytes'>;

const STORE = 'documents';

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const library = {
  async list(): Promise<LibrarySummary[]> {
    const all = await tx<LibraryEntry[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<LibraryEntry[]>);
    return all
      .map(({ bytes: _bytes, ...rest }) => rest)
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.openedAt - a.openedAt);
  },
  get(id: string): Promise<LibraryEntry | undefined> {
    return tx<LibraryEntry | undefined>(STORE, 'readonly', (s) => s.get(id) as IDBRequest<LibraryEntry | undefined>);
  },
  async put(entry: LibraryEntry): Promise<void> {
    await tx(STORE, 'readwrite', (s) => s.put(entry));
  },
  /** 앱 밖으로 내보냈다고 표시한다. */
  async markExported(ids: string[], at = Date.now()): Promise<void> {
    for (const id of ids) {
      const e = await library.get(id);
      if (e) await library.put({ ...e, exportedAt: at });
    }
  },
  async all(): Promise<LibraryEntry[]> {
    return tx<LibraryEntry[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<LibraryEntry[]>);
  },
  async remove(id: string): Promise<void> {
    await tx(STORE, 'readwrite', (s) => s.delete(id));
    await searchIndex.remove(id).catch(() => undefined);
  },
};
