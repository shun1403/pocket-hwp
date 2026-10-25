import type { EditableDocument } from '../editable';
import { type DocPos, inCell } from '../position';

function parse<T>(json: string): T {
  return JSON.parse(json) as T;
}

/**
 * 각주/미주를 넣고 내용을 채운다. (본문 전용)
 * rhwp의 글자 위치(charOffset)에는 개체가 자리를 차지하지 않으므로 캐럿 위치는 그대로다.
 */
export function insertNote(doc: EditableDocument, pos: DocPos, kind: 'footnote' | 'endnote', text: string): DocPos {
  const r = parse<{ paraIdx: number; controlIdx: number }>(
    kind === 'footnote' ? doc.raw.insertFootnote(pos.sec, pos.para, pos.offset) : doc.raw.insertEndnote(pos.sec, pos.para, pos.offset),
  );
  if (text) doc.raw.insertTextInFootnote(pos.sec, r.paraIdx, r.controlIdx, 0, 0, text);
  return { sec: pos.sec, para: r.paraIdx, offset: pos.offset };
}

export function insertEquation(doc: EditableDocument, pos: DocPos, script: string, sizePt = 10): DocPos {
  const r = parse<{ paraIdx: number }>(doc.raw.insertEquation(pos.sec, pos.para, pos.offset, script, sizePt * 100, 0));
  return { ...pos, para: r.paraIdx };
}

export function equationPreview(doc: EditableDocument, script: string): string {
  try {
    return doc.raw.renderEquationPreview(script, 1400, 0);
  } catch {
    return '';
  }
}

export function insertBreak(doc: EditableDocument, pos: DocPos, kind: 'page' | 'column'): DocPos {
  const r = parse<{ paraIdx: number; charOffset: number }>(
    kind === 'page' ? doc.raw.insertPageBreak(pos.sec, pos.para, pos.offset) : doc.raw.insertColumnBreak(pos.sec, pos.para, pos.offset),
  );
  return { sec: pos.sec, para: r.paraIdx, offset: r.charOffset };
}

/** 선택한 글에 웹 주소를 건다. 같은 문단 안의 선택만 된다. */
export function insertHyperlink(doc: EditableDocument, start: DocPos, end: DocPos, uri: string): void {
  const cellPath = inCell(start) ? start.cellPath.map((s) => [s.controlIndex, s.cellIndex, s.cellParaIndex]) : [];
  doc.raw.insertHyperlinkEx(
    JSON.stringify({ target: { section: start.sec, para: start.para, cellPath }, start: start.offset, end: end.offset, uri }),
  );
}

export function addBookmark(doc: EditableDocument, pos: DocPos, name: string): void {
  doc.raw.addBookmark(pos.sec, pos.para, pos.offset, name);
}

/** 캐럿 자리에 글자처럼 다루는 글상자를 넣는다. */
export function insertTextBox(doc: EditableDocument, pos: DocPos, widthPx: number): DocPos {
  const r = parse<{ paraIdx: number }>(
    doc.raw.createShapeControl(
      JSON.stringify({
        sectionIdx: pos.sec,
        paraIdx: pos.para,
        charOffset: pos.offset,
        width: Math.round(widthPx * 75),
        height: Math.round(widthPx * 75 * 0.3),
        treatAsChar: true,
      }),
    ),
  );
  return { sec: pos.sec, para: r.paraIdx, offset: pos.offset };
}

export function insertPicture(
  doc: EditableDocument,
  pos: DocPos,
  image: Uint8Array,
  natural: { width: number; height: number },
  ext: string,
  maxWidthPx: number,
): DocPos {
  // HWPUNIT: 96dpi 기준 1px = 75
  const scale = Math.min(1, maxWidthPx / natural.width);
  const r = parse<{ paraIdx: number; controlIdx: number }>(
    doc.raw.insertPictureEx(
      JSON.stringify({
        sectionIdx: pos.sec,
        paraIdx: pos.para,
        charOffset: pos.offset,
        cellPath: inCell(pos) ? JSON.stringify(pos.cellPath) : '',
        width: Math.round(natural.width * scale * 75),
        height: Math.round(natural.height * scale * 75),
        naturalWidthPx: natural.width,
        naturalHeightPx: natural.height,
        extension: ext,
      }),
      image,
    ),
  );
  // 기본값은 쪽 기준 떠 있는 그림이라 쪽 모서리에 붙는다. 본문 글자처럼 흐르게 바꾼다.
  if (!inCell(pos)) {
    doc.raw.setPictureProperties(pos.sec, r.paraIdx, r.controlIdx, JSON.stringify({ treatAsChar: true }));
  }
  return pos;
}

export interface DocStats {
  chars: number;
  charsNoSpace: number;
  words: number;
  paragraphs: number;
  pages: number;
}

export function documentStats(text: string, pages: number): DocStats {
  const paragraphs = text.split('\n').filter((l) => l.trim().length > 0).length;
  const chars = Array.from(text.replace(/\n/g, '')).length;
  const charsNoSpace = Array.from(text.replace(/\s/g, '')).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return { chars, charsNoSpace, words, paragraphs, pages };
}
