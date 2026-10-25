import type { DocumentSession } from '../app/session';
import { backScope } from '../app/back';
import { toParagraphs } from '../doc/text';
import { documentText } from '../export/exporters';
import { Speaker, canSpeak } from '../platform/speech';
import { h } from './dom';
import { icon } from './icons';
import { readPref, writePref } from '../platform/prefs';

const SIZES = [15, 17, 19, 22, 26];
const THEMES = ['paper', 'sepia', 'night'] as const;
type ReaderTheme = (typeof THEMES)[number];

const RATES = [0.8, 1, 1.25, 1.5];

interface ReaderPrefs {
  size: number;
  theme: ReaderTheme;
  rate: number;
}

function loadPrefs(): ReaderPrefs {
  return { size: 1, theme: 'paper', rate: 1, ...readPref<Partial<ReaderPrefs>>('reader-prefs', {}) };
}

function savePrefs(p: ReaderPrefs): void {
  writePref('reader-prefs', p);
}

/**
 * 읽기 모드: A4 쪽을 확대·이동하지 않고, 글자만 휴대폰 화면 폭에 맞춰 다시 흘려 보여 준다.
 * 글자 크기·배경(종이/세피아/밤)을 고를 수 있고, 소리 내어 읽어 준다.
 */
export function openReader(session: DocumentSession, startPage: number, onClose: (page: number) => void): void {
  const prefs = loadPrefs();
  const article = h('article.reader-text', { lang: 'ko' });
  const paragraphs = toParagraphs(documentText(session.doc.raw));
  const paraEls = paragraphs.map((para, i) => h('p', { 'data-index': i }, para));
  article.append(...paraEls);
  if (paragraphs.length === 0) article.append(h('p.muted', {}, '(글자가 없는 문서)'));
  const pageCount = Math.max(1, session.doc.pageCount());

  const apply = () => {
    root.dataset.theme = prefs.theme;
    article.style.fontSize = `${SIZES[prefs.size]}px`;
    savePrefs(prefs);
  };
  // 쪽 경계를 알 수 없으므로 읽은 위치를 문서 전체 비율로 주고받는다.
  const finish = () => {
    stopSpeaking();
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

  // ── 읽어 주기 ──
  const speaker = new Speaker();
  speaker.rate = RATES.includes(prefs.rate) ? prefs.rate : 1;
  let speaking = false;
  let current = -1;
  const playBtn = h('button.speak-play', { type: 'button', 'aria-label': '읽어 주기' });
  const rateBtn = h('button.speak-rate', { type: 'button', 'aria-label': '읽는 빠르기' });
  const speakBar = h('div.speak-bar', { role: 'group', 'aria-label': '읽어 주기' }, playBtn, h('span.speak-label'), rateBtn);
  const renderSpeak = () => {
    playBtn.replaceChildren(icon(speaking ? 'pause' : 'play', 22), speaking ? '멈추기' : current > 0 ? '이어 읽기' : '읽어 주기');
    playBtn.setAttribute('aria-label', speaking ? '읽기 멈추기' : '읽어 주기');
    rateBtn.textContent = `${speaker.rate}배`;
  };
  const mark = (i: number) => {
    paraEls[current]?.classList.remove('speaking');
    current = i;
    const el = paraEls[i];
    if (!el) return;
    el.classList.add('speaking');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  /** 화면에 보이는 첫 문단 */
  const firstVisible = () => {
    const top = body.getBoundingClientRect().top;
    const i = paraEls.findIndex((p) => p.getBoundingClientRect().bottom > top + 8);
    return Math.max(0, i);
  };
  const stopSpeaking = () => {
    if (!speaking) return;
    speaking = false;
    speaker.stop();
    renderSpeak();
  };
  const startSpeaking = (from: number) => {
    speaking = true;
    renderSpeak();
    void speaker.play(paragraphs, from, mark, () => {
      speaking = false;
      paraEls[current]?.classList.remove('speaking');
      current = -1;
      renderSpeak();
    });
  };
  playBtn.addEventListener('click', () => {
    if (speaking) stopSpeaking();
    else startSpeaking(current >= 0 ? current : firstVisible());
  });
  rateBtn.addEventListener('click', () => {
    speaker.rate = RATES[(RATES.indexOf(speaker.rate) + 1) % RATES.length];
    prefs.rate = speaker.rate;
    savePrefs(prefs);
    renderSpeak();
    // 빠르기는 다음 문장부터 바뀌므로 지금 문단을 새 빠르기로 다시 읽는다.
    if (speaking) {
      speaker.stop();
      startSpeaking(current);
    }
  });
  // 문단을 누르면 거기서부터 읽는다 (읽는 중일 때).
  article.addEventListener('click', (e) => {
    const p = (e.target as HTMLElement).closest('p[data-index]');
    if (!p || !speaking) return;
    speaker.stop();
    startSpeaking(Number((p as HTMLElement).dataset.index));
  });
  speakBar.hidden = !canSpeak() || paragraphs.length === 0;
  renderSpeak();
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
    speakBar,
  );
  apply();
  document.body.append(root);
  body.scrollTop = (startPage / pageCount) * (body.scrollHeight - body.clientHeight);
}
