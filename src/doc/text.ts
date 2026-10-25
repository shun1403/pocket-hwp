/** 쪽 글을 읽기 모드에 쓸 문단 목록으로 나눈다 (빈 줄·끝 공백 제거). */
export function toParagraphs(pageText: string): string[] {
  return pageText
    .split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .filter((line) => line.trim().length > 0);
}
