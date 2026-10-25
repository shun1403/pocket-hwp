import { baseName } from '../platform/bytes';
import { type LibrarySummary, library, needsBackup, newId } from '../platform/library';
import { readPref, writePref } from '../platform/prefs';
import { isIosBrowserTab } from '../platform/storage';
import { versions } from '../platform/versions';
import { fileHandles } from '../platform/document-files';
import { askConfirm, askText } from './dialog';
import { h } from './dom';
import { icon } from './icons';
import { Sheet } from './sheet';
import { toast } from './toast';
import { backupAll, homeScreenHelp, openStorageSheet } from './storage-sheet';

export interface HomeActions {
  openFile(): void;
  newDocument(): void;
  openSample(): void;
  openEntry(id: string): void;
  shareEntry(id: string): void;
  about(): void;
}

function relativeTime(t: number): string {
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(t).toLocaleDateString('ko-KR');
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 첫 화면: 큰 "열기/새 문서" 버튼과 최근 문서 목록 */
export class HomeScreen {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly notices = h('div.notices');
  private readonly searchBox = h('input.home-search', {
    type: 'search',
    placeholder: '문서 이름으로 찾기',
    'aria-label': '최근 문서 찾기',
    enterkeyhint: 'search',
  }) as HTMLInputElement;
  private items: LibrarySummary[] = [];

  constructor(private readonly actions: HomeActions) {
    this.list = h('div.recent-list', { role: 'list' });
    this.el = h(
      'main.screen.home',
      {},
      h(
        'header.home-header',
        {},
        h('div.brand', {}, h('img.brand-mark', { src: './icons/icon.svg', alt: '', width: 36, height: 36 }), h('span', {}, 'Pocket HWP')),
        h(
          'div.header-actions',
          {},
          h('button.icon-btn', { 'aria-label': '보관함 관리', onclick: () => void openStorageSheet(() => void this.refresh()) }, icon('shield')),
          h('button.icon-btn', { 'aria-label': '앱 정보', onclick: () => actions.about() }, icon('info')),
        ),
      ),
      h(
        'section.home-actions',
        {},
        h(
          'button.action-card.primary',
          { onclick: () => actions.openFile() },
          icon('folder', 28),
          h('span.action-title', {}, '문서 열기'),
          h('span.action-sub', {}, 'HWP · HWPX 파일'),
        ),
        h(
          'button.action-card',
          { onclick: () => actions.newDocument() },
          icon('filePlus', 28),
          h('span.action-title', {}, '새 문서'),
          h('span.action-sub', {}, '빈 문서로 시작'),
        ),
      ),
      this.notices,
      h('h2.section-title', {}, '최근 문서'),
      this.searchBox,
      this.list,
    );
    this.searchBox.hidden = true;
    this.searchBox.addEventListener('input', () => this.renderList());
    this.attachDrop();
  }

  async refresh(): Promise<void> {
    let items: LibrarySummary[] = [];
    try {
      items = await library.list();
    } catch {
      // 사생활 보호 모드 등에서 IndexedDB가 막혀 있으면 빈 목록으로 둔다.
    }
    this.items = items;
    this.renderNotices(items);
    // 문서가 몇 개 안 되면 찾기 칸은 자리만 차지한다.
    this.searchBox.hidden = items.length < 5;
    if (this.searchBox.hidden) this.searchBox.value = '';
    this.renderList();
  }

  private renderList(): void {
    const items = this.items;
    this.list.replaceChildren();
    if (items.length === 0) {
      this.list.append(
        h(
          'div.empty',
          {},
          h('div.empty-art', { 'aria-hidden': 'true' }, '📄'),
          h('p', {}, '아직 연 문서가 없어요.'),
          h('p.muted', {}, '메일·메신저로 받은 한글 파일을 열거나, 다른 앱에서 “Pocket HWP로 열기”를 선택하세요.'),
          h('button.sample-btn', { onclick: () => this.actions.openSample() }, icon('sparkles', 20), '샘플 문서로 둘러보기'),
        ),
      );
      return;
    }
    const query = this.searchBox.value.trim().toLowerCase();
    const shown = query ? items.filter((i) => i.name.toLowerCase().includes(query)) : items;
    if (shown.length === 0) this.list.append(h('p.empty-search', {}, `“${this.searchBox.value.trim()}”이(가) 들어간 문서가 없어요.`));
    for (const item of shown) this.list.append(this.card(item));
  }

  /** 데이터가 사라질 수 있는 상황을 알려 주는 안내 카드 */
  private renderNotices(items: LibrarySummary[]): void {
    this.notices.replaceChildren();
    const unbacked = items.filter(needsBackup).length;
    if (unbacked > 0) {
      this.notices.append(
        h(
          'div.notice',
          {},
          icon('shield', 22),
          h('div.notice-text', {}, h('strong', {}, `편집한 문서 ${unbacked}개가 이 기기에만 있어요`), h('span', {}, '백업해 두면 앱을 지우거나 기기를 바꿔도 되살릴 수 있어요.')),
          h('button.notice-btn', { onclick: async () => (await backupAll()) && void this.refresh() }, '백업'),
        ),
      );
    }
    if (isIosBrowserTab() && !dismissed('ios-home-screen')) {
      const card: HTMLElement = h(
        'div.notice.info',
        {},
        icon('homeAdd', 22),
        h('div.notice-text', {}, h('strong', {}, '홈 화면에 추가해서 쓰세요'), h('span', {}, '사파리 탭에서는 오래 쓰지 않으면 문서가 지워질 수 있어요.')),
        h(
          'button.notice-btn',
          {
            onclick: () => {
              const sheet = new Sheet({ title: '홈 화면에 추가' });
              sheet.body.append(homeScreenHelp());
              sheet.open();
            },
          },
          '방법',
        ),
        h('button.icon-btn.notice-close', { 'aria-label': '안내 닫기', onclick: () => (dismiss('ios-home-screen'), card.remove()) }, icon('close', 18)),
      );
      this.notices.append(card);
    }
  }

  private card(item: LibrarySummary): HTMLElement {
    const thumb = item.thumbnail
      ? h('img.recent-thumb', { src: item.thumbnail, alt: '', loading: 'lazy' })
      : h('div.recent-thumb.placeholder', {}, item.format.toUpperCase());
    const meta = [item.pages > 0 ? `${item.pages}쪽` : null, sizeLabel(item.size), relativeTime(item.openedAt)].filter(Boolean).join(' · ');
    return h(
      'div.recent-item',
      { role: 'listitem' },
      h(
        'button.recent-open',
        { onclick: () => this.actions.openEntry(item.id) },
        thumb,
        h(
          'span.recent-text',
          {},
          h('span.recent-name', {}, item.pinned ? h('span.pin-mark', { 'aria-label': '고정됨', title: '고정됨' }, icon('pin', 14)) : null, item.name),
          h(
            'span.recent-meta',
            {},
            meta,
            item.edited ? h('span.badge', {}, '편집됨') : null,
            needsBackup(item) ? h('span.badge.warn', { title: '편집한 내용이 이 기기에만 있어요' }, '백업 전') : null,
          ),
        ),
      ),
      h('button.icon-btn', { 'aria-label': `${item.name} 더보기`, onclick: () => this.more(item) }, icon('more')),
    );
  }

  private more(item: LibrarySummary): void {
    const sheet = new Sheet({ title: item.name });
    sheet.body.append(
      h('button.sheet-row', { onclick: () => (sheet.close(), this.actions.openEntry(item.id)) }, icon('book'), '열기'),
      h('button.sheet-row', { onclick: () => (sheet.close(), this.actions.shareEntry(item.id)) }, icon('share'), '보내기'),
      h(
        'button.sheet-row',
        { onclick: () => (sheet.close(), void this.setPinned(item.id, !item.pinned)) },
        icon('pin'),
        item.pinned ? '고정 풀기' : '맨 위에 고정',
      ),
      h('button.sheet-row', { onclick: () => (sheet.close(), void this.duplicate(item.id)) }, icon('filePlus'), '사본 만들기 (양식 다시 쓰기)'),
      h('button.sheet-row', { onclick: () => (sheet.close(), void this.rename(item)) }, icon('edit'), '이름 바꾸기'),
      h(
        'button.sheet-row.danger',
        {
          onclick: async () => {
            sheet.close();
            const ok = await askConfirm({
              title: '보관함에서 삭제',
              message: `“${item.name}”을(를) 최근 목록과 앱 보관함에서 지울까요? 버전 기록도 함께 지워져요. 다른 앱에 있는 원본 파일은 지워지지 않아요.`,
              confirmLabel: '삭제',
              danger: true,
            });
            if (!ok) return;
            await library.remove(item.id);
            await versions.removeAll(item.id).catch(() => undefined);
            await fileHandles.remove(item.id).catch(() => undefined);
            void this.refresh();
          },
        },
        icon('trash'),
        '보관함에서 삭제',
      ),
    );
    sheet.open();
  }

  private async setPinned(id: string, pinned: boolean): Promise<void> {
    const entry = await library.get(id);
    if (!entry) return;
    await library.put({ ...entry, pinned });
    await this.refresh();
  }

  /** 같은 내용의 새 문서를 만든다. 원본은 그대로 두고 사본에 쓸 수 있다. */
  private async duplicate(id: string): Promise<void> {
    const entry = await library.get(id);
    if (!entry) return;
    const now = Date.now();
    const base = baseName(entry.name);
    const taken = new Set(this.items.map((i) => i.name));
    let name = `${base} (사본).${entry.format}`;
    for (let n = 2; taken.has(name); n += 1) name = `${base} (사본 ${n}).${entry.format}`;
    // 사본은 원래 파일과 이어지지 않는다 (사본을 고쳐도 원본 파일을 덮어쓰지 않게).
    await library.put({ ...entry, id: newId(), name, openedAt: now, updatedAt: now, pinned: false, exportedAt: undefined, source: undefined });
    await this.refresh();
    toast(`“${name}”을(를) 만들었어요.`);
  }

  private async rename(item: LibrarySummary): Promise<void> {
    const next = await askText('문서 이름', baseName(item.name), '바꾸기');
    if (!next?.trim()) return;
    const entry = await library.get(item.id);
    if (!entry) return;
    await library.put({ ...entry, name: `${baseName(next.trim())}.${entry.format}` });
    await this.refresh();
  }

  /** 데스크톱·태블릿 브라우저에서 파일을 끌어 놓아 열기 */
  onDropFile: ((file: File) => void) | null = null;

  private attachDrop(): void {
    this.el.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.el.classList.add('dragging');
    });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('dragging'));
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('dragging');
      const file = e.dataTransfer?.files[0];
      if (file) this.onDropFile?.(file);
    });
  }
}

function dismissed(key: string): boolean {
  // 예전 버전은 '1'을 저장했다 (JSON으로 읽으면 1).
  const v = readPref<unknown>(`dismissed:${key}`, false);
  return v === true || v === 1;
}

function dismiss(key: string): void {
  writePref(`dismissed:${key}`, true);
}
