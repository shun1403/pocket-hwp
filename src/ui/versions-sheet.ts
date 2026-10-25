import type { DocumentSession } from '../app/session';
import { baseName } from '../platform/bytes';
import { library } from '../platform/library';
import { type VersionSummary, versions } from '../platform/versions';
import { askConfirm } from './dialog';
import { h } from './dom';
import { icon } from './icons';
import { Sheet } from './sheet';
import { toast } from './toast';

export interface VersionActions {
  /** 보관함의 문서를 다시 연다 (되돌린 내용을 보여 준다) */
  reopen(id: string): void;
  /** 새 문서로 연다 */
  openCopy(name: string, bytes: Uint8Array): void;
}

const REASON: Record<VersionSummary['reason'], string> = {
  original: '처음 연 상태',
  auto: '자동 저장',
  restore: '되돌리기 전 내용',
};

function when(t: number): string {
  return new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function kb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 버전 기록: 예전 내용으로 되돌리거나 사본으로 연다. */
export async function openVersionsSheet(session: DocumentSession, actions: VersionActions): Promise<void> {
  await session.save();
  const list = await versions.list(session.id).catch(() => [] as VersionSummary[]);
  const sheet = new Sheet({ title: '버전 기록' });
  if (list.length === 0) {
    sheet.body.append(h('p.sheet-note', {}, '아직 남겨 둔 버전이 없어요. 편집하는 동안 10분마다, 그리고 문서를 닫을 때 버전을 남겨요.'));
    sheet.open();
    return;
  }
  sheet.body.append(h('p.sheet-note', {}, `편집하는 동안 10분마다, 그리고 문서를 닫을 때 버전을 남겨요. 문서마다 최근 ${20}개와 처음 연 상태를 보관해요.`));
  for (const v of list) {
    sheet.body.append(
      h(
        'button.sheet-row.version-row',
        { onclick: () => (sheet.close(), void pick(session, v, actions)) },
        icon(v.reason === 'original' ? 'archive' : 'clock'),
        h('span.version-text', {}, h('strong', {}, when(v.at)), h('span.muted', {}, `${REASON[v.reason]} · ${kb(v.size)}`)),
      ),
    );
  }
  sheet.open();
}

async function pick(session: DocumentSession, v: VersionSummary, actions: VersionActions): Promise<void> {
  const sheet = new Sheet({ title: `${when(v.at)} · ${REASON[v.reason]}` });
  const row = (name: Parameters<typeof icon>[0], label: string, run: () => void) =>
    h('button.sheet-row', { onclick: () => (sheet.close(), run()) }, icon(name), label);
  sheet.body.append(
    row('undo', '이 버전으로 되돌리기', () => void restore(session, v, actions)),
    row('filePlus', '사본으로 열기', () => void openCopy(v, actions)),
  );
  sheet.open();
}

async function restore(session: DocumentSession, v: VersionSummary, actions: VersionActions): Promise<void> {
  const ok = await askConfirm({
    title: '이 버전으로 되돌릴까요?',
    message: '지금 내용은 버전 기록에 남겨 두니, 다시 돌아올 수 있어요.',
    confirmLabel: '되돌리기',
  });
  if (!ok) return;
  const full = await versions.get(v.key!);
  const entry = await library.get(session.id);
  if (!full || !entry) {
    toast('버전을 찾지 못했어요.');
    return;
  }
  await session.keepCurrentVersion();
  await library.put({
    ...entry,
    bytes: full.bytes,
    format: full.format,
    name: `${baseName(entry.name)}.${full.format}`,
    size: full.bytes.length,
    updatedAt: Date.now(),
    edited: true,
    thumbnail: undefined,
  });
  actions.reopen(session.id);
  toast('되돌렸어요.');
}

async function openCopy(v: VersionSummary, actions: VersionActions): Promise<void> {
  const full = await versions.get(v.key!);
  if (!full) {
    toast('버전을 찾지 못했어요.');
    return;
  }
  const stamp = new Date(v.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  actions.openCopy(`${baseName(full.name)} (${stamp} 버전).${full.format}`, full.bytes);
}
