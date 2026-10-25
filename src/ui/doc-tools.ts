import { type ChartData, chartData, setChartData } from '../doc/ops/chart';
import { type BookmarkInfo, type LinkInfo, bookmarkPos, bookmarks, deleteBookmark, removeLink, renameBookmark, safeLinkUrl, updateLink } from '../doc/ops/links';
import { addBookmark } from '../doc/ops/inserts';
import { type HfTarget, type NoteTarget, deleteNote, headerFooterLines, noteText, setHeaderFooterAlignment, setHeaderFooterLines, setNoteText } from '../doc/ops/notes';
import { type PageObject, objectsOnPage } from '../doc/ops/objects';
import { outline } from '../doc/ops/outline';
import { attachCaption, groupObjects, setShapeFill, setShapeLineColor, setShapeOrder, shapeColors, ungroup } from '../doc/ops/shapes';
import { type DocPos, inCell } from '../doc/position';
import type { Editor } from '../editor/editor';
import { askConfirm, askLongText, askText } from './dialog';
import { h } from './dom';
import { icon } from './icons';
import { Sheet } from './sheet';
import { toast } from './toast';

/**
 * 문서 화면에서 여는 도구 시트들: 목차, 책갈피, 링크, 머리말·꼬리말·각주 고치기, 도형 모양, 차트 값.
 * 문서를 바꾸는 일은 모두 Editor.command / objectCommand 를 거친다.
 */

const SHAPE_COLORS = ['#000000', '#5b616e', '#c00000', '#e36c09', '#f2c300', '#2e7d32', '#2f5ee8', '#7030a0'];
const FILL_COLORS = ['#ffffff', '#f1f3f4', '#fce8e6', '#fef7e0', '#e6f4ea', '#e8f0fe', '#f3e8fd', '#fff475'];

function row(name: Parameters<typeof icon>[0], label: string, run: () => void, sheet: Sheet, cls = ''): HTMLElement {
  return h(`button.sheet-row${cls}` as 'button', { type: 'button', onclick: () => (sheet.close(), run()) }, icon(name), label);
}

/** 문서 안 위치로 가서 보여 준다 (보기 모드에서도). */
function goTo(editor: Editor, pos: DocPos): void {
  editor.goTo(pos);
}

// ───────────── 목차 ─────────────

export function openOutlineSheet(editor: Editor): void {
  const doc = editor.document;
  if (!doc) return;
  const items = outline(doc);
  const sheet = new Sheet({ title: '목차' });
  if (items.length === 0) {
    sheet.body.append(h('p.sheet-note', {}, '개요 번호가 붙은 제목이 없어요. 제목 문단에 스타일 탭의 "개요 1~7"을 쓰면 여기에 목차가 생겨요.'));
  }
  for (const it of items) {
    const btn = h(
      'button.sheet-row.outline-row',
      { type: 'button', onclick: () => (sheet.close(), goTo(editor, it.pos)) },
      h('span.outline-num', {}, it.number),
      h('span.outline-title', {}, it.title || '(제목 없음)'),
      h('span.outline-page', {}, `${it.page}쪽`),
    );
    btn.style.setProperty('--level', String(Math.max(0, it.level - 1)));
    sheet.body.append(btn);
  }
  sheet.open();
}

// ───────────── 책갈피 ─────────────

export function openBookmarksSheet(editor: Editor): void {
  const doc = editor.document;
  if (!doc) return;
  const list = bookmarks(doc);
  const sheet = new Sheet({ title: '책갈피' });
  const caret = editor.caretPos;
  if (editor.currentMode === 'edit' && caret && !inCell(caret)) {
    sheet.body.append(
      row('plus', '지금 자리에 책갈피 넣기', async () => {
        const name = await askText('책갈피 이름', '', '넣기');
        if (name) editor.command((d, c) => addBookmark(d, c, name));
      }, sheet),
    );
  }
  if (list.length === 0) sheet.body.append(h('p.sheet-note', {}, '이 문서에는 책갈피가 없어요.'));
  for (const b of list) {
    sheet.body.append(
      h(
        'div.bookmark-row',
        {},
        h('button.sheet-row', { type: 'button', onclick: () => (sheet.close(), goTo(editor, bookmarkPos(b))) }, icon('bookmark'), b.name),
        editor.currentMode === 'edit' ? h('button.icon-btn', { type: 'button', 'aria-label': `${b.name} 고치기`, onclick: () => (sheet.close(), editBookmark(editor, b)) }, icon('more')) : null,
      ),
    );
  }
  sheet.open();
}

