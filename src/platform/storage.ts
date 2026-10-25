import { isNative } from './files';

/**
 * 웹 앱 저장소 보호.
 *
 * 브라우저는 저장 공간이 모자라거나(모든 브라우저) 오래 쓰지 않으면(사파리) 웹사이트 데이터를 지울 수 있다.
 * persist()를 허락받으면 사용자가 직접 지우기 전까지 보관함을 지우지 않는다.
 */
export interface StorageStatus {
  /** 브라우저가 함부로 지우지 않기로 했는가 (네이티브 앱은 항상 true) */
  persisted: boolean;
  usage?: number;
  quota?: number;
}

export async function requestPersistence(): Promise<boolean> {
  if (isNative) return true;
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<StorageStatus> {
  if (isNative) return { persisted: true };
  try {
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    return { persisted, usage: est?.usage, quota: est?.quota };
  } catch {
    return { persisted: false };
  }
}

/** 홈 화면에 추가한 앱(standalone)으로 실행 중인가 */
export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** 아이폰·아이패드 브라우저 탭에서 열었는가 (홈 화면 앱이 아님) */
export function isIosBrowserTab(): boolean {
  if (isNative || isStandalone()) return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios;
}
