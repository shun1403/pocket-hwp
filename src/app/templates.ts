import type { CharProps, EditableDocument } from '../doc/editable';
import { cellContext, setCellFill } from '../doc/ops/table';
import type { DocPos } from '../doc/position';

/**
 * 자주 쓰는 양식. 앱이 엔진으로 직접 만들어서 외부 파일·저작권 걱정이 없다.
 * 빈칸은 표의 빈 칸과 `20  년  월  일`·`(서명)`으로 두어 서식 채우기·내 정보로 채우기가 바로 찾는다.
 */
type Block =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; align?: 'center' | 'right' | 'left'; bold?: boolean }
  | { kind: 'blank' }
  /** 이름표·빈칸 표 (pairs = 한 줄에 몇 쌍) */
  | { kind: 'fields'; labels: string[]; pairs?: 1 | 2 }
  /** 머리 줄 + 빈 줄 표 */
  | { kind: 'grid'; headers: string[]; rows: number }
  /** 이름표 + 큰 빈칸 */
  | { kind: 'box'; label: string; heightMm?: number }
  /** 날짜와 서명 자리 */
  | { kind: 'sign'; who: string };

export interface Template {
  id: string;
  name: string;
  sub: string;
  /** 법률 문서처럼 자문이 아니라고 알릴 양식 */
  legal?: boolean;
  blocks: Block[];
}

const sign = (who: string): Block => ({ kind: 'sign', who });

export const TEMPLATES: Template[] = [
  {
    id: 'resume',
    name: '이력서',
    sub: '인적 사항 · 학력 · 경력 · 자격증',
    blocks: [
      { kind: 'title', text: '이 력 서' },
      { kind: 'fields', labels: ['성명', '생년월일', '연락처', '이메일'], pairs: 2 },
      { kind: 'fields', labels: ['주소'] },
      { kind: 'heading', text: '학력' },
      { kind: 'grid', headers: ['기간', '학교명', '전공'], rows: 3 },
      { kind: 'heading', text: '경력' },
      { kind: 'grid', headers: ['기간', '회사명', '담당 업무'], rows: 3 },
      { kind: 'heading', text: '자격증·어학' },
      { kind: 'grid', headers: ['취득일', '자격증명', '발급 기관'], rows: 3 },
      { kind: 'blank' },
      { kind: 'text', text: '위 기재 사항은 사실과 다름없음을 확인합니다.', align: 'center' },
      sign('작성자'),
    ],
  },
  {
    id: 'intro',
    name: '자기소개서',
    sub: '성장 과정 · 장단점 · 지원 동기 · 포부',
    blocks: [
      { kind: 'title', text: '자 기 소 개 서' },
      { kind: 'fields', labels: ['성명', '지원 분야'], pairs: 2 },
      { kind: 'box', label: '성장 과정' },
      { kind: 'box', label: '성격의 장단점' },
      { kind: 'box', label: '지원 동기' },
      { kind: 'box', label: '입사 후 포부' },
    ],
  },
  {
    id: 'proxy',
    name: '위임장',
    sub: '다른 사람에게 일을 맡길 때',
    legal: true,
    blocks: [
      { kind: 'title', text: '위 임 장' },
      { kind: 'heading', text: '위임하는 사람 (위임인)' },
      { kind: 'fields', labels: ['성명', '생년월일', '연락처', '이메일'], pairs: 2 },
      { kind: 'fields', labels: ['주소'] },
      { kind: 'heading', text: '위임받는 사람 (수임인)' },
      { kind: 'fields', labels: ['성명', '생년월일', '연락처', '관계'], pairs: 2 },
      { kind: 'fields', labels: ['주소'] },
      { kind: 'box', label: '위임하는 내용', heightMm: 30 },
      { kind: 'blank' },
      { kind: 'text', text: '위 사람에게 위 사항에 대한 권한을 위임합니다.', align: 'center' },
      sign('위임인'),
    ],
  },
  {
    id: 'resign',
    name: '사직서',
    sub: '회사를 그만둘 때',
    blocks: [
      { kind: 'title', text: '사 직 서' },
      { kind: 'fields', labels: ['소속', '직위', '성명', '입사일'], pairs: 2 },
      { kind: 'fields', labels: ['퇴사 예정일', '사직 사유'] },
      { kind: 'blank' },
      { kind: 'text', text: '위와 같은 사유로 사직하고자 하오니 허락하여 주시기 바랍니다.', align: 'center' },
      sign('신청인'),
      { kind: 'blank' },
      { kind: 'text', text: '(회사 이름) 대표 귀하', align: 'left', bold: true },
    ],
  },
  {
    id: 'loan',
    name: '차용증',
    sub: '돈을 빌리고 빌려줄 때',
    legal: true,
    blocks: [
      { kind: 'title', text: '차 용 증' },
      { kind: 'fields', labels: ['빌린 금액 (원)', '이자 (연 %)', '갚을 날짜', '갚는 방법'] },
      { kind: 'blank' },
      { kind: 'text', text: '위 금액을 틀림없이 빌렸으며 위 조건대로 갚을 것을 약속합니다.', align: 'center' },
      { kind: 'heading', text: '빌려준 사람 (채권자)' },
      { kind: 'fields', labels: ['성명', '연락처'], pairs: 2 },
      { kind: 'fields', labels: ['주소'] },
      { kind: 'heading', text: '빌린 사람 (채무자)' },
      { kind: 'fields', labels: ['성명', '연락처'], pairs: 2 },
      { kind: 'fields', labels: ['주소'] },
      sign('채무자'),
    ],
  },
  {
    id: 'receipt',
    name: '영수증',
    sub: '돈을 받았다는 확인',
    blocks: [
      { kind: 'title', text: '영 수 증' },
      { kind: 'fields', labels: ['금액 (원)', '내용', '받은 날짜'] },
      { kind: 'blank' },
      { kind: 'text', text: '위 금액을 정히 영수합니다.', align: 'center' },
      sign('받은 사람'),
    ],
  },
  {
    id: 'certified',
    name: '내용증명',
    sub: '보낸 내용을 우체국이 증명하는 편지',
    legal: true,
    blocks: [
      { kind: 'title', text: '내 용 증 명' },
      { kind: 'heading', text: '보내는 사람' },
      { kind: 'fields', labels: ['성명', '연락처'], pairs: 2 },
      { kind: 'fields', labels: ['주소'] },
      { kind: 'heading', text: '받는 사람' },
      { kind: 'fields', labels: ['성명', '연락처'], pairs: 2 },
      { kind: 'fields', labels: ['주소', '제목'] },
      { kind: 'box', label: '내용', heightMm: 90 },
      sign('보내는 사람'),
    ],
  },
  {
    id: 'minutes',
    name: '회의록',
    sub: '일시 · 참석자 · 논의 · 결정 · 할 일',
    blocks: [
      { kind: 'title', text: '회 의 록' },
      { kind: 'fields', labels: ['일시', '장소', '작성자', '참석자'], pairs: 2 },
      { kind: 'fields', labels: ['안건'] },
      { kind: 'box', label: '논의 내용', heightMm: 50 },
      { kind: 'box', label: '결정 사항', heightMm: 30 },
      { kind: 'heading', text: '할 일' },
      { kind: 'grid', headers: ['할 일', '담당', '기한'], rows: 3 },
    ],
  },
];

