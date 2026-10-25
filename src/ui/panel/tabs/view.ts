import { documentStats } from '../../../doc/ops/inserts';
import { documentText } from '../../../export/exporters';
import { h } from '../../dom';
import { Bindings, section, tiles } from '../controls';
import type { TabDef } from '../context';

export const viewTab: TabDef = {
  id: 'view',
  label: '보기',
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const raw = () => ed.document?.raw;
    const stats = h('dl.stats');
    const countText = () => {
      const r = raw();
      if (!r) return;
      const s = documentStats(documentText(r), r.pageCount());
      stats.replaceChildren(
        ...(
          [
            ['쪽', s.pages],
            ['글자 (공백 포함)', s.chars],
            ['글자 (공백 빼고)', s.charsNoSpace],
            ['낱말', s.words],
            ['문단', s.paragraphs],
          ] as const
        ).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v.toLocaleString('ko-KR'))]),
      );
    };
    const el = h(
      'div.tab-body',
      {},
      section(
        '도구',
        tiles(b, [
          { label: '찾기·바꾸기', icon: 'search', onClick: () => ctx.openSearch() },
          { label: '읽기 모드', icon: 'book', onClick: () => ctx.openReader() },
          { label: '쪽 모아 보기', icon: 'pages', onClick: () => ctx.openPages() },
          { label: '문서 정보', icon: 'info', onClick: () => ctx.openInfo() },
        ]),
      ),
      section(
        '표시',
        tiles(b, [
          {
            label: '조판 부호',
            icon: 'pilcrow',
            active: () => !!raw()?.getShowControlCodes(),
            onClick: () => {
              raw()?.setShowControlCodes(!raw()?.getShowControlCodes());
              ed.rerender();
            },
          },
          {
            label: '투명 선',
            icon: 'table',
            active: () => !!raw()?.getShowTransparentBorders(),
            onClick: () => {
              raw()?.setShowTransparentBorders(!raw()?.getShowTransparentBorders());
              ed.rerender();
            },
          },
        ]),
      ),
      section('글자 수', stats),
    );
    // 글자 수 세기는 문서 전체를 읽으므로 탭을 열 때 한 번만 한다.
    countText();
    return { el, refresh: () => b.refresh() };
  },
};
