import { type LibrarySummary, library } from '../platform/library';
import { h } from './dom';
import { icon } from './icons';
import { Sheet } from './sheet';

export interface HomeActions {
  openFile(): void;
  newDocument(): void;
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

  constructor(private readonly actions: HomeActions) {
    this.list = h('div.recent-list', { role: 'list' });
    this.el = h(
      'main.screen.home',
      {},
      h(
        'header.home-header',
        {},
        h('div.brand', {}, h('img.brand-mark', { src: './icons/icon.svg', alt: '', width: 36, height: 36 }), h('span', {}, 'Pocket HWP')),
        h('button.icon-btn', { 'aria-label': '앱 정보', onclick: () => actions.about() }, icon('info')),
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
      h('h2.section-title', {}, '최근 문서'),
      this.list,
    );
    this.attachDrop();
  }

  async refresh(): Promise<void> {
    let items: LibrarySummary[] = [];
    try {
      items = await library.list();
    } catch {
      // 사생활 보호 모드 등에서 IndexedDB가 막혀 있으면 빈 목록으로 둔다.
    }
    this.list.replaceChildren();
    if (items.length === 0) {
      this.list.append(
        h(
          'div.empty',
          {},
          h('div.empty-art', { 'aria-hidden': 'true' }, '📄'),
          h('p', {}, '아직 연 문서가 없어요.'),
          h('p.muted', {}, '메일·메신저로 받은 한글 파일을 열거나, 다른 앱에서 “Pocket HWP로 열기”를 선택하세요.'),
        ),
      );
      return;
    }
    for (const item of items) this.list.append(this.card(item));
  }

  private card(item: LibrarySummary): HTMLElement {
    const thumb = item.thumbnail
      ? h('img.recent-thumb', { src: item.thumbnail, alt: '', loading: 'lazy' })
      : h('div.recent-thumb.placeholder', {}, item.format.toUpperCase());
    const meta = [`${item.pages}쪽`, sizeLabel(item.size), relativeTime(item.openedAt)].join(' · ');
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
          h('span.recent-name', {}, item.name),
          h('span.recent-meta', {}, meta, item.edited ? h('span.badge', {}, '편집됨') : null),
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
        'button.sheet-row.danger',
        {
          onclick: async () => {
            sheet.close();
            if (!confirm(`“${item.name}”을(를) 목록과 앱 보관함에서 지울까요?`)) return;
            await library.remove(item.id);
            void this.refresh();
          },
        },
        icon('trash'),
        '보관함에서 삭제',
      ),
    );
    sheet.open();
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
