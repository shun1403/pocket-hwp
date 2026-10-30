import { registerPlugin } from '@capacitor/core';
import { isNative } from './files';
import { readPref, writePref } from './prefs';

/**
 * 앱 잠금 설정. 안드로이드·아이폰 앱은 기기 잠금(지문·얼굴·기기 PIN)으로 풀고,
 * 웹 앱이나 기기 잠금이 없는 폰은 앱 PIN으로 푼다.
 * 화면 잠금이며, 저장된 문서를 암호화하지는 않는다.
 */
export interface LockSettings {
  enabled: boolean;
  /** 다른 앱에 다녀온 지 몇 분 뒤 다시 잠글지 (0 = 바로) */
  afterMinutes: number;
  /** 최근 앱 화면에서 가리기 (안드로이드는 화면 캡처도 막힘) */
  hideInSwitcher: boolean;
  /** 앱 PIN (PBKDF2-SHA256) — 기기 잠금을 못 쓸 때만 */
  pin?: { salt: string; hash: string };
}

const KEY = 'appLock';
const DEFAULTS: LockSettings = { enabled: false, afterMinutes: 1, hideInSwitcher: false };

export const lockSettings = {
  get: (): LockSettings => ({ ...DEFAULTS, ...readPref<Partial<LockSettings>>(KEY, {}) }),
  set: (next: LockSettings): void => writePref(KEY, next),
};

interface AppLockPlugin {
  available(): Promise<{ available: boolean }>;
  authenticate(opts: { reason: string }): Promise<{ ok: boolean; error?: string }>;
  setSecure(opts: { on: boolean }): Promise<void>;
}

/** 앱에 들어 있는 네이티브 플러그인 (android/…/AppLockPlugin.java, ios/App/App/AppLockPlugin.swift) */
const AppLock = registerPlugin<AppLockPlugin>('AppLock');

/** 기기 잠금(지문·얼굴·기기 PIN)으로 풀 수 있나 */
export async function deviceAuthAvailable(): Promise<boolean> {
  if (!isNative) return false;
  try {
    return (await AppLock.available()).available;
  } catch {
    return false;
  }
}

export async function deviceAuthenticate(reason: string): Promise<boolean> {
  try {
    return (await AppLock.authenticate({ reason })).ok;
  } catch {
    return false;
  }
}

export async function setHideInSwitcher(on: boolean): Promise<void> {
  if (!isNative) return;
  try {
    await AppLock.setSecure({ on });
  } catch {
    // 플러그인이 없는 옛 앱이면 그냥 둔다.
  }
}

const toHex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((x) => parseInt(x, 16)));

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 150_000 }, key, 256);
  return toHex(bits);
}

export async function hashPin(pin: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt), hash: await derive(pin, salt) };
}

export async function checkPin(pin: string, saved: { salt: string; hash: string }): Promise<boolean> {
  const hash = await derive(pin, fromHex(saved.salt));
  // 길이가 같은 16진 문자열 비교
  let diff = hash.length ^ saved.hash.length;
  for (let i = 0; i < Math.min(hash.length, saved.hash.length); i += 1) diff |= hash.charCodeAt(i) ^ saved.hash.charCodeAt(i);
  return diff === 0;
}