/** 1mm = 283.46 HWPUNIT */
const MM = 283.46;
const LABEL_FILL = '#f2f2f2';

/** 양식을 빈 문서에 쓴다. */
export function buildTemplate(doc: EditableDocument, t: Template): void {
  let pos: DocPos = { sec: 0, para: 0, offset: 0 };
  const write = (text: string, props: CharProps = {}, align: 'center' | 'right' | 'left' | 'justify' = 'left') => {
    doc.applyParaProps(pos, pos, { alignment: align });
    const start = pos;
    pos = doc.insertText(pos, text);
    doc.applyCharProps(start, pos, { bold: false, fontSize: 1100, ...props });
  };
  const enter = () => {
    pos = doc.splitParagraph(pos);
  };
  const cell = (para: number, ctrl: number, i: number): DocPos => ({ sec: 0, para, offset: 0, cellPath: [{ controlIndex: ctrl, cellIndex: i, cellParaIndex: 0 }] });

  /** 표를 넣고, 이름표 칸에 글·바탕색을 넣고, 칸 너비를 맞춘 뒤 표 다음 문단으로 간다. */
  const table = (
    rows: number,
    cols: number,
    texts: (string | null)[],
    shadeLabels: (i: number) => boolean,
    widths?: number[],
    heights?: { cell: number; mm: number }[],
  ) => {
    const t = JSON.parse(doc.raw.createTable(pos.sec, pos.para, pos.offset, rows, cols)) as { paraIdx: number; controlIdx: number };
    texts.forEach((text, i) => {
      if (text) doc.insertText(cell(t.paraIdx, t.controlIdx, i), text);
      if (shadeLabels(i)) {
        const ctx = cellContext(doc, cell(t.paraIdx, t.controlIdx, i));
        if (ctx) setCellFill(doc, ctx, LABEL_FILL);
      }
    });
    const edits: Record<string, number>[] = [];
    if (widths) {
      // 같은 너비로 만들어진 칸을 비율(합 1)대로 바꾼다. 칸마다 따로 바뀌므로 모든 줄의 칸을 바꾼다.
      const total = tableWidth(doc, t.paraIdx, t.controlIdx);
      if (total > 0) {
        for (let r = 0; r < rows; r += 1) widths.forEach((w, c) => edits.push({ cellIdx: r * cols + c, widthDelta: Math.round(total * (w - 1 / cols)) }));
      }
    }
    for (const hgt of heights ?? []) edits.push({ cellIdx: hgt.cell, heightDelta: Math.round(hgt.mm * MM) });
    // 같은 칸에 대한 바꿈은 하나로 합친다 (엔진은 칸마다 하나만 받는다).
    const merged = new Map<number, Record<string, number>>();
    for (const e of edits) merged.set(e.cellIdx, { ...merged.get(e.cellIdx), ...e });
    if (merged.size) doc.raw.resizeTableCells(0, t.paraIdx, t.controlIdx, JSON.stringify([...merged.values()]));
    // 표 다음 문단으로 간다 (없으면 만든다).
    const last = doc.raw.getParagraphCount(0) - 1;
    pos = { sec: 0, para: Math.min(t.paraIdx + 1, last), offset: 0 };
    if (pos.para === t.paraIdx) {
      pos = { ...pos, offset: doc.raw.getParagraphLength(0, pos.para) };
      enter();
    }
  };

  /** 손으로 써도 넉넉하도록 줄마다 높이를 더한다 (엔진은 줄이 하나뿐인 표의 높이 바꾸기는 받지 않는다) */
  const rowHeights = (rows: number, cols: number, mm = 3) => Array.from({ length: rows }, (_, r) => ({ cell: r * cols, mm }));
  let prev: Block['kind'] | null = null;
  for (const b of t.blocks) {
    // 표 바로 뒤의 소제목은 한 줄 띄운다.
    if (b.kind === 'heading' && prev && prev !== 'title' && prev !== 'blank' && prev !== 'text') enter();
    prev = b.kind;
    if (b.kind === 'title') {
      write(b.text, { bold: true, fontSize: 2000 }, 'center');
      enter();
      enter();
    } else if (b.kind === 'heading') {
      write(`□ ${b.text}`, { bold: true, fontSize: 1200 });
      enter();
    } else if (b.kind === 'text') {
      write(b.text, { bold: !!b.bold }, b.align ?? 'left');
      enter();
    } else if (b.kind === 'blank') {
      enter();
    } else if (b.kind === 'fields') {
      const pairs = b.pairs ?? 1;
      const rows = Math.ceil(b.labels.length / pairs);
      const texts: (string | null)[] = [];
      for (let r = 0; r < rows; r += 1) {
        for (let p = 0; p < pairs; p += 1) texts.push(b.labels[r * pairs + p] ?? null, null);
      }
      const widths = pairs === 2 ? [0.17, 0.33, 0.17, 0.33] : [0.2, 0.8];
      table(rows, pairs * 2, texts, (i) => i % 2 === 0, widths, rowHeights(rows, pairs * 2));
    } else if (b.kind === 'grid') {
      const texts = [...b.headers, ...Array<string | null>(b.headers.length * b.rows).fill(null)];
      table(b.rows + 1, b.headers.length, texts, (i) => i < b.headers.length, undefined, rowHeights(b.rows + 1, b.headers.length).slice(1));
    } else if (b.kind === 'box') {
      table(2, 1, [b.label, null], (i) => i === 0, undefined, [{ cell: 1, mm: b.heightMm ?? 40 }]);
    } else if (b.kind === 'sign') {
      enter();
      write('20  년    월    일', {}, 'right');
      enter();
      enter();
      write(`${b.who}                    (서명)`, {}, 'right');
      enter();
    }
  }
  finishTemplate(doc);
}

/** 표 전체 너비 (HWPUNIT) */
/** 표 칸 크기를 바꾼 뒤 줄 위치를 다시 계산해 둔다 (저장된 줄 위치가 낡아 표와 글이 겹치지 않게). */
export function finishTemplate(doc: EditableDocument): void {
  try {
    doc.raw.reflowLinesegs();
  } catch {
    // 다시 계산하지 못해도 문서는 쓸 수 있다.
  }
}

function tableWidth(doc: EditableDocument, para: number, ctrl: number): number {
  for (let page = 0; page < doc.pageCount(); page += 1) {
    try {
      const controls = (JSON.parse(doc.raw.getPageControlLayout(page)) as { controls: { type: string; paraIdx: number; controlIdx: number; w: number }[] }).controls;
      const t = controls.find((c) => c.type === 'table' && c.paraIdx === para && c.controlIdx === ctrl);
      if (t) return t.w * 75;
    } catch {
      // 다음 쪽을 본다.
    }
  }
  return 0;
}
