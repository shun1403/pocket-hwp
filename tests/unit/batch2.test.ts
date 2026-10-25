import { describe, expect, it } from 'vitest';
import { createStyleFromPos, paragraphStyles, redefineStyle, restartNumbering, styleAt } from '../../src/doc/ops/lists';
import { bookmarks, linkAt, removeLink, safeLinkUrl, updateLink } from '../../src/doc/ops/links';
import { outline } from '../../src/doc/ops/outline';
import { pageBorderFill, setPageBorder, setPageFill } from '../../src/doc/ops/page';
import { cssColor, hwpColor } from '../../src/doc/ops/shapes';
import { blankDocument } from './engine';

const svgText = (raw: { renderPageSvg(p: number): string }) => (raw.renderPageSvg(0).match(/>[^<>]{1,20}<\/text>/g) ?? []).join('');

describe('스타일 만들기·고치기', () => {
  it('지금 모양으로 새 스타일을 만들어 다른 문단에 건다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '큰 제목');
    doc.raw.splitParagraph(0, 0, 4);
    doc.raw.insertText(0, 1, 0, '다른 문단');
    doc.raw.splitParagraph(0, 1, 5);
    doc.raw.insertText(0, 2, 0, '셋째 문단');
    const p0 = { sec: 0, para: 0, offset: 1 };
    doc.applyCharProps({ ...p0, offset: 0 }, { ...p0, offset: 4 }, { bold: true, fontSize: 1800, textColor: '#c00000' });
    doc.applyParaProps(p0, p0, { alignment: 'center' });
    const id = createStyleFromPos(doc, p0, '내 제목');
    expect(paragraphStyles(doc).some((s) => s.id === id && s.name === '내 제목')).toBe(true);
    const p1 = { sec: 0, para: 1, offset: 1 };
    doc.raw.applyStyle(0, 1, id);
    expect(styleAt(doc, p1)).toBe(id);
    expect(doc.charProps(p1)).toMatchObject({ bold: true, fontSize: 1800, textColor: '#c00000' });
    expect(doc.paraProps(p1).alignment).toBe('center');
    // 스타일을 지금 모양으로 다시 정한다.
    doc.applyCharProps({ ...p1, offset: 0 }, { ...p1, offset: 5 }, { italic: true, bold: false });
    redefineStyle(doc, id, p1);
    const p2 = { sec: 0, para: 2, offset: 1 };
    doc.raw.applyStyle(0, 2, id);
    expect(doc.charProps(p2)).toMatchObject({ italic: true, bold: false, fontSize: 1800 });
  });
});

describe('번호 새로 시작', () => {
  it('지정한 번호부터 다시 센다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '하나');
    doc.raw.splitParagraph(0, 0, 2);
    doc.raw.insertText(0, 1, 0, '둘');
    const nid = doc.raw.ensureDefaultNumbering();
    for (const p of [0, 1]) doc.raw.applyParaFormat(0, p, JSON.stringify({ headType: 'Number', numberingId: nid, paraLevel: 0 }));
    restartNumbering(doc, { sec: 0, para: 1, offset: 0 }, 5);
    expect(svgText(doc.raw)).toContain('>5</text>');
  });
});

describe('링크·책갈피', () => {
  it('링크를 찾고, 주소를 바꾸고, 뗀다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '홈페이지 바로가기');
    doc.raw.insertHyperlinkEx(JSON.stringify({ target: { section: 0, para: 0, cellPath: [] }, start: 0, end: 4, uri: 'https://a.example' }));
    const pos = { sec: 0, para: 0, offset: 2 };
    const link = linkAt(doc, pos)!;
    expect(link).toMatchObject({ text: '홈페이지', uri: 'https://a.example' });
    expect(linkAt(doc, { ...pos, offset: 7 })).toBeNull();
    updateLink(doc, pos, link, 'https://b.example');
    expect(linkAt(doc, pos)?.uri).toBe('https://b.example');
    removeLink(doc, pos, linkAt(doc, pos)!);
    expect(linkAt(doc, pos)).toBeNull();
    expect(doc.paraText(pos)).toBe('홈페이지 바로가기');
  });

  it('위험한 주소는 열지 않는다', () => {
    expect(safeLinkUrl('https://a.kr')).toBe('https://a.kr');
    expect(safeLinkUrl('www.a.kr')).toBe('https://www.a.kr');
    expect(safeLinkUrl('mailto:a@b.kr')).toBe('mailto:a@b.kr');
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(safeLinkUrl('file:///etc/passwd')).toBeNull();
  });

  it('책갈피 목록', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '여기');
    doc.raw.addBookmark(0, 0, 1, '중간');
    expect(bookmarks(doc).map((b) => [b.name, b.charPos])).toEqual([['중간', 1]]);
  });
});

