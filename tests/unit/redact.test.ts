import { describe, expect, it } from 'vitest';
import { findPii, maskChars, uniquePii } from '../../src/doc/ops/redact';

const kinds = (t: string) => findPii(t).map((m) => [m.kind, m.masked]);

describe('개인정보 찾기·가리기', () => {
  it('주민번호는 생년월일과 성별 자리만 남긴다', () => {
    expect(kinds('주민등록번호: 900101-1234567')).toEqual([['rrn', '900101-1●●●●●●']]);
    expect(kinds('9001011234567')).toEqual([['rrn', '9001011●●●●●●']]);
    // 날짜가 아닌 13자리는 아니다
    expect(findPii('9913991234567').map((m) => m.kind)).not.toContain('rrn');
  });

  it('전화번호는 가운데 묶음을 가린다', () => {
    expect(kinds('연락처 010-1234-5678')).toEqual([['phone', '010-●●●●-5678']]);
    expect(kinds('02)123-4567')).toEqual([['phone', '02)●●●-4567']]);
    expect(kinds('031.987.6543')).toEqual([['phone', '031.●●●.6543']]);
    expect(kinds('01012345678')).toEqual([['phone', '010●●●●5678']]);
  });

  it('이메일은 앞 두 글자만 남긴다', () => {
    expect(kinds('hong.gildong@example.co.kr')).toEqual([['email', 'ho●●.●●●●●●●@example.co.kr']]);
  });

  it('카드번호는 룬 검사를 통과할 때만', () => {
    expect(kinds('카드 4111-1111-1111-1111')).toEqual([['card', '4111-●●●●-●●●●-1111']]);
    expect(findPii('4111-1111-1111-1112').map((m) => m.kind)).not.toContain('card');
  });

  it('계좌번호는 은행·계좌라는 말이 앞에 있을 때만', () => {
    expect(kinds('국민은행 123456-01-234567')).toEqual([['account', '123●●●-●●-●●●●67']]);
    expect(findPii('문서번호 123456-01-234567')).toEqual([]);
    expect(findPii('2026-10-30')).toEqual([]);
  });

  it('여권·운전면허 번호', () => {
    expect(kinds('여권 M12345678')).toEqual([['passport', 'M1●●●●●●●']]);
    expect(kinds('면허 11-23-456789-01')).toEqual([['license', '11-23-●●●●●●-●●']]);
  });

  it('글자 수는 그대로, 같은 글은 한 번만', () => {
    const t = '010-1234-5678 / 010-1234-5678 / a@b.co';
    const all = findPii(t);
    for (const m of all) expect(Array.from(m.masked).length).toBe(Array.from(m.text).length);
    expect(uniquePii(all).map((m) => [m.text, m.count])).toEqual([
      ['010-1234-5678', 2],
      ['a@b.co', 1],
    ]);
    expect(maskChars('ab', 2, 0)).toBe('ab');
  });
});
