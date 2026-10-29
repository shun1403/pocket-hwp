import type { HwpDocument } from '../engine/rhwp';
import {
  type CaretRect,
  type DocPos,
  type HitResult,
  type PageRect,
  cellPathJson,
  inCell,
  innerPara,
  orderRange,
  posFromHit,
  withInnerPara,
} from './position';

/** 글자 모양 (rhwp CharProperties 중 모바일 UI가 다루는 부분) */
export interface CharProps {
  fontFamily?: string;
  /** 글꼴을 바꿀 때: findOrCreateFontId 결과 */
  fontId?: number;
  fontSize?: number; // HWPUNIT, 1pt = 100
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  textColor?: string;
  shadeColor?: string;
  /** 언어별(7개) 장평 %, 자간 % */
  ratios?: number[];
  spacings?: number[];
}

export interface ParaProps {
  alignment?: 'justify' | 'left' | 'right' | 'center' | 'distribute' | 'split';
  lineSpacing?: number;
  lineSpacingType?: string;
  /** px (96dpi) */
  marginLeft?: number;
  indent?: number;
  spacingBefore?: number;
  spacingAfter?: number;
  headType?: 'None' | 'Outline' | 'Number' | 'Bullet';
  numberingId?: number;
  paraLevel?: number;
}

export interface SearchMatch {
  start: DocPos;
  end: DocPos;
}

interface RawMatch {
  sec: number;
  para: number;
  charOffset: number;
  length: number;
  cellContext?: { parentPara: number; ctrlIdx: number; cellIdx: number; cellPara: number };
}

/** rhwp searchAllText 결과 한 건을 선택 범위로 바꾼다. */
export function matchToRange(m: RawMatch): SearchMatch {
  const start: DocPos = m.cellContext
    ? {
        sec: m.sec,
        para: m.cellContext.parentPara,
        offset: m.charOffset,
        cellPath: [{ controlIndex: m.cellContext.ctrlIdx, cellIndex: m.cellContext.cellIdx, cellParaIndex: m.cellContext.cellPara }],
      }
    : { sec: m.sec, para: m.para, offset: m.charOffset };
  return { start, end: { ...start, offset: m.charOffset + m.length } };
}

function parse<T>(json: string): T {
  return JSON.parse(json) as T;
}

/**
 * rhwp `HwpDocument` 위에 "본문/표 셀" 차이를 숨긴 편집 API.
 *
 * 모든 메서드는 DocPos 하나로 동작하고, 셀 안이면 ...ByPath 계열 API를 호출한다.
 */
export class EditableDocument {
  constructor(private engine: HwpDocument) {}

  get raw(): HwpDocument {
    return this.engine;
  }

  /** 엔진 밖에서 고친 문서(메모 등)로 통째로 바꾼다. 앞 문서는 풀어 준다. */
  replaceRaw(next: HwpDocument): void {
    const prev = this.engine;
    this.engine = next;
    prev.free();
  }

  pageCount(): number {
    return this.raw.pageCount();
  }

  hitTest(page: number, x: number, y: number): DocPos | null {
    try {
      return posFromHit(parse<HitResult>(this.raw.hitTest(page, x, y)));
    } catch {
      return null;
    }
  }

  paraLength(pos: DocPos): number {
    if (inCell(pos)) return this.raw.getCellParagraphLengthByPath(pos.sec, pos.para, cellPathJson(pos));
    return this.raw.getParagraphLength(pos.sec, pos.para);
  }

  paraCount(pos: DocPos): number {
    if (inCell(pos)) return this.raw.getCellParagraphCountByPath(pos.sec, pos.para, cellPathJson(pos));
    return this.raw.getParagraphCount(pos.sec);
  }

  paraText(pos: DocPos): string {
    const len = this.paraLength(pos);
    if (len === 0) return '';
    if (inCell(pos)) return this.raw.getTextInCellByPath(pos.sec, pos.para, cellPathJson(pos), 0, len);
    return this.raw.getTextRange(pos.sec, pos.para, 0, len);
  }

  caretRect(pos: DocPos): CaretRect | null {
    try {
      const json = inCell(pos)
        ? this.raw.getCursorRectByPath(pos.sec, pos.para, cellPathJson(pos), pos.offset)
        : this.raw.getCursorRect(pos.sec, pos.para, pos.offset);
      const rect = parse<CaretRect>(json);
      return Number.isFinite(rect.x) ? rect : null;
    } catch {
      return null;
    }
  }

