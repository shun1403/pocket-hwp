import { buildZip, readZip, type ZipEntry } from '../../export/zip';
import type { HwpDocument } from '../../engine/rhwp';
import type { EditableDocument } from '../editable';
import { type DocPos, cellPathJson, inCell } from '../position';
import { type RawField, fieldPos } from './fields';

/**
 * 한글 메모(문서 옆에 다는 말풍선 메모).
 *
 * 엔진(rhwp)은 HWPX 메모를 읽고 HWPX로 다시 저장할 때 그대로 지키지만, 메모 내용을 꺼내거나
 * 새로 만드는 API는 없다. 그래서 문서를 HWPX로 내보내 메모 부분을 한글과 같은 모양으로 고친 뒤
 * 그 HWPX를 다시 연다. HWP(5.0)로 저장하면 엔진이 메모를 지키지 못하므로 메모가 있는 문서는
 * HWPX로 저장한다 (session.ts).
 *
 * HWP 파일에서 연 메모는 엔진이 내용을 읽지 않아 목록에만 보이고 고칠 수 없다.
 */
export interface Memo {
  /** 메모 필드 번호 (HWPX fieldBegin id) */
  id: number;
  start: DocPos | null;
  end: DocPos | null;
  /** 메모를 단 본문 글 */
  anchor: string;
  /** 메모 내용. 읽지 못하면 null (HWP 파일의 메모) */
  text: string | null;
  author: string;
  /** 만든 때 (ISO 문자열) */
  created: string | null;
  /** 이 앱에서 고치거나 지울 수 있다 */
  editable: boolean;
}

export class MemoError extends Error {}

/** 한글이 HWPX에 쓰는 메모 필드 표식 */
const MEMO_FIELD_ID = '623209829';
const MEMO_PR =
  '<hh:memoProperties itemCnt="1"><hh:memoPr id="1" width="15591" lineWidth="3" lineType="SOLID" lineColor="#A9A9A9" fillColor="#CBFF99" activeColor="#FDBCDD" memoType="NOMAL"/></hh:memoProperties>';

function rawFieldList(raw: HwpDocument): RawField[] {
  try {
    return JSON.parse(raw.getFieldList()) as RawField[];
  } catch {
    return [];
  }
}

function isMemoField(f: RawField): boolean {
  return f.fieldType === 'memo' || (f.command ?? '').startsWith('MEMO/');
}

/** 문서에 HWPX 메모가 있나 (HWP로 저장하면 사라진다) */
export function hasMemos(raw: HwpDocument): boolean {
  return rawFieldList(raw).some((f) => f.fieldType === 'memo');
}

/** 메모 개수 (내용은 읽지 않는다) */
export function memoCount(doc: EditableDocument): number {
  return rawFieldList(doc.raw).filter(isMemoField).length;
}

/** 메모를 단 자리들 (쪽 위에 표시할 때 쓴다) */
export function memoRanges(doc: EditableDocument): { id: number; start: DocPos; end: DocPos }[] {
  const out: { id: number; start: DocPos; end: DocPos }[] = [];
  for (const f of rawFieldList(doc.raw)) {
    if (!isMemoField(f)) continue;
    const start = fieldPos(f, f.startCharIdx);
    const end = fieldPos(f, f.endCharIdx);
    if (start && end) out.push({ id: f.fieldId, start, end });
  }
  return out;
}

// ───────────── HWPX 글 다루기 ─────────────

const SECTION = /^Contents\/section\d+\.xml$/;
const HEADER = 'Contents/header.xml';

interface Package {
  entries: ZipEntry[];
  text: Map<string, string>;
}

async function unpack(bytes: Uint8Array): Promise<Package> {
  const entries = await readZip(bytes);
  const dec = new TextDecoder();
  const text = new Map<string, string>();
  for (const e of entries) if (SECTION.test(e.name) || e.name === HEADER) text.set(e.name, dec.decode(e.bytes));
  return { entries, text };
}

