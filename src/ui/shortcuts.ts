import type { Editor } from '../editor/editor';
import { insertBreak } from '../doc/ops/inserts';
import { inCell } from '../doc/position';
import type { ParaProps } from '../doc/editable';
import { h } from './dom';
import { nextFontSize } from './panel/font-size';
import { Sheet } from './sheet';
import { toast } from './toast';

/** 단축키가 부르는 화면 쪽 동작 */
export interface ShortcutActions {
  editor: Editor;
  save(): void;
  search(): void;
  print(): void;
  pageSetup(): void;
  panel(tab: string): void;
  help(): void;
}

interface Shortcut {
  /** keyName 형식 ('Ctrl+Shift+L'). 첫째가 목록에 보인다 */
  keys: string[];
  label: string;
  group: Group;
  /** 편집 중에만 (보기 중에는 그냥 지나간다) */
  edit?: boolean;
  /** 없으면 목록에만 보인다 (브라우저·편집기가 직접 처리) */
  run?: (a: ShortcutActions) => void;
}

type Group = '문서' | '편집' | '글자' | '문단' | '이동';

const size = (a: ShortcutActions, dir: 1 | -1) => {
  const pt = (a.editor.currentChar().fontSize ?? 1000) / 100;
  a.editor.applyChar({ fontSize: nextFontSize(pt, dir) * 100 });
};
const align = (alignment: NonNullable<ParaProps['alignment']>) => (a: ShortcutActions) => a.editor.applyPara({ alignment });
const toggle = (key: 'bold' | 'italic' | 'underline' | 'strikethrough') => (a: ShortcutActions) =>
  a.editor.applyChar({ [key]: !a.editor.currentChar()[key] });
const pageBreak = (kind: 'page' | 'column') => (a: ShortcutActions) => {
  const caret = a.editor.caretPos;
  if (!caret) return;
  if (inCell(caret)) {
    toast(`${kind === 'page' ? '쪽' : '단'} 나누기는 표 밖 본문에만 넣을 수 있어요.`);
    return;
  }
  a.editor.command((doc, at) => insertBreak(doc, at, kind));
};

