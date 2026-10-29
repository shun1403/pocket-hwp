import { describe, expect, it } from 'vitest';
import { copyObject, deleteObject, objectAt, objectsOnPage, tableObjectAt } from '../../src/doc/ops/objects';
import { blankDocument } from './engine';

describe('표 통째로', () => {
  it('바깥 테두리만 표 전체로 잡고, 복사해 붙이고, 지운다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '앞 글');
    const t = JSON.parse(doc.raw.createTable(0, 0, 3, 2, 2)) as { paraIdx: number; controlIdx: number };
    const table = objectsOnPage(doc, 0).find((o) => o.kind === 'table')!;
    expect(table).toMatchObject({ para: t.paraIdx, ctrl: t.controlIdx });
    // 칸 안은 글을 고치고, 테두리 바로 둘레는 표 전체
    expect(objectAt(doc, 0, table.x + table.w / 2, table.y + table.h / 2)).toBeNull();
    expect(objectAt(doc, 0, table.x + table.w / 2, table.y - 3)?.kind).toBe('table');
    expect(objectAt(doc, 0, table.x - 5, table.y + table.h / 2)?.kind).toBe('table');
    // 캐럿이 든 표
    const cell = { sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: 3, cellParaIndex: 0 }] };
    expect(tableObjectAt(doc, cell)?.kind).toBe('table');
    expect(tableObjectAt(doc, { sec: 0, para: 0, offset: 0 })).toBeNull();
    // 복사 → 본문 끝에 붙이기 → 지우기
    expect(copyObject(doc, table)).toBe('[표]');
    const last = doc.paraCount({ sec: 0, para: 0, offset: 0 }) - 1;
    expect(doc.pasteControl({ sec: 0, para: last, offset: 0 })).not.toBeNull();
    expect(objectsOnPage(doc, 0).filter((o) => o.kind === 'table')).toHaveLength(2);
    expect(doc.pasteControl(cell)).toBeNull(); // 칸 안에는 못 붙인다
    deleteObject(doc, table);
    expect(objectsOnPage(doc, 0).filter((o) => o.kind === 'table')).toHaveLength(1);
  });
});
