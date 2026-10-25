import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import init, { HwpDocument } from '@rhwp/core';
import { EditableDocument } from '../../src/doc/editable';

let ready: Promise<void> | null = null;

/** Node에서 rhwp WASM을 띄운다 (글자 폭은 대충 잰다). */
export async function blankDocument(): Promise<EditableDocument> {
  ready ??= (async () => {
    (globalThis as Record<string, unknown>).measureTextWidth = (_font: string, text: string) => text.length * 10;
    const wasm = readFileSync(fileURLToPath(import.meta.resolve('@rhwp/core/rhwp_bg.wasm')));
    await init({ module_or_path: wasm });
  })();
  await ready;
  const raw = HwpDocument.createEmpty();
  raw.createBlankDocument();
  return new EditableDocument(raw);
}