function editBookmark(editor: Editor, b: BookmarkInfo): void {
  const sheet = new Sheet({ title: `책갈피 “${b.name}”` });
  sheet.body.append(
    row('edit', '이름 바꾸기', async () => {
      const name = await askText('책갈피 이름', b.name, '바꾸기');
      if (name && name !== b.name) editor.command((d) => renameBookmark(d, b, name));
    }, sheet),
    row('trash', '책갈피 지우기 (글은 남아요)', () => editor.command((d) => deleteBookmark(d, b)), sheet, '.danger'),
  );
  sheet.open();
}

// ───────────── 링크 ─────────────

/** 밖의 앱(브라우저·메일)에서 연다. 열어도 안전한 주소만 열고, 먼저 묻는다. */
export async function openLinkOutside(uri: string): Promise<void> {
  const url = safeLinkUrl(uri);
  if (!url) {
    toast('이 주소는 열 수 없어요.');
    return;
  }
  const ok = await askConfirm({ title: '링크 열기', message: `이 주소를 열까요?\n${url}`, confirmLabel: '열기' });
  if (!ok) return;
  const a = h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' });
  document.body.append(a);
  a.click();
  a.remove();
}

/** 링크를 눌렀을 때: 열기, (편집 중이면) 주소 고치기·링크 지우기 */
export function openLinkSheet(editor: Editor, pos: DocPos, link: LinkInfo): void {
  const sheet = new Sheet({ title: link.text || '링크' });
  sheet.body.append(h('p.sheet-note.link-uri', {}, link.uri));
  sheet.body.append(row('link', '링크 열기', () => void openLinkOutside(link.uri), sheet));
  if (editor.currentMode === 'edit') {
    sheet.body.append(
      row('edit', '주소 고치기', async () => {
        const uri = await askText('웹 주소', link.uri, '바꾸기');
        if (uri && uri !== link.uri) editor.command((d) => updateLink(d, pos, link, uri));
      }, sheet),
      row('close', '링크 지우기 (글은 남아요)', () => editor.command((d) => removeLink(d, pos, link)), sheet, '.danger'),
    );
  }
  sheet.open();
}

// ───────────── 머리말·꼬리말·각주 ─────────────

export async function openHeaderFooterSheet(editor: Editor, target: HfTarget): Promise<void> {
  const doc = editor.document;
  if (!doc) return;
  const name = target.isHeader ? '머리말' : '꼬리말';
  let align: 'left' | 'center' | 'right' | null = null;
  const aligns = (['left', 'center', 'right'] as const).map((a) => {
    const b = h('button.chip-btn', { type: 'button', 'aria-pressed': 'false' }, { left: '왼쪽', center: '가운데', right: '오른쪽' }[a]);
    b.addEventListener('click', () => {
      align = a;
      aligns.forEach((x) => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', String(on));
      });
    });
    return b;
  });
  const lines = headerFooterLines(doc, target);
  const text = await askLongText(`${name} 고치기`, lines.join('\n'), '저장', {
    message: `모든 쪽에 같은 ${name}이 들어가요. 줄을 바꾸면 ${name}도 여러 줄이 돼요. 비워 두고 저장하면 지워져요.`,
    extra: h('div.chips', { 'aria-label': '정렬' }, ...aligns),
  });
  if (text === null) return;
  editor.command((d) => {
    setHeaderFooterLines(d, target, text.split('\n'));
    if (align && text.trim()) setHeaderFooterAlignment(d, target, align);
  });
}

