import type { DocFormat } from './bytes';
import { tx } from './db';

/**
 * 문서별 이전 버전. 자동 저장이 덮어써도 예전 내용으로 돌아갈 수 있게 한다.
 * - original: 처음 열었을 때의 파일 (지우지 않는다)
 * - auto: 편집하는 동안 일정 시간마다 남기는 버전
 * - restore: 다른 버전으로 되돌리기 직전의 내용
 */
export interface DocVersion {
  key?: number;
  docId: string;
  at: number;
  name: string;
  format: DocFormat;
  size: number;
  bytes: Uint8Array;
  reason: 'original' | 'auto' | 'restore';
}

export type VersionSummary = Omit<DocVersion, 'bytes'>;

/** 문서마다 남기는 자동 버전 수 (처음 상태는 따로 하나 더) */
export const MAX_VERSIONS = 20;
/** 자동 버전 사이 최소 간격 */
export const VERSION_INTERVAL_MS = 10 * 60_000;

async function forDoc(docId: string): Promise<DocVersion[]> {
  const all = await tx<DocVersion[]>('versions', 'readonly', (s) => s.index('docId').getAll(docId) as IDBRequest<DocVersion[]>);
  return all.sort((a, b) => b.at - a.at);
}

/** 오래된 자동 버전을 지울 key 목록 (처음 상태는 남긴다) */
export function versionsToPrune(list: Pick<DocVersion, 'key' | 'at' | 'reason'>[], max = MAX_VERSIONS): number[] {
  return [...list]
    .filter((v) => v.reason !== 'original')
    .sort((a, b) => b.at - a.at)
    .slice(max)
    .map((v) => v.key!)
    .filter((k) => k !== undefined);
}

export const versions = {
  async list(docId: string): Promise<VersionSummary[]> {
    return (await forDoc(docId)).map(({ bytes: _b, ...rest }) => rest);
  },
  get(key: number): Promise<DocVersion | undefined> {
    return tx<DocVersion | undefined>('versions', 'readonly', (s) => s.get(key) as IDBRequest<DocVersion | undefined>);
  },
  async add(v: Omit<DocVersion, 'key'>): Promise<void> {
    await tx('versions', 'readwrite', (s) => s.add(v));
    const stale = versionsToPrune(await forDoc(v.docId));
    if (stale.length) await tx('versions', 'readwrite', (s) => void stale.forEach((k) => s.delete(k)));
  },
  async latestAt(docId: string): Promise<number> {
    return (await forDoc(docId))[0]?.at ?? 0;
  },
  async hasOriginal(docId: string): Promise<boolean> {
    return (await forDoc(docId)).some((v) => v.reason === 'original');
  },
  async removeAll(docId: string): Promise<void> {
    const keys = (await forDoc(docId)).map((v) => v.key!);
    if (keys.length) await tx('versions', 'readwrite', (s) => void keys.forEach((k) => s.delete(k)));
  },
};
