import init, { HwpDocument, version } from '@rhwp/core';
import wasmUrl from '@rhwp/core/rhwp_bg.wasm?url';
import { loadBundledFonts } from './fonts';

export { HwpDocument };

let ready: Promise<void> | null = null;

function installTextMeasure(): void {
  // 구버전 rhwp 호환: WASM이 JS 콜백으로 글자 폭을 잰다.
  let ctx: CanvasRenderingContext2D | null = null;
  let lastFont = '';
  (globalThis as Record<string, unknown>).measureTextWidth = (font: string, text: string) => {
    ctx ??= document.createElement('canvas').getContext('2d');
    if (!ctx) return 0;
    if (font !== lastFont) {
      ctx.font = font;
      lastFont = font;
    }
    return ctx.measureText(text).width;
  };
}

/** 폰트와 WASM 엔진을 한 번만 초기화한다. */
export function initEngine(): Promise<void> {
  ready ??= (async () => {
    installTextMeasure();
    await loadBundledFonts(import.meta.env.BASE_URL);
    await init({ module_or_path: wasmUrl });
  })();
  return ready;
}

export function engineVersion(): string {
  try {
    return version();
  } catch {
    return 'unknown';
  }
}
