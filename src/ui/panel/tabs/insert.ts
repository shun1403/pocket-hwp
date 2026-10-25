import { addBookmark, insertBreak, insertHyperlink, insertNote, insertPicture, insertTextBox } from '../../../doc/ops/inserts';
import { inCell, innerPara } from '../../../doc/position';
import { pickFile } from '../../../platform/files';
import { askText } from '../../dialog';
import { h } from '../../dom';
import { Bindings, section, tiles } from '../controls';
import type { PanelContext, TabDef } from '../context';
import { openEquationSheet } from '../equation-sheet';
import { openSignatureSheet } from '../signature-sheet';
import { openTableSheet } from '../table-sheet';
import { toast } from '../../toast';


function bodyOnly(ctx: PanelContext, what: string): boolean {
  const caret = ctx.editor.caretPos;
  if (caret && inCell(caret)) {
    toast(`${what}은(는) 표 밖 본문에만 넣을 수 있어요.`);
    return false;
  }
  return !!caret;
}

async function insertImage(ctx: PanelContext, capture: boolean): Promise<void> {
  const file = await pickFile('image/png,image/jpeg,image/gif,image/bmp', capture);
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file);
  const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
  const ed = ctx.editor;
  const width = ed.bodyWidth();
  ed.command((doc, caret) => insertPicture(doc, caret, bytes, { width: bitmap.width, height: bitmap.height }, ext, width));
  bitmap.close();
}

async function note(ctx: PanelContext, kind: 'footnote' | 'endnote'): Promise<void> {
  const name = kind === 'footnote' ? '각주' : '미주';
  if (!bodyOnly(ctx, name)) return;
  const text = await askText(`${name} 내용`, '', '넣기');
  if (text === null) return;
  ctx.editor.command((doc, caret) => insertNote(doc, caret, kind, text));
}

async function hyperlink(ctx: PanelContext): Promise<void> {
  const sel = ctx.editor.selection;
  if (!sel || innerPara(sel[0]) !== innerPara(sel[1])) {
    toast('링크를 걸 글을 먼저 한 문단 안에서 길게 눌러 선택해 주세요.');
    return;
  }
  const uri = await askText('웹 주소', 'https://', '링크 걸기');
  if (!uri || uri === 'https://') return;
  ctx.editor.command((doc) => insertHyperlink(doc, sel[0], sel[1], uri));
}

async function bookmark(ctx: PanelContext): Promise<void> {
  if (!bodyOnly(ctx, '책갈피')) return;
  const name = await askText('책갈피 이름', '', '넣기');
  if (!name) return;
  ctx.editor.command((doc, caret) => addBookmark(doc, caret, name));
}

export const insertTab: TabDef = {
  id: 'insert',
  label: '입력',
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const now = () => new Date();
    const el = h(
      'div.tab-body',
      {},
      section(
        '개체',
        tiles(b, [
          { label: '표', icon: 'table', onClick: () => bodyOnly(ctx, '표') && openTableSheet(ed) },
          { label: '사진', icon: 'image', onClick: () => void insertImage(ctx, false) },
          { label: '카메라', icon: 'camera', onClick: () => void insertImage(ctx, true) },
          { label: '수식', icon: 'sigma', onClick: () => bodyOnly(ctx, '수식') && openEquationSheet(ed) },
          {
            label: '글상자',
            icon: 'textbox',
            onClick: () => bodyOnly(ctx, '글상자') && ed.command((doc, caret) => insertTextBox(doc, caret, ed.bodyWidth() * 0.6)),
          },
        ]),
      ),
      section(
        '주석·연결',
        tiles(b, [
          { label: '각주', icon: 'footnote', onClick: () => void note(ctx, 'footnote') },
          { label: '미주', icon: 'footnote', onClick: () => void note(ctx, 'endnote') },
          { label: '링크', icon: 'link', onClick: () => void hyperlink(ctx) },
          { label: '책갈피', icon: 'bookmark', onClick: () => void bookmark(ctx) },
        ]),
      ),
      section(
        '나누기·날짜',
        tiles(b, [
          { label: '쪽 나누기', icon: 'pageBreak', onClick: () => bodyOnly(ctx, '쪽 나누기') && ed.command((doc, caret) => insertBreak(doc, caret, 'page')) },
          { label: '단 나누기', icon: 'columns', onClick: () => bodyOnly(ctx, '단 나누기') && ed.command((doc, caret) => insertBreak(doc, caret, 'column')) },
          { label: '오늘 날짜', icon: 'calendar', onClick: () => ed.insertText(now().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })) },
          { label: '지금 시각', icon: 'clock', onClick: () => ed.insertText(now().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })) },
        ]),
      ),
      section(
        '양식',
        tiles(b, [
          { label: '서식 채우기', icon: 'form', onClick: () => ctx.openFormFill() },
          { label: '서명·도장', icon: 'pen', onClick: () => void openSignatureSheet(ed) },
          { label: '기호·상용구', icon: 'symbol', onClick: () => ctx.openTab('symbol') },
        ]),
      ),
    );
    return { el, refresh: () => b.refresh() };
  },
};