describe('개요·쪽 테두리·색', () => {
  it('개요 스타일 제목을 목차로 모은다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '첫 장');
    doc.raw.splitParagraph(0, 0, 3);
    doc.raw.insertText(0, 1, 0, '본문');
    doc.raw.applyStyle(0, 0, 2);
    expect(outline(doc)).toEqual([{ level: 1, number: '1.', title: '첫 장', page: 1, pos: { sec: 0, para: 0, offset: 0 } }]);
  });

  it('쪽 테두리와 배경을 따로 바꾼다', async () => {
    const doc = await blankDocument();
    setPageBorder(doc, 0, 'thick', '#2f5ee8');
    expect(pageBorderFill(doc, 0)).toEqual({ border: 'thick', fill: null });
    setPageFill(doc, 0, '#fff8e1');
    expect(pageBorderFill(doc, 0)).toEqual({ border: 'thick', fill: '#fff8e1' });
    setPageBorder(doc, 0, 'none');
    expect(pageBorderFill(doc, 0).border).toBe('none');
  });

  it('한글 색 값(BBGGRR)과 CSS 색을 바꾼다', () => {
    expect(hwpColor('#ff0000')).toBe(0x0000ff);
    expect(cssColor(hwpColor('#12abef'))).toBe('#12abef');
  });
});

describe('표: 크기·테두리·계산식·나누기', () => {
  const setup = async () => {
    const { cellContext, tableCells } = await import('../../src/doc/ops/table');
    const doc = await blankDocument();
    const t = JSON.parse(doc.raw.createTable(0, 0, 0, 3, 3)) as { paraIdx: number; controlIdx: number };
    const cell = (i: number) => ({ sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: i, cellParaIndex: 0 }] });
    const ctx = (i: number) => cellContext(doc, cell(i))!;
    return { doc, t, cell, ctx, cells: () => tableCells(doc, ctx(0)) };
  };

  it('칸 너비를 넓힌다', async () => {
    const { resizeCell } = await import('../../src/doc/ops/table');
    const { doc, ctx, cells } = await setup();
    const before = cells()[0].w;
    resizeCell(doc, ctx(0), 1500, 0);
    expect(cells()[0].w).toBeCloseTo(before + 20, 0);
  });

  it('바깥 테두리만 굵게', async () => {
    const { setCellBorders, cellsIn } = await import('../../src/doc/ops/table');
    const { doc, t, ctx, cells } = await setup();
    setCellBorders(doc, ctx(0), cellsIn(cells(), { r0: 0, c0: 0, r1: 1, c1: 1 }), 'thick', true);
    const props = (i: number) => JSON.parse(doc.raw.getCellProperties(0, t.paraIdx, t.controlIdx, i));
    expect(props(0).borderLeft.width).toBe(7);
    expect(props(0).borderTop.width).toBe(7);
    expect(props(0).borderRight.width).not.toBe(7);
    expect(props(4).borderRight.width).toBe(7);
    expect(props(4).borderBottom.width).toBe(7);
  });

  it('배경색을 칠해도 테두리 굵기가 그대로다', async () => {
    const { setCellFill } = await import('../../src/doc/ops/table');
    const { doc, t, ctx } = await setup();
    setCellFill(doc, ctx(0), '#fef7e0');
    const p = JSON.parse(doc.raw.getCellProperties(0, t.paraIdx, t.controlIdx, 0));
    expect(p.fillColor).toBe('#fef7e0');
    expect([p.borderLeft.width, p.borderTop.width]).toEqual([1, 1]);
  });

  it('위 칸 합계 계산식', async () => {
    const { applyFormula, quickFormula, columnName } = await import('../../src/doc/ops/table');
    const { doc, cell, ctx } = await setup();
    doc.insertText(cell(1), '10');
    doc.insertText(cell(4), '32');
    const f = quickFormula(ctx(7), 'SUM', 'up')!;
    expect(f).toBe('=SUM(B1:B2)');
    expect(applyFormula(doc, ctx(7), f)).toBe(42);
    expect(doc.paraText(cell(7))).toBe('42');
    expect(applyFormula(doc, ctx(7), '=BOGUS(')).toBeNull();
    expect([columnName(0), columnName(25), columnName(26)]).toEqual(['A', 'Z', 'AA']);
  });

  it('표를 나누고 다시 붙인다', async () => {
    const { splitTableAt, joinNextTable } = await import('../../src/doc/ops/table');
    const { doc, ctx } = await setup();
    const tables = () => JSON.parse(doc.raw.getPageControlLayout(0)).controls.filter((c: { type: string }) => c.type === 'table');
    expect(splitTableAt(doc, ctx(6))).toBe(true);
    expect(tables().map((x: { rowCount: number }) => x.rowCount)).toEqual([2, 1]);
    expect(joinNextTable(doc, ctx(0))).toBe(true);
    expect(tables().map((x: { rowCount: number }) => x.rowCount)).toEqual([3]);
  });
});

describe('서식 있는 붙여넣기', () => {
  it('본문과 표 칸에 HTML을 모양째 붙인다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '앞뒤');
    const end = doc.pasteHtml({ sec: 0, para: 0, offset: 1 }, '<b>굵게</b> 붙임');
    expect(doc.paraText({ sec: 0, para: 0, offset: 0 })).toBe('앞굵게 붙임뒤');
    expect(end).toEqual({ sec: 0, para: 0, offset: 6 });
    expect(doc.charProps({ sec: 0, para: 0, offset: 2 }).bold).toBe(true);
    const t = JSON.parse(doc.raw.createTable(0, 0, 7, 1, 1)) as { paraIdx: number; controlIdx: number };
    const cell = { sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: 0, cellParaIndex: 0 }] };
    const after = doc.pasteHtml(cell, '<i>칸</i>');
    expect(doc.paraText(cell)).toBe('칸');
    expect(after.offset).toBe(1);
  });
});
