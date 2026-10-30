import { type DocStats, documentStats } from '../../../doc/ops/inserts';
import { documentText } from '../../../export/exporters';
import { openBookmarksSheet, openMemosSheet, openOutlineSheet } from '../../doc-tools';
import { h } from '../../dom';
import { readPref, writePref } from '../../../platform/prefs';
import { Bindings, chips, section, tiles } from '../controls';
import type { TabDef } from '../context';

export const viewTab: TabDef = {
  id: 'view',
  label: '보기',
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const raw = () => ed.document?.raw;
    const stats = h('dl.stats.doc-stats');
    const selStats = h('dl.stats');
    const selBox = h('div.sel-stats', { hidden: true }, h('h4.stats-label', {}, '고른 글'), selStats);
    const statRows = (s: DocStats, full: boolean) =>
      (
        [
          ...(full ? ([['쪽', s.pages]] as const) : []),
          ['글자 (공백 포함)', s.chars],
          ['글자 (공백 빼고)', s.charsNoSpace],
          ['바이트 (한글 2바이트)', s.bytes2],
          ['바이트 (한글 3바이트·UTF-8)', s.bytes3],
          ['원고지 (200자, 대략)', `${s.sheets.toLocaleString('ko-KR')}장`],
          ...(full
            ? ([
                ['낱말', s.words],
                ['문단', s.paragraphs],
              ] as const)
            : []),
        ] as const
      ).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, typeof v === 'number' ? v.toLocaleString('ko-KR') : v)]);

    // 목표 글자 수 (자기소개서 등). 문서마다 기기 안에 기억한다.
    const goalKey = `goal:${ctx.session.id}`;
    let goal = readPref<{ n: number; noSpace: boolean } | null>(goalKey, null);
    let docStats: DocStats | null = null;
    const goalBar = h('div.goal-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-label': '목표 글자 수' }, h('div.goal-fill'));
    const goalText = h('p.goal-text', { 'aria-live': 'polite' });
    const goalInput = h('input.text-field.goal-input', {
      type: 'number',
      inputmode: 'numeric',
      min: '1',
      placeholder: '예) 1000',
      value: goal ? String(goal.n) : '',
      'aria-label': '목표 글자 수',
    });
    const renderGoal = () => {
      goalBar.hidden = goalText.hidden = !goal || !docStats;
      if (!goal || !docStats) return;
      const now = goal.noSpace ? docStats.charsNoSpace : docStats.chars;
      const ratio = Math.min(1, now / goal.n);
      (goalBar.firstElementChild as HTMLElement).style.width = `${ratio * 100}%`;
      goalBar.classList.toggle('over', now > goal.n);
      goalBar.setAttribute('aria-valuemax', String(goal.n));
      goalBar.setAttribute('aria-valuenow', String(now));
      const left = goal.n - now;
      goalText.textContent = `${now.toLocaleString('ko-KR')} / ${goal.n.toLocaleString('ko-KR')}자 (${goal.noSpace ? '공백 빼고' : '공백 포함'}) · ${
        left >= 0 ? `${left.toLocaleString('ko-KR')}자 남았어요` : `${(-left).toLocaleString('ko-KR')}자 넘었어요`
      }`;
    };
    const saveGoal = (next: typeof goal) => {
      goal = next;
      writePref(goalKey, goal);
      renderGoal();
      b.refresh();
    };
    goalInput.addEventListener('input', () => {
      const n = Math.floor(Number(goalInput.value));
      saveGoal(n > 0 ? { n, noSpace: goal?.noSpace ?? false } : null);
    });
    const goalBox = h(
      'div.goal-box',
      {},
      goalInput,
      chips(b, [
        { label: '공백 포함', onClick: () => goal && saveGoal({ ...goal, noSpace: false }), active: () => !!goal && !goal.noSpace, disabled: () => !goal },
        { label: '공백 빼고', onClick: () => goal && saveGoal({ ...goal, noSpace: true }), active: () => !!goal?.noSpace, disabled: () => !goal },
      ]),
      goalBar,
      goalText,
    );

    const countText = () => {
      const r = raw();
      if (!r) return;
      docStats = documentStats(documentText(r), r.pageCount());
      stats.replaceChildren(...statRows(docStats, true));
      renderGoal();
    };
    // 고친 뒤 글자 수는 입력이 멈추면 다시 센다 (문서 전체를 읽으므로).
    let recount = 0;
    const scheduleCount = () => {
      window.clearTimeout(recount);
      recount = window.setTimeout(countText, 500);
    };
    const countSelection = () => {
      const text = ed.selectedText();
      selBox.hidden = !text;
      if (text) selStats.replaceChildren(...statRows(documentStats(text, 0), false));
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
          { label: '목차', icon: 'list', onClick: () => openOutlineSheet(ed) },
          { label: '책갈피', icon: 'bookmark', onClick: () => openBookmarksSheet(ed) },
          { label: '메모', icon: 'memo', onClick: () => void openMemosSheet(ed) },
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
      section('글자 수', selBox, stats),
      section('목표 글자 수', goalBox),
    );
    countText();
    countSelection();
    return {
      el,
      refresh: () => {
        b.refresh();
        countSelection();
        scheduleCount();
      },
    };
  },
};
