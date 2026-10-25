import { h } from './dom';
import { Sheet } from './sheet';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

/**
 * 확인 시트. 브라우저 confirm() 대신 쓴다 — 모바일에서 보기 좋고,
 * confirm()을 막는 환경(미리보기 프레임 등)에서도 동작한다.
 */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value: boolean) => {
      if (answered) return;
      answered = true;
      resolve(value);
      sheet.close();
    };
    const sheet = new Sheet({ title: opts.title, onClose: () => finish(false) });
    sheet.body.append(
      h('p.dialog-message', {}, opts.message),
      h(
        'div.dialog-actions',
        {},
        h('button.secondary-btn', { onclick: () => finish(false) }, '취소'),
        h(`button.primary-btn${opts.danger ? '.danger-btn' : ''}` as 'button', { onclick: () => finish(true) }, opts.confirmLabel),
      ),
    );
    sheet.open();
  });
}

/** 한 줄 입력 시트. 브라우저 prompt() 대신 쓴다. 취소하면 null. */
export function askText(title: string, initial: string, confirmLabel = '확인'): Promise<string | null> {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('input.text-field', { type: 'text', value: initial, enterkeyhint: 'done', 'aria-label': title });
    const finish = (value: string | null) => {
      if (answered) return;
      answered = true;
      resolve(value);
      sheet.close();
    };
    const sheet = new Sheet({ title, onClose: () => finish(null) });
    const form = h(
      'form.dialog-form',
      {},
      input,
      h(
        'div.dialog-actions',
        {},
        h('button.secondary-btn', { type: 'button', onclick: () => finish(null) }, '취소'),
        h('button.primary-btn', { type: 'submit' }, confirmLabel),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input.value.trim() || null);
    });
    sheet.body.append(form);
    sheet.open();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}
