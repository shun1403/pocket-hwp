import type { DocumentSession } from '../app/session';
import { engineVersion } from '../engine/rhwp';
import { documentText, exportDocument, exportPdf } from '../export/exporters';
import { parsePageRange, renderPagesPng } from '../export/images';
import { printDocument } from '../export/print';
import { buildZip } from '../export/zip';
import { MIME, type DocFormat, baseName } from '../platform/bytes';
import { type OutgoingFile, isNative, shareFile, shareFiles } from '../platform/files';
import type { PageView } from '../view/page-view';
import { askConfirm, askPassword, askText } from './dialog';
import { h } from './dom';
import { icon } from './icons';
import { Sheet } from './sheet';
import { toast } from './toast';

async function deliver(name: string, bytes: Uint8Array, mime: string): Promise<boolean> {
  const result = await shareFile(name, bytes, mime);
  if (result === 'downloaded') toast(`${name} 파일을 내려받았어요.`);
  return result !== 'cancelled';
}

async function sendDocument(session: DocumentSession, format: DocFormat, password?: string): Promise<void> {
  const { bytes, lossWarnings } = exportDocument(session.doc.raw, format, password);
  if (lossWarnings.length > 0) {
    const ok = await askConfirm({
      title: '일부 내용이 빠질 수 있어요',
      message: `${format.toUpperCase()}로 저장하면 다음 내용이 빠질 수 있어요.\n· ${lossWarnings.slice(0, 5).join('\n· ')}`,
      confirmLabel: '그래도 보내기',
    });
    if (!ok) return;
  }
  if (await deliver(`${baseName(session.name)}.${format}`, bytes, MIME[format])) await session.markExported();
}

/** 원래 파일 자리에 덮어쓴다. 성공하면 true */
export async function saveToOriginal(session: DocumentSession): Promise<boolean> {
  try {
    const saved = await session.saveToSource((losses, format) =>
      askConfirm({
        title: '일부 내용이 바뀔 수 있어요',
        message: `${format.toUpperCase()}로 저장하면 다음 내용이 빠지거나 바뀔 수 있어요.\n· ${losses.slice(0, 5).join('\n· ')}`,
        confirmLabel: '그래도 저장',
      }),
    );
    if (saved) toast(`원래 파일(${session.sourceName})에 저장했어요.`);
    return saved;
  } catch (err) {
    console.error(err);
    toast('원래 파일에 저장하지 못했어요. 파일이 옮겨졌거나 권한이 없을 수 있어요. 보내기로 저장해 주세요.', 5000);
    return false;
  }
}

/** 쪽마다 그리는 동안 진행 상황을 보여 주며 인쇄한다. */
export async function printWithProgress(session: DocumentSession): Promise<void> {
  const progress = h('div.progress-toast', {}, '인쇄 준비 중…');
  document.body.append(progress);
  try {
    await printDocument(session.doc.raw, baseName(session.name), (done, total) => {
      progress.textContent = `인쇄 준비 중… ${done}/${total}`;
    });
  } finally {
    progress.remove();
  }
}

