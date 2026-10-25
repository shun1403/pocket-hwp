/** Uint8Array ↔ base64 (Capacitor Filesystem은 바이너리를 base64 문자열로 주고받는다) */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]*,/, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export type DocFormat = 'hwp' | 'hwpx';

/** 파일 내용(없으면 이름)으로 형식을 고른다. HWP 5.0은 OLE 복합 문서, HWPX는 ZIP(PK) 컨테이너다. */
export function detectFormat(name: string, bytes: Uint8Array): DocFormat {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'hwpx';
  if (bytes.length >= 2 && bytes[0] === 0xd0 && bytes[1] === 0xcf) return 'hwp';
  return /\.hwpx$/i.test(name) ? 'hwpx' : 'hwp';
}

export function baseName(name: string): string {
  return name.replace(/\.(hwpx?|hml)$/i, '');
}

/** 파일 시스템에 쓸 수 없는 문자를 바꾼다. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.length > 0 ? cleaned : '문서';
}

export function fileNameFromUrl(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const last = path.split('/').filter(Boolean).pop();
    if (last) return last;
  } catch {
    // content:// 같은 비표준 URL은 아래 기본값을 쓴다.
  }
  return '받은 문서.hwp';
}

export const MIME: Record<DocFormat | 'pdf' | 'txt', string> = {
  hwp: 'application/x-hwp',
  hwpx: 'application/hwp+zip',
  pdf: 'application/pdf',
  txt: 'text/plain',
};
