import { describe, expect, it } from 'vitest';
import { chosungOf, searchText } from '../../src/doc/text-search';

describe('보관함 본문 찾기', () => {
  const text = '2026년 가정통신문\n현장 체험 학습 신청서를 11월 5일까지 제출해 주세요.\n체험학습 장소: 국립중앙박물관';
  it('띄어쓰기를 무시하고 찾고, 찾은 곳 수와 앞뒤 글을 준다', () => {
    const hit = searchText(text, '체험학습')!;
    expect(hit.count).toBe(2);
    expect(hit.match).toBe('체험 학습');
    expect(hit.before).toBe('현장 ');
    expect(hit.after.startsWith(' 신청서를 11월 5일까지')).toBe(true);
  });
  it('초성으로 찾는다', () => {
    expect(chosungOf('가')).toBe('ㄱ');
    expect(searchText(text, 'ㄱㅈㅌㅅㅁ')?.match).toBe('가정통신문');
  });
  it('대소문자 무시, 없으면 null', () => {
    expect(searchText('Pocket HWP', 'hwp')?.match).toBe('HWP');
    expect(searchText(text, '없는말')).toBeNull();
    expect(searchText(text, '  ')).toBeNull();
  });
  it('긴 줄은 앞뒤를 줄여 보여 준다', () => {
    const hit = searchText(`${'가'.repeat(40)}목표${'나'.repeat(40)}`, '목표')!;
    expect(hit.before).toBe(`…${'가'.repeat(16)}`);
    expect(hit.after).toBe(`${'나'.repeat(30)}…`);
  });
});