/** 쪽을 사진(PNG)으로 보낸다: 모든 쪽 · 지금 쪽 · 쪽 고르기 */
async function sendImages(session: DocumentSession, currentPage: number): Promise<void> {
  const raw = session.doc.raw;
  const total = raw.pageCount();
  const pages = await new Promise<number[] | null>((resolve) => {
    let picked: number[] | null = null;
    // '쪽 골라서'는 이 시트를 닫고 쪽 번호를 따로 물은 뒤에 답한다.
    let askLater = false;
    const sheet = new Sheet({ title: '사진으로 보내기', onClose: () => !askLater && resolve(picked) });
    const choose = (p: number[] | null) => () => {
      picked = p;
      sheet.close();
    };
    const all = Array.from({ length: total }, (_, i) => i);
    const rows: HTMLElement[] = [
      h('p.sheet-note', {}, '쪽마다 사진 한 장으로 보내요. 한글이 없는 사람도 바로 볼 수 있어요.'),
      h('button.sheet-row', { onclick: choose(all) }, icon('pages'), h('span', {}, `모든 쪽 (${total}장)`)),
    ];
    if (total > 1) {
      rows.push(
        h('button.sheet-row', { onclick: choose([currentPage]) }, icon('page'), h('span', {}, `지금 보는 쪽만 (${currentPage + 1}쪽)`)),
        h(
          'button.sheet-row',
          {
            onclick: async () => {
              askLater = true;
              sheet.close();
              const input = await askText('보낼 쪽', `1-${total}`, '보내기', { message: `쪽 번호를 쓰세요. 예) 1-3, 5 (전체 ${total}쪽)` });
              const range = input ? parsePageRange(input, total) : null;
              if (input && !range) toast(`쪽 번호를 다시 확인해 주세요. 1부터 ${total}까지 쓸 수 있어요.`);
              resolve(range);
            },
          },
          icon('list'),
          h('span', {}, '쪽 골라서…'),
        ),
      );
    }
    sheet.body.append(...rows);
    sheet.open();
  });
  if (!pages || pages.length === 0) return;
  if (pages.length > 20 && !(await askConfirm({ title: '사진이 많아요', message: `${pages.length}장을 만들어요. 시간이 조금 걸리고 메신저에서 나뉘어 보내질 수 있어요.`, confirmLabel: '만들기' }))) return;
  const progress = h('div.progress-toast', {}, '사진 만드는 중…');
  document.body.append(progress);
  try {
    const images = await renderPagesPng(raw, pages, (done, n) => {
      progress.textContent = `사진 만드는 중… ${done}/${n}`;
    });
    const base = baseName(session.name);
    const width = String(Math.max(...pages) + 1).length;
    const files: OutgoingFile[] = images.map((bytes, i) => ({ name: `${base}-${String(pages[i] + 1).padStart(width, '0')}.png`, bytes, mime: 'image/png' }));
    const result = await shareFiles(files, () => ({ name: `${base}-사진.zip`, bytes: buildZip(files), mime: 'application/zip' }));
    if (result === 'downloaded') toast(files.length > 1 ? `사진 ${files.length}장을 ZIP으로 내려받았어요.` : `${files[0].name} 파일을 내려받았어요.`);
  } finally {
    progress.remove();
  }
}

/** 보내기(공유)·내보내기 선택지. currentPage 는 '지금 쪽만' 사진으로 보낼 때 쓴다. */
export function openExportSheet(session: DocumentSession, currentPage = 0): void {
  const sheet = new Sheet({ title: '보내기' });
  const row = (iconName: Parameters<typeof icon>[0], title: string, sub: string, run: () => Promise<void>) =>
    h(
      'button.sheet-row',
      {
        onclick: async () => {
          sheet.close();
          try {
            await run();
          } catch (err) {
            console.error(err);
            toast('보내지 못했어요. 다시 시도해 주세요.');
          }
        },
      },
      icon(iconName),
      h('span.row-text', {}, h('span', {}, title), h('span.row-sub', {}, sub)),
    );
  if (import.meta.env.VITE_SANDBOXED) {
    sheet.body.append(
      h('p.sheet-note', {}, 'Claude 미리보기 안에서는 파일을 내보낼 수 없어요. 설치한 앱이나 웹 버전에서 보내기를 써 주세요.'),
    );
  }
  if (session.sourceName) {
    sheet.body.append(
      row('download', '원래 파일에 저장', `${session.sourceName}에 고친 내용을 덮어써요`, async () => {
        await saveToOriginal(session);
      }),
    );
  }
  sheet.body.append(
    row('share', '한글 문서 (.hwp)', '한컴오피스·다른 앱에서 열 수 있어요', () => sendDocument(session, 'hwp')),
    row('share', 'HWPX 문서 (.hwpx)', '개방형 한글 형식 (실험적)', () => sendDocument(session, 'hwpx')),
    row('lock', '암호 건 한글 문서', '열 때 암호를 물어요 (.hwp·.hwpx)', async () => {
      const choice = await askPassword();
      if (choice) await sendDocument(session, choice.format, choice.password);
    }),
    row('image', '사진 (.png)', '쪽마다 사진으로 · 한글이 없어도 보여요', () => sendImages(session, currentPage)),
    row('download', 'PDF', '쪽 모양 그대로 보내기', async () => {
      const progress = h('div.progress-toast', {}, 'PDF 만드는 중…');
      document.body.append(progress);
      try {
        const pdf = await exportPdf(session.doc.raw, (done, total) => {
          progress.textContent = `PDF 만드는 중… ${done}/${total}`;
        });
        await deliver(`${baseName(session.name)}.pdf`, pdf, MIME.pdf);
      } finally {
        progress.remove();
      }
    }),
    row('print', '인쇄', '프린터로 바로 인쇄하기', () => printWithProgress(session)),
    row('text', '텍스트 (.txt)', '글자만 뽑아 보내기', async () => {
      const text = documentText(session.doc.raw);
      await deliver(`${baseName(session.name)}.txt`, new TextEncoder().encode(text), MIME.txt);
    }),
  );
  if (!isNative) {
    sheet.body.append(h('p.sheet-note', {}, '휴대폰 브라우저에서는 공유 창이, 컴퓨터에서는 내려받기가 열려요.'));
  }
  sheet.open();
}

