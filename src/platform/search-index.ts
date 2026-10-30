import { tx } from './db';

/**
 * 보관함 전체 검색용 본문 글. 문서를 저장할 때마다 글만 뽑아 둔다(문서 하나에 수십 KB).
 * 암호 문서는 넣지 않는다(암호를 건 뜻을 지키려고). 다시 만들 수 있으니 백업에는 넣지 않는다.
 */
export interface IndexedText {
  id: string;
  /** 이 글을 뽑은 문서의 updatedAt */
  updatedAt: number;
  text: string;
  /** 암호 문서처럼 글을 뽑지 않기로 한 문서 */
  skipped?: boolean;
}

export const searchIndex = {
  async all(): Promise<IndexedText[]> {
    return tx<IndexedText[]>('search', 'readonly', (s) => s.getAll() as IDBRequest<IndexedText[]>);
  },
  async put(entry: IndexedText): Promise<void> {
    await tx('search', 'readwrite', (s) => s.put(entry));
  },
  async remove(id: string): Promise<void> {
    await tx('search', 'readwrite', (s) => s.delete(id));
  },
};
