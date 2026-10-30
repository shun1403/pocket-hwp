import { tx } from './db';
import { newId } from './library';

/** 저장해 둔 서명·도장 (투명 배경 PNG) */
export interface SavedSignature {
  id: string;
  kind: 'sign' | 'stamp';
  png: Uint8Array;
  width: number;
  height: number;
  createdAt: number;
}

/** 서명·도장은 몇 개만 둔다. 오래된 것부터 지운다. */
export const MAX_SIGNATURES = 12;

export const signatures = {
  async list(): Promise<SavedSignature[]> {
    const all = await tx<SavedSignature[]>('signatures', 'readonly', (s) => s.getAll() as IDBRequest<SavedSignature[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  async add(sig: Omit<SavedSignature, 'id' | 'createdAt'>): Promise<void> {
    await tx('signatures', 'readwrite', (s) => s.put({ ...sig, id: newId(), createdAt: Date.now() }));
    const stale = (await signatures.list()).slice(MAX_SIGNATURES);
    if (stale.length) await tx('signatures', 'readwrite', (s) => void stale.forEach((x) => s.delete(x.id)));
  },
  /** 백업에서 되살릴 때: 받은 그대로 넣는다. */
  async put(sig: SavedSignature): Promise<void> {
    await tx('signatures', 'readwrite', (s) => s.put(sig));
  },
  async remove(id: string): Promise<void> {
    await tx('signatures', 'readwrite', (s) => s.delete(id));
  },
};

/**
 * 도장·서명 사진의 바탕을 투명하게 만든다.
 * 어두운 잉크와 붉은 인주는 남기고, 흰 종이(밝고 색이 옅은 부분)는 지운다.
 * data 는 RGBA 픽셀 (ImageData.data)이며 그 자리에서 바꾼다.
 */
export function removePaper(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const red = r - Math.max(g, b);
    // 어두움(잉크)과 붉음(인주) 중 강한 쪽을 잉크 양으로 본다.
    const ink = Math.max(255 - lum, red * 1.6);
    const alpha = Math.max(0, Math.min(255, (ink - 70) * 2.4));
    data[i + 3] = Math.round((alpha * data[i + 3]) / 255);
  }
}

/** 보이는 픽셀(알파 > 8)을 감싸는 상자. 없으면 null */
export function inkBounds(data: Uint8ClampedArray, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
