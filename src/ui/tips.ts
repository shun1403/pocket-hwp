import { readPref, writePref } from '../platform/prefs';
import { h } from './dom';
import { type IconName, icon } from './icons';
import { Sheet } from './sheet';

const SEEN_KEY = 'tips:edit-seen';

const TIPS: [IconName, string, string][] = [
  ['edit', '눌러서 쓰기', '글자를 누르면 그 자리에 캐럿이 와요. 캐럿 아래 동그라미를 끌면 자리를 옮길 수 있어요.'],
  ['text', '길게 눌러 고르기', '낱말을 길게 누르면 골라져요. 양쪽 손잡이를 끌어 범위를 넓히고, 위에 뜨는 메뉴로 복사·서식을 바꿔요.'],
  ['format', '도구는 키보드 자리에', '아래 줄의 서식·입력·기호를 누르면 키보드 자리에 도구가 열려요. 오른쪽 키보드 버튼으로 다시 글을 써요.'],
  ['form', '양식은 서식 채우기로', '신청서처럼 빈칸이 많은 문서는 입력 → 서식 채우기로 빈칸을 차례로 채울 수 있어요.'],
  ['clock', '잘못 고쳤다면', '실행 취소(↶)로 되돌리고, 문서를 닫은 뒤라면 더보기 → 버전 기록에서 예전 내용으로 돌아가요.'],
];

/** 사용법 안내 시트 */
export function openTips(): void {
  const sheet = new Sheet({ title: '이렇게 써 보세요' });
  sheet.body.append(
    h(
      'ul.tips',
      {},
      ...TIPS.map(([name, title, text]) => h('li.tip', {}, icon(name, 24), h('div', {}, h('strong', {}, title), h('p', {}, text)))),
    ),
    h('button.primary-btn', { type: 'button', onclick: () => sheet.close() }, '알겠어요'),
  );
  sheet.open();
}

/** 처음 편집할 때 한 번만 사용법을 보여 준다. 보여 줬으면 true */
export function maybeShowEditTips(): boolean {
  if (readPref<boolean>(SEEN_KEY, false)) return false;
  writePref(SEEN_KEY, true);
  openTips();
  return true;
}
