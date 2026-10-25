import type { ParaProps } from '../doc/editable';
import type { Editor } from '../editor/editor';
import { pickFile } from '../platform/files';
import { h } from './dom';
import { icon } from './icons';
import { Sheet } from './sheet';
import { toast } from './toast';

const COLORS = ['#000000', '#5f6368', '#d93025', '#e8710a', '#f9ab00', '#188038', '#1a73e8', '#7b1fa2'];
const HIGHLIGHTS = ['#ffffff', '#fff475', '#ccff90', '#a7ffeb', '#cbf0f8', '#fdcfe8', '#e6c9a8'];
const LINE_SPACINGS = [100, 130, 160, 200];
const SYMBOLS = ['※', '·', '•', '○', '●', '□', '■', '◇', '◆', '△', '▲', '▷', '▶', '☆', '★', '→', '←', '↑', '↓', '①', '②', '③', '④', '⑤', '「', '」', '『', '』', '〈', '〉', '…', '℃', '㎡', '₩', '±', '×', '÷', '≠', '≤', '≥'];

/** 시트를 닫으면 다시 문서 입력칸에 포커스를 돌려 키보드를 띄운다. */
function editSheet(editor: Editor, title: string): Sheet {
  return new Sheet({ title, onClose: () => editor.currentMode === 'edit' && editor.input.focus() });
}

export function openFormatSheet(editor: Editor): void {
  const sheet = editSheet(editor, '글자·문단 모양');
  const char = editor.currentChar();
  const swatches = (colors: string[], key: 'textColor' | 'shadeColor', current?: string) =>
    h(
      'div.swatches',
      { role: 'radiogroup' },
      ...colors.map((c) =>
        h(
          'button.swatch',
          {
            style: `--swatch:${c}`,
            'aria-label': c,
            'aria-checked': String(current?.toLowerCase() === c),
            role: 'radio',
            onclick: () => {
              editor.applyChar({ [key]: c });
              sheet.close();
            },
          },
        ),
      ),
    );
  const segmented = <T extends string | number>(items: [T, string][], current: T | undefined, apply: (v: T) => void) =>
    h(
      'div.segmented',
      {},
      ...items.map(([v, label]) =>
        h('button', { class: v === current ? 'on' : '', onclick: () => (apply(v), sheet.close()) }, label),
      ),
    );
  const para = editor.currentMode === 'edit' && editor.caretPos ? editor.document?.paraProps(editor.caretPos) ?? {} : {};
  sheet.body.append(
    h('div.field-label', {}, '글자 색'),
    swatches(COLORS, 'textColor', char.textColor),
    h('div.field-label', {}, '형광펜'),
    swatches(HIGHLIGHTS, 'shadeColor', char.shadeColor),
    h('div.field-label', {}, '정렬'),
    segmented<NonNullable<ParaProps['alignment']>>(
      [
        ['left', '왼쪽'],
        ['center', '가운데'],
        ['right', '오른쪽'],
        ['justify', '양쪽'],
      ],
      para.alignment,
      (alignment) => editor.applyPara({ alignment }),
    ),
    h('div.field-label', {}, '줄 간격'),
    segmented<number>(
      LINE_SPACINGS.map((v) => [v, `${v}%`]),
      para.lineSpacingType === 'Percent' ? para.lineSpacing : undefined,
      (lineSpacing) => editor.applyPara({ lineSpacing, lineSpacingType: 'Percent' }),
    ),
  );
  sheet.open();
}

export function openInsertSheet(editor: Editor): void {
  const sheet = editSheet(editor, '넣기');
  let rows = 3;
  let cols = 3;
  const grid = h('div.table-preview', { 'aria-hidden': 'true' });
  const label = h('span.table-size', {});
  const draw = () => {
    grid.style.setProperty('--cols', String(cols));
    grid.replaceChildren(...Array.from({ length: rows * cols }, () => h('span')));
    label.textContent = `${rows} × ${cols}`;
  };
  const stepper = (name: string, get: () => number, set: (v: number) => void) =>
    h(
      'div.stepper',
      {},
      h('span', {}, name),
      h('button.icon-btn', { 'aria-label': `${name} 줄이기`, onclick: () => (set(Math.max(1, get() - 1)), draw()) }, icon('minus', 20)),
      h('button.icon-btn', { 'aria-label': `${name} 늘리기`, onclick: () => (set(Math.min(20, get() + 1)), draw()) }, icon('plus', 20)),
    );
  draw();
  const insertImage = async () => {
    sheet.close();
    const file = await pickFile('image/png,image/jpeg,image/gif,image/bmp');
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const bitmap = await createImageBitmap(file);
    const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
    editor.insertPicture(bytes, bitmap.width, bitmap.height, ext);
    bitmap.close();
  };
  const now = new Date();
  const dateText = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  sheet.body.append(
    h('div.field-label', {}, '표'),
    h('div.table-picker', {}, grid, h('div.table-controls', {}, label, stepper('줄', () => rows, (v) => (rows = v)), stepper('칸', () => cols, (v) => (cols = v)))),
    h(
      'button.primary-btn',
      {
        onclick: () => {
          sheet.close();
          if (!editor.insertTable(rows, cols)) toast('표는 본문에만 넣을 수 있어요.');
        },
      },
      icon('table', 20),
      '표 넣기',
    ),
    h('button.sheet-row', { onclick: insertImage }, icon('image'), '사진·그림 넣기'),
    h('button.sheet-row', { onclick: () => (sheet.close(), editor.insertText(dateText)) }, icon('text'), `오늘 날짜 (${dateText})`),
    h('div.field-label', {}, '기호'),
    h(
      'div.symbols',
      {},
      ...SYMBOLS.map((s) => h('button.symbol', { onclick: () => editor.insertText(s) }, s)),
    ),
  );
  sheet.open();
}