function pack(pkg: Package): Uint8Array {
  const enc = new TextEncoder();
  // mimetype 이 맨 앞에 와야 HWPX(OCF)로 알아본다.
  const entries = [...pkg.entries].sort((a, b) => Number(b.name === 'mimetype') - Number(a.name === 'mimetype'));
  return buildZip(entries.map((e) => (pkg.text.has(e.name) ? { name: e.name, bytes: enc.encode(pkg.text.get(e.name)!) } : e)));
}

/** HWPX로 내보낸다. 잃는 내용이 있으면 lossy 가 참이다. */
function exportHwpx(raw: HwpDocument): { bytes: Uint8Array; lossy: boolean } {
  const result = raw.exportHwpxWithReport();
  try {
    const report = JSON.parse(result.contentLoss()) as { count?: number; losses?: unknown[] };
    return { lossy: (report.count ?? report.losses?.length ?? 0) > 0, bytes: result.takeBytes() };
  } finally {
    result.free();
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** start 에서 시작하는 <tag ...> 요소가 끝나는 자리 (같은 이름이 안에 겹쳐 있어도 짝을 맞춘다) */
export function elementEnd(xml: string, start: number, tag: string): number {
  const open = new RegExp(`<${tag}[\\s/>]|</${tag}>`, 'g');
  let depth = 0;
  open.lastIndex = start;
  for (let m = open.exec(xml); m; m = open.exec(xml)) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
      continue;
    }
    const close = xml.indexOf('>', m.index);
    if (xml[close - 1] === '/') {
      if (depth === 0) return close + 1;
      continue;
    }
    depth += 1;
  }
  return -1;
}

interface Found {
  /** <hp:ctrl> 시작과 끝 */
  start: number;
  end: number;
  /** fieldBegin 요소 */
  begin: string;
}

/** id 로 fieldBegin 을 감싼 <hp:ctrl> 을 찾는다. */
function findBeginCtrl(xml: string, attr: string): Found | null {
  const at = xml.indexOf(`<hp:fieldBegin ${attr}`);
  if (at < 0) return null;
  const start = xml.lastIndexOf('<hp:ctrl>', at);
  const beginEnd = elementEnd(xml, at, 'hp:fieldBegin');
  if (start < 0 || beginEnd < 0 || !xml.startsWith('</hp:ctrl>', beginEnd)) return null;
  return { start, end: beginEnd + '</hp:ctrl>'.length, begin: xml.slice(at, beginEnd) };
}

