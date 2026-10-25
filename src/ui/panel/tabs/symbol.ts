import { readPref, writePref } from '../../../platform/prefs';
import { askText } from '../../dialog';
import { h, keepFocus } from '../../dom';
import { icon } from '../../icons';
import { toast } from '../../toast';
import { Bindings, chips, section } from '../controls';
import type { TabDef } from '../context';

/** 휴대폰 키보드로 치기 어려운 기호 (공문서에서 자주 쓰는 것부터) */
export const SYMBOL_GROUPS: { id: string; label: string; symbols: string[] }[] = [
  {
    id: 'official',
    label: '공문서',
    symbols: ['※', '·', '‧', '•', '○', '●', '◎', '□', '■', '◇', '◆', '△', '▲', '▽', '▼', '▷', '▶', '◁', '◀', '☞', '☆', '★', '∼', '…', '‥', '〃', '§', '¶', '✓', '✔', '✗', '♣', '♠', '♥', '♡'],
  },
  {
    id: 'number',
    label: '번호',
    symbols: [
      ...'①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳',
      ...'㉮㉯㉰㉱㉲㉳㉴㉵㉶㉷㉸㉹㉺㉻',
      ...'㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩㉪㉫㉬㉭',
      ...'⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽',
      ...'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ',
      ...'ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ',
    ],
  },
  { id: 'bracket', label: '괄호', symbols: [...'「」『』〈〉《》【】〔〕（）［］｛｝“”‘’'] },
  { id: 'arrow', label: '화살표', symbols: [...'→←↑↓↔↕⇒⇔↗↘↙↖⇐⇑⇓'] },
  { id: 'unit', label: '단위', symbols: [...'℃℉°㎜㎝㎞㎡㎢㎥㎖㎗ℓ㎘㎎㎏㎾㎿₩＄€¥£%‰㏊㎐㎑㎒'] },
  { id: 'math', label: '수학', symbols: [...'±×÷≠≒≡≤≥≪≫∞√∑∏∫∂∴∵∈∋⊂⊃∪∩∧∨¬∀∃∠⊥'] },
];

/** 공문서에서 자주 쓰는 문구 (처음 쓸 때 보이는 상용구) */
export const DEFAULT_PHRASES = ['끝.', '붙임', '직인 생략', '위와 같이 신청합니다.', '※ 문의: '];

const RECENT_KEY = 'symbols:recent';
const PHRASE_KEY = 'symbols:phrases';
const GROUP_KEY = 'symbols:group';
const MAX_RECENT = 16;

export function recentSymbols(): string[] {
  const list = readPref<unknown>(RECENT_KEY, []);
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT) : [];
}

export function rememberSymbol(symbol: string): void {
  writePref(RECENT_KEY, [symbol, ...recentSymbols().filter((s) => s !== symbol)].slice(0, MAX_RECENT));
}

export function phrases(): string[] {
  const list = readPref<unknown>(PHRASE_KEY, null);
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [...DEFAULT_PHRASES];
}

export function savePhrases(list: string[]): void {
  writePref(PHRASE_KEY, list);
}

/**
 * 기호·상용구 탭. 키보드 자리에 열려 있어서 기호를 여러 개 연달아 넣을 수 있다.
 * 최근에 쓴 기호가 맨 앞에 온다.
 */
export const symbolTab: TabDef = {
  id: 'symbol',
  label: '기호',
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const recentBox = h('div.symbols');
    const grid = h('div.symbols');
    const phraseBox = h('div.phrase-list');
    let group = readPref<string>(GROUP_KEY, 'official');
    if (!SYMBOL_GROUPS.some((g) => g.id === group)) group = 'official';

    const symbolBtn = (s: string) =>
      keepFocus(
        h('button.symbol', {
          type: 'button',
          'aria-label': `기호 ${s}`,
          onclick: () => {
            ed.insertText(s);
            rememberSymbol(s);
            renderRecent();
          },
        }, s),
      );
    const renderRecent = () => {
      const recent = recentSymbols();
      recentBox.replaceChildren(...recent.map(symbolBtn));
      recentSection.hidden = recent.length === 0;
    };
    const renderGrid = () => {
      grid.replaceChildren(...(SYMBOL_GROUPS.find((g) => g.id === group)?.symbols ?? []).map(symbolBtn));
      b.refresh();
    };
    const renderPhrases = () => {
      const list = phrases();
      phraseBox.replaceChildren(
        ...list.map((p, i) =>
          h(
            'div.phrase-row',
            {},
            keepFocus(h('button.phrase', { type: 'button', onclick: () => ed.insertText(p) }, p)),
            keepFocus(
              h(
                'button.icon-btn.small',
                {
                  type: 'button',
                  'aria-label': `상용구 "${p}" 지우기`,
                  onclick: () => {
                    savePhrases(list.filter((_, j) => j !== i));
                    renderPhrases();
                  },
                },
                icon('close', 18),
              ),
            ),
          ),
        ),
        keepFocus(
          h(
            'button.phrase.add',
            {
              type: 'button',
              onclick: async () => {
                const text = await askText('상용구 추가', ed.selectedText().slice(0, 200), '추가', {
                  message: '자주 쓰는 문구를 저장해 두고 한 번에 넣어요.',
                });
                if (!text?.trim()) return;
                savePhrases([...phrases(), text.trim()]);
                renderPhrases();
                toast('상용구를 저장했어요.');
              },
            },
            icon('plus', 18),
            '상용구 추가',
          ),
        ),
      );
    };

    const recentSection = section('최근에 쓴 기호', recentBox);
    const el = h(
      'div.tab-body',
      {},
      recentSection,
      section(
        '기호',
        chips(
          b,
          SYMBOL_GROUPS.map((g) => ({
            label: g.label,
            active: () => group === g.id,
            onClick: () => {
              group = g.id;
              writePref(GROUP_KEY, group);
              renderGrid();
            },
          })),
        ),
        grid,
      ),
      section('상용구', phraseBox),
    );
    renderRecent();
    renderGrid();
    renderPhrases();
    return { el, refresh: () => b.refresh() };
  },
};
