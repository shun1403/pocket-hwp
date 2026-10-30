/**
 * 가정통신문·공문에서 날짜(일정)를 찾아 캘린더 파일(.ics)로 만든다. 모두 기기 안에서 한다.
 */

export interface FoundDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 24시간제 (없으면 하루 종일) */
  hour?: number;
  minute?: number;
  /** 연도가 글에 없어 짐작했나 */
  guessedYear: boolean;
  /** '까지·마감·기한·제출' 근처인가 */
  deadline: boolean;
  /** 날짜가 든 문장 (일정 이름·설명에 쓴다) */
  context: string;
  /** 문서에 쓰인 그대로 */
  text: string;
}

const WEEK = '(?:\\s*\\(?[월화수목금토일](?:요일)?\\)?)?';
const PATTERNS: { re: RegExp; parts: (m: RegExpExecArray) => [number | null, number, number] }[] = [
  // 2026. 11. 5.(수) · 2026.11.5 · 2026-11-05 · 2026/11/5
  { re: new RegExp(`(?<!\\d)(20\\d{2})\\s*[.\\-/]\\s*(\\d{1,2})\\s*[.\\-/]\\s*(\\d{1,2})\\.?${WEEK}`, 'g'), parts: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // 2026년 11월 5일 · 11월 5일(수)
  { re: new RegExp(`(?:(?<!\\d)(\\d{4})\\s*년\\s*)?(?<!\\d)(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${WEEK}`, 'g'), parts: (m) => [m[1] ? Number(m[1]) : null, Number(m[2]), Number(m[3])] },
  // 11/5(수) — 요일이 붙을 때만 (분수·쪽 번호와 헷갈리지 않게)
  { re: /(?<![\d/])(\d{1,2})\/(\d{1,2})\s*\(\s*[월화수목금토일]\s*\)/g, parts: (m) => [null, Number(m[1]), Number(m[2])] },
];

const TIME = /^\s*(?:(오전|오후)\s*)?(\d{1,2})\s*(?:시\s*(?:(\d{1,2})\s*분|반)?|:(\d{2}))/;
const DEADLINE = /까지|마감|기한|제출|접수|신청|회신/;

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

/** 날짜 바로 뒤의 시각 (오후 3시, 15:00, 3시 30분, 2시 반) */
function timeAfter(rest: string): { hour: number; minute: number } | null {
  const m = TIME.exec(rest);
  if (!m) return null;
  let hour = Number(m[2]);
  const minute = m[3] ? Number(m[3]) : m[4] ? Number(m[4]) : /반/.test(m[0]) ? 30 : 0;
  if (m[1] === '오후' && hour < 12) hour += 12;
  if (m[1] === '오전' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** 날짜가 든 문장 (줄·마침표로 자른다, 너무 길면 줄인다) */
function sentenceAround(text: string, start: number, end: number): string {
  const from = Math.max(text.lastIndexOf('\n', start - 1), text.lastIndexOf('. ', start - 1)) + 1;
  const nl = text.indexOf('\n', end);
  const to = nl < 0 ? text.length : nl;
  const s = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/**
 * 글에서 날짜를 찾는다. 연도가 없으면 올해로 보고, 이미 지난 날이면 내년으로 본다.
 * 같은 날·같은 시각은 한 번만, 마감 날짜를 먼저 둔다.
 */
export function findDates(text: string, now = new Date()): FoundDate[] {
  const out: (FoundDate & { index: number })[] = [];
  const taken: [number, number][] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const { re, parts } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const exec = m as unknown as RegExpExecArray;
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const [y, month, day] = parts(exec);
      let year = y ?? now.getFullYear();
      if (y === null && new Date(year, month - 1, day) < today) year += 1;
      if (!validDay(year, month, day)) continue;
      taken.push([start, end]);
      const time = timeAfter(text.slice(end, end + 16));
      // 마감인지는 같은 줄 안의 앞뒤 글로 본다.
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end);
      const around = text.slice(Math.max(lineStart, start - 12), Math.min(lineEnd, end + 24));
      out.push({
        year,
        month,
        day,
        ...(time ?? {}),
        guessedYear: y === null,
        deadline: DEADLINE.test(around),
        context: sentenceAround(text, start, end),
        text: m[0].trim(),
        index: start,
      });
    }
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => Number(b.deadline) - Number(a.deadline) || a.index - b.index)
    .filter((d) => {
      const key = `${d.year}-${d.month}-${d.day}-${d.hour ?? ''}-${d.minute ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ index: _index, ...d }) => d);
}

export function dateLabel(d: Pick<FoundDate, 'year' | 'month' | 'day' | 'hour' | 'minute'>): string {
  const week = '일월화수목금토'[new Date(d.year, d.month - 1, d.day).getDay()];
  const base = `${d.year}년 ${d.month}월 ${d.day}일 (${week})`;
  if (d.hour === undefined) return base;
  const ampm = d.hour < 12 ? '오전' : '오후';
  const h12 = d.hour % 12 === 0 ? 12 : d.hour % 12;
  return `${base} ${ampm} ${h12}시${d.minute ? ` ${d.minute}분` : ''}`;
}

export interface CalendarEvent {
  title: string;
  date: Pick<FoundDate, 'year' | 'month' | 'day' | 'hour' | 'minute'>;
  description?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** iCalendar 글자 이스케이프 */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** 75바이트가 넘는 줄은 접는다 (RFC 5545) */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  for (const ch of Array.from(line)) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * 일정들을 .ics 파일로. 시각이 없으면 하루 종일, 있으면 1시간짜리(기기 시간대 기준).
 * 마감 일정은 하루 전 알림을 넣는다.
 */
export function buildIcs(events: CalendarEvent[], now = new Date(), uid: () => string = () => crypto.randomUUID()): string {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pocket HWP//KO', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    const { year, month, day, hour, minute } = e.date;
    const ymd = `${year}${pad(month)}${pad(day)}`;
    lines.push('BEGIN:VEVENT', `UID:${uid()}@pocket-hwp`, `DTSTAMP:${stamp}`);
    if (hour === undefined) {
      const next = new Date(year, month - 1, day + 1);
      lines.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`);
    } else {
      const endH = new Date(year, month - 1, day, hour + 1, minute ?? 0);
      lines.push(
        `DTSTART:${ymd}T${pad(hour)}${pad(minute ?? 0)}00`,
        `DTEND:${endH.getFullYear()}${pad(endH.getMonth() + 1)}${pad(endH.getDate())}T${pad(endH.getHours())}${pad(endH.getMinutes())}00`,
      );
    }
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
