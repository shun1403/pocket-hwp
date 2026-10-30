import { checkPin, deviceAuthAvailable, deviceAuthenticate, hashPin, lockSettings, setHideInSwitcher } from '../platform/app-lock';
import { isNative } from '../platform/files';
import { h } from './dom';
import { Sheet } from './sheet';
import { toast } from './toast';

/** 앱 PIN 정하기: 4~8자리 숫자를 두 번. 취소하면 null */
function askNewPin(): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
      sheet.close();
    };
    const sheet = new Sheet({ title: '앱 PIN 정하기', onClose: () => finish(null) });
    const field = (label: string) =>
      h('input.text-field', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: '8', 'aria-label': label, placeholder: label }) as HTMLInputElement;
    const first = field('PIN (숫자 4~8자리)');
    const second = field('PIN 한 번 더');
    const error = h('p.dialog-error', { role: 'alert' });
    const form = h(
      'form.dialog-form',
      {},
      h('p.dialog-message', {}, '앱을 열 때 넣을 PIN이에요. 이 기기에만 저장되고, 잊으면 되찾을 수 없어요.'),
      first,
      second,
      error,
      h('div.dialog-actions', {}, h('button.secondary-btn', { type: 'button', onclick: () => finish(null) }, '취소'), h('button.primary-btn', { type: 'submit' }, '정하기')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!/^\d{4,8}$/.test(first.value)) error.textContent = '숫자 4~8자리로 정해 주세요.';
      else if (first.value !== second.value) error.textContent = '두 PIN이 달라요.';
      else return finish(first.value);
    });
    sheet.body.append(form);
    sheet.open();
    requestAnimationFrame(() => first.focus());
  });
}

/** 지금 PIN 확인 (끄거나 바꾸기 전에) */
function askCurrentPin(saved: { salt: string; hash: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      resolve(v);
      sheet.close();
    };
    const sheet = new Sheet({ title: '지금 PIN 확인', onClose: () => finish(false) });
    const input = h('input.text-field', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', 'aria-label': '지금 PIN', placeholder: '지금 PIN' }) as HTMLInputElement;
    const error = h('p.dialog-error', { role: 'alert' });
    const form = h(
      'form.dialog-form',
      {},
      input,
      error,
      h('div.dialog-actions', {}, h('button.secondary-btn', { type: 'button', onclick: () => finish(false) }, '취소'), h('button.primary-btn', { type: 'submit' }, '확인')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await checkPin(input.value, saved)) finish(true);
      else {
        error.textContent = 'PIN이 맞지 않아요.';
        input.value = '';
      }
    });
    sheet.body.append(form);
    sheet.open();
    requestAnimationFrame(() => input.focus());
  });
}

/** 지금 잠금을 풀 수 있는 사람인지 확인 (끄기·설정 바꾸기 전에) */
async function confirmOwner(): Promise<boolean> {
  const s = lockSettings.get();
  if (s.pin) return askCurrentPin(s.pin);
  return deviceAuthenticate('앱 잠금 설정 바꾸기');
}

const AFTER = [
  { value: 0, label: '바로' },
  { value: 1, label: '1분 뒤' },
  { value: 5, label: '5분 뒤' },
];

/** 보관함 관리 → 앱 잠금 */
export function openLockSettings(): void {
  const sheet = new Sheet({ title: '앱 잠금' });
  const render = () => {
    const s = lockSettings.get();
    const toggle = h('input', { type: 'checkbox', role: 'switch', checked: s.enabled, 'aria-label': '앱 잠금 켜기' }) as HTMLInputElement;
    toggle.addEventListener('change', async () => {
      toggle.checked = !toggle.checked; // 확인이 끝날 때까지 그대로 둔다
      if (!s.enabled) {
        // 켜기: 기기 잠금이 있으면 그걸로, 없으면 앱 PIN을 정한다.
        if (await deviceAuthAvailable()) {
          if (!(await deviceAuthenticate('앱 잠금 켜기'))) return;
          lockSettings.set({ ...s, enabled: true, pin: undefined });
        } else {
          const pin = await askNewPin();
          if (!pin) return;
          lockSettings.set({ ...s, enabled: true, pin: await hashPin(pin) });
        }
        void setHideInSwitcher(s.hideInSwitcher);
        toast('앱 잠금을 켰어요.');
      } else {
        if (!(await confirmOwner())) return;
        lockSettings.set({ ...s, enabled: false, pin: undefined });
        void setHideInSwitcher(false);
        toast('앱 잠금을 껐어요.');
      }
      render();
    });
    const rows: HTMLElement[] = [
      h('label.switch-row', {}, h('span.row-text', {}, h('span', {}, '앱 잠금'), h('span.row-sub', {}, isNative ? '지문·얼굴 또는 기기 잠금으로 열어요' : '앱 PIN으로 열어요')), toggle),
    ];
    if (s.enabled) {
      const chips = AFTER.map((a) =>
        h(
          `button.chip-btn${a.value === s.afterMinutes ? '.on' : ''}` as 'button',
          {
            type: 'button',
            'aria-pressed': String(a.value === s.afterMinutes),
            onclick: () => {
              lockSettings.set({ ...lockSettings.get(), afterMinutes: a.value });
              render();
            },
          },
          a.label,
        ),
      );
      rows.push(h('h3.panel-label', {}, '다른 앱에 다녀오면 다시 잠그기'), h('div.chips', { role: 'group', 'aria-label': '다시 잠그는 때' }, ...chips));
      if (isNative) {
        const hide = h('input', { type: 'checkbox', role: 'switch', checked: s.hideInSwitcher, 'aria-label': '최근 앱 화면에서 가리기' }) as HTMLInputElement;
        hide.addEventListener('change', () => {
          lockSettings.set({ ...lockSettings.get(), hideInSwitcher: hide.checked });
          void setHideInSwitcher(hide.checked);
        });
        rows.push(
          h('label.switch-row', {}, h('span.row-text', {}, h('span', {}, '최근 앱 화면에서 가리기'), h('span.row-sub', {}, '안드로이드는 화면 캡처도 함께 막혀요')), hide),
        );
      }
      if (s.pin) {
        rows.push(
          h(
            'button.sheet-row',
            {
              onclick: async () => {
                if (!(await confirmOwner())) return;
                const pin = await askNewPin();
                if (!pin) return;
                lockSettings.set({ ...lockSettings.get(), pin: await hashPin(pin) });
                toast('PIN을 바꿨어요.');
              },
            },
            h('span', {}, 'PIN 바꾸기'),
          ),
        );
      }
    }
    rows.push(
      h(
        'p.sheet-note',
        {},
        '앱 잠금은 화면 잠금이에요. 보관함의 문서 자체를 암호화하지는 않아요. PIN을 잊으면 앱 데이터를 지워야 하니 백업해 두세요.',
      ),
    );
    sheet.body.replaceChildren(...rows);
  };
  render();
  sheet.open();
}
