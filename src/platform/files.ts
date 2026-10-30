import { Capacitor } from '@capacitor/core';
import { MIME, base64ToBytes, bytesToBase64, fileNameFromUrl, safeFileName } from './bytes';

export const isNative = Capacitor.isNativePlatform();

export interface IncomingFile {
  name: string;
  bytes: Uint8Array;
}

/** 시스템 파일 선택기를 연다. 안드로이드/iOS WebView에서도 같은 방식으로 동작한다. capture면 카메라로 찍는다. */
export function pickFile(accept: string, capture = false): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    // 휴대폰에서 바로 카메라를 연다.
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/**
 * 파일을 다른 앱으로 보낸다(공유 시트). 웹에서 공유를 못 하면 내려받기로 대신한다.
 * iOS 공유 시트의 "파일에 저장", 안드로이드의 드라이브·파일 앱이 곧 "저장"이다.
 */
export async function shareFile(name: string, bytes: Uint8Array, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const fileName = safeFileName(name);
  if (isNative) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const written = await Filesystem.writeFile({
      path: `share/${fileName}`,
      data: bytesToBase64(bytes),
      directory: Directory.Cache,
      recursive: true,
    });
    try {
      await Share.share({ title: fileName, files: [written.uri], dialogTitle: '문서 보내기' });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const file = new File([bytes as BlobPart], fileName, { type: mime });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  downloadFile(fileName, bytes, mime);
  return 'downloaded';
}

export interface OutgoingFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

/**
 * 여러 파일을 한 번에 보낸다(쪽마다 그린 사진 등). 공유 시트가 여러 파일을 못 받는 컴퓨터에서는
 * zip 으로 묶어 내려받는다(묶는 함수는 부르는 쪽이 넘긴다).
 */
export async function shareFiles(
  files: OutgoingFile[],
  zip: () => OutgoingFile,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (files.length === 1) return shareFile(files[0].name, files[0].bytes, files[0].mime);
  if (isNative) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const uris: string[] = [];
    for (const f of files) {
      const written = await Filesystem.writeFile({
        path: `share/${safeFileName(f.name)}`,
        data: bytesToBase64(f.bytes),
        directory: Directory.Cache,
        recursive: true,
      });
      uris.push(written.uri);
    }
    try {
      await Share.share({ files: uris, dialogTitle: '보내기' });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const list = files.map((f) => new File([f.bytes as BlobPart], safeFileName(f.name), { type: f.mime }));
  if (navigator.canShare?.({ files: list }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: list });
      return 'shared';
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const packed = zip();
  downloadFile(packed.name, packed.bytes, packed.mime);
  return 'downloaded';
}

export function downloadFile(name: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(name);
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 길게 누르기 등 손끝 반응 */
export function haptic(): void {
  if (isNative) {
    void import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }));
  } else {
    navigator.vibrate?.(10);
  }
}

async function readNativeUrl(url: string): Promise<IncomingFile> {
  const { Filesystem } = await import('@capacitor/filesystem');
  const result = await Filesystem.readFile({ path: url });
  const data = result.data;
  const bytes = typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(await data.arrayBuffer());
  return { name: fileNameFromUrl(url), bytes };
}

/**
 * 다른 앱에서 "Pocket HWP로 열기"로 넘어온 파일을 받는다.
 * - 안드로이드/iOS: 앱 URL 열기 이벤트 (content://, file://)
 * - 데스크톱 PWA: launchQueue (manifest file_handlers)
 */
export async function listenIncomingFiles(onFile: (f: IncomingFile) => void, onError: (e: unknown) => void): Promise<void> {
  // 앱이 꺼져 있을 때 열리면 같은 주소가 실행 주소와 이벤트로 두 번 올 수 있다.
  let last = { url: '', at: 0 };
  const accept = (url: string | undefined) => {
    if (!url || !/^(content|file):/i.test(url)) return;
    if (url === last.url && Date.now() - last.at < 3000) return;
    last = { url, at: Date.now() };
    readNativeUrl(url).then(onFile, onError);
  };
  if (isNative) {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', (e) => accept(e.url));
    const launch = await App.getLaunchUrl();
    accept(launch?.url);
    return;
  }
  const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } })
    .launchQueue;
  lq?.setConsumer(async (params) => {
    for (const handle of params.files) {
      const file = await handle.getFile();
      onFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
  });
}

export { MIME };
