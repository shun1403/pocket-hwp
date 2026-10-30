import type { HwpDocument } from '../engine/rhwp';

/**
 * "1-3, 5" 같은 쪽 범위를 0부터 세는 쪽 번호 목록으로 바꾼다.
 * 쪽 번호는 1부터 쓴다. 범위를 벗어나거나 읽을 수 없으면 null.
 */
export function parsePageRange(input: string, total: number): number[] | null {
  const pages = new Set<number>();
  const parts = input.replace(/[~〜–—]/g, '-').split(/[,\s，、]+/).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from || to > total) return null;
    for (let p = from; p <= to; p += 1) pages.add(p - 1);
  }
  return [...pages].sort((a, b) => a - b);
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('PNG 변환 실패'));
      blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, 'image/png');
  });
}

/**
 * 쪽을 PNG 이미지로 그린다. 배율 2면 카톡에서 확대해도 글자가 또렷하다.
 * 긴 문서도 메모리를 아끼도록 캔버스 하나를 돌려 쓴다.
 */
export async function renderPagesPng(
  doc: HwpDocument,
  pages: number[],
  onProgress: (done: number, total: number) => void,
  scale = 2,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const canvas = document.createElement('canvas');
  for (const [i, page] of pages.entries()) {
    doc.renderPageToCanvas(page, canvas, scale);
    // 투명한 바탕은 메신저에서 검게 보이므로 흰 바탕을 깐다.
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    out.push(await canvasToPng(canvas));
    onProgress(i + 1, pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  canvas.width = 0;
  return out;
}