/** 한글(한컴오피스)과 같은 조합을 먼저 쓴다. */
const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl+S', 'Alt+S'], label: '저장', group: '문서', run: (a) => a.save() },
  { keys: ['Ctrl+F'], label: '찾기', group: '문서', run: (a) => a.search() },
  { keys: ['Ctrl+H', 'Ctrl+F2'], label: '찾아 바꾸기', group: '문서', run: (a) => a.search() },
  { keys: ['Ctrl+P', 'Alt+P'], label: '인쇄', group: '문서', run: (a) => a.print() },
  { keys: ['F7'], label: '편집 용지 (여백·크기)', group: '문서', run: (a) => a.pageSetup() },
  { keys: ['F1', 'Ctrl+/'], label: '단축키 목록', group: '문서', run: (a) => a.help() },

  { keys: ['Ctrl+Z'], label: '실행 취소', group: '편집', edit: true, run: (a) => a.editor.undo() },
  { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], label: '다시 실행', group: '편집', edit: true, run: (a) => a.editor.redo() },
  { keys: ['Ctrl+C'], label: '복사', group: '편집' },
  { keys: ['Ctrl+X'], label: '잘라내기', group: '편집', edit: true },
  { keys: ['Ctrl+V'], label: '붙여넣기', group: '편집', edit: true },
  { keys: ['Ctrl+A'], label: '모두 선택', group: '편집', run: (a) => a.editor.selectAll() },
  { keys: ['Ctrl+Enter'], label: '쪽 나누기', group: '편집', edit: true, run: pageBreak('page') },
  { keys: ['Ctrl+Shift+Enter'], label: '단 나누기', group: '편집', edit: true, run: pageBreak('column') },
  { keys: ['Ctrl+F10'], label: '문자표 (기호)', group: '편집', run: (a) => a.panel('symbol') },

  { keys: ['Alt+L'], label: '글자 모양', group: '글자', run: (a) => a.panel('char') },
  { keys: ['Ctrl+B', 'Alt+Shift+B'], label: '진하게', group: '글자', edit: true, run: toggle('bold') },
  { keys: ['Ctrl+I', 'Alt+Shift+I'], label: '기울임', group: '글자', edit: true, run: toggle('italic') },
  { keys: ['Ctrl+U', 'Alt+Shift+U'], label: '밑줄', group: '글자', edit: true, run: toggle('underline') },
  { keys: ['Ctrl+]', 'Alt+Shift+E'], label: '글자 크게', group: '글자', edit: true, run: (a) => size(a, 1) },
  { keys: ['Ctrl+[', 'Alt+Shift+R'], label: '글자 작게', group: '글자', edit: true, run: (a) => size(a, -1) },

  { keys: ['Alt+T'], label: '문단 모양', group: '문단', run: (a) => a.panel('para') },
  { keys: ['F6'], label: '스타일', group: '문단', run: (a) => a.panel('style') },
  { keys: ['Ctrl+Shift+L'], label: '왼쪽 정렬', group: '문단', edit: true, run: align('left') },
  { keys: ['Ctrl+Shift+C'], label: '가운데 정렬', group: '문단', edit: true, run: align('center') },
  { keys: ['Ctrl+Shift+R'], label: '오른쪽 정렬', group: '문단', edit: true, run: align('right') },
  { keys: ['Ctrl+Shift+M'], label: '양쪽 정렬', group: '문단', edit: true, run: align('justify') },
  { keys: ['Ctrl+Shift+T'], label: '배분 정렬', group: '문단', edit: true, run: align('distribute') },

  // 이동 키는 편집기가 직접 처리한다 (목록에만 보인다).
  { keys: ['Ctrl+←', 'Ctrl+→'], label: '낱말 단위로 옮기기', group: '이동' },
  { keys: ['Home', 'End'], label: '줄 처음 · 끝', group: '이동' },
  { keys: ['Ctrl+Home', 'Ctrl+End'], label: '문서(표 칸) 처음 · 끝', group: '이동' },
  { keys: ['Shift+방향키'], label: '고르며 옮기기', group: '이동' },
  { keys: ['PageUp', 'PageDown'], label: '화면 넘기기', group: '이동' },
];

const BY_KEY = new Map(SHORTCUTS.flatMap((s) => s.keys.map((k) => [k, s] as const)));

/** 단축키를 실행한다. 이 화면에서 할 일이 있었으면 true (브라우저 기본 동작을 막는다) */
export function runShortcut(name: string, a: ShortcutActions): boolean {
  const s = BY_KEY.get(name);
  if (!s?.run) return false;
  // 보기 중에는 편집 단축키를 무시한다 (도구 패널·편집 용지는 열면서 편집으로 바뀐다).
  if (s.edit && a.editor.currentMode !== 'edit') return false;
  s.run(a);
  return true;
}

const isApple = /Mac|iPhone|iPad/.test(navigator.platform);
const label = (key: string) => (isApple ? key.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥') : key);

/** 단축키 목록 (하드웨어 키보드·컴퓨터에서) */
export function openShortcutsSheet(): void {
  const sheet = new Sheet({ title: '단축키' });
  const groups: Group[] = ['문서', '편집', '글자', '문단', '이동'];
  sheet.body.append(
    h('p.sheet-note', {}, '블루투스 키보드나 컴퓨터에서 쓸 수 있어요. 한글(한컴오피스)과 같은 조합이에요.'),
    ...groups.map((g) =>
      h(
        'section.shortcut-group',
        {},
        h('h3', {}, g),
        ...SHORTCUTS.filter((s) => s.group === g).map((s) =>
          h('div.shortcut-row', {}, h('span', {}, s.label), h('span.shortcut-keys', {}, ...s.keys.map((k) => h('kbd', {}, label(k))))),
        ),
      ),
    ),
  );
  sheet.open();
}
