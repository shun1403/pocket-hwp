import type { DocumentSession } from '../app/session';
import { backScope } from '../app/back';
import { toParagraphs } from '../doc/text';
import { documentText } from '../export/exporters';
import { h } from './dom';
import { icon } from './icons';

const SIZES = [15, 17, 19, 22, 26];
const THEMES = ['paper', 'sepia', 'night'] as const;
type ReaderTheme = (typeof THEMES)[number];

interface ReaderPrefs {
  size: number;
  theme: ReaderTheme;
}

function loadPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem('reader-prefs');
    if (raw) return { size: 1, theme: 'paper', ...(JSON.parse(raw) as Partial<ReaderPrefs>) };
  } catch {
    // 저장소를 못 쓰면 기본값
  }
  return { size: 1, theme: 'paper' };
}

function savePrefs(p: ReaderPrefs): void {
  try {
    localStorage.setItem('reader-prefs', JSON.stringify(p));
  } catch {
    // 무시
  }
}

/**
 * 읽기 모드: A4 쪽을 확대·이동하지 않고, 글자만 휴대폰 화면 폭에 맞춰 다시 흘려 보여 준다.
 * 글자 크기·배경(종이/세피아/밤)을 고를 수 있다.
 */
export function openReader(session: DocumentSession, startPage: number, onClose: (page: number) => void): void {
  const prefs = loadPrefs();
  const article = h('article.reader-text', { lang: 'ko' });
  const paragraphs = toParagraphs(documentText(session.doc.raw));
  for (const para of paragraphs) article.append(h('p', {}, para));
  if (paragraphs.length === 0) article.append(h('p.muted', {}, '(글자가 없는 문서)'));
  const pageCount = Math.max(1, session.doc.pageCount());

  const apply = () => {
    root.dataset.theme = prefs.theme;
    article.style.fontSize = `${SIZES[prefs.size]}px`;
    savePrefs(prefs);
  };
  // 쪽 경계를 알 수 없으므로 읽은 위치를 문서 전체 비율로 주고받는다.
  const finish = () => {
    const ratio = body.scrollTop / Math.max(1, body.scrollHeight - body.clientHeight);
    root.remove();
    onClose(Math.min(pageCount - 1, Math.floor(ratio * pageCount)));
  };
  const scope = backScope(finish);
  const close = () => {
    scope.dismiss();
    finish();
  };
  const body = h('div.reader-body', {}, article);
  const root = h(
    'div.reader',
    { role: 'dialog', 'aria-label': '읽기 모드' },
    h(
      'header.app-bar',
      {},
      h('button.icon-btn', { 'aria-label': '읽기 모드 닫기', onclick: close }, icon('back')),
      h('div.app-title', {}, session.name),
      h('button.icon-btn.text-btn', { 'aria-label': '글자 작게', onclick: () => ((prefs.size = Math.max(0, prefs.size - 1)), apply()) }, '가-'),
      h('button.icon-btn.text-btn', { 'aria-label': '글자 크게', onclick: () => ((prefs.size = Math.min(SIZES.length - 1, prefs.size + 1)), apply()) }, '가+'),
      h(
        'button.icon-btn.text-btn',
        {
          'aria-label': '배경 바꾸기',
          onclick: () => {
            prefs.theme = THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length];
            apply();
          },
        },
        '배경',
      ),
    ),
    body,
  );
  apply();
  document.body.append(root);
  body.scrollTop = (startPage / pageCount) * (body.scrollHeight - body.clientHeight);
}
