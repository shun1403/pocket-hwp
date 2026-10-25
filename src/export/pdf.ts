export interface PdfImagePage {
  /** JPEG 바이트 */
  jpeg: Uint8Array;
  /** 이미지 픽셀 크기 */
  pixelWidth: number;
  pixelHeight: number;
  /** 페이지 크기 (pt, 1pt = 1/72인치) */
  widthPt: number;
  heightPt: number;
}

/**
 * 쪽마다 JPEG 한 장을 담은 최소 PDF를 만든다.
 *
 * 모바일 WebView는 인쇄(PDF 저장) 경로가 플랫폼마다 달라서, 렌더링된 쪽 이미지를
 * 그대로 PDF로 묶는 방식을 쓴다. 외부 라이브러리 없이 PDF 1.4 규격만 사용한다.
 */
export function buildImagePdf(pages: PdfImagePage[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageIds = pages.map((_, i) => 3 + i * 3);
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));

  pages.forEach((page, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const w = fmt(page.widthPt);
    const hgt = fmt(page.heightPt);
    object(pageId, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${hgt}] ` +
          `/Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    const content = `q ${w} 0 0 ${hgt} 0 0 cm /Im${i} Do Q`;
    object(contentId, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(imageId, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      );
      push(page.jpeg);
      push('\nendstream');
    });
  });

  const xrefOffset = length;
  const count = 3 + pages.length * 3;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
