import { TEMPLATES, type Template } from '../app/templates';
import { searchText, type TextHit } from '../doc/text-search';
import { HwpDocument, initEngine } from '../engine/rhwp';
import { documentText } from '../export/exporters';
import { baseName } from '../platform/bytes';
import { type LibrarySummary, library, needsBackup, newId } from '../platform/library';
import { readPref, writePref } from '../platform/prefs';
import { type IndexedText, searchIndex } from '../platform/search-index';
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
  /** 자주 쓰는 양식으로 새 문서 */
  newFromTemplate(t: Template): void;
  /** find 를 주면 문서를 연 뒤 그 글을 찾아 보여 준다 (본문 검색 결과) */
  openEntry(id: string, find?: string): void;
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
    placeholder: '문서 이름·내용으로 찾기 (초성도 돼요)',
    'aria-label': '최근 문서 찾기',
    enterkeyhint: 'search',
  }) as HTMLInputElement;
  private items: LibrarySummary[] = [];
  /** 문서 id → 본문 글 (보관함 전체 검색) */
  private texts = new Map<string, IndexedText>();
  private indexing = false;

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
      h(
        'button.template-btn',
        { onclick: () => this.openTemplates() },
        icon('form', 22),
        h('span.row-text', {}, h('span', {}, '양식으로 만들기'), h('span.row-sub', {}, '이력서 · 자기소개서 · 위임장 · 사직서 · 차용증 …')),
      ),
      this.notices,
      h('h2.section-title', {}, '최근 문서'),
      this.searchBox,
      this.list,
    );
    this.searchBox.hidden = true;
    let typing = 0;
    this.searchBox.addEventListener('input', () => {
      window.clearTimeout(typing);
      typing = window.setTimeout(() => this.renderList(), 150);
    });
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
    // 본문까지 찾으므로 문서가 두 개만 돼도 찾기 칸을 둔다.
    this.searchBox.hidden = items.length < 2;
    if (this.searchBox.hidden) this.searchBox.value = '';
    this.renderList();
    void this.buildIndex();
  }

  /**
   * 본문 글이 없거나 오래된 문서를 한가할 때 하나씩 읽어 검색용 글을 만든다.
   * (문서를 열어 저장할 때도 만들어지므로, 앱을 새로 깐 뒤 백업에서 되살린 문서 등이 대상이다.)
   */
  private async buildIndex(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;
    try {
      this.texts = new Map((await searchIndex.all()).map((t) => [t.id, t]));
      for (const item of this.items) {
        const known = this.texts.get(item.id);
        if (known && known.updatedAt >= item.updatedAt) continue;
        await new Promise((r) => window.setTimeout(r, 40));
        const entry = await library.get(item.id);
        if (!entry) continue;
        let indexed: IndexedText;
        try {
          await initEngine();
          const raw = new HwpDocument(entry.bytes);
          indexed = { id: item.id, updatedAt: item.updatedAt, text: documentText(raw) };
          raw.free();
        } catch {
          // 암호 문서 등 읽을 수 없는 문서는 건너뛴다.
          indexed = { id: item.id, updatedAt: item.updatedAt, text: '', skipped: true };
        }
        await searchIndex.put(indexed);
        this.texts.set(item.id, indexed);
      }
    } catch {
      // 검색 색인은 보조 기능이라 실패해도 목록은 그대로 쓴다.
    } finally {
      this.indexing = false;
    }
    if (this.searchBox.value.trim()) this.renderList();
  }

  /** 자주 쓰는 양식 고르기 */
  private openTemplates(): void {
    const sheet = new Sheet({ title: '양식으로 만들기' });
    sheet.body.append(
      ...TEMPLATES.map((t) =>
        h(
          'button.sheet-row',
          { onclick: () => (sheet.close(), this.actions.newFromTemplate(t)) },
          icon('form'),
          h('span.row-text', {}, h('span', {}, t.name), h('span.row-sub', {}, t.sub)),
        ),
      ),
      h('p.sheet-note', {}, '빈칸은 서식 채우기나 내 정보로 채우기로 바로 채울 수 있어요. 위임장·차용증·내용증명은 일반적인 서식이며 법률 자문이 아니에요.'),
    );
    sheet.open();
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
    const query = this.searchBox.value.trim();
    if (!query) {
      for (const item of items) this.list.append(this.card(item));
      return;
    }
    // 이름에 든 문서를 먼저, 그다음 본문에 든 문서
    const byName = items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) || searchText(baseName(i.name), query));
    const byText = items
      .filter((i) => !byName.includes(i))
      .map((i) => ({ item: i, hit: searchText(this.texts.get(i.id)?.text ?? '', query) }))
      .filter((x): x is { item: LibrarySummary; hit: TextHit } => !!x.hit);
    if (byName.length + byText.length === 0) this.list.append(h('p.empty-search', {}, `“${query}”이(가) 들어간 문서가 없어요.`));
    for (const item of byName) this.list.append(this.card(item));
    for (const { item, hit } of byText) this.list.append(this.card(item, hit));
    if (this.indexing) this.list.append(h('p.empty-search', {}, '문서 내용을 읽는 중이에요. 결과가 더 나올 수 있어요.'));
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

  private card(item: LibrarySummary, hit?: TextHit): HTMLElement {
    const thumb = item.thumbnail
      ? h('img.recent-thumb', { src: item.thumbnail, alt: '', loading: 'lazy' })
      : h('div.recent-thumb.placeholder', {}, item.format.toUpperCase());
    const meta = [item.pages > 0 ? `${item.pages}쪽` : null, sizeLabel(item.size), relativeTime(item.openedAt)].filter(Boolean).join(' · ');
    return h(
      'div.recent-item',
      { role: 'listitem' },
      h(
        'button.recent-open',
        { onclick: () => this.actions.openEntry(item.id, hit?.match) },
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
          hit
            ? h(
                'span.recent-snippet',
                {},
                hit.before,
                h('mark', {}, hit.match),
                hit.after,
                hit.count > 1 ? h('span.snippet-count', {}, ` · ${hit.count}곳`) : null,
              )
            : null,
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
