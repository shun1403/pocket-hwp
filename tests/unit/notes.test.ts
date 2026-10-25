import { describe, expect, it } from 'vitest';
import { headerFooterLines, noteText, setHeaderFooterLines, setNoteText, specialAt } from '../../src/doc/ops/notes';
import { blankDocument } from './engine';

describe('머리말·꼬리말 직접 고치기', () => {
  it('여러 줄로 쓰고, 줄 수를 늘리고 줄이고, 비우면 지운다', async () => {
    const doc = await blankDocument();
    const t = { sec: 0, isHeader: true, applyTo: 0 };
    setHeaderFooterLines(doc, t, ['기관명', '문서번호 2026-1']);
    expect(headerFooterLines(doc, t)).toEqual(['기관명', '문서번호 2026-1']);
    setHeaderFooterLines(doc, t, ['기관명', '둘', '셋']);
    expect(headerFooterLines(doc, t)).toEqual(['기관명', '둘', '셋']);
    setHeaderFooterLines(doc, t, ['한 줄만']);
    expect(headerFooterLines(doc, t)).toEqual(['한 줄만']);
    setHeaderFooterLines(doc, t, ['']);
    expect(headerFooterLines(doc, t)).toEqual([]);
  });

  it('머리말 자리를 누르면 머리말로 알아본다', async () => {
    const doc = await blankDocument();
    setHeaderFooterLines(doc, { sec: 0, isHeader: true, applyTo: 0 }, ['머리말']);
    let hit = null;
    for (let y = 0; y < 200 && !hit; y += 4) hit = specialAt(doc, 0, 300, y);
    expect(hit).toMatchObject({ kind: 'headerFooter', target: { isHeader: true } });
  });

  it('머리말·꼬리말이 없으면 그 여백을 눌러도 본문 탭으로 둔다', async () => {
    const doc = await blankDocument();
    for (let y = 0; y < 1120; y += 4) expect(specialAt(doc, 0, 300, y)).toBeNull();
  });
});

describe('각주 직접 고치기', () => {
  it('내용을 여러 줄로 바꾸고 다시 한 줄로 줄인다', async () => {
    const doc = await blankDocument();
    doc.raw.insertText(0, 0, 0, '본문 글');
    const r = JSON.parse(doc.raw.insertFootnote(0, 0, 2)) as { paraIdx: number; controlIdx: number };
    doc.raw.insertTextInFootnote(0, r.paraIdx, r.controlIdx, 0, 0, '처음 내용');
    const n = { sec: 0, para: r.paraIdx, ctrl: r.controlIdx };
    expect(noteText(doc, n)).toEqual({ number: 1, lines: ['처음 내용'] });
    setNoteText(doc, n, '첫 줄\n둘째 줄');
    expect(noteText(doc, n)?.lines).toEqual(['첫 줄', '둘째 줄']);
    setNoteText(doc, n, '하나로');
    expect(noteText(doc, n)?.lines).toEqual(['하나로']);
  });
});
