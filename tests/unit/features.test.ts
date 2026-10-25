import { describe, expect, it } from 'vitest';
import { fieldCount, formTargets, setTargetValue, targetValue } from '../../src/doc/ops/fields';
import { setPageNumber } from '../../src/doc/ops/page';
import { cellContext, cellRange, cellsIn, clearRange, mergeRange, tableCells } from '../../src/doc/ops/table';
import type { DocPos } from '../../src/doc/position';
import { speechChunks } from '../../src/platform/speech';
import { inkBounds, removePaper } from '../../src/platform/signatures';
import { versionsToPrune } from '../../src/platform/versions';
import { blankDocument } from './engine';

const cell = (para: number, ctrl: number, cellIndex: number): DocPos => ({
  sec: 0,
  para,
  offset: 0,
  cellPath: [{ controlIndex: ctrl, cellIndex, cellParaIndex: 0 }],
});

describe('서식 채우기', () => {
  it('누름틀을 문서 순서대로 찾고 값을 넣는다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '성명:   연락처: ');
    doc.raw.insertClickHereField(0, 0, 11, '전화번호', '', 'phone', true);
    doc.raw.insertClickHereField(0, 0, 4, '이름', '', 'name', true);
    expect(fieldCount(doc)).toBe(2);
    const targets = formTargets(doc);
    expect(targets.map((t) => t.label)).toEqual(['이름', '전화번호']);
    setTargetValue(doc, targets[0], '홍길동');
    setTargetValue(doc, targets[1], '010\n1234');
    expect(targetValue(doc, targets[0])).toBe('홍길동');
    expect(targetValue(doc, targets[1])).toBe('010 1234');
    expect(doc.paraText({ sec: 0, para: 0, offset: 0 })).toBe('성명: 홍길동  연락처: 010 1234');
  });

  it('누름틀이 없으면 표의 빈 칸을 왼쪽 칸 이름으로 돈다', async () => {
    const doc = await blankDocument();
    const t = JSON.parse(doc.raw.createTable(0, 0, 0, 2, 2)) as { paraIdx: number; controlIdx: number };
    doc.insertText(cell(t.paraIdx, t.controlIdx, 0), '성명');
    doc.insertText(cell(t.paraIdx, t.controlIdx, 2), '주소');
    const targets = formTargets(doc);
    expect(targets.map((x) => x.label)).toEqual(['성명', '주소']);
    expect(targets.every((x) => x.kind === 'cell')).toBe(true);
    setTargetValue(doc, targets[1], '서울');
    expect(doc.paraText(cell(t.paraIdx, t.controlIdx, 3))).toBe('서울');
    // 다시 넣으면 바꾼다 (덧붙이지 않는다).
    setTargetValue(doc, targets[1], '부산');
    expect(targetValue(doc, targets[1])).toBe('부산');
  });
});

describe('쪽 번호', () => {
  it('꼬리말에 쪽마다 다른 번호가 그려지고, 저장해도 남는다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '본문');
    doc.raw.insertPageBreak(0, 0, 2);
    setPageNumber(doc, 0, 'total', 'right');
    const texts = (p: number, raw = doc.raw) => (raw.renderPageSvg(p).match(/>[^<>]{1,20}<\/text>/g) ?? []).join('');
    expect(texts(0)).toContain('>1</text>>/</text>>2</text>');
    expect(texts(1)).toContain('>2</text>>/</text>>2</text>');
    const reopened = new (doc.raw.constructor as new (b: Uint8Array) => typeof doc.raw)(doc.raw.exportHwp());
    expect(texts(1, reopened)).toContain('>2</text>');
  });
});

describe('표 여러 칸', () => {
  it('범위를 골라 합치고, 글을 지운다', async () => {
    const doc = await blankDocument();
    const t = JSON.parse(doc.raw.createTable(0, 0, 0, 3, 3)) as { paraIdx: number; controlIdx: number };
    for (let i = 0; i < 9; i += 1) doc.insertText(cell(t.paraIdx, t.controlIdx, i), `칸${i}`);
    const ctx = cellContext(doc, cell(t.paraIdx, t.controlIdx, 0))!;
    const cells = tableCells(doc, ctx);
    const r = cellRange(ctx, cells, 2, 2);
    expect(r).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
    clearRange(doc, ctx, cellsIn(cells, cellRange(ctx, cells, 1, 2)));
    expect(doc.paraText(cell(t.paraIdx, t.controlIdx, 1))).toBe('');
    expect(doc.paraText(cell(t.paraIdx, t.controlIdx, 2))).toBe('칸2');
    mergeRange(doc, ctx, r);
    const info = JSON.parse(doc.raw.getCellInfo(0, t.paraIdx, t.controlIdx, 0)) as { rowSpan: number; colSpan: number };
    expect([info.rowSpan, info.colSpan]).toEqual([2, 2]);
  });

  it('합쳐진 칸이 걸치면 범위를 넓힌다', () => {
    const ctx = { sec: 0, para: 0, ctrl: 0, cell: 0, row: 0, col: 0, rowSpan: 1, colSpan: 1 };
    const box = (cellIdx: number, row: number, col: number, rowSpan = 1, colSpan = 1) => ({ cellIdx, row, col, rowSpan, colSpan, pageIndex: 0, x: 0, y: 0, w: 1, h: 1 });
    const cells = [box(0, 0, 0), box(1, 0, 1, 2, 1), box(2, 1, 0), box(3, 0, 2), box(4, 1, 2)];
    expect(cellRange(ctx, cells, 1, 2)).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
  });
});

describe('읽어 주기', () => {
  it('긴 문단은 문장 단위로 나눈다', () => {
    expect(speechChunks('  짧은 문장.  ')).toEqual(['짧은 문장.']);
    const long = Array.from({ length: 10 }, (_, i) => `${i}번째 문장은 조금 길게 써 봅니다.`).join(' ');
    const chunks = speechChunks(long, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 60)).toBe(true);
    expect(chunks.join(' ')).toBe(long);
  });
});

describe('서명·도장', () => {
  it('흰 종이는 투명하게, 검은 잉크와 붉은 인주는 남긴다', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 20, 20, 20, 255, 210, 40, 40, 255, 235, 230, 225, 255]);
    removePaper(px);
    expect(px[3]).toBe(0);
    expect(px[7]).toBe(255);
    expect(px[11]).toBeGreaterThan(200);
    expect(px[15]).toBe(0);
  });

  it('잉크가 있는 상자를 찾는다', () => {
    const w = 4;
    const data = new Uint8ClampedArray(w * 3 * 4);
    data[(1 * w + 2) * 4 + 3] = 255;
    data[(2 * w + 1) * 4 + 3] = 255;
    expect(inkBounds(data, w, 3)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(inkBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});

describe('버전 기록', () => {
  it('처음 상태는 남기고 오래된 자동 버전부터 지운다', () => {
    const list = [
      { key: 1, at: 1, reason: 'original' as const },
      ...Array.from({ length: 5 }, (_, i) => ({ key: i + 2, at: i + 2, reason: 'auto' as const })),
    ];
    expect(versionsToPrune(list, 3)).toEqual([3, 2]);
    expect(versionsToPrune(list, 10)).toEqual([]);
  });
});