export async function openNoteSheet(editor: Editor, target: NoteTarget): Promise<void> {
  const doc = editor.document;
  const current = doc ? noteText(doc, target) : null;
  if (!current) return;
  const text = await askLongText(`각주 ${current.number} 고치기`, current.lines.join('\n'), '저장', {
    danger: {
      label: '각주 지우기',
      onClick: () => void askConfirm({ title: '각주 지우기', message: '이 각주를 지울까요? 실행 취소로 되돌릴 수 있어요.', confirmLabel: '지우기', danger: true }).then((ok) => ok && editor.command((d) => deleteNote(d, target))),
    },
  });
  if (text === null || text === current.lines.join('\n')) return;
  editor.command((d) => setNoteText(d, target, text));
}

// ───────────── 도형 ─────────────

function swatchRow(colors: string[], current: string | null, pick: (c: string | null) => void, none?: string): HTMLElement {
  const items: HTMLElement[] = [];
  if (none) items.push(h('button.swatch.none', { type: 'button', 'aria-label': none, onclick: () => pick(null) }, h('span.swatch-x', { 'aria-hidden': 'true' })));
  for (const c of colors) {
    const b = h('button.swatch', { type: 'button', 'aria-label': c, 'aria-pressed': String(current === c), onclick: () => pick(c) });
    b.classList.toggle('on', current === c);
    b.style.setProperty('--swatch', c);
    items.push(b);
  }
  return h('div.swatches', {}, ...items);
}

/** 도형 모양: 선·채우기 색, 겹침 순서, 묶기·풀기, 캡션 */
export function openShapeSheet(editor: Editor, obj: PageObject): void {
  const doc = editor.document;
  if (!doc) return;
  const colors = obj.kind === 'group' ? null : shapeColors(doc, obj);
  const sheet = new Sheet({ title: { shape: '도형', line: '선', group: '묶은 도형' }[obj.kind as 'shape'] ?? '도형' });
  // 메뉴에서 시트를 열 때 개체 선택은 풀렸으므로 고른 개체를 직접 넘긴다.
  const run = (fn: (d: Parameters<Parameters<Editor['command']>[0]>[0], o: PageObject) => void) => {
    sheet.close();
    editor.command((d) => fn(d, obj));
  };
  if (colors) {
    sheet.body.append(
      h('h3.panel-label', {}, '선 색'),
      swatchRow(SHAPE_COLORS, colors.line, (c) => c && run((d, o) => setShapeLineColor(d, o, c))),
    );
    if (obj.kind === 'shape') {
      sheet.body.append(h('h3.panel-label', {}, '채우기'), swatchRow(FILL_COLORS, colors.fill, (c) => run((d, o) => setShapeFill(d, o, c)), '채우기 없음'));
    }
  }
  sheet.body.append(
    h('h3.panel-label', {}, '겹친 순서'),
    h(
      'div.chips',
      {},
      ...(
        [
          ['front', '맨 앞으로'],
          ['forward', '앞으로'],
          ['backward', '뒤로'],
          ['back', '맨 뒤로'],
        ] as const
      ).map(([op, label]) => h('button.chip-btn', { type: 'button', onclick: () => run((d, o) => setShapeOrder(d, o, op)) }, label)),
    ),
  );
  const others = objectsOnPage(doc, obj.page).filter(
    (o) => (o.kind === 'shape' || o.kind === 'line' || o.kind === 'group') && o.sec === obj.sec && !(o.para === obj.para && o.ctrl === obj.ctrl),
  );
  if (others.length) sheet.body.append(row('pages', '다른 도형과 묶기', () => openGroupSheet(editor, obj, others), sheet));
  if (obj.kind === 'group') sheet.body.append(row('split', '묶기 풀기', () => editor.command((d) => ungroup(d, obj)), sheet));
  if (obj.kind !== 'line') {
    sheet.body.append(
      row('text', '캡션 달기 ("그림 1")', () =>
        editor.command((d) => {
          if (!attachCaption(d, obj)) toast('이 개체에는 캡션을 달 수 없어요.');
        }), sheet),
    );
  }
  sheet.open();
}

