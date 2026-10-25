import type { EditableDocument } from '../editable';

/**
 * 머리말·꼬리말·각주를 본문처럼 고치기 위한 읽기·쓰기.
 * 휴대폰에서는 좁은 머리말 칸에 캐럿을 두기보다, 눌렀을 때 여러 줄 입력 시트로 고치는 편이 쉽다.
 */

function parse<T>(json: string): T {
  return JSON.parse(json) as T;
}

/** 머리말·꼬리말 하나의 자리 */
export interface HfTarget {
  sec: number;
  isHeader: boolean;
  applyTo: number;
}

/** 각주·미주 하나의 자리 (본문 문단의 개체) */
export interface NoteTarget {
  sec: number;
  para: number;
  ctrl: number;
}

export function headerFooterExists(doc: EditableDocument, t: HfTarget): boolean {
  try {
    return !!parse<{ exists?: boolean }>(doc.raw.getHeaderFooter(t.sec, t.isHeader, t.applyTo)).exists;
  } catch {
    return false;
  }
}

/** 머리말·꼬리말의 줄(문단)들. 없으면 빈 배열 */
export function headerFooterLines(doc: EditableDocument, t: HfTarget): string[] {
  if (!headerFooterExists(doc, t)) return [];
  const lines: string[] = [];
  try {
    const first = parse<{ paraCount: number; text?: string }>(doc.raw.getHeaderFooterParaInfo(t.sec, t.isHeader, t.applyTo, 0));
    for (let i = 0; i < first.paraCount; i += 1) {
      const info = i === 0 ? first : parse<{ text?: string }>(doc.raw.getHeaderFooterParaInfo(t.sec, t.isHeader, t.applyTo, i));
      lines.push(info.text ?? '');
    }
  } catch {
    // 읽지 못한 줄은 건너뛴다.
  }
  return lines;
}

/**
 * 머리말·꼬리말을 주어진 줄들로 바꾼다. 바뀌지 않은 줄은 건드리지 않아서
 * 그 줄의 글자 모양·쪽 번호 같은 필드가 그대로 남는다. 모든 줄이 비면 지운다.
 */
export function setHeaderFooterLines(doc: EditableDocument, t: HfTarget, lines: string[]): void {
  const raw = doc.raw;
  if (lines.every((l) => !l.trim())) {
    if (headerFooterExists(doc, t)) raw.deleteHeaderFooter(t.sec, t.isHeader, t.applyTo);
    return;
  }
  if (!headerFooterExists(doc, t)) raw.createHeaderFooter(t.sec, t.isHeader, t.applyTo);
  const old = headerFooterLines(doc, t);
  const count = (i: number) => parse<{ charCount: number }>(raw.getHeaderFooterParaInfo(t.sec, t.isHeader, t.applyTo, i)).charCount;
  // 줄 수를 맞춘다: 모자라면 끝에서 나누고, 남으면 뒤에서부터 합친다.
  let paras = Math.max(1, old.length);
  while (paras < lines.length) {
    raw.splitParagraphInHeaderFooter(t.sec, t.isHeader, t.applyTo, paras - 1, count(paras - 1));
    paras += 1;
  }
  while (paras > lines.length) {
    const last = paras - 1;
    const len = count(last);
    if (len > 0) raw.deleteTextInHeaderFooter(t.sec, t.isHeader, t.applyTo, last, 0, len);
    raw.mergeParagraphInHeaderFooter(t.sec, t.isHeader, t.applyTo, last);
    paras -= 1;
  }
  lines.forEach((line, i) => {
    if (old[i] === line) return;
    const len = count(i);
    if (len > 0) raw.deleteTextInHeaderFooter(t.sec, t.isHeader, t.applyTo, i, 0, len);
    if (line) raw.insertTextInHeaderFooter(t.sec, t.isHeader, t.applyTo, i, 0, line);
  });
}

