import type { Profile } from '../doc/ops/autofill';
import { tx } from './db';
import { newId } from './library';

/**
 * 내 정보(이름·연락처·주소 등)를 이 기기의 보관함에만 둔다. 외부로 보내지 않는다.
 * 주민등록번호는 저장 항목에 없다.
 */
export const profiles = {
  async list(): Promise<Profile[]> {
    const all = await tx<Profile[]>('profiles', 'readonly', (s) => s.getAll() as IDBRequest<Profile[]>);
    // 나(self)를 먼저, 그다음 이름표 순서
    return all.sort((a, b) => Number(b.kind === 'self') - Number(a.kind === 'self') || a.label.localeCompare(b.label, 'ko'));
  },
  async save(p: Omit<Profile, 'id' | 'updatedAt'> & { id?: string }): Promise<Profile> {
    const values = Object.fromEntries(Object.entries(p.values).filter(([, v]) => v?.trim()));
    const next: Profile = { ...p, id: p.id ?? newId(), values, updatedAt: Date.now() };
    await tx('profiles', 'readwrite', (s) => s.put(next));
    return next;
  },
  /** 백업에서 되살릴 때: 받은 그대로 넣는다. */
  async put(p: Profile): Promise<void> {
    await tx('profiles', 'readwrite', (s) => s.put(p));
  },
  async remove(id: string): Promise<void> {
    await tx('profiles', 'readwrite', (s) => s.delete(id));
  },
};
