import type { DocumentSession } from '../app/session';
import { hasMemos } from '../doc/ops/memos';
import { PII_NAMES, findPii, uniquePii } from '../doc/ops/redact';
import { HwpDocument } from '../engine/rhwp';
import { documentText, exportDocument } from '../export/exporters';
import { readPref, writePref } from '../platform/prefs';
import { askConfirm } from './dialog';
import { h } from './dom';
import { Sheet } from './sheet';

const PREF = 'redactBeforeSend';

export const redactPref = {
  get: (): boolean => readPref(PREF, false),
  set: (on: boolean): void => writePref(PREF, on),
};

/** 보낼 문서: 원본 그대로이거나, 개인정보를 가린 사본 (보낸 뒤 free 로 풀어 준다) */
export interface SendSource {
  raw: HwpDocument;
  redacted: boolean;
  free(): void;
}

/** 보내기 시트 맨 위의 '보내기 전에 개인정보 가리기' 스위치 */
export function redactSwitch(): HTMLElement {
  const box = h('input', { type: 'checkbox', role: 'switch', checked: redactPref.get(), 'aria-label': '보내기 전에 개인정보 가리기' });
  box.addEventListener('change', () => redactPref.set(box.checked));
  return h(
    'label.switch-row',
    {},
    h('span.row-text', {}, h('span', {}, '보내기 전에 개인정보 가리기'), h('span.row-sub', {}, '주민번호·전화·계좌 등을 ●로 가린 사본을 보내요. 원본은 그대로예요.')),
    box,
  );
}

/**
 * 스위치가 켜져 있으면 문서에서 개인정보를 찾아 보여 주고, 고른 것만 가린 사본을 만든다.
 * 꺼져 있으면 원본을 그대로 쓴다. 보내기를 그만두면 null.
 */
export async function sendSource(session: DocumentSession): Promise<SendSource | null> {
  const original: SendSource = { raw: session.doc.raw, redacted: false, free: () => {} };
  if (!redactPref.get()) return original;
  const text = documentText(session.doc.raw);
  const found = uniquePii(findPii(text));
  if (found.length === 0) {
    const ok = await askConfirm({
      title: '가릴 개인정보를 찾지 못했어요',
      message: '주민번호·전화·이메일·계좌·카드 번호를 찾지 못했어요. 그림 속 글자는 찾을 수 없어요.\n그대로 보낼까요?',
      confirmLabel: '그대로 보내기',
    });
    return ok ? original : null;
  }

  const chosen = await new Promise<typeof found | null>((resolve) => {
    let done = false;
    const finish = (v: typeof found | null) => {
      if (done) return;
      done = true;
      resolve(v);
      sheet.close();
    };
    const sheet = new Sheet({ title: '보내기 전에 가리기', onClose: () => finish(null) });
    const state = found.map((m) => ({ m, on: true }));
    const submit = h('button.primary-btn', { type: 'button', onclick: () => finish(state.filter((s) => s.on).map((s) => s.m)) });
    const sync = () => {
      const n = state.filter((s) => s.on).length;
      submit.textContent = n ? `${n}개 가리고 보내기` : '가리지 않고 보내기';
    };
    const rows = state.map((s) => {
      const box = h('input', { type: 'checkbox', checked: true, 'aria-label': `${PII_NAMES[s.m.kind]} 가리기` });
      box.addEventListener('change', () => {
        s.on = box.checked;
        sync();
      });
      return h(
        'label.autofill-row',
        {},
        box,
        h('span.autofill-text', {}, h('span.autofill-label', {}, PII_NAMES[s.m.kind]), h('span.autofill-value', {}, `${s.m.masked}${s.m.count > 1 ? ` (${s.m.count}곳)` : ''}`)),
      );
    });
    sheet.body.append(
      h('p.sheet-note', {}, '찾은 개인정보예요. 가릴 것만 고르세요. 보낼 사본에만 가리고 원본은 그대로 둬요.'),
      h('div.autofill-list', {}, ...rows),
      h('p.sheet-note.warn-note', {}, '모두 찾았다고 보장하지 못해요(그림 속 글자, 머리말·꼬리말, 메모 등). 보내기 전에 한 번 더 확인해 주세요.'),
      h('div.dialog-actions', {}, h('button.secondary-btn', { type: 'button', onclick: () => finish(null) }, '취소'), submit),
    );
    sync();
    sheet.open();
  });
  if (!chosen) return null;
  if (chosen.length === 0) return original;

  // 메모가 있으면 HWPX로 옮겨야 메모가 남는다.
  const { bytes } = exportDocument(session.doc.raw, hasMemos(session.doc.raw) ? 'hwpx' : 'hwp');
  const copy = new HwpDocument(bytes);
  for (const m of chosen) copy.replaceAll(m.text, m.masked, true);
  return { raw: copy, redacted: true, free: () => copy.free() };
}
