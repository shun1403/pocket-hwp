import type { HwpDocument } from '../engine/rhwp';
import { bytesToBase64 } from '../platform/bytes';
import { printPdf } from '../platform/document-files';
import { isNative } from '../platform/files';
import { exportPdf } from './exporters';

/**
 * 인쇄. 앱은 PDF를 만들어 안드로이드·iOS 인쇄 화면에 넘기고,
 * 브라우저는 쪽 그림을 인쇄용 화면에 깔고 브라우저 인쇄 창을 연다.
 */
export async function printDocument(doc: HwpDocument, name: string, onProgress: (done: number, total: number) => void): Promise<void> {
  if (isNative) {
    // 인쇄는 화면보다 선명해야 해서 200dpi 정도(배율 2.1)로 그린다.
    const pdf = await exportPdf(doc, onProgress, 2.1);
    await printPdf(name, bytesToBase64(pdf));
    return;
  }
  await printInBrowser(doc, onProgress);
}

async function printInBrowser(doc: HwpDocument, onProgress: (done: number, total: number) => void): Promise<void> {
  const root = document.createElement('div');
  root.className = 'print-root';
  const urls: string[] = [];
  const canvas = document.createElement('canvas');
  const total = doc.pageCount();
  for (let i = 0; i < total; i += 1) {
    const info = JSON.parse(doc.getPageInfo(i)) as { width: number; height: number };
    doc.renderPageToCanvas(i, canvas, 2.1);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (blob) {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      // 96dpi px → mm
      img.style.width = `${(info.width * 25.4) / 96}mm`;
      img.style.height = `${(info.height * 25.4) / 96}mm`;
      root.append(img);
    }
    onProgress(i + 1, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  canvas.width = 0;
  document.body.append(root);
  document.documentElement.classList.add('printing');
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
  const done = () => {
    document.documentElement.classList.remove('printing');
    root.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // afterprint 를 보내지 않는 브라우저를 위해 잠시 뒤 정리한다.
  window.setTimeout(done, 60_000);
}
