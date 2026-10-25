import { isNative } from './files';

/** 시스템 클립보드 (네이티브는 Capacitor 플러그인, 웹은 비동기 Clipboard API) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (isNative) {
      const { Clipboard } = await import('@capacitor/clipboard');
      await Clipboard.write({ string: text });
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch {
    return false;
  }
}

export async function readText(): Promise<string | null> {
  try {
    if (isNative) {
      const { Clipboard } = await import('@capacitor/clipboard');
      const r = await Clipboard.read();
      return r.type.startsWith('text') ? r.value : null;
    }
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
