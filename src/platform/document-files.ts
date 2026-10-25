import { registerPlugin } from '@capacitor/core';
import { base64ToBytes, bytesToBase64 } from './bytes';
import { tx } from './db';
import { isNative } from './files';

/**
 * 연 문서의 원래 파일 자리. 고친 내용을 그 자리에 다시 쓸 때 쓴다.
 * - native: 안드로이드는 SAF content:// 주소(영구 쓰기 권한), iOS는 보안 북마크(base64)
 * - web: File System Access API 파일 핸들. 핸들 자체는 문서 목록과 따로 handles 저장소에 두고,
 *   원래 파일에 저장할 때만 꺼낸다.
 */
export type FileSource = { kind: 'native'; uri: string; name: string } | { kind: 'web'; name: string };

export interface PickedDocument {
  name: string;
  bytes: Uint8Array;
  /** 다시 쓸 수 있으면 있다 */
  source?: FileSource;
  /** web 일 때 파일 핸들 */
  handle?: FileSystemFileHandle;
}

/** 컴퓨터 브라우저의 파일 핸들 보관 (문서 id 별) */
export const fileHandles = {
  async put(docId: string, handle: FileSystemFileHandle): Promise<void> {
    await tx('handles', 'readwrite', (s) => s.put(handle, docId));
  },
  get(docId: string): Promise<FileSystemFileHandle | undefined> {
    return tx<FileSystemFileHandle | undefined>('handles', 'readonly', (s) => s.get(docId) as IDBRequest<FileSystemFileHandle | undefined>);
  },
  async remove(docId: string): Promise<void> {
    await tx('handles', 'readwrite', (s) => s.delete(docId));
  },
};

interface NativePick {
  cancelled?: boolean;
  uri?: string;
  name?: string;
  data?: string;
  writable?: boolean;
}

interface DocumentFilesPlugin {
  open(): Promise<NativePick>;
  write(options: { uri: string; data: string }): Promise<{ uri?: string }>;
}

/** 앱에 들어 있는 네이티브 플러그인 (android/…/DocumentFilesPlugin.java, ios/App/App/DocumentFilesPlugin.swift) */
const DocumentFiles = registerPlugin<DocumentFilesPlugin>('DocumentFiles');

type PickerWindow = Window & {
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
};

type WritableHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  createWritable?: () => Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
};

/** 원래 파일에 다시 쓸 수 있게 여는 방법이 있나 (앱, 또는 크롬 계열 컴퓨터 브라우저) */
export function canOpenInPlace(): boolean {
  return isNative || typeof (window as PickerWindow).showOpenFilePicker === 'function';
}

/** 문서를 고른다. 취소하면 null. canOpenInPlace() 일 때만 부른다. */
export async function pickDocumentInPlace(): Promise<PickedDocument | null> {
  if (isNative) {
    const r = await DocumentFiles.open();
    if (r.cancelled || !r.data || !r.name) return null;
    const bytes = base64ToBytes(r.data);
    return { name: r.name, bytes, source: r.uri && r.writable !== false ? { kind: 'native', uri: r.uri, name: r.name } : undefined };
  }
  let handles: FileSystemFileHandle[];
  try {
    handles = await (window as PickerWindow).showOpenFilePicker!({
      types: [{ description: '한글 문서', accept: { 'application/x-hwp': ['.hwp'], 'application/hwp+zip': ['.hwpx'] } }],
      multiple: false,
    });
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return null;
    throw err;
  }
  const handle = handles[0];
  const file = await handle.getFile();
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), source: { kind: 'web', name: file.name }, handle };
}

/**
 * 원래 파일 자리에 쓴다. 바뀐 자리 정보(iOS 북마크가 갱신된 경우 등)가 있으면 돌려준다.
 * 권한이 없거나 파일이 사라졌으면 예외를 던진다.
 */
export async function writeToSource(source: FileSource, bytes: Uint8Array, webHandle?: FileSystemFileHandle): Promise<FileSource> {
  if (source.kind === 'native') {
    const r = await DocumentFiles.write({ uri: source.uri, data: bytesToBase64(bytes) });
    return r.uri ? { ...source, uri: r.uri } : source;
  }
  if (!webHandle) throw new Error('no file handle');
  const handle = webHandle as WritableHandle;
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted') {
    const state = await handle.requestPermission?.({ mode: 'readwrite' });
    if (state !== 'granted') throw new Error('permission denied');
  }
  const writable = await handle.createWritable!();
  await writable.write(bytes as BlobPart);
  await writable.close();
  return source;
}
