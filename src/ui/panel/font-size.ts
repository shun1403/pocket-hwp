/** 글자 크기 단계 (pt) */
export const SIZE_STEPS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 60, 72];

export function nextFontSize(currentPt: number, dir: 1 | -1): number {
  if (dir > 0) return SIZE_STEPS.find((s) => s > currentPt + 0.01) ?? SIZE_STEPS[SIZE_STEPS.length - 1];
  return [...SIZE_STEPS].reverse().find((s) => s < currentPt - 0.01) ?? SIZE_STEPS[0];
}

export function ptLabel(hwpunit: number | undefined): string {
  const pt = (hwpunit ?? 1000) / 100;
  return Number.isInteger(pt) ? String(pt) : pt.toFixed(1);
}