  selectionRects(a: DocPos, b: DocPos): PageRect[] {
    const [s, e] = orderRange(a, b);
    try {
      const json = inCell(s)
        ? this.raw.getSelectionRectsInCellByPath(s.sec, s.para, cellPathJson(s), innerPara(s), s.offset, innerPara(e), e.offset)
        : this.raw.getSelectionRects(s.sec, s.para, s.offset, e.para, e.offset);
      return parse<PageRect[]>(json);
    } catch {
      // 엔진이 범위 전체를 못 재면(개체가 낀 문단 등) 문단마다 따로 재어 보이는 만큼은 보여 준다.
      const rects: PageRect[] = [];
      for (let p = innerPara(s); p <= innerPara(e); p += 1) {
        const at = withInnerPara(s, p, 0);
        const from = p === innerPara(s) ? s.offset : 0;
        const to = p === innerPara(e) ? e.offset : this.paraLength(at);
        if (to <= from) continue;
        try {
          const json = inCell(at)
            ? this.raw.getSelectionRectsInCellByPath(at.sec, at.para, cellPathJson(at), p, from, p, to)
            : this.raw.getSelectionRects(at.sec, p, from, p, to);
          rects.push(...parse<PageRect[]>(json));
        } catch {
          // 이 문단은 건너뛴다.
        }
      }
      return rects;
    }
  }

