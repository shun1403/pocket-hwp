import { describe, expect, it } from 'vitest';
import { buildIcs, dateLabel, findDates } from '../../src/doc/dates';

const now = new Date(2026, 9, 30); // 2026-10-30

describe('문서에서 날짜 찾기', () => {
  it('여러 모양의 날짜와 시각, 마감을 먼저', () => {
    const text = '현장 체험 학습 안내\n일시: 2026. 11. 12.(목) 오전 9시 30분\n신청서는 11월 5일(수)까지 제출해 주세요.\n문의: 02-123-4567';
    const found = findDates(text, now);
    expect(found.map((d) => [d.year, d.month, d.day, d.hour, d.minute, d.deadline])).toEqual([
      [2026, 11, 5, undefined, undefined, true],
      [2026, 11, 12, 9, 30, false],
    ]);
    expect(found[0].guessedYear).toBe(true);
    expect(found[0].context).toBe('신청서는 11월 5일(수)까지 제출해 주세요.');
  });
  it('연도가 없고 이미 지난 날은 내년으로, 오후 시각', () => {
    const [d] = findDates('3월 2일 오후 2시 반 입학식', now);
    expect([d.year, d.month, d.day, d.hour, d.minute]).toEqual([2027, 3, 2, 14, 30]);
  });
  it('없는 날짜·전화번호·분수는 날짜가 아니다', () => {
    expect(findDates('2월 30일, 3/4 정도, 2026-13-01, 02-123-4567', now)).toEqual([]);
    expect(findDates('11/5(목) 15:00 회의', now)[0]).toMatchObject({ month: 11, day: 5, hour: 15, minute: 0 });
  });
  it('같은 날은 한 번만', () => {
    expect(findDates('2026년 11월 5일 … 11월 5일까지', now)).toHaveLength(1);
  });
  it('읽기 좋은 날짜', () => {
    expect(dateLabel({ year: 2026, month: 11, day: 5 })).toBe('2026년 11월 5일 (목)');
    expect(dateLabel({ year: 2026, month: 11, day: 5, hour: 15, minute: 0 })).toBe('2026년 11월 5일 (목) 오후 3시');
  });
});

describe('캘린더 파일', () => {
  it('하루 종일·시각 일정, 이스케이프, 하루 전 알림', () => {
    const ics = buildIcs(
      [
        { title: '체험 학습 신청서 제출, 마감', date: { year: 2026, month: 11, day: 5 } },
        { title: '현장 체험', date: { year: 2026, month: 11, day: 12, hour: 9, minute: 30 }, description: '1줄\n2줄' },
      ],
      new Date(Date.UTC(2026, 9, 30, 1, 2, 3)),
      () => 'id',
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20261105\r\nDTEND;VALUE=DATE:20261106');
    expect(ics).toContain('DTSTART:20261112T093000\r\nDTEND:20261112T103000');
    expect(ics).toContain('SUMMARY:체험 학습 신청서 제출\\, 마감');
    expect(ics).toContain('DESCRIPTION:1줄\\n2줄');
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('DTSTAMP:20261030T010203Z');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
