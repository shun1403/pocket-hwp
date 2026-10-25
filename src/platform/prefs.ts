/**
 * 작은 설정값(최근 기호, 상용구, 안내 닫음 등)을 localStorage에 둔다.
 * 사생활 보호 모드처럼 저장소를 못 쓰는 곳에서는 조용히 기본값을 쓴다.
 */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장소를 못 쓰면 이번 실행 동안만 유지된다.
  }
}
