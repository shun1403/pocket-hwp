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

/** 한 줄 입력 시트. 브라우저 prompt() 대신 쓴다. 취소하면 null. secret 이면 암호 입력칸. */
export function askText(title: string, initial: string, confirmLabel = '확인', opts: { secret?: boolean; message?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('input.text-field', {
      type: opts.secret ? 'password' : 'text',
      value: initial,
      enterkeyhint: 'done',
      autocomplete: opts.secret ? 'off' : null,
      'aria-label': title,
    });
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
      opts.message ? h('p.dialog-message', {}, opts.message) : null,
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

export interface PasswordChoice {
  password: string;
  format: 'hwp' | 'hwpx';
}

/** 한컴오피스 문서 암호 설정처럼 5자 이상으로 받는다. */
export const MIN_PASSWORD = 5;

/** 암호 문서로 보내기: 암호를 두 번 받아 맞는지 보고, 형식(HWP·HWPX)을 고른다. 취소하면 null */
export function askPassword(): Promise<PasswordChoice | null> {
  return new Promise((resolve) => {
    let answered = false;
    let format: PasswordChoice['format'] = 'hwp';
    const field = (label: string) =>
      h('input.text-field', { type: 'password', autocomplete: 'new-password', enterkeyhint: 'next', 'aria-label': label, placeholder: label });
    const first = field('암호');
    const second = field('암호 한 번 더');
    const error = h('p.dialog-error', { role: 'alert' });
    const chips = (['hwp', 'hwpx'] as const).map((f) =>
      h(
        `button.chip-btn${f === format ? '.on' : ''}` as 'button',
        {
          type: 'button',
          'aria-pressed': String(f === format),
          onclick: () => {
            format = f;
            chips.forEach((c, i) => {
              const on = (['hwp', 'hwpx'] as const)[i] === f;
              c.classList.toggle('on', on);
              c.setAttribute('aria-pressed', String(on));
            });
          },
        },
        f === 'hwp' ? '한글 (.hwp)' : 'HWPX (.hwpx)',
      ),
    );
    const finish = (value: PasswordChoice | null) => {
      if (answered) return;
      answered = true;
      resolve(value);
      sheet.close();
    };
    const sheet = new Sheet({ title: '암호 걸어 보내기', onClose: () => finish(null) });
    const form = h(
      'form.dialog-form',
      {},
      h('p.dialog-message', {}, `받는 사람이 이 암호를 알아야 열 수 있어요. ${MIN_PASSWORD}자 이상으로 정해 주세요.`),
      first,
      second,
      h('div.chips', { role: 'group', 'aria-label': '형식' }, ...chips),
      error,
      h('p.sheet-note', {}, '암호는 앱에 저장하지 않아요. 문자·전화처럼 문서와 다른 방법으로 따로 알려 주세요.'),
      h(
        'div.dialog-actions',
        {},
        h('button.secondary-btn', { type: 'button', onclick: () => finish(null) }, '취소'),
        h('button.primary-btn', { type: 'submit' }, '암호 걸어 보내기'),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const password = first.value;
      if (password.length < MIN_PASSWORD) error.textContent = `암호를 ${MIN_PASSWORD}자 이상 넣어 주세요.`;
      else if (password !== second.value) error.textContent = '두 암호가 달라요. 다시 확인해 주세요.';
      else return finish({ password, format });
      (password.length < MIN_PASSWORD ? first : second).focus();
    });
    sheet.body.append(form);
    sheet.open();
    requestAnimationFrame(() => first.focus());
  });
}

/** 여러 줄 입력 시트. 취소하면 null, 빈 글로 확인하면 ''. extra 는 입력칸 아래에 둘 추가 도구. */
export function askLongText(
  title: string,
  initial: string,
  confirmLabel = '확인',
  opts: { message?: string; extra?: Node; danger?: { label: string; onClick: () => void } } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('textarea.text-field.multi', { rows: 4, 'aria-label': title }) as HTMLTextAreaElement;
    input.value = initial;
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
      opts.message ? h('p.dialog-message', {}, opts.message) : null,
      input,
      opts.extra ?? null,
      h(
        'div.dialog-actions',
        {},
        opts.danger
          ? h('button.secondary-btn.danger', { type: 'button', onclick: () => (finish(null), opts.danger!.onClick()) }, opts.danger.label)
          : h('button.secondary-btn', { type: 'button', onclick: () => finish(null) }, '취소'),
        h('button.primary-btn', { type: 'submit' }, confirmLabel),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input.value.replace(/\s+$/, ''));
    });
    sheet.body.append(form);
    sheet.open();
    requestAnimationFrame(() => input.focus());
  });
}
