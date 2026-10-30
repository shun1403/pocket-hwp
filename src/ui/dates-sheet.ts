import type { DocumentSession } from '../app/session';
import { buildIcs, dateLabel, findDates } from '../doc/dates';
import { documentText } from '../export/exporters';
import { baseName } from '../platform/bytes';
import { shareFile } from '../platform/files';
import { h } from './dom';
import { Sheet } from './sheet';
import { toast } from './toast';

/**
 * 문서 속 날짜(제출 기한·행사일)를 모아 보여 주고, 고른 것을 캘린더 파일(.ics)로 보낸다.
 * 폰의 캘린더 앱이 파일을 받아 일정으로 넣는다(새 권한이 필요 없다).
 */
export function openDatesSheet(session: DocumentSession): void {
  const found = findDates(documentText(session.doc.raw));
  const sheet = new Sheet({ title: '일정 꺼내기' });
  if (found.length === 0) {
    sheet.body.append(h('p.dialog-message', {}, '문서에서 날짜를 찾지 못했어요.\n“2026. 11. 5.”, “11월 5일”, “11/5(수)” 같은 날짜를 찾아요.'));
    sheet.open();
    return;
  }
  const docName = baseName(session.name);
  const state = found.map((d) => ({ d, on: d.deadline || found.length <= 3 }));
  const submit = h('button.primary-btn', { type: 'button' });
  const sync = () => {
    const n = state.filter((s) => s.on).length;
    submit.textContent = n ? `${n}개 캘린더에 넣기` : '고른 일정이 없어요';
    submit.toggleAttribute('disabled', n === 0);
  };
  const rows = state.map((s) => {
    const box = h('input', { type: 'checkbox', checked: s.on, 'aria-label': `${dateLabel(s.d)} 넣기` });
    box.addEventListener('change', () => {
      s.on = box.checked;
      sync();
    });
    return h(
      'label.autofill-row',
      {},
      box,
      h(
        'span.autofill-text',
        {},
        h('span.autofill-label', {}, [s.d.deadline ? '마감' : '', s.d.guessedYear ? '연도 짐작' : ''].filter(Boolean).join(' · ') || '날짜'),
        h('span.autofill-value', {}, dateLabel(s.d)),
        h('span.autofill-label', {}, s.d.context),
      ),
    );
  });
  submit.addEventListener('click', async () => {
    const events = state
      .filter((s) => s.on)
      .map((s) => ({
        title: `${s.d.deadline ? '[마감] ' : ''}${docName}`,
        date: s.d,
        description: s.d.context,
      }));
    sheet.close();
    const ics = new TextEncoder().encode(buildIcs(events));
    const result = await shareFile(`${docName} 일정.ics`, ics, 'text/calendar');
    if (result === 'downloaded') toast('일정 파일을 내려받았어요. 열면 캘린더에 넣을 수 있어요.', 3500);
    else if (result === 'shared') toast('캘린더 앱을 골라 일정을 넣으세요.');
  });
  sheet.body.append(
    h('p.sheet-note', {}, '문서 속 날짜예요. 넣을 일정을 고르세요. 마감 일정은 하루 전에 알려 줘요.'),
    h('div.autofill-list', {}, ...rows),
    h('p.sheet-note', {}, '연도가 없는 날짜는 올해(이미 지났으면 내년)로 짐작했어요. 캘린더에 넣기 전에 확인해 주세요.'),
    h('div.dialog-actions', {}, h('button.secondary-btn', { type: 'button', onclick: () => sheet.close() }, '닫기'), submit),
  );
  sync();
  sheet.open();
}
