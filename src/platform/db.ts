/**
 * 앱 보관함 IndexedDB. 문서(documents), 문서별 이전 버전(versions), 저장한 서명(signatures),
 * 컴퓨터 브라우저에서 연 원래 파일 핸들(handles, 문서 id 별), 내 정보(profiles)를 둔다.
 * 모든 데이터는 이 기기 안에만 있다.
 */
const DB_NAME = 'pocket-hwp';
const DB_VERSION = 3;

export type StoreName = 'documents' | 'versions' | 'signatures' | 'handles' | 'profiles';

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('versions')) {
        const versions = db.createObjectStore('versions', { keyPath: 'key', autoIncrement: true });
        versions.createIndex('docId', 'docId');
      }
      if (!db.objectStoreNames.contains('signatures')) db.createObjectStore('signatures', { keyPath: 'id' });
      // 파일 핸들은 문서 목록과 따로 둔다: 목록을 읽을 때마다 핸들을 되살리지 않도록.
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 저장소 하나에 대한 트랜잭션. fn 이 돌려준 요청의 결과를 트랜잭션이 끝난 뒤 돌려준다. */
export async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => {
      db.close();
      resolve(req ? req.result : (undefined as T));
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
    t.onabort = () => {
      db.close();
      reject(t.error ?? new Error('transaction aborted'));
    };
  });
}
