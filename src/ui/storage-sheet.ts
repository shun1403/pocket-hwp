import { backupFileName, createBackup, restoreBackup } from '../app/backup';
import { isNative, pickFile, shareFile } from '../platform/files';
import { library } from '../platform/library';
import { isIosBrowserTab, requestPersistence, storageStatus } from '../platform/storage';
import { h } from './dom';
import { icon } from './icons';
import { Sheet } from './sheet';
import { toast } from './toast';

function mb(bytes: number | undefined): string {
  if (bytes === undefined) return '-';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 보관함 전체를 ZIP으로 내보낸다. 성공하면 true */
export async function backupAll(): Promise<boolean> {
  const { zip, count, ids } = await createBackup();
  if (count === 0) {
    toast('백업할 문서가 없어요.');
    return false;
  }
  const result = await shareFile(backupFileName(), zip, 'application/zip');
  if (result === 'cancelled') return false;
  await library.markExported(ids);
  toast(result === 'downloaded' ? `문서 ${count}개를 백업 파일로 내려받았어요.` : `문서 ${count}개를 백업했어요.`);
  return true;
}

export async function restoreFromFile(): Promise<boolean> {
  const file = await pickFile('.zip,application/zip');
  if (!file) return false;
  try {
    const r = await restoreBackup(new Uint8Array(await file.arrayBuffer()));
    const parts = [r.added && `${r.added}개 추가`, r.updated && `${r.updated}개 새 버전으로 바꿈`, r.skipped && `${r.skipped}개는 이미 최신`].filter(Boolean);
    toast(parts.length ? `백업에서 불러왔어요: ${parts.join(', ')}` : '백업 안에 한글 문서가 없어요.');
    return true;
  } catch {
    toast('백업 파일을 읽지 못했어요. Pocket HWP 백업(.zip)인지 확인해 주세요.');
    return false;
  }
}

/** 보관함 관리: 보관 상태, 전체 백업, 백업 불러오기 */
export async function openStorageSheet(onChange: () => void): Promise<void> {
  const sheet = new Sheet({ title: '보관함 관리' });
  const status = await storageStatus();
  const docs = await library.list().catch(() => []);
  const state = h('div.storage-state', { class: status.persisted ? 'safe' : 'warn' });
  const renderState = (persisted: boolean) => {
    state.className = `storage-state ${persisted ? 'safe' : 'warn'}`;
    state.replaceChildren(
      icon('shield', 26),
      h(
        'div',
        {},
        h('strong', {}, persisted ? '이 기기에 안전하게 보관 중이에요' : '브라우저가 지울 수 있는 상태예요'),
        h(
          'p',
          {},
          persisted
            ? isNative
              ? '앱을 지우기 전까지 문서가 이 기기에 남아요.'
              : '브라우저 데이터를 직접 지우기 전까지 문서를 지우지 않아요.'
            : '저장 공간이 부족하거나 오래 쓰지 않으면 브라우저가 보관함을 비울 수 있어요.',
        ),
      ),
    );
  };
  renderState(status.persisted);
  const ask = status.persisted
    ? null
    : h(
        'button.secondary-btn.full',
        {
          onclick: async () => {
            const ok = await requestPersistence();
            renderState(ok);
            toast(ok ? '보관함을 지우지 않도록 설정했어요.' : '브라우저가 허락하지 않았어요. 홈 화면에 추가하거나 백업해 두세요.');
            if (ok) ask?.remove();
          },
        },
        '지우지 않도록 요청하기',
      );
  sheet.body.append(state);
  if (ask) sheet.body.append(ask);
  sheet.body.append(
    h(
      'dl.info-list',
      {},
      h('dt', {}, '문서'),
      h('dd', {}, `${docs.length}개`),
      h('dt', {}, '사용 공간'),
      h('dd', {}, status.quota ? `${mb(status.usage)} / ${mb(status.quota)}` : mb(status.usage)),
    ),
    h(
      'button.sheet-row',
      { onclick: async () => (sheet.close(), (await backupAll()) && onChange()) },
      icon('archive'),
      h('span.row-text', {}, h('span', {}, '모두 백업하기 (.zip)'), h('span.row-sub', {}, '파일 앱·드라이브에 저장해 두면 기기를 바꿔도 되살릴 수 있어요')),
    ),
    h(
      'button.sheet-row',
      { onclick: async () => (sheet.close(), (await restoreFromFile()) && onChange()) },
      icon('upload'),
      h('span.row-text', {}, h('span', {}, '백업에서 불러오기'), h('span.row-sub', {}, '이미 있는 문서는 더 새것일 때만 바꿔요')),
    ),
    h(
      'p.sheet-note',
      {},
      '문서는 이 기기 안에만 저장되고 서버로 보내지 않아요. 앱을 지우거나 브라우저 데이터를 지우면 함께 지워지니, 중요한 문서는 보내기나 백업으로 밖에 저장해 두세요.',
    ),
  );
  if (isIosBrowserTab()) sheet.body.append(homeScreenHelp());
  sheet.open();
}

/** 아이폰 사파리에서 홈 화면에 추가하는 방법 */
export function homeScreenHelp(): HTMLElement {
  return h(
    'div.howto',
    {},
    h('strong', {}, '홈 화면에 추가하는 방법'),
    h('ol', {}, h('li', {}, '사파리 아래쪽 공유 버튼(□↑)을 눌러요.'), h('li', {}, '“홈 화면에 추가”를 고르고 “추가”를 눌러요.'), h('li', {}, '이제 홈 화면의 Pocket HWP 아이콘으로 열어요.')),
    h('p.muted', {}, '사파리 탭과 홈 화면 앱은 보관함이 따로예요. 탭에서 고친 문서는 백업한 뒤 홈 화면 앱에서 불러오세요.'),
  );
}