function findEndCtrl(xml: string, id: string): { start: number; end: number } | null {
  const m = new RegExp(`<hp:ctrl><hp:fieldEnd beginIDRef="${id}"[^>]*/></hp:ctrl>`).exec(xml);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

function splice(xml: string, start: number, end: number, insert: string): string {
  return xml.slice(0, start) + insert + xml.slice(end);
}

function param(begin: string, name: string): string | null {
  const m = new RegExp(`<hp:(?:string|integer)Param name="${name}">([^<]*)</hp:(?:string|integer)Param>`).exec(begin);
  return m ? unescapeXml(m[1]) : null;
}

function paragraphsText(subList: string): string {
  const lines: string[] = [];
  const p = /<hp:p[\s>][\s\S]*?<\/hp:p>/g;
  for (let m = p.exec(subList); m; m = p.exec(subList)) {
    let line = '';
    const t = /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g;
    for (let n = t.exec(m[0]); n; n = t.exec(m[0])) {
      line += unescapeXml(n[1].replace(/<hp:tab[^>]*\/>/g, '\t').replace(/<hp:lineBreak[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''));
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function subListOf(begin: string): { start: number; end: number } | null {
  const start = begin.indexOf('<hp:subList');
  if (start < 0) return null;
  const end = elementEnd(begin, start, 'hp:subList');
  return end < 0 ? null : { start, end };
}

function memoParagraphs(text: string): string {
  return text
    .split('\n')
    .map(
      (line) =>
        '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' +
        (line ? `<hp:run charPrIDRef="0"><hp:t>${escapeXml(line)}</hp:t></hp:run>` : '<hp:run charPrIDRef="0"/>') +
        '</hp:p>',
    )
    .join('');
}

const SUBLIST_OPEN =
  '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">';

/** 메모 작성자 이름: 한글 메모 명령의 구분 글자(/ \ ;)와 줄바꿈을 빼고, 비면 '사용자' */
export function memoAuthor(name: string): string {
  return name.replace(/[/\\;\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || '사용자';
}

/** 한글이 쓰는 모양 그대로의 메모 fieldBegin */
function memoBegin(id: number, number: number, text: string, author: string, now: Date): string {
  // Command 의 두 수는 만든 때의 FILETIME(100ns, 1601년부터) 아래·위 32비트다.
  const filetime = BigInt(now.getTime() + 11644473600000) * 10000n;
  const low = Number(filetime & 0xffffffffn);
  const high = Number(filetime >> 32n);
  // Command 는 '/' 와 ';' 로 칸을 나누므로 이름에서 그 글자를 뺀다 (한글이 메모 정보를 잘못 읽지 않게).
  const who = escapeXml(memoAuthor(author));
  const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return (
    `<hp:fieldBegin id="${id}" type="MEMO" name="" editable="1" dirty="1" zorder="${number}" fieldid="${MEMO_FIELD_ID}">` +
    '<hp:parameters cnt="7" name="">' +
    '<hp:integerParam name="Prop">0</hp:integerParam>' +
    `<hp:stringParam name="Command">MEMO/65535/${number}/${low}/${high}/${who}/\\;;</hp:stringParam>` +
    `<hp:stringParam name="ID">memo${number}</hp:stringParam>` +
    `<hp:integerParam name="Number">${number}</hp:integerParam>` +
    `<hp:stringParam name="Author">${who}</hp:stringParam>` +
    '<hp:stringParam name="MemoShapeIDRef">65535</hp:stringParam>' +
    `<hp:stringParam name="CreateDateTime">${created}</hp:stringParam>` +
    '</hp:parameters>' +
    `${SUBLIST_OPEN}${memoParagraphs(text)}</hp:subList></hp:fieldBegin>`
  );
}

function memoEnd(id: number): string {
  return `<hp:ctrl><hp:fieldEnd beginIDRef="${id}" fieldid="${MEMO_FIELD_ID}"/></hp:ctrl>`;
}

// ───────────── 읽기 ─────────────

interface MemoBody {
  text: string;
  author: string;
  created: string | null;
}

function memoBodies(pkg: Package): Map<number, MemoBody> {
  const out = new Map<number, MemoBody>();
  for (const [name, xml] of pkg.text) {
    if (!SECTION.test(name)) continue;
    const re = /<hp:fieldBegin id="(\d+)" type="MEMO"/g;
    for (let m = re.exec(xml); m; m = re.exec(xml)) {
      const end = elementEnd(xml, m.index, 'hp:fieldBegin');
      if (end < 0) continue;
      const begin = xml.slice(m.index, end);
      const sub = subListOf(begin);
      out.set(Number(m[1]), {
        text: sub ? paragraphsText(begin.slice(sub.start, sub.end)) : '',
        author: param(begin, 'Author') ?? '',
        created: param(begin, 'CreateDateTime'),
      });
    }
  }
  return out;
}

/** 문서의 메모를 내용과 함께 읽는다 (문서를 HWPX로 내보내 읽으므로 조금 걸린다). */
export async function readMemos(doc: EditableDocument): Promise<Memo[]> {
  const fields = rawFieldList(doc.raw).filter(isMemoField);
  if (!fields.length) return [];
  let bodies = new Map<number, MemoBody>();
  if (fields.some((f) => f.fieldType === 'memo')) {
    try {
      bodies = memoBodies(await unpack(exportHwpx(doc.raw).bytes));
    } catch {
      // 내용을 못 읽어도 메모 자리는 보여 준다.
    }
  }
  return fields.map((f) => {
    const body = f.fieldType === 'memo' ? bodies.get(f.fieldId) : undefined;
    return {
      id: f.fieldId,
      start: fieldPos(f, f.startCharIdx),
      end: fieldPos(f, f.endCharIdx),
      anchor: f.value ?? '',
      text: body ? body.text : null,
      author: body?.author ?? '',
      created: body?.created ?? null,
      editable: !!body,
    };
  });
}

// ───────────── 쓰기 ─────────────

/** HWPX로 바꿀 때 잃는 내용이 있으면 메모를 쓰지 않는다 (문서가 몰래 바뀌지 않게). */
function convertible(raw: HwpDocument): Uint8Array {
  const { bytes, lossy } = exportHwpx(raw);
  if (lossy) throw new MemoError('이 문서는 메모를 넣으면 다른 내용 일부가 바뀔 수 있어서 메모를 쓰지 않았어요.');
  return bytes;
}

function unusedId(pkg: Package): number {
  const all = [...pkg.text.values()].join('');
  for (;;) {
    const id = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    if (!all.includes(`id="${id}"`) && !all.includes(`beginIDRef="${id}"`)) return id;
  }
}

function ensureMemoProperties(pkg: Package): void {
  const header = pkg.text.get(HEADER);
  if (!header || header.includes('<hh:memoProperties')) return;
  if (!header.includes('</hh:refList>')) throw new MemoError('문서 머리 정보를 읽지 못했어요.');
  pkg.text.set(HEADER, header.replace('</hh:refList>', `${MEMO_PR}</hh:refList>`));
}

function countMemos(pkg: Package): number {
  let n = 0;
  for (const [name, xml] of pkg.text) if (SECTION.test(name)) n += xml.split('type="MEMO"').length - 1;
  return n;
}

function insertMarker(raw: HwpDocument, pos: DocPos, name: string): void {
  const r = JSON.parse(
    inCell(pos)
      ? raw.insertClickHereFieldByPath(pos.sec, pos.para, cellPathJson(pos), pos.offset, '', '', name, true)
      : raw.insertClickHereField(pos.sec, pos.para, pos.offset, '', '', name, true),
  ) as { ok: boolean };
  if (!r.ok) throw new MemoError('이 자리에는 메모를 달 수 없어요.');
}

/**
 * start~end 글에 메모를 단다 (같은 문단 안). 새 문서(HWPX 바이트)를 돌려준다.
 * 지금 문서는 바꾸지 않는다.
 */
export async function addMemo(doc: EditableDocument, start: DocPos, end: DocPos, text: string, author: string, now = new Date()): Promise<Uint8Array> {
  const raw = doc.raw;
  convertible(raw);
  const tag = `__pocket_memo_${Date.now()}`;
  const empty = start.offset === end.offset;
  // 엔진 누름틀을 자리표로 끼워 HWPX 안에서 그 자리를 찾는다. 뒤쪽부터 끼워야 앞 자리가 밀리지 않는다.
  const snapshot = raw.saveSnapshot();
  let bytes: Uint8Array;
  try {
    if (!empty) insertMarker(raw, end, `${tag}_b`);
    insertMarker(raw, start, `${tag}_a`);
    bytes = exportHwpx(raw).bytes;
  } finally {
    raw.restoreSnapshot(snapshot);
    raw.discardSnapshot(snapshot);
  }
  const pkg = await unpack(bytes);
  const id = unusedId(pkg);
  const number = countMemos(pkg) + 1;
  let done = false;
  for (const [name, xml0] of pkg.text) {
    if (!SECTION.test(name) || !xml0.includes(`name="${tag}_a"`)) continue;
    let xml = xml0;
    const a = findMarker(xml, `${tag}_a`);
    if (!a) break;
    if (empty) {
      // 자리표 하나: 시작 → 메모 시작, 끝 → 메모 끝
      const aEnd = findEndCtrl(xml, a.id);
      if (!aEnd) break;
      xml = splice(xml, aEnd.start, aEnd.end, memoEnd(id));
      xml = splice(xml, a.start, a.end, `<hp:ctrl>${memoBegin(id, number, text, author, now)}</hp:ctrl>`);
    } else {
      // 뒤에서부터 고친다: 끝 자리표의 끝 → 메모 끝, 끝 자리표의 시작 지움, 시작 자리표의 끝 지움, 시작 자리표 → 메모 시작
      const b = findMarker(xml, `${tag}_b`);
      if (!b) break;
      const bEnd = findEndCtrl(xml, b.id);
      const aEnd = findEndCtrl(xml, a.id);
      if (!bEnd || !aEnd) break;
      const edits = [
        { ...bEnd, insert: memoEnd(id) },
        { start: b.start, end: b.end, insert: '' },
        { ...aEnd, insert: '' },
        { start: a.start, end: a.end, insert: `<hp:ctrl>${memoBegin(id, number, text, author, now)}</hp:ctrl>` },
      ].sort((x, y) => y.start - x.start);
      for (const e of edits) xml = splice(xml, e.start, e.end, e.insert);
    }
    pkg.text.set(name, xml);
    done = true;
    break;
  }
  if (!done) throw new MemoError('메모를 달 자리를 찾지 못했어요.');
  ensureMemoProperties(pkg);
  return pack(pkg);
}

function findMarker(xml: string, name: string): (Found & { id: string }) | null {
  const at = xml.indexOf(`name="${name}"`);
  if (at < 0) return null;
  const beginAt = xml.lastIndexOf('<hp:fieldBegin ', at);
  const id = /^<hp:fieldBegin id="(\d+)"/.exec(xml.slice(beginAt))?.[1];
  if (!id) return null;
  const found = findBeginCtrl(xml, `id="${id}"`);
  return found ? { ...found, id } : null;
}

async function rewriteMemo(doc: EditableDocument, id: number, fn: (xml: string, found: Found) => string): Promise<Uint8Array> {
  const pkg = await unpack(convertible(doc.raw));
  for (const [name, xml] of pkg.text) {
    if (!SECTION.test(name)) continue;
    const found = findBeginCtrl(xml, `id="${id}" type="MEMO"`);
    if (!found) continue;
    pkg.text.set(name, fn(xml, found));
    return pack(pkg);
  }
  throw new MemoError('메모를 찾지 못했어요.');
}

/** 메모 내용을 바꾼다. 새 문서(HWPX 바이트)를 돌려준다. */
export function editMemo(doc: EditableDocument, id: number, text: string): Promise<Uint8Array> {
  return rewriteMemo(doc, id, (xml, found) => {
    const sub = subListOf(found.begin);
    const beginAt = xml.indexOf('<hp:fieldBegin', found.start);
    if (!sub) {
      // 내용 칸이 없으면 fieldBegin 끝에 붙인다.
      const close = found.begin.endsWith('/>') ? found.begin.length - 2 : found.begin.lastIndexOf('</hp:fieldBegin>');
      const begin = found.begin.endsWith('/>')
        ? `${found.begin.slice(0, close)}>${SUBLIST_OPEN}${memoParagraphs(text)}</hp:subList></hp:fieldBegin>`
        : `${found.begin.slice(0, close)}${SUBLIST_OPEN}${memoParagraphs(text)}</hp:subList></hp:fieldBegin>`;
      return splice(xml, beginAt, beginAt + found.begin.length, begin);
    }
    const open = found.begin.slice(sub.start, found.begin.indexOf('>', sub.start) + 1);
    const selfClosing = open.endsWith('/>');
    const subXml = `${selfClosing ? `${open.slice(0, -2)}>` : open}${memoParagraphs(text)}</hp:subList>`;
    return splice(xml, beginAt + sub.start, beginAt + sub.end, subXml);
  });
}

/** 메모를 지운다 (메모를 단 본문 글은 남긴다). 새 문서(HWPX 바이트)를 돌려준다. */
export function deleteMemo(doc: EditableDocument, id: number): Promise<Uint8Array> {
  return rewriteMemo(doc, id, (xml, found) => {
    const end = findEndCtrl(xml, String(id));
    let out = xml;
    if (end && end.start > found.start) out = splice(out, end.start, end.end, '');
    out = splice(out, found.start, found.end, '');
    if (end && end.start < found.start) out = splice(out, end.start, end.end, '');
    return out;
  });
}
