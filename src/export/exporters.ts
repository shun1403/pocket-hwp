import type { HwpDocument } from '../engine/rhwp';
import type { DocFormat } from '../platform/bytes';
import { buildImagePdf, type PdfImagePage } from './pdf';

export interface ExportResult {
  bytes: Uint8Array;
  /** 저장하면서 잃는 내용이 있으면 사람이 읽을 설명 */
  lossWarnings: string[];
}

interface LossReport {
  count?: number;
  losses?: Record<string, unknown>[];
}

/** rhwp content-loss 보고서(`{count, losses:[...]}`)를 사람이 읽을 문장 목록으로 바꾼다. */
export function readLoss(json: string): string[] {
  try {
    const report = JSON.parse(json) as LossReport;
    return (report.losses ?? []).map((item) => {
      const text = ['message', 'description', 'detail', 'kind', 'feature']
        .map((k) => item[k])
        .find((v): v is string => typeof v === 'string' && v.length > 0);
      return text ?? JSON.stringify(item);
    });
  } catch {
    return [];
  }
}

/** 문서를 HWP 또는 HWPX 바이트로 직렬화한다. password 를 주면 암호를 건다. */
export function exportDocument(doc: HwpDocument, format: DocFormat, password?: string): ExportResult {
  const result = password
    ? format === 'hwpx'
      ? doc.exportHwpxWithPasswordAndReport(password)
      : doc.exportHwpWithPasswordAndReport(password)
    : format === 'hwpx'
      ? doc.exportHwpxWithReport()
      : doc.exportHwpWithReport();
  try {
    const lossWarnings = readLoss(result.contentLoss());
    return { bytes: result.takeBytes(), lossWarnings };
  } finally {
    result.free();
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('JPEG 변환 실패'));
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * 모든 쪽을 그려 PDF로 묶는다. 150dpi 정도(배율 1.6)면 휴대폰에서 읽기 충분하고
 * 파일도 지나치게 커지지 않는다.
 */
export async function exportPdf(doc: HwpDocument, onProgress: (done: number, total: number) => void, scale = 1.6): Promise<Uint8Array> {
  const total = doc.pageCount();
  const pages: PdfImagePage[] = [];
  const canvas = document.createElement('canvas');
  for (let i = 0; i < total; i += 1) {
    const info = JSON.parse(doc.getPageInfo(i)) as { width: number; height: number };
    doc.renderPageToCanvas(i, canvas, scale);
    // JPEG에는 투명도가 없으므로 흰 바탕을 깔아 준다.
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    pages.push({
      jpeg: await canvasToJpeg(canvas, 0.85),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      widthPt: (info.width * 72) / 96,
      heightPt: (info.height * 72) / 96,
    });
    onProgress(i + 1, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  canvas.width = 0;
  return buildImagePdf(pages);
}

/** 문서 전체 평문 (표 안 글 포함) */
export function documentText(doc: HwpDocument): string {
  try {
    const raw = doc.getTextFileText();
    const text = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
    return text.replace(/\r\n?/g, '\n');
  } catch {
    return '';
  }
}

/** 첫 쪽 썸네일 (최근 문서 목록용) */
export function renderThumbnail(doc: HwpDocument, width = 180): string | undefined {
  try {
    const info = JSON.parse(doc.getPageInfo(0)) as { width: number };
    const canvas = document.createElement('canvas');
    doc.renderPageToCanvas(0, canvas, width / info.width);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const url = canvas.toDataURL('image/jpeg', 0.7);
    canvas.width = 0;
    return url;
  } catch {
    return undefined;
  }
}