function openGroupSheet(editor: Editor, obj: PageObject, others: PageObject[]): void {
  const sheet = new Sheet({ title: '함께 묶을 도형' });
  const picked = new Set<PageObject>();
  const kindName = { shape: '도형', line: '선', group: '묶은 도형' } as Record<string, string>;
  others.forEach((o, i) => {
    const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
    box.addEventListener('change', () => (box.checked ? picked.add(o) : picked.delete(o)));
    sheet.body.append(h('label.check-row', {}, box, `${kindName[o.kind] ?? '도형'} ${i + 1} (위에서 ${Math.round(o.y)}px)`));
  });
  sheet.body.append(
    h(
      'button.primary-btn',
      {
        type: 'button',
        onclick: () => {
          if (picked.size === 0) {
            toast('묶을 도형을 하나 이상 골라 주세요.');
            return;
          }
          sheet.close();
          editor.command((d) => groupObjects(d, [obj, ...picked]));
        },
      },
      '묶기',
    ),
  );
  sheet.open();
}

// ───────────── 차트 ─────────────

/** 차트 값 고치기: 가로축 항목(줄) × 계열(칸) 표 */
export function openChartSheet(editor: Editor, obj: PageObject): void {
  const doc = editor.document;
  const data = doc ? chartData(doc, obj) : null;
  if (!data) {
    toast('이 차트의 값을 읽지 못했어요.');
    return;
  }
  const sheet = new Sheet({ title: '차트 값 고치기' });
  const labelInputs = data.labels.map((l) => h('input.chart-input.label', { type: 'text', value: l, 'aria-label': '항목 이름' }) as HTMLInputElement);
  const nameInputs = data.series.map((s) => h('input.chart-input.name', { type: 'text', value: s.name, 'aria-label': '계열 이름' }) as HTMLInputElement);
  const valueInputs = data.series.map((s) =>
    s.values.map((v, i) => h('input.chart-input', { type: 'text', inputmode: 'decimal', value: v, 'aria-label': `${s.name} ${data.labels[i] ?? i + 1}` }) as HTMLInputElement),
  );
  const rows = Math.max(data.labels.length, ...data.series.map((s) => s.values.length));
  const table = h(
    'table.chart-table',
    {},
    h('thead', {}, h('tr', {}, h('th', {}, ''), ...nameInputs.map((n) => h('th', {}, n)))),
    h(
      'tbody',
      {},
      ...Array.from({ length: rows }, (_, i) => h('tr', {}, h('th', {}, labelInputs[i] ?? ''), ...valueInputs.map((col) => h('td', {}, col[i] ?? '')))),
    ),
  );
  const collect = (): Pick<ChartData, 'labels' | 'series'> => ({
    labels: data.labels.length ? labelInputs.map((i) => i.value) : [],
    series: data.series.map((_, si) => ({ name: nameInputs[si].value, values: valueInputs[si].map((i) => i.value.trim()) })),
  });
  sheet.body.append(
    h('p.sheet-note', {}, '숫자를 고치면 차트 막대·선이 바뀌어요.'),
    h('div.chart-scroll', {}, table),
    h(
      'button.primary-btn',
      {
        type: 'button',
        onclick: () => {
          const next = collect();
          const result: { problem?: string | null } = {};
          editor.command((d) => {
            result.problem = setChartData(d, obj, next);
          });
          if (result.problem) toast(`차트를 바꾸지 못했어요: ${result.problem}`, 5000);
          else {
            sheet.close();
            editor.clearObject();
          }
        },
      },
      '저장',
    ),
  );
  sheet.open();
}
