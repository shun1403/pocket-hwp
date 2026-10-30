import { backScope } from '../app/back';
import { checkPin, deviceAuthAvailable, deviceAuthenticate, lockSettings, setHideInSwitcher } from '../platform/app-lock';
import { h } from './dom';
import { icon } from './icons';

const MAX_TRIES = 5;
const WAIT_MS = 30_000;

/**
 * 앱 잠금 화면. 켜 두면 앱을 열 때, 그리고 다른 앱에 다녀온 지 정한 시간이 지나면 잠근다.
 * 잠깐 다녀온 동안에도 화면을 덮어 두어 최근 앱 목록에 문서가 보이지 않게 한다.
 */
export class AppLockGuard {
  private cover: HTMLElement | null = null;
  private locked = false;
  private hiddenAt = 0;
  private back: { dismiss: () => void } | null = null;
  private tries = 0;
  private waitUntil = 0;

  start(): void {
    const s = lockSettings.get();
    void setHideInSwitcher(s.enabled && s.hideInSwitcher);
    if (s.enabled) this.lock();
    document.addEventListener('visibilitychange', () => {
      const now = lockSettings.get();
      if (!now.enabled) return;
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now();
        this.showCover();
        return;
      }
      if (this.locked) return;
      if (Date.now() - this.hiddenAt >= now.afterMinutes * 60_000) this.lock();
      else this.removeCover();
    });
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** 문서 내용을 가리기만 하는 덮개 (아직 잠그지는 않음) */
  private showCover(): void {
    if (this.cover) return;
    this.cover = h('div.lock-screen', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '앱 잠금' }, h('div.lock-mark', {}, icon('lock', 40)));
    document.body.append(this.cover);
  }

  private removeCover(): void {
    if (this.locked) return;
    this.cover?.remove();
    this.cover = null;
  }

  lock(): void {
    this.locked = true;
    this.showCover();
    this.armBack();
    void this.renderUnlock();
  }

  /** 잠긴 동안 뒤로 가기는 아무것도 하지 않는다 (뒤의 시트·문서를 닫지 않게). */
  private armBack(): void {
    this.back?.dismiss();
    this.back = backScope(() => {
      this.back = null;
      if (this.locked) this.armBack();
    });
  }

  private unlock(): void {
    this.locked = false;
    this.tries = 0;
    this.back?.dismiss();
    this.back = null;
    this.removeCover();
  }

  private async renderUnlock(): Promise<void> {
    const cover = this.cover!;
    const s = lockSettings.get();
    const device = !s.pin && (await deviceAuthAvailable());
    const title = h('h2.lock-title', {}, 'Pocket HWP가 잠겨 있어요');
    if (device) {
      const tryDevice = async () => {
        if (await deviceAuthenticate('Pocket HWP 잠금 풀기')) this.unlock();
      };
      cover.replaceChildren(
        h('div.lock-mark', {}, icon('lock', 40)),
        title,
        h('p.lock-text', {}, '지문·얼굴 또는 기기 잠금으로 열어요.'),
        h('button.primary-btn.lock-btn', { type: 'button', onclick: () => void tryDevice() }, '잠금 풀기'),
      );
      void tryDevice();
      return;
    }
    const input = h('input.text-field.lock-pin', {
      type: 'password',
      inputmode: 'numeric',
      autocomplete: 'off',
      maxlength: '8',
      'aria-label': '앱 PIN',
      placeholder: 'PIN',
    }) as HTMLInputElement;
    const error = h('p.dialog-error', { role: 'alert' });
    const form = h(
      'form.lock-form',
      {},
      input,
      error,
      h('button.primary-btn.lock-btn', { type: 'submit' }, '열기'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (Date.now() < this.waitUntil) {
        error.textContent = `여러 번 틀려서 ${Math.ceil((this.waitUntil - Date.now()) / 1000)}초 뒤에 다시 해 주세요.`;
        return;
      }
      if (s.pin && (await checkPin(input.value, s.pin))) {
        this.unlock();
        return;
      }
      this.tries += 1;
      input.value = '';
      if (this.tries >= MAX_TRIES) {
        this.tries = 0;
        this.waitUntil = Date.now() + WAIT_MS;
        error.textContent = '여러 번 틀려서 30초 동안 기다려야 해요.';
      } else {
        error.textContent = `PIN이 맞지 않아요. (${this.tries}/${MAX_TRIES})`;
      }
      input.focus();
    });
    const forgot = h('details.lock-forgot', {}, h('summary', {}, 'PIN을 잊었어요'), h('p', {}, 'PIN은 이 기기에만 있어서 되찾을 수 없어요. 앱(또는 이 사이트의 데이터)을 지우면 잠금이 풀리지만 보관함의 문서도 함께 지워져요. 백업 파일이 있으면 지운 뒤 되살릴 수 있어요.'));
    cover.replaceChildren(h('div.lock-mark', {}, icon('lock', 40)), title, h('p.lock-text', {}, '앱 PIN을 넣어 주세요.'), form, forgot);
    requestAnimationFrame(() => input.focus());
  }
}
