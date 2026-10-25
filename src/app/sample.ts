import type { EditableDocument } from '../doc/editable';
import { insertEquation } from '../doc/ops/inserts';
import { NUMBERING_PRESETS, numberingId } from '../doc/ops/lists';
import type { DocPos } from '../doc/position';

/**
 * 처음 쓰는 사람이 바로 만져 볼 수 있는 안내 문서를 엔진으로 만든다.
 * (외부 파일이 필요 없고, 저작권 걱정이 없다)
 */
export function buildSample(doc: EditableDocument): void {
  let pos: DocPos = { sec: 0, para: 0, offset: 0 };
  const line = (text: string) => {
    const start = pos;
    pos = doc.insertText(pos, text);
    return start;
  };
  const enter = () => {
    pos = doc.splitParagraph(pos);
  };
  const styleLast = (start: DocPos, props: Parameters<EditableDocument['applyCharProps']>[2]) => doc.applyCharProps(start, pos, props);

  doc.applyParaProps(pos, pos, { alignment: 'center' });
  styleLast(line('Pocket HWP 사용 안내'), { bold: true, fontSize: 2000, textColor: '#1f47c4' });
  enter();
  doc.applyParaProps(pos, pos, { alignment: 'justify' });
  styleLast(line('휴대폰에서 한글 문서를 보고 고치는 방법을 담은 샘플 문서예요. 마음껏 고쳐 보세요.'), { bold: false, fontSize: 1100, textColor: '#000000' });
  enter();
  enter();
  styleLast(line('□ 이렇게 써 보세요'), { bold: true, fontSize: 1300 });
  enter();
  const numbered = numberingId(doc, NUMBERING_PRESETS[0]);
  const steps = [
    '화면을 두 번 탭하면 본문 폭에 맞춰 글자가 크게 보여요.',
    '오른쪽 아래 [편집]을 누르면 바로 고칠 수 있어요.',
    '키보드 위 [서식]으로 글자·문단·스타일·쪽 모양을 바꿔요.',
    '[입력]으로 표·사진·수식·각주·링크를 넣어요.',
    '길게 누르면 낱말이 선택되고, 손잡이로 범위를 조절해요.',
    '[입력 → 서식 채우기]로 양식의 빈칸을 차례로 채워요.',
  ];
  steps.forEach((text, i) => {
    styleLast(line(text), { bold: false, fontSize: 1100 });
    doc.applyParaProps(pos, pos, { headType: 'Number', numberingId: numbered, paraLevel: 0 });
    if (i < steps.length - 1) enter();
  });
  enter();
  doc.applyParaProps(pos, pos, { headType: 'None' });
  enter();
  styleLast(line('□ 표도 고칠 수 있어요'), { bold: true, fontSize: 1300 });
  enter();
  const table = JSON.parse(doc.raw.createTable(pos.sec, pos.para, pos.offset, 3, 3)) as { paraIdx: number; controlIdx: number };
  const cells = ['기능', '보기', '편집', '글자·문단', '○', '○', '표·그림·수식', '○', '○'];
  cells.forEach((text, i) => {
    doc.insertText({ sec: 0, para: table.paraIdx, offset: 0, cellPath: [{ controlIndex: table.controlIdx, cellIndex: i, cellParaIndex: 0 }] }, text);
  });
  // 표 다음 문단으로 간다 (없으면 만든다).
  const last = doc.raw.getParagraphCount(0) - 1;
  pos = { sec: 0, para: Math.min(table.paraIdx + 1, last), offset: 0 };
  if (pos.para === table.paraIdx) {
    pos = { ...pos, offset: doc.raw.getParagraphLength(0, pos.para) };
    enter();
  }
  styleLast(line('□ 서식 채우기 연습'), { bold: true, fontSize: 1300 });
  enter();
  // 한글 누름틀(빨간 안내문이 보이는 빈칸). 줄을 다 만든 뒤 각 줄 끝에 넣는다
  // (누름틀 뒤에서 줄을 나누면 누름틀이 다음 줄로 넘어간다).
  const fields: [DocPos, string, string][] = [];
  for (const [label, guide, name] of [
    ['성명: ', '이름을 쓰세요', '성명'],
    ['연락처: ', '전화번호를 쓰세요', '연락처'],
  ]) {
    styleLast(line(label), { bold: false, fontSize: 1100 });
    fields.push([pos, guide, name]);
    enter();
  }
  for (const [at, guide, name] of fields) doc.raw.insertClickHereField(at.sec, at.para, at.offset, guide, '', name, true);
  enter();
  styleLast(line('□ 수식'), { bold: true, fontSize: 1300 });
  enter();
  pos = insertEquation(doc, pos, 'x = {-b +- sqrt {b ^{2} - 4ac}} over {2a}', 12);
}
