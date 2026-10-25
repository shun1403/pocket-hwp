import type { EditableDocument } from '../editable';
import type { PageObject } from './objects';

/** 차트의 숫자 데이터: 항목 이름(가로축)과 계열별 값 */
export interface ChartData {
  plot: string;
  labels: string[];
  series: { name: string; values: string[] }[];
}

export function chartData(doc: EditableDocument, o: PageObject): ChartData | null {
  try {
    const r = JSON.parse(doc.raw.getChartData(o.sec, o.para, o.ctrl)) as ChartData & { ok: boolean };
    return r.ok ? { plot: r.plot, labels: r.labels ?? [], series: r.series ?? [] } : null;
  } catch {
    return null;
  }
}

/**
 * 차트 값을 바꾼다. 엔진이 받지 않으면(값이 숫자가 아님, 차트 구조가 맞지 않음 등) 이유를 돌려준다.
 * 엔진은 원본 차트 사본(HWP용 OLE)까지 함께 고칠 수 없으면 아무것도 쓰지 않는다.
 */
export function setChartData(doc: EditableDocument, o: PageObject, data: Pick<ChartData, 'labels' | 'series'>): string | null {
  const r = JSON.parse(doc.raw.setChartData(o.sec, o.para, o.ctrl, JSON.stringify({ labels: data.labels, series: data.series }))) as {
    ok: boolean;
    invalid?: { message?: string; reason?: string }[];
  };
  if (r.ok) return null;
  return r.invalid?.map((i) => i.message ?? i.reason).join('\n') || '차트를 바꾸지 못했어요.';
}