  /** 텍스트를 끼우고 끼운 뒤의 캐럿 위치를 돌려준다. 줄바꿈(\n)은 문단 나누기로 처리한다. */
  insertText(pos: DocPos, text: string): DocPos {
    let cur = pos;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => {
      if (i > 0) cur = this.splitParagraph(cur);
      if (line.length === 0) return;
      const json = inCell(cur)
        ? this.raw.insertTextInCellByPath(cur.sec, cur.para, cellPathJson(cur), cur.offset, line)
        : this.raw.insertText(cur.sec, cur.para, cur.offset, line);
      cur = { ...cur, offset: parse<{ charOffset: number }>(json).charOffset };
    });
    return cur;
  }

  splitParagraph(pos: DocPos): DocPos {
    if (inCell(pos)) {
      const r = parse<{ cellParaIndex: number; charOffset: number }>(
        this.raw.splitParagraphInCellByPath(pos.sec, pos.para, cellPathJson(pos), pos.offset),
      );
      return withInnerPara(pos, r.cellParaIndex, r.charOffset);
    }
    const r = parse<{ paraIdx: number; charOffset: number }>(this.raw.splitParagraph(pos.sec, pos.para, pos.offset));
    return { sec: pos.sec, para: r.paraIdx, offset: r.charOffset };
  }

  /** Backspace. 문단 맨 앞이면 이전 문단과 합친다. */
  deleteBackward(pos: DocPos): DocPos {
    if (pos.offset > 0) {
      this.deleteChars(pos, pos.offset - 1, 1);
      return { ...pos, offset: pos.offset - 1 };
    }
    if (innerPara(pos) === 0) return pos;
    if (inCell(pos)) {
      const r = parse<{ cellParaIndex: number; charOffset: number }>(
        this.raw.mergeParagraphInCellByPath(pos.sec, pos.para, cellPathJson(pos)),
      );
      return withInnerPara(pos, r.cellParaIndex, r.charOffset);
    }
    const r = parse<{ paraIdx: number; charOffset: number }>(this.raw.mergeParagraph(pos.sec, pos.para));
    return { sec: pos.sec, para: r.paraIdx, offset: r.charOffset };
  }

  /** Delete 키. 문단 끝이면 다음 문단을 끌어올린다. */
  deleteForward(pos: DocPos): DocPos {
    if (pos.offset < this.paraLength(pos)) {
      this.deleteChars(pos, pos.offset, 1);
      return pos;
    }
    const next = innerPara(pos) + 1;
    if (next >= this.paraCount(pos)) return pos;
    this.deleteBackward(withInnerPara(pos, next, 0));
    return pos;
  }

  deleteRange(a: DocPos, b: DocPos): DocPos {
    const [s, e] = orderRange(a, b);
    if (innerPara(s) === innerPara(e)) {
      if (e.offset > s.offset) this.deleteChars(s, s.offset, e.offset - s.offset);
      return s;
    }
    const json = inCell(s)
      ? this.raw.deleteRangeInCellByPath(s.sec, s.para, cellPathJson(s), innerPara(s), s.offset, innerPara(e), e.offset)
      : this.raw.deleteRange(s.sec, s.para, s.offset, e.para, e.offset);
    const r = parse<{ paraIdx?: number; charOffset?: number }>(json);
    return withInnerPara(s, r.paraIdx ?? innerPara(s), r.charOffset ?? s.offset);
  }

  private deleteChars(pos: DocPos, offset: number, count: number): void {
    if (inCell(pos)) this.raw.deleteTextInCellByPath(pos.sec, pos.para, cellPathJson(pos), offset, count);
    else this.raw.deleteText(pos.sec, pos.para, offset, count);
  }

  /** 선택 범위의 평문 */
  textBetween(a: DocPos, b: DocPos): string {
    const [s, e] = orderRange(a, b);
    const parts: string[] = [];
    for (let p = innerPara(s); p <= innerPara(e); p += 1) {
      const text = Array.from(this.paraText(withInnerPara(s, p, 0)));
      const from = p === innerPara(s) ? s.offset : 0;
      const to = p === innerPara(e) ? e.offset : text.length;
      parts.push(text.slice(from, to).join(''));
    }
    return parts.join('\n');
  }

  /** 선택 범위를 모양(굵게·표 등)째 HTML로 (복사할 때). 엔진이 못 만들면 null */
  htmlBetween(a: DocPos, b: DocPos): string | null {
    const [s, e] = orderRange(a, b);
    try {
      const html = inCell(s)
        ? this.raw.exportSelectionInCellHtmlByPath(s.sec, s.para, cellPathJson(s), innerPara(s), s.offset, innerPara(e), e.offset)
        : this.raw.exportSelectionHtml(s.sec, s.para, s.offset, e.para, e.offset);
      return html || null;
    } catch {
      return null;
    }
  }

  charProps(pos: DocPos): CharProps {
    try {
      const json = inCell(pos)
        ? this.raw.getCellCharPropertiesAtByPath(pos.sec, pos.para, cellPathJson(pos), pos.offset)
        : this.raw.getCharPropertiesAt(pos.sec, pos.para, pos.offset);
      return parse<CharProps>(json);
    } catch {
      return {};
    }
  }

  paraProps(pos: DocPos): ParaProps {
    try {
      if (!inCell(pos)) return parse<ParaProps>(this.raw.getParaPropertiesAt(pos.sec, pos.para));
      const outer = pos.cellPath[0];
      if (pos.cellPath.length > 1) return {};
      return parse<ParaProps>(
        this.raw.getCellParaPropertiesAt(pos.sec, pos.para, outer.controlIndex, outer.cellIndex, outer.cellParaIndex),
      );
    } catch {
      return {};
    }
  }

  /** 범위의 각 문단에 글자 모양을 건다. */
  applyCharProps(a: DocPos, b: DocPos, props: CharProps): void {
    const [s, e] = orderRange(a, b);
    const json = JSON.stringify(props);
    for (let p = innerPara(s); p <= innerPara(e); p += 1) {
      const at = withInnerPara(s, p, 0);
      const from = p === innerPara(s) ? s.offset : 0;
      const to = p === innerPara(e) ? e.offset : this.paraLength(at);
      if (to <= from) continue;
      if (inCell(at)) this.raw.applyCharFormatInCellByPath(at.sec, at.para, cellPathJson(at), from, to, json);
      else this.raw.applyCharFormat(at.sec, p, from, to, json);
    }
  }

  /** 범위가 걸친 문단마다 문단 모양을 건다. */
  applyParaProps(a: DocPos, b: DocPos, props: ParaProps): void {
    const [s, e] = orderRange(a, b);
    const json = JSON.stringify(props);
    for (let p = innerPara(s); p <= innerPara(e); p += 1) {
      if (!inCell(s)) {
        this.raw.applyParaFormat(s.sec, p, json);
      } else if (s.cellPath.length === 1) {
        const outer = s.cellPath[0];
        this.raw.applyParaFormatInCell(s.sec, s.para, outer.controlIndex, outer.cellIndex, p, json);
      }
    }
  }

  /** 엔진 안 클립보드에 복사해 둔 개체(표·그림·도형)를 붙인다. 본문에만 된다. 못 붙이면 null */
  pasteControl(pos: DocPos): DocPos | null {
    if (inCell(pos) || !this.raw.clipboardHasControl()) return null;
    try {
      const r = parse<{ ok: boolean; paraIdx?: number }>(this.raw.pasteControl(pos.sec, pos.para, pos.offset));
      return r.ok ? { sec: pos.sec, para: r.paraIdx ?? pos.para, offset: 0 } : null;
    } catch {
      return null;
    }
  }

  /** HTML을 붙여 넣고 붙인 뒤의 캐럿 위치를 돌려준다. */
  pasteHtml(pos: DocPos, html: string): DocPos {
    const r = parse<{ ok: boolean; paraIdx?: number; cellParaIdx?: number; charOffset?: number }>(
      inCell(pos)
        ? this.raw.pasteHtmlInCellByPath(pos.sec, pos.para, cellPathJson(pos), pos.offset, html)
        : this.raw.pasteHtml(pos.sec, pos.para, pos.offset, html),
    );
    if (!r.ok) throw new Error('paste failed');
    if (inCell(pos)) return r.cellParaIdx !== undefined ? withInnerPara(pos, r.cellParaIdx, r.charOffset ?? 0) : pos;
    return { sec: pos.sec, para: r.paraIdx ?? pos.para, offset: r.charOffset ?? pos.offset };
  }

  /** 문서 전체(표 안 포함)에서 찾는다. */
  search(query: string): SearchMatch[] {
    if (!query) return [];
    try {
      return parse<RawMatch[]>(this.raw.searchAllText(query, false, true)).map(matchToRange);
    } catch {
      return [];
    }
  }

  /** 본문 캐럿 위치에 표를 넣는다. 셀 안에서는 지원하지 않는다. */
  insertTable(pos: DocPos, rows: number, cols: number): DocPos | null {
    if (inCell(pos)) return null;
    const r = parse<{ ok: boolean; paraIdx: number }>(this.raw.createTable(pos.sec, pos.para, pos.offset, rows, cols));
    if (!r.ok) return null;
    return { sec: pos.sec, para: Math.min(r.paraIdx + 1, this.raw.getParagraphCount(pos.sec) - 1), offset: 0 };
  }


}
