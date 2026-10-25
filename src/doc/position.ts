/**
 * 문서 안의 캐럿 위치.
 *
 * 본문 문단이면 `para`가 곧 문단 번호다. 표 셀/글상자 안이면 `para`는 표를 가진 바깥 본문 문단이고,
 * 실제 편집 문단은 `cellPath`의 마지막 항목(`cellParaIndex`)이 가리킨다.
 */
export interface CellStep {
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
}

export interface DocPos {
  sec: number;
  para: number;
  offset: number;
  cellPath?: CellStep[];
}

/** rhwp `hitTest` 결과 */
export interface HitResult {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  parentParaIndex?: number;
  cellPath?: CellStep[];
}

export interface CaretRect {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

export interface PageRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function posFromHit(hit: HitResult): DocPos {
  if (hit.cellPath && hit.cellPath.length > 0 && hit.parentParaIndex !== undefined) {
    return {
      sec: hit.sectionIndex,
      para: hit.parentParaIndex,
      offset: hit.charOffset,
      cellPath: hit.cellPath.map((s) => ({ ...s })),
    };
  }
  return { sec: hit.sectionIndex, para: hit.paragraphIndex, offset: hit.charOffset };
}

export function inCell(pos: DocPos): pos is DocPos & { cellPath: CellStep[] } {
  return !!pos.cellPath && pos.cellPath.length > 0;
}

/** 편집 대상 문단 번호 (본문이면 para, 셀이면 가장 안쪽 cellParaIndex) */
export function innerPara(pos: DocPos): number {
  return inCell(pos) ? pos.cellPath[pos.cellPath.length - 1].cellParaIndex : pos.para;
}

/** 같은 문단 목록(본문 구역 또는 같은 셀) 안에서 다른 문단을 가리키는 위치를 만든다. */
export function withInnerPara(pos: DocPos, paraIndex: number, offset: number): DocPos {
  if (!inCell(pos)) return { sec: pos.sec, para: paraIndex, offset };
  const cellPath = pos.cellPath.map((s) => ({ ...s }));
  cellPath[cellPath.length - 1].cellParaIndex = paraIndex;
  return { sec: pos.sec, para: pos.para, offset, cellPath };
}

export function cellPathJson(pos: DocPos): string {
  return JSON.stringify(pos.cellPath ?? []);
}

/** 두 위치가 같은 문단 목록(같은 구역 본문, 또는 같은 셀)에 있는가 */
export function sameContainer(a: DocPos, b: DocPos): boolean {
  if (a.sec !== b.sec) return false;
  if (!inCell(a) && !inCell(b)) return true;
  if (!inCell(a) || !inCell(b) || a.para !== b.para) return false;
  if (a.cellPath.length !== b.cellPath.length) return false;
  return a.cellPath.every((s, i) => {
    const t = b.cellPath[i];
    const last = i === a.cellPath.length - 1;
    return s.controlIndex === t.controlIndex && s.cellIndex === t.cellIndex && (last || s.cellParaIndex === t.cellParaIndex);
  });
}

export function samePos(a: DocPos, b: DocPos): boolean {
  return sameContainer(a, b) && innerPara(a) === innerPara(b) && a.offset === b.offset;
}

/** 같은 컨테이너 안의 두 위치를 비교한다. a<b 이면 음수. */
export function comparePos(a: DocPos, b: DocPos): number {
  const pa = innerPara(a);
  const pb = innerPara(b);
  if (pa !== pb) return pa - pb;
  return a.offset - b.offset;
}

/** 선택 범위를 앞→뒤 순서로 정렬한다. */
export function orderRange(a: DocPos, b: DocPos): [DocPos, DocPos] {
  return comparePos(a, b) <= 0 ? [a, b] : [b, a];
}

/** 문단 텍스트에서 offset 주변 단어 경계를 찾는다 (길게 눌러 단어 선택). */
export function wordBounds(text: string, offset: number): [number, number] {
  const chars = Array.from(text);
  const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
  let i = Math.min(Math.max(offset, 0), chars.length);
  if (!isWord(chars[i]) && isWord(chars[i - 1])) i -= 1;
  if (!isWord(chars[i])) return [i, Math.min(i + 1, chars.length)];
  let start = i;
  let end = i;
  while (start > 0 && isWord(chars[start - 1])) start -= 1;
  while (end < chars.length && isWord(chars[end])) end += 1;
  return [start, end];
}
