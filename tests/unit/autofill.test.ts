import { describe, expect, it } from 'vitest';
import { type Profile, applyFill, findSlots, koreanDate, matchLabel, scanText, slotValue } from '../../src/doc/ops/autofill';
import { blankDocument } from './engine';

const me: Profile = {
  id: 'me',
  label: '나',
  kind: 'self',
  values: { name: '홍길동', mobile: '010-1234-5678', address: '서울시 중구 세종대로 110', birth: '1990-01-02', email: 'hong@example.com' },
  updatedAt: 0,
};

describe('이름표 알아보기', () => {
  it('공백·기호를 빼고 여러 표현을 같은 항목으로 본다', () => {
    expect(matchLabel('성 명')?.key).toBe('name');
    expect(matchLabel('신청인 성명')?.key).toBe('name');
    expect(matchLabel('성명(한자)')?.key).toBe('nameHanja');
    expect(matchLabel('연락처(휴대폰)')?.key).toBe('mobile');
    expect(matchLabel('E-mail')?.key).toBe('email');
    expect(matchLabel('학교명')?.key).toBe('org');
    expect(matchLabel('생년월일')?.key).toBe('birth');
    expect(matchLabel('작성일')?.key).toBe('today');
    expect(matchLabel('학생 성명')).toEqual({ key: 'name', child: true });
    expect(matchLabel('비고')).toBeNull();
    expect(matchLabel('이 신청서의 내용은 사실과 다름없음을 확인합니다')).toBeNull();
  });
});

describe('문단에서 자리 찾기', () => {
  it('성명: ____ 연락처: ____ 의 빈칸', () => {
    const hits = scanText('성명 : ______    연락처 : ______');
    expect(hits.map((h) => [h.key, h.kind])).toEqual([
      ['name', 'inline'],
      ['mobile', 'inline'],
    ]);
    expect(hits[0].from).toBe(4);
  });
  it('이미 쓴 칸은 건너뛴다', () => {
    expect(scanText('성명 : 김철수  연락처 : ____').map((h) => h.key)).toEqual(['mobile']);
  });
  it('(서명)·(인), 빈 날짜, 생년월일 날짜', () => {
    expect(scanText('신청인 홍길동 (서명 또는 인)').map((h) => h.key)).toEqual(['signature']);
    expect(scanText('2026년    월    일').map((h) => h.key)).toEqual(['today']);
    expect(scanText('20  년  월  일').map((h) => h.key)).toEqual(['today']);
    expect(scanText('생년월일   년   월   일').map((h) => h.key)).toEqual(['birth']);
    expect(scanText('지난 3년 2월 1일에 시작했다')).toEqual([]);
    expect(scanText('2026년 10월 30일')).toEqual([]);
  });
});

describe('문서 채우기', () => {
  it('본문 빈칸·표 빈 칸·날짜를 한 번에 채우고 서명 자리는 서명이 있을 때만', async () => {
    const doc = await blankDocument();
    let pos = doc.insertText({ sec: 0, para: 0, offset: 0 }, '성명 : ______    연락처 : ______');
    pos = doc.splitParagraph(pos);
    pos = doc.insertText(pos, '2026년    월    일');
    pos = doc.splitParagraph(pos);
    pos = doc.insertText(pos, '신청인 (서명)');
    pos = doc.splitParagraph(pos);
    const t = JSON.parse(doc.raw.createTable(0, pos.para, 0, 2, 2)) as { paraIdx: number; controlIdx: number };
    const cell = (i: number) => ({ sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: i, cellParaIndex: 0 }] });
    doc.insertText(cell(0), '주 소');
    doc.insertText(cell(2), '이메일');

    const slots = findSlots(doc);
    expect(slots.map((s) => `${s.kind}:${s.key}`).sort()).toEqual(['cell:address', 'cell:email', 'date:today', 'inline:mobile', 'inline:name', 'marker:signature'].sort());

    const now = new Date(2026, 9, 30);
    const items = slots.map((slot) => ({ slot, value: slotValue(slot, me, now) }));
    applyFill(doc, items, null);
    expect(doc.paraText({ sec: 0, para: 0, offset: 0 })).toBe('성명 : 홍길동 연락처 : 010-1234-5678 ');
    expect(doc.paraText({ sec: 0, para: 1, offset: 0 })).toBe('2026년 10월 30일');
    expect(doc.paraText({ sec: 0, para: 2, offset: 0 })).toBe('신청인 (서명)'); // 서명이 없으면 그대로
    expect(doc.paraText(cell(1))).toBe('서울시 중구 세종대로 110');
    expect(doc.paraText(cell(3))).toBe('hong@example.com');
    // 다 채우고 나면 더 채울 자리가 없다 (서명 자리만 남는다).
    expect(findSlots(doc).map((s) => s.key)).toEqual(['signature']);
  });

  it('날짜 모양', () => {
    expect(koreanDate('1990-01-02')).toBe('1990년 1월 2일');
    expect(koreanDate('')).toBe('');
  });
});
