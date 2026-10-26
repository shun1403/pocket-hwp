import { HwpDocument } from '@rhwp/core';
import { describe, expect, it } from 'vitest';
import { BINDINGS, PAPERS, bodySize, getPageDef, mm, pageSetupError, paperOf, setPageDef, toMm } from '../../src/doc/ops/page';
import { blankDocument } from './engine';

describe('편집 용지 (F7)', () => {
  it('여백 일곱 가지와 사용자 정의 크기·제본을 바꾸고 쪽에 반영한다', async () => {
    const doc = await blankDocument();
    const before = JSON.parse(doc.raw.getPageInfo(0)) as { columns: { x: number; width: number }[] };
    setPageDef(doc, 0, {
      width: mm(200),
      height: mm(280),
      marginTop: mm(12),
      marginHeader: mm(8),
      marginLeft: mm(25),
      marginGutter: mm(10),
      marginBottom: mm(14),
      marginFooter: mm(9),
      marginRight: mm(18),
      binding: 0,
    });
    const def = getPageDef(doc, 0);
    expect([def.width, def.height].map(toMm)).toEqual([200, 280]);
    expect([def.marginTop, def.marginHeader, def.marginLeft, def.marginGutter, def.marginBottom, def.marginFooter, def.marginRight].map(toMm)).toEqual([12, 8, 25, 10, 14, 9, 18]);
    expect(paperOf(def)).toBeNull();
    // 제본 여백만큼 본문이 안쪽으로 들어간다.
    const after = JSON.parse(doc.raw.getPageInfo(0)) as { width: number; columns: { x: number; width: number }[] };
    expect(after.columns[0].x).toBeGreaterThan(before.columns[0].x - 1);
    expect(toMm(bodySize(def).width)).toBe(147);
    expect(toMm(bodySize(def).height)).toBe(237);
    // 저장했다 다시 열어도 남는다.
    const reopened = new HwpDocument(doc.raw.exportHwp());
    expect(toMm((JSON.parse(reopened.getPageDef(0)) as { marginGutter: number }).marginGutter)).toBe(10);
  });

  it('맞쪽 제본이면 짝수 쪽 여백이 거울처럼 바뀐다', async () => {
    const doc = await blankDocument();
    for (let i = 0; i < 120; i += 1) doc.raw.splitParagraph(0, i, 0);
    setPageDef(doc, 0, { marginGutter: mm(20), binding: BINDINGS[1].id });
    const info = [0, 1].map((p) => JSON.parse(doc.raw.getPageInfo(p)) as { bindingMirrored: boolean; columns: { x: number }[] });
    expect(info.map((i) => i.bindingMirrored)).toEqual([false, true]);
    expect(info[0].columns[0].x).toBeGreaterThan(info[1].columns[0].x);
  });

  it('용지 종류를 알아보고, 맞지 않는 값은 막는다', async () => {
    const doc = await blankDocument();
    const def = getPageDef(doc, 0);
    expect(paperOf(def)).toBe('A4');
    const b4 = PAPERS.find((p) => p.id === 'B4')!;
    expect(paperOf({ ...def, width: b4.width, height: b4.height })).toBe('B4');
    expect(pageSetupError(def)).toBeNull();
    expect(pageSetupError({ ...def, marginLeft: mm(130), marginRight: mm(80) })).toContain('여백이 너무 커서');
    expect(pageSetupError({ ...def, width: mm(10) })).toContain('30~1500mm');
    expect(pageSetupError({ ...def, marginTop: Number.NaN })).toContain('숫자');
    // 가로 방향이면 폭과 길이를 바꿔 잰다.
    expect(toMm(bodySize({ ...def, landscape: true }).width)).toBe(toMm(def.height - def.marginLeft - def.marginRight));
    // 위로 넘기기면 제본 여백이 위에 붙는다.
    expect(bodySize({ ...def, binding: 2, marginGutter: mm(20) }).width).toBe(bodySize(def).width);
  });
});