export function setHeaderFooterAlignment(doc: EditableDocument, t: HfTarget, alignment: 'left' | 'center' | 'right'): void {
  const n = Math.max(1, headerFooterLines(doc, t).length);
  for (let i = 0; i < n; i += 1) doc.raw.applyParaFormatInHf(t.sec, t.isHeader, t.applyTo, i, JSON.stringify({ alignment }));
}

interface FootnoteInfo {
  paraCount: number;
  number: number;
  texts: string[];
}

/** 각주 번호와 줄들. 엔진이 각 줄 끝에 붙이는 빈칸은 뗀다. */
export function noteText(doc: EditableDocument, n: NoteTarget): { number: number; lines: string[] } | null {
  try {
    const info = parse<FootnoteInfo>(doc.raw.getFootnoteInfo(n.sec, n.para, n.ctrl));
    return { number: info.number, lines: info.texts.map((t) => t.replace(/\s+$/, '')) };
  } catch {
    return null;
  }
}

/** 각주 내용을 바꾼다. 줄바꿈은 각주 안 문단 나누기가 된다. */
export function setNoteText(doc: EditableDocument, n: NoteTarget, text: string): void {
  const current = noteText(doc, n);
  if (!current) return;
  const raw = doc.raw;
  const lines = text.split('\n');
  // 뒤쪽 문단부터 글을 지우고 앞 문단에 합친다.
  for (let i = Math.max(1, current.lines.length) - 1; i >= 0; i -= 1) {
    const len = current.lines[i]?.length ?? 0;
    if (len > 0) raw.deleteTextInFootnote(n.sec, n.para, n.ctrl, i, 0, len);
    if (i > 0) raw.mergeParagraphInFootnote(n.sec, n.para, n.ctrl, i);
  }
  lines.forEach((line, i) => {
    if (i > 0) raw.splitParagraphInFootnote(n.sec, n.para, n.ctrl, i - 1, lines[i - 1].length);
    if (line) raw.insertTextInFootnote(n.sec, n.para, n.ctrl, i, 0, line);
  });
}

export function deleteNote(doc: EditableDocument, n: NoteTarget): void {
  doc.raw.deleteFootnote(n.sec, n.para, n.ctrl);
}

/** 쪽 좌표가 머리말·꼬리말·각주 위인지 */
export type SpecialHit = { kind: 'headerFooter'; target: HfTarget } | { kind: 'note'; target: NoteTarget };

export function specialAt(doc: EditableDocument, page: number, x: number, y: number): SpecialHit | null {
  try {
    const marker = parse<{ hit: boolean; sectionIndex?: number; paragraphIndex?: number; controlIndex?: number }>(
      doc.raw.hitTestBodyFootnoteMarker(page, x, y),
    );
    if (marker.hit) return { kind: 'note', target: { sec: marker.sectionIndex!, para: marker.paragraphIndex!, ctrl: marker.controlIndex! } };
    const area = parse<{ hit: boolean; footnoteIndex?: number }>(doc.raw.hitTestFootnote(page, x, y));
    if (area.hit && area.footnoteIndex !== undefined) {
      const info = parse<{ ok: boolean; sectionIdx: number; paraIdx: number; controlIdx: number }>(doc.raw.getPageFootnoteInfo(page, area.footnoteIndex));
      if (info.ok) return { kind: 'note', target: { sec: info.sectionIdx, para: info.paraIdx, ctrl: info.controlIdx } };
    }
    const hf = parse<{ hit: boolean; isHeader?: boolean; sectionIndex?: number; applyTo?: number }>(doc.raw.hitTestHeaderFooter(page, x, y));
    if (hf.hit) {
      // 머리말·꼬리말이 없어도 그 여백 자리는 hit 으로 나온다. 실제로 있을 때만 머리말 탭으로 본다.
      const target: HfTarget = { sec: hf.sectionIndex ?? 0, isHeader: !!hf.isHeader, applyTo: hf.applyTo ?? 0 };
      if (headerFooterExists(doc, target)) return { kind: 'headerFooter', target };
    }
  } catch {
    // 히트테스트를 못 하면 본문으로 본다.
  }
  return null;
}
