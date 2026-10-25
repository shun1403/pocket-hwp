import type { DocFormat } from './bytes';

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
}

export type LibrarySummary = Omit<LibraryEntry, 'bytes'>;

const DB_NAME = 'pocket-hwp';
const STORE = 'documents';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const library = {
  async list(): Promise<LibrarySummary[]> {
    const all = await tx<LibraryEntry[]>('readonly', (s) => s.getAll() as IDBRequest<LibraryEntry[]>);
    return all
      .map(({ bytes: _bytes, ...rest }) => rest)
      .sort((a, b) => b.openedAt - a.openedAt);
  },
  get(id: string): Promise<LibraryEntry | undefined> {
    return tx<LibraryEntry | undefined>('readonly', (s) => s.get(id) as IDBRequest<LibraryEntry | undefined>);
  },
  async put(entry: LibraryEntry): Promise<void> {
    await tx('readwrite', (s) => s.put(entry));
  },
  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  },
};