interface DocInfo {
  version?: string;
  pageCount?: number;
  fontsUsed?: string[];
  encrypted?: boolean;
}

export function openInfoSheet(session: DocumentSession): void {
  const sheet = new Sheet({ title: '문서 정보' });
  let info: DocInfo = {};
  try {
    info = JSON.parse(session.doc.raw.getDocumentInfo()) as DocInfo;
  } catch {
    // 정보를 못 읽어도 시트는 연다.
  }
  const dl = (rows: [string, string][]) =>
    h('dl.info-list', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  sheet.body.append(
    dl([
      ['이름', session.name],
      ['형식', session.format.toUpperCase() + (info.version ? ` (${info.version})` : '')],
      ['쪽 수', `${session.doc.pageCount()}쪽`],
      ['사용 글꼴', (info.fontsUsed ?? []).join(', ') || '-'],
      ['문서 엔진', `rhwp ${engineVersion()}`],
    ]),
    h('p.sheet-note', {}, '한컴 전용 글꼴은 비슷한 무료 글꼴(Pretendard·Noto Serif KR·나눔 글꼴)로 대신 보여 줘서 줄바꿈이 원본과 조금 다를 수 있어요.'),
  );
  sheet.open();
}

/** 쪽 썸네일 모아 보기 → 눌러서 이동 */
export function openPagesSheet(session: DocumentSession, view: PageView): void {
  let observer: IntersectionObserver | null = null;
  const sheet = new Sheet({ title: `쪽 (${session.doc.pageCount()})`, onClose: () => observer?.disconnect() });
  const grid = h('div.page-grid');
  const current = view.currentPage();
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const cell = e.target as HTMLElement;
        observer?.unobserve(cell);
        const index = Number(cell.dataset.page);
        const canvas = cell.querySelector('canvas');
        if (!canvas) continue;
        const info = JSON.parse(session.doc.raw.getPageInfo(index)) as { width: number };
        session.doc.raw.renderPageToCanvas(index, canvas, (120 * (window.devicePixelRatio || 1)) / info.width);
      }
    },
    { root: sheet.body, rootMargin: '200px' },
  );
  for (let i = 0; i < session.doc.pageCount(); i += 1) {
    const cell = h(
      'button.page-thumb',
      {
        'data-page': i,
        class: i === current ? 'current' : '',
        'aria-label': `${i + 1}쪽으로 이동`,
        onclick: () => {
          sheet.close();
          view.scrollToPage(i);
        },
      },
      h('canvas'),
      h('span', {}, String(i + 1)),
    );
    grid.append(cell);
    observer.observe(cell);
  }
  sheet.body.append(grid);
  sheet.open();
  requestAnimationFrame(() => grid.children[current]?.scrollIntoView({ block: 'center' }));
}
