import { HwpDocument } from '@rhwp/core';
import { describe, expect, it } from 'vitest';
import { EditableDocument } from '../../src/doc/editable';
import { addMemo, deleteMemo, editMemo, elementEnd, hasMemos, memoAuthor, memoCount, memoRanges, readMemos } from '../../src/doc/ops/memos';
import { readZip } from '../../src/export/zip';
import { exportDocument } from '../../src/export/exporters';
import { blankDocument } from './engine';

const reopen = (bytes: Uint8Array) => new EditableDocument(new HwpDocument(bytes));
const at = (offset: number) => ({ sec: 0, para: 0, offset });

async function sectionXml(doc: EditableDocument): Promise<string> {
  const files = await readZip(exportDocument(doc.raw, 'hwpx').bytes);
  return new TextDecoder().decode(files.find((f) => f.name === 'Contents/section0.xml')!.bytes);
}

describe('메모', () => {
  it('고른 글에 메모를 달고, 고치고, 지운다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '보고서 초안입니다');
    expect(memoCount(doc)).toBe(0);

    const withMemo = reopen(await addMemo(doc, at(0), at(3), '숫자 다시 확인\n둘째 줄', '홍길동', new Date('2026-10-26T01:02:03Z')));
    expect(withMemo.paraText(at(0))).toBe('보고서 초안입니다');
    expect(hasMemos(withMemo.raw)).toBe(true);
    const [memo] = await readMemos(withMemo);
    expect(memo).toMatchObject({ anchor: '보고서', text: '숫자 다시 확인\n둘째 줄', author: '홍길동', created: '2026-10-26T01:02:03Z', editable: true });
    expect(memo.start).toEqual(at(0));
    expect(memo.end).toEqual(at(3));
    // 지금 문서는 그대로다 (자리표로 끼운 누름틀도 남지 않는다).
    expect(memoCount(doc)).toBe(0);
    expect(JSON.parse(doc.raw.getFieldList())).toEqual([]);

    // 한글과 같은 모양으로 쓴다.
    const xml = await sectionXml(withMemo);
    expect(xml).toContain('type="MEMO"');
    expect(xml).toMatch(/<hp:stringParam name="Command">MEMO\/65535\/1\/\d+\/\d+\/홍길동\/\\;;<\/hp:stringParam>/);

    const edited = reopen(await editMemo(withMemo, memo.id, '고쳤어요 <&>'));
    expect((await readMemos(edited))[0]).toMatchObject({ text: '고쳤어요 <&>', anchor: '보고서' });

    const removed = reopen(await deleteMemo(edited, memo.id));
    expect(memoCount(removed)).toBe(0);
    expect(removed.paraText(at(0))).toBe('보고서 초안입니다');
  });

  it('글을 고르지 않으면 그 자리에 메모를 달고, 여러 개를 차례로 단다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '가나다라마바');
    const one = reopen(await addMemo(doc, at(2), at(2), '첫 메모', '나'));
    const two = reopen(await addMemo(one, at(4), at(6), '둘째 메모', '나'));
    const memos = await readMemos(two);
    expect(memos.map((m) => [m.text, m.anchor])).toEqual([
      ['첫 메모', ''],
      ['둘째 메모', '마바'],
    ]);
    expect(memoRanges(two).map((r) => [r.start.offset, r.end.offset])).toEqual([
      [2, 2],
      [4, 6],
    ]);
    expect(two.paraText(at(0))).toBe('가나다라마바');
  });

  it('표 칸 안의 글에도 단다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '표 앞');
    const t = JSON.parse(doc.raw.createTable(0, 0, 3, 2, 2)) as { paraIdx: number; controlIdx: number };
    const cell = { sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: 1, cellParaIndex: 0 }] };
    doc.insertText(cell, '칸 글자');
    const next = reopen(await addMemo(doc, cell, { ...cell, offset: 1 }, '칸 메모', '나'));
    const [memo] = await readMemos(next);
    expect(memo).toMatchObject({ text: '칸 메모', anchor: '칸' });
    expect(memo.start?.cellPath?.[0]).toMatchObject({ controlIndex: t.controlIdx, cellIndex: 1 });
  });

  it('HWPX로 다시 저장해도 메모가 남고, HWP로 저장하면 사라진다고 알린다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '본문');
    const memoDoc = reopen(await addMemo(doc, at(0), at(2), '남아야 해요', '나'));
    const again = reopen(exportDocument(memoDoc.raw, 'hwpx').bytes);
    expect((await readMemos(again))[0].text).toBe('남아야 해요');
    expect(exportDocument(memoDoc.raw, 'hwp').lossWarnings.join(' ')).toContain('메모');
    expect(exportDocument(memoDoc.raw, 'hwpx').lossWarnings).toEqual([]);
  });

  it('작성자 이름에서 한글 메모 명령의 구분 글자를 뺀다', async () => {
    expect(memoAuthor('홍길동/기획팀;과장')).toBe('홍길동 기획팀 과장');
    expect(memoAuthor('  \\ ; ')).toBe('사용자');
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '본문');
    const memoDoc = reopen(await addMemo(doc, at(0), at(2), '내용', 'a/b;c'));
    expect((await readMemos(memoDoc))[0].author).toBe('a b c');
    expect(await sectionXml(memoDoc)).toMatch(/MEMO\/65535\/1\/\d+\/\d+\/a b c\/\\;;/);
  });

  it('겹친 요소의 끝을 짝 맞춰 찾는다', () => {
    const xml = '<a><hp:subList x="1"><hp:subList/><hp:subList>안</hp:subList></hp:subList>뒤</a>';
    const start = xml.indexOf('<hp:subList');
    expect(xml.slice(start, elementEnd(xml, start, 'hp:subList'))).toBe('<hp:subList x="1"><hp:subList/><hp:subList>안</hp:subList></hp:subList>');
  });
});
