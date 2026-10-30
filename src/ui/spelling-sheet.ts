import { paragraphs } from '../doc/ops/autofill';
import type { DocPos } from '../doc/position';
import { checkSpelling, type SpellHit } from '../doc/spelling';
import type { Editor } from '../editor/editor';
import { h } from './dom';
import { Sheet } from './sheet';
import { toast } from './toast';

interface Found extends SpellHit {
  pos: DocPos;
}

function scan(editor: Editor): Found[] {
  const doc = editor.document;
  if (!doc) return [];
  const out: Found[] = [];
  for (const pos of paragraphs(doc)) {
    let text: string;
    try {
      text = doc.paraText(pos);
    } catch {
      continue;
    }
    for (const hit of checkSpelling(text)) out.push({ ...hit, pos });
  }
  return out;
}

/** 고친다. 같은 문단은 뒤에서부터 고쳐 앞 위치가 밀리지 않게 한다. */
function apply(editor: Editor, items: Found[]): boolean {
  // 문단마다 따로 위치가 밀리므로 문단끼리 묶고, 문단 안에서는 뒤에서부터.
  const key = (p: DocPos) => `${p.sec}:${p.para}:${JSON.stringify(p.cellPath ?? [])}`;
  const order = [...items].sort((a, b) => (key(a.pos) === key(b.pos) ? b.from - a.from : key(a.pos) < key(b.pos) ? -1 : 1));
  return editor.command((doc) => {
    let first: DocPos | undefined;
    for (const f of order) {
      const at = doc.deleteRange({ ...f.pos, offset: f.from }, { ...f.pos, offset: f.to });
      first = doc.insertText(at, f.fix);
    }
    return first;
  });
}

/**
 * 맞춤법 검사: 자주 틀리는 말과 띄어쓰기를 찾아 보여 주고, 하나씩 또는 모두 고친다.
 * 폰 안에서 규칙으로만 찾으므로 모든 틀린 곳을 찾지는 못한다.
 */
export function openSpellingSheet(editor: Editor): void {
  const found = scan(editor);
  const sheet = new Sheet({ title: '맞춤법 검사' });
  if (found.length === 0) {
    sheet.body.append(h('p.dialog-message', {}, '자주 틀리는 말을 찾지 못했어요.\n규칙으로 찾는 검사라 모든 틀린 곳을 찾지는 못해요.'));
    sheet.open();
    return;
  }
  const rows = found.map((f) => {
    const row: HTMLElement = h(
      'div.spell-row',
      {},
      h(
        'button.spell-text',
        {
          type: 'button',
          'aria-label': `${f.text}을(를) 문서에서 보기`,
          onclick: () => {
            sheet.close();
            editor.select({ ...f.pos, offset: f.from }, { ...f.pos, offset: f.to });
          },
        },
        h('span.spell-wrong', {}, f.text),
        ' → ',
        h('strong', {}, f.fix),
        h('span.autofill-label', {}, f.why),
      ),
      h(
        'button.chip-btn',
        {
          type: 'button',
          onclick: () => {
            if (apply(editor, [f])) {
              sheet.close();
              // 위치가 바뀌었으므로 다시 찾아 보여 준다.
              openSpellingSheet(editor);
            }
          },
        },
        '고치기',
      ),
    );
    return row;
  });
  sheet.body.append(
    h('p.sheet-note', {}, `고칠 만한 곳 ${found.length}개를 찾았어요. 글을 누르면 문서에서 보여 줘요.`),
    h('div.autofill-list', {}, ...rows),
    h('p.sheet-note', {}, '자주 틀리는 말을 규칙으로 찾는 검사예요. 모든 틀린 곳을 찾지는 못하고, 인터넷으로 보내지 않아요.'),
    h(
      'div.dialog-actions',
      {},
      h('button.secondary-btn', { type: 'button', onclick: () => sheet.close() }, '닫기'),
      h(
        'button.primary-btn',
        {
          type: 'button',
          onclick: () => {
            const ok = apply(editor, found);
            sheet.close();
            toast(ok ? `${found.length}곳을 고쳤어요. 실행 취소로 되돌릴 수 있어요.` : '고치지 못했어요.');
          },
        },
        `모두 고치기 (${found.length})`,
      ),
    ),
  );
  sheet.open();
}
