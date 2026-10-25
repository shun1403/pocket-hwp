import type { EditableDocument } from '../editable';
import { type DocPos, inCell } from '../position';

/** 문단 안의 링크 하나 */
export interface LinkInfo {
  fieldId: number;
  start: number;
  end: number;
  text: string;
  uri: string;
}

function target(pos: DocPos) {
  return {
    section: pos.sec,
    para: pos.para,
    cellPath: inCell(pos) ? pos.cellPath.map((s) => [s.controlIndex, s.cellIndex, s.cellParaIndex]) : [],
  };
}

/** 위치에 걸린 링크. 없으면 null */
export function linkAt(doc: EditableDocument, pos: DocPos): LinkInfo | null {
  try {
    const r = JSON.parse(doc.raw.getHyperlinkContext(JSON.stringify({ ...target(pos), offset: pos.offset }))) as { links?: LinkInfo[] };
    return r.links?.find((l) => pos.offset >= l.start && pos.offset <= l.end) ?? null;
  } catch {
    return null;
  }
}

export function updateLink(doc: EditableDocument, pos: DocPos, link: LinkInfo, uri: string): void {
  doc.raw.updateHyperlinkEx(JSON.stringify({ target: target(pos), fieldId: link.fieldId, uri }));
}

/** 링크만 떼고 글은 남긴다. */
export function removeLink(doc: EditableDocument, pos: DocPos, link: LinkInfo): void {
  doc.raw.removeHyperlinkEx(JSON.stringify({ target: target(pos), fieldId: link.fieldId }));
}

/**
 * 밖에서 열어도 되는 주소인가. 문서에 담긴 주소라 javascript: 같은 것은 열지 않는다.
 */
export function safeLinkUrl(uri: string): string | null {
  const trimmed = uri.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

export interface BookmarkInfo {
  name: string;
  sec: number;
  para: number;
  ctrlIdx: number;
  charPos: number;
}

export function bookmarks(doc: EditableDocument): BookmarkInfo[] {
  try {
    return JSON.parse(doc.raw.getBookmarks()) as BookmarkInfo[];
  } catch {
    return [];
  }
}

export function bookmarkPos(b: BookmarkInfo): DocPos {
  return { sec: b.sec, para: b.para, offset: b.charPos };
}

export function renameBookmark(doc: EditableDocument, b: BookmarkInfo, name: string): void {
  doc.raw.renameBookmark(b.sec, b.para, b.ctrlIdx, name);
}

export function deleteBookmark(doc: EditableDocument, b: BookmarkInfo): void {
  doc.raw.deleteBookmark(b.sec, b.para, b.ctrlIdx);
}
