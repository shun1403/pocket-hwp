import type { EditableDocument } from '../editable';
import type { DocPos } from '../position';

/** 개요(제목) 하나: 개요 1~7 스타일·개요 번호가 붙은 문단 */
export interface OutlineItem {
  level: number;
  number: string;
  title: string;
  page: number;
  pos: DocPos;
}

export function outline(doc: EditableDocument): OutlineItem[] {
  try {
    const r = JSON.parse(doc.raw.getOutlineNavigation()) as {
      outline: { level: number; number: string; title: string; page: number; section: number; paragraph: number }[];
    };
    return r.outline.map((o) => ({ level: o.level, number: o.number, title: o.title, page: o.page, pos: { sec: o.section, para: o.paragraph, offset: 0 } }));
  } catch {
    return [];
  }
}
