// 모바일 화면(Pixel 7, 터치)으로 앱을 띄워 주요 흐름을 끝까지 검증한다.
// 실행: pnpm test:e2e   (Chromium이 없으면 `pnpm exec playwright install chromium`)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  // 로캘이 없는 환경(LANG 미설정)에서는 Chromium이 한글 파일 이름을 "download"로 바꿔 버린다.
  env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8' },
});
const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR', acceptDownloads: true });
// 처음 편집할 때 뜨는 사용법 안내는 따로 확인한다. 크롬의 파일 선택 API는 자동화할 수 없어
// 기본으로 감추고, 원래 파일에 저장하는 단계에서만 가짜로 넣는다.
await context.addInitScript(() => {
  localStorage.setItem('tips:edit-seen', 'true');
  delete window.showOpenFilePicker;
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await context.newCDPSession(page);

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['✓', name]);
    console.log(`✓ ${name}`);
  } catch (err) {
    results.push(['✗', name]);
    console.log(`✗ ${name}\n  ${err.stack ?? err}`);
  }
}

/** 편집기 내부 상태 (개발 모드 전용 창구) */
const editor = (fn, arg) =>
  page.evaluate(
    ([src, a]) => {
      const ed = window.__pocket.docScreen().editor;
      return new Function('ed', 'a', `return (${src})(ed, a)`)(ed, a);
    },
    [fn.toString(), arg],
  );
const paraText = () => editor((ed) => ed.doc.paraText(ed.caret));
const compose = async (steps, final) => {
  for (const text of steps) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  }
  await cdp.send('Input.insertText', { text: final });
};
/** 도구 패널을 해당 탭으로 연다 (이미 열려 있어도 된다) */
const openTab = async (label) => {
  if (!(await page.$('.tool-panel.open'))) await page.click('.qb[aria-label="서식 도구"]');
  await page.click(`.panel-tab:has-text("${label}")`);
};
const caretClient = () =>
  page.evaluate(() => {
    const r = document.querySelector('.caret').getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2 };
  });

await page.goto('http://localhost:5199/');
await page.waitForSelector('.home');

await step('처음 화면의 샘플 문서로 바로 둘러볼 수 있다', async () => {
  await page.click('.sample-btn');
  await page.waitForSelector('.doc .page canvas');
  const text = await page.evaluate(() => window.__pocket.docScreen().session.doc.raw.getTextRange(0, 0, 0, 30));
  assert.equal(text, 'Pocket HWP 사용 안내');
  // 보기 모드는 이름표가 붙은 아래 도구 줄을 쓴다.
  for (const label of ['찾기', '읽기 모드', '쪽 모아 보기', '보내기', '편집하기']) {
    assert.ok(await page.isVisible(`.view-bar [aria-label="${label}"]`), label);
  }
  await page.click('[aria-label="문서 닫기"]');
  await page.waitForSelector('.home:not([hidden])');
});

await step('새 문서를 만들면 바로 편집 모드로 열린다', async () => {
  await page.click('text=새 문서');
  await page.waitForSelector('.doc.editing .page canvas');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'ime-input');
});

await step('영문 입력과 한글 조합 입력이 문서에 들어간다', async () => {
  // 편집할 때는 글자가 보이도록 본문 폭에 맞춰 확대된다.
  assert.ok((await editor((ed) => ed.view.zoomFactorValue)) > 1.2, '본문 폭 맞춤');
  await page.keyboard.type('Pocket ');
  await compose(['ㅎ', '하', '한'], '한');
  await compose(['ㄱ', '그', '글'], '글');
  assert.equal(await paraText(), 'Pocket 한글');
});

await step('조합 중인 글은 실제 모양 그대로 문서에 보이고, 확정하거나 지우면 정리된다', async () => {
  await cdp.send('Input.imeSetComposition', { text: '무', selectionStart: 1, selectionEnd: 1 });
  // 떠 있는 미리보기가 아니라 문서에 바로 들어가 실제 글꼴·크기·줄 간격으로 그려진다.
  await page.waitForFunction(async () => document.querySelector('.composing-range'));
  assert.equal(await paraText(), 'Pocket 한글무');
  assert.equal(await page.$('.composition'), null);
  // 단어를 통째로 조합하는 키보드: 긴 조합도 문서 줄바꿈 그대로 쪽 안에서 줄을 바꾼다.
  const long = '가나다라마바사아자차카타파하'.repeat(4);
  await cdp.send('Input.imeSetComposition', { text: long, selectionStart: long.length, selectionEnd: long.length });
  assert.equal(await paraText(), `Pocket 한글${long}`);
  const box = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.composing-range')].map((el) => el.getBoundingClientRect());
    const pg = document.querySelector('.composing-range').closest('.page').getBoundingClientRect();
    return { lines: rects.length, right: Math.max(...rects.map((r) => r.right)), pageRight: pg.right };
  });
  assert.ok(box.lines > 1, `줄 바꿈 (${box.lines}줄)`);
  assert.ok(box.right <= box.pageRight, `쪽 안 (${box.right} ≤ ${box.pageRight})`);
  // 조합을 비우고 끝내면 넣어 둔 글이 빠진다.
  await cdp.send('Input.imeSetComposition', { text: '무', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '' });
  await page.waitForFunction(() => !document.querySelector('.composing-range'));
  assert.equal(await paraText(), 'Pocket 한글');
  // 확정하면 한 번만 들어간다.
  await compose(['ㅁ', '무'], '무');
  assert.equal(await paraText(), 'Pocket 한글무');
  await page.keyboard.press('Backspace');
  assert.equal(await paraText(), 'Pocket 한글');
  // 조합 중에 실행 취소하면 조합 글을 확정한 뒤 되돌린다 (넣어 둔 글이 남거나 엉뚱한 글이 지워지지 않는다).
  await cdp.send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 });
  assert.equal(await paraText(), 'Pocket 한글하');
  await editor((ed) => ed.undo());
  await page.waitForFunction(() => !document.querySelector('.composing-range'));
  assert.equal(await paraText(), 'Pocket 한글');
  await editor((ed) => ed.redo());
  assert.equal(await paraText(), 'Pocket 한글하');
  await page.keyboard.press('Backspace');
  assert.equal(await paraText(), 'Pocket 한글');
});

await step('Backspace·Enter가 동작한다', async () => {
  await page.keyboard.press('Backspace');
  assert.equal(await paraText(), 'Pocket 한');
  await page.keyboard.type('국');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second line');
  const caret = await editor((ed) => ed.caret);
  assert.equal(caret.para, 1);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  assert.equal(await paraText(), 'Pocket 한국Second line');
  await page.keyboard.press('Enter');
});

await step('탭하면 캐럿 손잡이가 나오고, 끌면 캐럿이 옮겨진다', async () => {
  await page.keyboard.type('abcdefghij');
  const before = await editor((ed) => ed.caret.offset);
  const at = await caretClient();
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForSelector('.sel-handle-caret');
  const h = await page.locator('.sel-handle-caret').boundingBox();
  const start = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - 60, y: start.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await editor((ed) => ed.caret.offset);
  assert.ok(after < before, `캐럿 ${before} → ${after}`);
  // 넣었던 글을 지워 다음 단계가 원래 문단("Second line")으로 이어지게 한다.
  await page.keyboard.press('Home');
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('Delete');
  assert.equal(await paraText(), 'Second line');
});

await step('키보드 높이를 알 수 없으면 편집 도구 줄이 화면 위에 붙는다', async () => {
  // 에뮬레이터에는 가상 키보드가 없어 앱 안 미리보기 창과 같은 상황이 된다.
  await page.waitForFunction(() => document.querySelector('.doc')?.classList.contains('dock-top'));
  const bar = await page.locator('.quick-bar').boundingBox();
  assert.ok(bar.y < 200, `도구 줄 위치 ${bar.y}`);
});

await step('실행 취소·다시 실행', async () => {
  await page.keyboard.type('XYZ');
  assert.match(await paraText(), /^XYZ/);
  await page.click('[aria-label="실행 취소"]');
  assert.doesNotMatch(await paraText(), /XYZ/);
  await page.click('[aria-label="다시 실행"]');
  assert.match(await paraText(), /^XYZ/);
});

await step('길게 눌러 단어를 선택하고 굵게 만든다', async () => {
  const at = await caretClient();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x - 10, y: at.y }] });
  await page.waitForTimeout(600);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForSelector('.selection-menu:not([hidden])');
  assert.equal(await editor((ed) => ed.selectedText()), 'XYZSecond');
  await page.click('.qb[aria-label="굵게"]');
  const bold = await editor((ed) => ed.doc.charProps({ ...ed.caret, offset: 1 }).bold);
  assert.equal(bold, true);
  assert.equal(await page.getAttribute('.qb[aria-label="굵게"]', 'aria-pressed'), 'true');
  // 길게 누른 뒤에도 키보드(입력칸 포커스)가 유지되어야 한다.
  assert.equal(await page.evaluate(() => document.activeElement.className), 'ime-input');
});

await step('표를 넣고 셀 안에 글을 쓴다', async () => {
  await page.keyboard.press('End');
  await page.click('.qb[aria-label="입력 도구"]');
  await page.click('.tile[aria-label="표"]');
  await page.click('.sheet .primary-btn:has-text("표 넣기")');
  await page.waitForTimeout(300);
  assert.equal(await editor((ed) => ed.doc.raw.getTextRange(0, 1, 0, 30)), 'XYZSecond line', '표는 문단 끝에 들어가야 함');
  const pages = await editor((ed) => ed.doc.pageCount());
  assert.equal(pages, 1);
  // 표의 첫 칸을 찾아 안쪽을 탭한다 (바깥 테두리를 누르면 표 전체가 골라진다).
  const target = await editor((ed) => {
    for (let y = 40; y < 400; y += 4) {
      const pos = ed.doc.hitTest(0, 200, y);
      if (pos?.cellPath) return { y: y + 6 };
    }
    return null;
  });
  assert.ok(target, '표 칸을 찾지 못함');
  const box = await page.locator('.page').first().boundingBox();
  const zoom = await editor((ed) => ed.view.zoom);
  await page.touchscreen.tap(box.x + 200 * zoom, box.y + target.y * zoom);
  await compose(['ㅅ', '세', '셀'], '셀');
  assert.equal(await paraText(), '셀');
  assert.ok(await editor((ed) => !!ed.caret.cellPath));
});

await step('표 탭: 셀 안에서 줄을 넣고 칸 배경을 칠한다', async () => {
  const before = await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table').rowCount);
  await page.click('.qb[aria-label="표 도구"]');
  await page.click('.tile[aria-label="아래에 줄 넣기"]');
  const after = await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table').rowCount);
  assert.equal(after, before + 1);
  await page.click('.panel-body .swatch[aria-label="#fef7e0"]');
  const fill = await editor((ed) => {
    const c = ed.caret.cellPath[0];
    return JSON.parse(ed.doc.raw.getCellProperties(0, ed.caret.para, c.controlIndex, c.cellIndex)).fillColor;
  });
  assert.equal(fill, '#fef7e0');
  assert.ok(await editor((ed) => !!ed.caret.cellPath), '셀 안에 캐럿이 남아야 함');
});

await step('글자 탭: 선택한 글의 크기·색을 바꾼다', async () => {
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 0 }, { sec: 0, para: 0, offset: 6 }));
  await page.click('.panel-tab:has-text("글자")');
  await page.click('.chip-btn[aria-label="14"]');
  await page.click('.panel-body .swatch[aria-label="#1a73e8"]');
  const props = await editor((ed) => ed.doc.charProps({ sec: 0, para: 0, offset: 1 }));
  assert.equal(props.fontSize, 1400);
  assert.equal(props.textColor, '#1a73e8');
});

await step('문단 탭: 가운데 정렬과 공문서 번호', async () => {
  await page.click('.panel-tab:has-text("문단")');
  await page.click('.seg[aria-label="가운데 정렬"]');
  await page.click('.chip-btn[aria-label="1. 가. 1) 가)"]');
  const para = await editor((ed) => ed.doc.paraProps({ sec: 0, para: 0, offset: 0 }));
  assert.equal(para.alignment, 'center');
  assert.equal(para.headType, 'Number');
  await page.click('.seg[aria-label="번호·글머리표 없애기"]');
  assert.equal(await editor((ed) => ed.doc.paraProps({ sec: 0, para: 0, offset: 0 }).headType), 'None');
});

await step('스타일 탭: 개요 1 적용', async () => {
  await page.click('.panel-tab:has-text("스타일")');
  await page.click('.style-btn[aria-label="개요 1"]');
  assert.equal(await editor((ed) => JSON.parse(ed.doc.raw.getStyleAt(0, 0)).name), '개요 1');
  await page.click('.style-btn[aria-label="바탕글"]');
});

await step('입력 탭: 수식을 넣고, 눌러서 고치고 지운다', async () => {
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 0 }, { sec: 0, para: 0, offset: 0 }));
  await page.click('.panel-tab:has-text("입력")');
  await page.click('.tile[aria-label="수식"]');
  await page.fill('.equation-input', '{a} over {b}');
  await page.waitForSelector('.equation-preview img');
  await page.click('.sheet .primary-btn:has-text("수식 넣기")');
  const eq = await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'equation'));
  assert.ok(eq, '수식이 들어가야 함');
  const box = await page.locator('.page').first().boundingBox();
  const zoom = await editor((ed) => ed.view.zoom);
  await page.touchscreen.tap(box.x + (eq.x + eq.w / 2) * zoom, box.y + (eq.y + eq.h / 2) * zoom);
  await page.waitForSelector('.selection-menu:not([hidden]) >> text=수식 고치기');
  await page.click('.selection-menu >> text=삭제');
  const left = await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.filter((c) => c.type === 'equation').length);
  assert.equal(left, 0);
});

await step('입력 탭: 각주를 넣는다', async () => {
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 4 }, { sec: 0, para: 0, offset: 4 }));
  const lenBefore = await editor((ed) => ed.doc.raw.getParagraphLength(0, 0));
  await openTab('입력');
  await page.click('.tile[aria-label="각주"]');
  await page.fill('.sheet.open .text-field', '각주 설명');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.equal(await editor((ed) => ed.doc.raw.getParagraphLength(0, 0)), lenBefore, '각주는 글자 위치를 차지하지 않는다');
  const where = await editor((ed) => JSON.parse(ed.doc.raw.getPageFootnoteInfo(0, 0)));
  assert.equal(where.ok, true, '쪽에 각주가 있어야 함');
  const note = await editor((ed, w) => JSON.parse(ed.doc.raw.getFootnoteInfo(0, w.paraIdx, w.controlIdx)), where);
  assert.match(note.texts.join(''), /각주 설명/);
});

await step('입력 탭: 사진은 본문 글자처럼 들어간다 (쪽 모서리에 붙지 않는다)', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
    'base64',
  );
  await openTab('입력');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tile[aria-label="사진"]')]);
  await chooser.setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() =>
    JSON.parse(window.__pocket.docScreen().editor.doc.raw.getPageControlLayout(0)).controls.some((c) => c.type === 'image'),
  );
  const img = await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'image'));
  assert.equal(await editor((ed, o) => JSON.parse(ed.doc.raw.getPictureProperties(0, o.paraIdx, o.controlIdx)).treatAsChar, img), true);
  assert.ok(img.x > 50 && img.y > 50, `그림 위치 ${img.x},${img.y}`);
  // 그림을 탭해서 고르고 지운다.
  const box = await page.locator('.page').first().boundingBox();
  const zoom = await editor((ed) => ed.view.zoom);
  await page.touchscreen.tap(box.x + (img.x + img.w / 2) * zoom, box.y + (img.y + img.h / 2) * zoom);
  await page.waitForSelector('.selection-menu:not([hidden]) >> text=글 둘레로 배치');
  await page.click('.selection-menu >> text=삭제');
  assert.equal(await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.filter((c) => c.type === 'image').length), 0);
});

await step('쪽 탭: 가로 방향과 2단', async () => {
  await openTab('쪽');
  await page.click('.seg[aria-label="가로"]');
  const info = await editor((ed) => JSON.parse(ed.doc.raw.getPageInfo(0)));
  assert.ok(info.width > info.height, '가로 쪽');
  await page.click('.chip-btn[aria-label="2단"]');
  assert.equal(await editor((ed) => JSON.parse(ed.doc.raw.getColumnDef(0)).columnCount), 2);
  await page.click('.chip-btn[aria-label="1단"]');
  await page.click('.seg[aria-label="세로"]');
});

await step('키보드 버튼으로 도구 패널을 닫으면 다시 글을 쓸 수 있다', async () => {
  await page.click('.qb-kb');
  await page.waitForFunction(() => !document.querySelector('.tool-panel.open'));
  assert.equal(await page.evaluate(() => document.activeElement.className), 'ime-input');
});

await step('찾기로 낱말 위치를 선택한다', async () => {
  await page.click('[aria-label="찾기·바꾸기"]');
  await page.fill('.search-input[type="search"]', 'Second');
  await page.waitForFunction(() => document.querySelector('.search-count')?.textContent === '1/1');
  assert.equal(await editor((ed) => ed.selectedText()), 'Second');
  await page.click('[aria-label="찾기 닫기"]');
});

await step('완료 → 보기 모드, 두 손가락으로 확대', async () => {
  await page.click('.done-btn');
  await page.waitForSelector('.doc:not(.editing)');
  const before = await editor((ed) => ed.view.zoomFactorValue);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 400, id: 1 }, { x: 250, y: 400, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 400, id: 1 }, { x: 300, y: 400, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await editor((ed) => ed.view.zoomFactorValue);
  assert.ok(after > before * 1.8, `zoom ${before} → ${after}`);
});

let exported;
await step('HWP로 보내기 → 다시 열 수 있는 파일', async () => {
  await page.click('[aria-label="보내기"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=한글 문서 (.hwp)')]);
  exported = await readFile(await download.path());
  assert.ok(exported.length > 1000);
  assert.equal(exported.subarray(0, 4).toString('hex'), 'd0cf11e0'); // OLE 복합 문서
});

let locked;
await step('암호 건 HWP로 보내기', async () => {
  await page.click('[aria-label="보내기"]');
  await page.click('.sheet-row:has-text("암호 건")');
  const pw = (i) => `.sheet.open .text-field[type="password"] >> nth=${i}`;
  // 짧거나 두 번이 다르면 막는다.
  await page.fill(pw(0), 'abc');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForSelector('.dialog-error:has-text("5자 이상")');
  await page.fill(pw(0), 'pocket123');
  await page.fill(pw(1), 'pocket124');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForSelector('.dialog-error:has-text("두 암호가 달라요")');
  await page.fill(pw(1), 'pocket123');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.sheet.open .dialog-form button[type="submit"]')]);
  assert.match(download.suggestedFilename(), /\.hwp$/);
  locked = await readFile(await download.path());
  assert.equal(locked.subarray(0, 4).toString('hex'), 'd0cf11e0');
});

await step('암호 건 HWPX로도 보낸다', async () => {
  await page.click('[aria-label="보내기"]');
  await page.click('.sheet-row:has-text("암호 건")');
  await page.fill('.sheet.open .text-field[type="password"] >> nth=0', 'pocket123');
  await page.fill('.sheet.open .text-field[type="password"] >> nth=1', 'pocket123');
  await page.click('.sheet.open .chip-btn:has-text("HWPX")');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.sheet.open .dialog-form button[type="submit"]')]);
  assert.match(download.suggestedFilename(), /\.hwpx$/);
  const bytes = await readFile(await download.path());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
});

await step('사진으로 보내기: 지금 쪽은 PNG 한 장, 여러 쪽은 ZIP', async () => {
  await page.click('[aria-label="보내기"]');
  await page.click('.sheet-row:has-text("사진")');
  const pages = await editor((ed) => ed.doc.pageCount());
  if (pages > 1) {
    const [one] = await Promise.all([page.waitForEvent('download'), page.click('.sheet.open .sheet-row:has-text("지금 보는 쪽만")')]);
    const png = await readFile(await one.path());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    await page.click('[aria-label="보내기"]');
    await page.click('.sheet-row:has-text("사진")');
  }
  const [all] = await Promise.all([page.waitForEvent('download'), page.click('.sheet.open .sheet-row:has-text("모든 쪽")')]);
  const bytes = await readFile(await all.path());
  if (pages > 1) {
    assert.match(all.suggestedFilename(), /사진\.zip$/);
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  } else {
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  }
});

await step('PDF로 보내기', async () => {
  await page.click('[aria-label="보내기"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.sheet-row:has-text("PDF")')]);
  const pdf = await readFile(await download.path());
  if (process.env.SAVE_PDF) await (await import('node:fs/promises')).writeFile(process.env.SAVE_PDF, pdf);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

await step('읽기 모드는 글자를 화면 폭에 맞춰 흘린다', async () => {
  await page.click('[aria-label="읽기 모드"]');
  const text = await page.textContent('.reader-text');
  assert.match(text, /Pocket 한국/);
  assert.match(text, /셀/, '표 안의 글도 보여야 함');
  await page.click('[aria-label="읽기 모드 닫기"]');
  await page.waitForFunction(() => !document.querySelector('.reader'));
});

await step('시트를 닫자마자 다른 시트를 열어도 뒤로 가기 기록이 어긋나지 않는다', async () => {
  await page.click('[aria-label="더보기"]');
  await page.click('text=쪽 모아 보기');
  await page.waitForSelector('.page-grid');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.page-grid'));
  assert.ok(await page.$('.doc'), '문서 화면이 그대로 있어야 함');
});

await step('이름 바꾸기는 앱 안 입력 시트로 한다', async () => {
  await page.click('[aria-label="더보기"]');
  await page.click('.sheet-row:has-text("이름 바꾸기")');
  await page.fill('.sheet.open .text-field', '모바일 테스트');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.app-title')?.textContent === '모바일 테스트.hwp');
});

await step('닫으면 최근 문서에 “편집됨”으로 남고 다시 열면 내용이 그대로다', async () => {
  await page.click('[aria-label="문서 닫기"]');
  await page.waitForSelector('.home:not([hidden]) .recent-item');
  assert.match(await page.textContent('.recent-item'), /편집됨/);
  await page.click('.recent-open');
  await page.waitForSelector('.doc .page canvas');
  const text = await page.evaluate(() => window.__pocket.docScreen().session.doc.raw.getTextRange(0, 0, 0, 30));
  assert.equal(text, 'Pocket 한국');
  await page.goBack();
  await page.waitForSelector('.home:not([hidden])');
});

await step('내보낸 HWP 파일을 다시 연다', async () => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=문서 열기')]);
  await chooser.setFiles({ name: 'exported.hwp', mimeType: 'application/x-hwp', buffer: exported });
  await page.waitForSelector('.doc .page canvas');
  const text = await page.evaluate(() => window.__pocket.docScreen().session.doc.raw.getTextRange(0, 0, 0, 30));
  assert.equal(text, 'Pocket 한국');
});

await step('암호 문서를 열면 암호를 물어보고 연다', async () => {
  await page.goBack();
  await page.waitForSelector('.home:not([hidden])');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=문서 열기')]);
  await chooser.setFiles({ name: 'locked.hwp', mimeType: 'application/x-hwp', buffer: locked });
  await page.waitForSelector('.sheet.open .text-field[type="password"]');
  await page.fill('.sheet.open .text-field[type="password"]', 'wrong');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForSelector('.dialog-message:has-text("맞지 않아요")');
  await page.fill('.sheet.open .text-field[type="password"]', 'pocket123');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForSelector('.doc .page canvas');
  const text = await page.evaluate(() => window.__pocket.docScreen().session.doc.raw.getTextRange(0, 0, 0, 30));
  assert.match(text, /Pocket/);
});

let backupZip;
await step('편집하고 내보내지 않은 문서는 백업 알림과 “백업 전” 표시가 뜬다', async () => {
  await page.goBack();
  await page.waitForSelector('.home:not([hidden])');
  await page.click('text=새 문서');
  await page.waitForSelector('.doc.editing .page canvas');
  await page.keyboard.type('백업할 글');
  await page.click('.done-btn');
  await page.click('[aria-label="문서 닫기"]');
  await page.waitForSelector('.home:not([hidden]) .notice');
  assert.match(await page.textContent('.notice'), /이 기기에만 있어요/);
  assert.ok(await page.isVisible('.recent-item .badge.warn'));
});

await step('알림의 백업 버튼으로 모든 문서를 ZIP으로 내보낸다', async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.notice-btn:has-text("백업")')]);
  assert.match(download.suggestedFilename(), /^Pocket HWP 백업 .*\.zip$/);
  backupZip = await readFile(await download.path());
  assert.equal(backupZip.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(backupZip.includes(Buffer.from('pocket-hwp-backup.json')));
  await page.waitForFunction(() => !document.querySelector('.recent-item .badge.warn'));
  assert.equal(await page.$('.notice:has-text("이 기기에만")'), null);
});

await step('지운 문서를 백업에서 되살린다', async () => {
  const before = await page.$$eval('.recent-item', (els) => els.length);
  await page.click('.recent-item .icon-btn[aria-label$="더보기"]');
  await page.click('.sheet.open .sheet-row.danger');
  await page.click('.sheet.open .danger-btn');
  await page.waitForFunction((n) => document.querySelectorAll('.recent-item').length === n - 1, before);
  await page.click('[aria-label="보관함 관리"]');
  await page.waitForSelector('.sheet.open .storage-state');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.sheet.open .sheet-row:has-text("백업에서 불러오기")')]);
  await chooser.setFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: backupZip });
  await page.waitForFunction((n) => document.querySelectorAll('.recent-item').length === n, before);
  assert.match(await page.textContent('.toast-host'), /1개 추가/);
});

/** 시트·패널·편집 모드를 차례로 닫으며 처음 화면까지 돌아간다. */
const goHome = async () => {
  for (let i = 0; i < 6 && !(await page.isVisible('.home')); i += 1) {
    await page.goBack();
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('.home:not([hidden])');
};
const newDoc = async () => {
  await goHome();
  await page.click('text=새 문서');
  await page.waitForSelector('.doc.editing .page canvas');
};
const submitText = async (value) => {
  await page.fill('.sheet.open .text-field', value);
  await page.click('.sheet.open .dialog-form button[type="submit"]');
};

await step('기호 탭: 기호·상용구를 넣고 최근 기호에 남긴다', async () => {
  await newDoc();
  await page.click('.qb[aria-label="기호 도구"]');
  await page.click('.panel-body .chip-btn:has-text("번호")');
  await page.click('.panel-body .symbol[aria-label="기호 ①"]');
  assert.equal(await paraText(), '①');
  assert.ok(await page.isVisible('.panel-body .panel-section:has-text("최근에 쓴 기호") .symbol[aria-label="기호 ①"]'));
  await page.click('.panel-body .phrase.add');
  await submitText('위와 같이 보고합니다.');
  await page.click('.panel-body .phrase:has-text("위와 같이 보고합니다.")');
  assert.equal(await paraText(), '①위와 같이 보고합니다.');
});

await step('쪽 탭: 꼬리말에 쪽 번호를 넣는다', async () => {
  await page.click('.panel-tab:has-text("쪽")');
  await page.click('.panel-body .chip-btn[aria-label="쪽 번호 - 1 -"]');
  const svg = await editor((ed) => ed.doc.raw.renderPageSvg(0));
  assert.match(svg, />1<\/text>/);
  assert.match(svg, />-<\/text>/);
});

await step('서식 채우기: 누름틀을 차례로 채우고, 다시 열면 채우기를 권한다', async () => {
  await editor((ed) => {
    const raw = ed.doc.raw;
    raw.splitParagraph(0, 0, raw.getParagraphLength(0, 0));
    raw.insertText(0, 1, 0, '성명:   연락처: ');
    raw.insertClickHereField(0, 1, 11, '전화번호', '', 'phone', true);
    raw.insertClickHereField(0, 1, 4, '이름을 쓰세요', '', 'name', true);
    ed.rerender();
  });
  await page.click('.panel-tab:has-text("입력")');
  await page.click('.tile[aria-label="서식 채우기"]');
  await page.waitForSelector('.form-fill:not([hidden])');
  assert.equal(await page.textContent('.ff-label'), '이름을 쓰세요');
  assert.equal(await page.textContent('.ff-count'), '1 / 2');
  await page.fill('.ff-input', '홍길동');
  await page.press('.ff-input', 'Enter');
  assert.equal(await page.textContent('.ff-label'), '전화번호');
  await page.fill('.ff-input', '010-1234-5678');
  await page.press('.ff-input', 'Enter');
  await page.waitForSelector('.form-fill', { state: 'hidden' });
  const values = await editor((ed) => JSON.parse(ed.doc.raw.getFieldList()).map((f) => f.value));
  assert.deepEqual(values, ['홍길동', '010-1234-5678']);
  // 실행 취소로 마지막 빈칸을 되돌릴 수 있다.
  await page.click('[aria-label="실행 취소"]');
  assert.deepEqual(await editor((ed) => JSON.parse(ed.doc.raw.getFieldList()).map((f) => f.value)), ['홍길동', '']);
  await page.click('.done-btn');
  await page.click('[aria-label="문서 닫기"]');
  await page.waitForSelector('.home:not([hidden])');
  await page.click('.recent-open');
  await page.waitForSelector('.fill-chip:not([hidden])');
  assert.match(await page.textContent('.fill-chip'), /빈칸 2개/);
  await page.click('.fill-chip');
  await page.waitForSelector('.form-fill:not([hidden])');
  assert.equal(await page.inputValue('.ff-input'), '홍길동');
  await page.click('.ff-done');
});

await step('표 탭: 여러 칸을 골라 한 번에 합친다', async () => {
  await page.click('.qb[aria-label="입력 도구"]');
  await page.click('.tile[aria-label="표"]');
  await page.click('.sheet .primary-btn:has-text("표 넣기")');
  await page.waitForTimeout(200);
  // 표의 첫 칸으로 캐럿을 옮긴다.
  await editor((ed) => {
    const layout = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    const pos = { sec: 0, para: layout.paraIdx, offset: 0, cellPath: [{ controlIndex: layout.controlIdx, cellIndex: 0, cellParaIndex: 0 }] };
    ed.select(pos, pos);
  });
  await page.click('.qb[aria-label="표 도구"]');
  await page.click('.panel-body [aria-label="오른쪽으로 늘리기"]');
  await page.click('.panel-body [aria-label="오른쪽으로 늘리기"]');
  assert.equal(await page.$$eval('.range-rect', (els) => els.length), 3);
  await page.click('.tile[aria-label="고른 칸 합치기"]');
  const span = await editor((ed) => {
    const layout = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    return JSON.parse(ed.doc.raw.getCellInfo(0, layout.paraIdx, layout.controlIdx, 0)).colSpan;
  });
  assert.equal(span, 3);
  assert.equal(await page.$$eval('.range-rect', (els) => els.length), 0);
});

await step('서명을 손가락으로 그려 넣고, 저장한 서명을 다시 쓴다', async () => {
  // 표 칸 밖, 첫 문단 끝에 넣는다.
  await editor((ed) => {
    const end = { sec: 0, para: 0, offset: ed.doc.raw.getParagraphLength(0, 0) };
    ed.select(end, end);
  });
  const pictures = () => editor((ed) => JSON.stringify(JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.map((c) => c.type)));
  const before = await pictures();
  await openTab('입력');
  await page.click('.tile[aria-label="서명·도장"]');
  await page.waitForSelector('.sheet.open .sign-canvas');
  await page.waitForTimeout(400); // 시트가 다 올라온 뒤 그린다
  const box = await page.locator('.sheet.open .sign-canvas').boundingBox();
  const pts = [0.2, 0.35, 0.5, 0.65, 0.8].map((t, i) => ({ x: box.x + box.width * t, y: box.y + box.height * (i % 2 ? 0.35 : 0.6) }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
  for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await page.$eval('.sheet.open .sign-hint', (e) => e.hidden), '서명이 그려져야 함');
  await page.click('.sheet.open .primary-btn:has-text("넣기")');
  await page.waitForFunction((b) => {
    const ed = window.__pocket.docScreen().editor;
    return JSON.stringify(JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.map((c) => c.type)) !== b;
  }, before);
  const after = JSON.parse(await pictures());
  assert.equal(after.length, JSON.parse(before).length + 1);
  await openTab('입력');
  await page.click('.tile[aria-label="서명·도장"]');
  await page.waitForSelector('.sheet.open .saved-sign-btn');
  await page.click('.sheet.open .saved-sign-btn');
  await page.waitForFunction((n) => {
    const ed = window.__pocket.docScreen().editor;
    return JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.length === n;
  }, after.length + 1);
});

await step('버전 기록: 다른 버전으로 되돌리고, 사용법을 다시 본다', async () => {
  await goHome();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=문서 열기')]);
  await chooser.setFiles({ name: '버전 시험.hwp', mimeType: 'application/x-hwp', buffer: exported });
  await page.waitForSelector('.doc .page canvas');
  await page.click('[aria-label="편집하기"]');
  await page.keyboard.type('지울 글 ');
  await page.click('.done-btn');
  assert.match(await editor((ed) => ed.doc.raw.getTextRange(0, 0, 0, 40)), /지울 글/);
  await page.click('[aria-label="더보기"]');
  await page.click('.sheet-row:has-text("버전 기록")');
  await page.click('.sheet.open .version-row:has-text("처음 연 상태")');
  await page.click('.sheet.open .sheet-row:has-text("이 버전으로 되돌리기")');
  await page.click('.sheet.open .primary-btn:has-text("되돌리기")');
  await page.waitForFunction(() => {
    const t = window.__pocket.docScreen()?.session.doc.raw.getTextRange(0, 0, 0, 40);
    return t === 'Pocket 한국';
  });
  // 되돌리기 전 내용은 버전 기록에 남는다.
  await page.click('[aria-label="더보기"]');
  await page.click('.sheet-row:has-text("버전 기록")');
  await page.waitForSelector('.sheet.open .version-row:has-text("되돌리기 전 내용")');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
  await page.click('[aria-label="더보기"]');
  await page.click('.sheet-row:has-text("사용법")');
  await page.waitForSelector('.sheet.open .tip');
  assert.ok((await page.$$('.sheet.open .tip')).length >= 4);
  await page.click('.sheet.open .primary-btn:has-text("알겠어요")');
});

await step('원래 파일에 저장: 연 파일 자리에 고친 내용을 덮어쓴다', async () => {
  await goHome();
  // 크롬의 파일 선택 API 대신 OPFS(브라우저 안 파일) 핸들을 돌려준다. 진짜 파일 핸들이라 저장·쓰기가 그대로 동작한다.
  // (이 환경의 OPFS는 한글 파일 이름을 받지 않아 영문 이름을 쓴다.)
  await page.evaluate(async (b64) => {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle('original.hwp', { create: true });
    const w = await handle.createWritable();
    await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    await w.close();
    window.showOpenFilePicker = async () => [handle];
  }, exported.toString('base64'));
  await page.click('text=문서 열기');
  await page.waitForSelector('.doc .page canvas');
  await page.click('[aria-label="편집하기"]');
  await page.keyboard.type('덮어쓴 ');
  await page.click('[aria-label="원래 파일(original.hwp)에 저장"]');
  await page.waitForSelector('.toast-host:has-text("원래 파일")');
  const text = await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    const file = await (await dir.getFileHandle('original.hwp')).getFile();
    const Ctor = window.__pocket.docScreen().session.doc.raw.constructor;
    const doc = new Ctor(new Uint8Array(await file.arrayBuffer()));
    const t = doc.getTextRange(0, 0, 0, 40);
    doc.free();
    return t;
  });
  assert.equal(text, '덮어쓴 Pocket 한국');
  await page.click('.done-btn');
});

await step('홈: 고정·사본 만들기·이름으로 찾기', async () => {
  await goHome();
  const names = await page.$$eval('.recent-name', (els) => els.map((e) => e.textContent));
  const last = names[names.length - 1];
  await page.click(`.recent-item:last-child .icon-btn[aria-label$="더보기"]`);
  await page.click('.sheet.open .sheet-row:has-text("맨 위에 고정")');
  await page.waitForFunction((n) => document.querySelector('.recent-item .recent-name')?.textContent === n, last);
  assert.ok(await page.$('.recent-item:first-child .pin-mark'));
  await page.click('.recent-item:first-child .icon-btn[aria-label$="더보기"]');
  await page.click('.sheet.open .sheet-row:has-text("사본 만들기")');
  await page.waitForSelector('.recent-name:has-text("(사본)")');
  assert.ok(await page.isVisible('.home-search'), '문서가 많으면 찾기 칸이 보인다');
  await page.fill('.home-search', '(사본)');
  assert.equal(await page.$$eval('.recent-item', (els) => els.length), 1);
  await page.fill('.home-search', '');
});

await step('읽기 모드에 읽어 주기 버튼이 있다', async () => {
  await page.click('.recent-open');
  await page.waitForSelector('.doc .page canvas');
  await page.click('[aria-label="읽기 모드"]');
  await page.waitForSelector('.speak-bar:not([hidden]) .speak-play');
  assert.match(await page.textContent('.speak-rate'), /배/);
  await page.click('.speak-rate');
  assert.equal(await page.textContent('.speak-rate'), '1.25배');
  await page.click('[aria-label="읽기 모드 닫기"]');
});

/** 쪽 좌표(px) → 화면 좌표 */
const pageToClient = async (page0, x, y) => {
  const box = await page.locator('.page').nth(page0).boundingBox();
  const zoom = await editor((ed) => ed.view.zoom);
  return { x: box.x + x * zoom, y: box.y + y * zoom };
};
const firstTable = () =>
  editor((ed) => {
    const t = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    return t && { para: t.paraIdx, ctrl: t.controlIdx, rows: t.rowCount };
  });
const caretToCell = (cell) =>
  editor((ed, i) => {
    const t = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    const pos = { sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: i, cellParaIndex: 0 }] };
    ed.select(pos, pos);
  }, cell);

await step('표 탭: 칸 너비·테두리·계산식·표 나누기', async () => {
  await newDoc();
  await page.keyboard.type('표 시험');
  await page.click('.qb[aria-label="입력 도구"]');
  await page.click('.tile[aria-label="표"]');
  await page.click('.sheet .primary-btn:has-text("표 넣기")');
  await page.waitForTimeout(200);
  // 3×3 표의 둘째 칸(B열)에 숫자를 넣는다.
  await editor((ed) => {
    const t = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    const at = (i) => ({ sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: i, cellParaIndex: 0 }] });
    ed.doc.insertText(at(1), '1,200');
    ed.doc.insertText(at(4), '300');
    ed.rerender();
  });
  await caretToCell(7);
  await page.click('.qb[aria-label="표 도구"]');
  await page.click('.tile[aria-label="위 칸 합계"]');
  const sum = await editor((ed) => ed.doc.paraText(ed.caret));
  assert.equal(sum, '1500');
  const widthBefore = await editor((ed) => {
    const t = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    return JSON.parse(ed.doc.raw.getTableCellBboxes(0, t.paraIdx, t.controlIdx))[7].w;
  });
  await page.click('.panel-body [aria-label="칸 너비 늘리기"]');
  const widthAfter = await editor((ed) => {
    const t = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    return JSON.parse(ed.doc.raw.getTableCellBboxes(0, t.paraIdx, t.controlIdx))[7].w;
  });
  assert.ok(widthAfter > widthBefore + 5, `${widthBefore} → ${widthAfter}`); // 2mm ≈ 7.6px
  await page.click('.panel-body .chip-btn:has-text("굵은 실선")');
  const bottom = await editor((ed) => {
    const t = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    return JSON.parse(ed.doc.raw.getCellProperties(0, t.paraIdx, t.controlIdx, 7)).borderBottom.width;
  });
  assert.equal(bottom, 7);
  await page.click('.tile[aria-label="여기서 표 나누기"]');
  const rows = await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.filter((c) => c.type === 'table').map((c) => c.rowCount));
  assert.deepEqual(rows, [2, 1]);
});

await step('머리말을 여러 줄로 고치고, 문서의 머리말을 눌러도 고칠 수 있다', async () => {
  await openTab('쪽');
  await page.click('.panel-body .seg:has-text("머리말 고치기")');
  await page.fill('.sheet.open textarea.text-field', '○○기관\n문서번호 2026-17');
  await page.click('.sheet.open .chip-btn:has-text("오른쪽")');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
  const lines = await editor((ed) => [0, 1].map((i) => JSON.parse(ed.doc.raw.getHeaderFooterParaInfo(0, true, 0, i)).text));
  assert.deepEqual(lines, ['○○기관', '문서번호 2026-17']);
  // 머리말 자리를 찾아 누른다.
  const spot = await editor((ed) => {
    for (let y = 0; y < 200; y += 4) if (JSON.parse(ed.doc.raw.hitTestHeaderFooter(0, 400, y)).hit) return { x: 400, y };
    return null;
  });
  assert.ok(spot, '머리말 자리');
  await page.click('.qb.qb-kb');
  const at = await pageToClient(0, spot.x, spot.y);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForSelector('.sheet.open textarea.text-field');
  assert.equal(await page.inputValue('.sheet.open textarea.text-field'), '○○기관\n문서번호 2026-17');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
});

await step('각주를 눌러 내용을 고친다', async () => {
  await editor((ed) => {
    const p = { sec: 0, para: 0, offset: 2 };
    ed.select(p, p);
  });
  await openTab('입력');
  await page.click('.tile[aria-label="각주"]');
  await submitText('처음 각주');
  const spot = await editor((ed) => {
    for (let y = 100; y < 300; y += 2) for (let x = 100; x < 500; x += 3) {
      const r = JSON.parse(ed.doc.raw.hitTestBodyFootnoteMarker(0, x, y));
      if (r.hit) return { x: r.bbox.x + r.bbox.w / 2, y: r.bbox.y + r.bbox.h / 2 };
    }
    return null;
  });
  assert.ok(spot, '각주 번호 자리');
  await page.click('.qb.qb-kb');
  const at = await pageToClient(0, spot.x, spot.y);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForSelector('.sheet.open textarea.text-field');
  assert.equal(await page.inputValue('.sheet.open textarea.text-field'), '처음 각주');
  await page.fill('.sheet.open textarea.text-field', '고친 각주\n둘째 줄');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
  const texts = await editor((ed) => {
    const fn = JSON.parse(ed.doc.raw.getPageFootnoteInfo(0, 0));
    return JSON.parse(ed.doc.raw.getFootnoteInfo(0, fn.paraIdx, fn.controlIdx)).texts.map((t) => t.trimEnd());
  });
  assert.deepEqual(texts, ['고친 각주', '둘째 줄']);
});

await step('도형을 넣고 채우기 색·순서를 바꾼다', async () => {
  await editor((ed) => {
    const p = { sec: 0, para: 0, offset: ed.doc.raw.getParagraphLength(0, 0) };
    ed.select(p, p);
  });
  await openTab('입력');
  await page.click('.tile[aria-label="사각형"]');
  const shape = await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'shape'));
  assert.ok(shape, '도형이 들어가야 함');
  await page.click('.qb.qb-kb');
  const at = await pageToClient(0, shape.x + 2, shape.y + shape.h / 2);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForSelector('.selection-menu:not([hidden]) button:has-text("모양")');
  await page.click('.selection-menu button:has-text("모양")');
  await page.click('.sheet.open .swatch[aria-label="#fef7e0"]');
  const fill = await editor((ed, s) => JSON.parse(ed.doc.raw.getShapeProperties(0, s.paraIdx, s.controlIdx)).fillBgColor, shape);
  assert.equal(fill, 0xe0f7fe);
});

await step('쪽 테두리·배경, 번호 새로 시작, 새 스타일', async () => {
  await editor((ed) => {
    const p = { sec: 0, para: 0, offset: 0 };
    ed.select(p, p);
  });
  await openTab('쪽');
  await page.click('.panel-body .chip-btn:has-text("굵은 선")');
  await page.click('.panel-body .swatch[aria-label="#fff8e1"]');
  const pb = await editor((ed) => JSON.parse(ed.doc.raw.getPageBorderFill(0)));
  assert.equal(pb.borderLeft.width, 7);
  assert.equal(pb.fillColor, '#fff8e1');
  await page.click('.panel-tab:has-text("문단")');
  await page.click('.panel-body .chip-btn:has-text("1. 가.")').catch(async () => page.click('.panel-body .panel-section:has-text("문단 번호") .chip-btn >> nth=0'));
  await page.click('.panel-body .seg:has-text("번호 새로 시작")');
  await submitText('4');
  assert.match(await editor((ed) => ed.doc.raw.renderPageSvg(0)), />4<\/text>/);
  await page.click('.panel-tab:has-text("스타일")');
  await page.click('.panel-body .seg:has-text("새 스타일")');
  await submitText('보고서 제목');
  await page.waitForSelector('.panel-body .style-btn:has-text("보고서 제목")');
  assert.equal(await page.getAttribute('.panel-body .style-btn:has-text("보고서 제목")', 'aria-pressed'), 'true');
});

await step('서식 있는 붙여넣기', async () => {
  await page.click('.qb.qb-kb');
  await editor((ed) => {
    const p = { sec: 0, para: 0, offset: 0 };
    ed.select(p, p);
  });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '굵은 글 ');
    dt.setData('text/html', '<b>굵은 글</b> ');
    document.querySelector('.ime-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const r = await editor((ed) => ({ text: ed.doc.raw.getTextRange(0, 0, 0, 4), bold: ed.doc.charProps({ sec: 0, para: 0, offset: 1 }).bold }));
  assert.equal(r.text, '굵은 글');
  assert.equal(r.bold, true);
});

await step('링크를 누르면 열기·고치기, 책갈피 목록으로 이동, 목차', async () => {
  await newDoc();
  await page.keyboard.type('홈페이지 바로가기');
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 0 }, { sec: 0, para: 0, offset: 2 }));
  await openTab('입력');
  await page.click('.tile[aria-label="링크"]');
  await submitText('https://example.com/a');
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 1 }, { sec: 0, para: 0, offset: 1 }));
  await page.click('.tile[aria-label="링크"]');
  await page.waitForSelector('.sheet.open .link-uri:has-text("https://example.com/a")');
  await page.click('.sheet.open .sheet-row:has-text("주소 고치기")');
  await submitText('https://example.com/b');
  assert.equal(await editor((ed) => ed.linkAtCaret()?.link.uri), 'https://example.com/b');
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 5 }, { sec: 0, para: 0, offset: 5 }));
  await page.click('.tile[aria-label="책갈피"]');
  await page.click('.sheet.open .sheet-row:has-text("지금 자리에 책갈피 넣기")');
  await submitText('여기');
  await page.click('.tile[aria-label="책갈피"]');
  await page.waitForSelector('.sheet.open .bookmark-row:has-text("여기")');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
  // 목차: 첫 문단을 개요 1로 만들고 목차에서 고른다.
  await page.click('.panel-tab:has-text("스타일")');
  await page.click('.panel-body .style-btn:has-text("개요 1")');
  await page.click('.done-btn');
  await page.click('[aria-label="더보기"]');
  await page.click('.sheet.open .sheet-row:has-text("목차")');
  await page.waitForSelector('.sheet.open .outline-row');
  await page.click('.sheet.open .outline-row >> nth=0');
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
  // 보기 모드에서 링크를 누르면 링크 시트가 뜬다.
  const linkAt = await editor((ed) => ed.doc.caretRect({ sec: 0, para: 0, offset: 1 }));
  const at = await pageToClient(linkAt.pageIndex, linkAt.x + 3, linkAt.y + linkAt.height / 2);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForSelector('.sheet.open .sheet-row:has-text("링크 열기")');
  assert.equal(await page.$('.sheet.open .sheet-row:has-text("주소 고치기")'), null, '보기 모드에서는 열기만');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
});

await step('인쇄: 쪽 그림을 깔고 인쇄 창을 연다', async () => {
  if (await page.isVisible('.done-btn')) await page.click('.done-btn');
  await page.evaluate(() => {
    window.__printed = -1;
    window.print = () => {
      window.__printed = document.querySelectorAll('.print-root img').length;
    };
  });
  await page.click('[aria-label="보내기"]');
  await page.click('.sheet.open .sheet-row:has-text("인쇄")');
  await page.waitForFunction(() => window.__printed >= 0);
  assert.equal(await page.evaluate(() => window.__printed), await editor((ed) => ed.doc.pageCount()));
});

await step('차트: 값을 표로 보여 주고, 엔진이 못 바꾸면 이유를 알린다', async () => {
  // 엔진으로 빈 HWPX를 만든 뒤 차트(OOXML)를 끼워 넣은 시험 문서
  const b64 = await page.evaluate(async () => {
    const { buildZip, readZip } = await import('/src/export/zip.ts');
    const raw = window.__pocket.docScreen().session.doc.raw;
    const Ctor = raw.constructor;
    const blank = Ctor.createEmpty();
    blank.createBlankDocument();
    blank.insertText(0, 0, 0, '차트');
    const files = await readZip(blank.exportHwpx());
    blank.free();
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const chart = '<hp:run charPrIDRef="0"><hp:chart id="1977" zOrder="1" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" chartIDRef="Chart/chart1.xml"><hp:sz width="30000" widthRelTo="ABSOLUTE" height="20000" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:chart></hp:run>';
    const xml = '<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>매출</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1월</c:v></c:pt><c:pt idx="1"><c:v>2월</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>';
    const out = files.map((f) => {
      if (f.name === 'Contents/section0.xml') return { name: f.name, bytes: enc.encode(dec.decode(f.bytes).replace('<hp:t>차트</hp:t></hp:run>', `<hp:t>차트</hp:t></hp:run>${chart}`)) };
      if (f.name === 'Contents/content.hpf') return { name: f.name, bytes: enc.encode(dec.decode(f.bytes).replace('<opf:item id="settings"', '<opf:item id="chart1" href="Chart/chart1.xml" media-type="application/xml"/><opf:item id="settings"')) };
      return f;
    });
    out.push({ name: 'Chart/chart1.xml', bytes: enc.encode(xml) });
    const zip = buildZip(out);
    let s = '';
    for (const b of zip) s += String.fromCharCode(b);
    return btoa(s);
  });
  await goHome();
  // 앞 단계에서 넣은 가짜 파일 선택 API를 치우고 보통 파일 선택 창을 쓴다.
  await page.evaluate(() => delete window.showOpenFilePicker);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=문서 열기')]);
  await chooser.setFiles({ name: '차트.hwpx', mimeType: 'application/hwp+zip', buffer: Buffer.from(b64, 'base64') });
  await page.waitForSelector('.doc .page canvas');
  await page.click('[aria-label="편집하기"]');
  const chart = await editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'ole'));
  assert.ok(chart, '차트 개체');
  await page.click('.qb.qb-kb');
  const at = await pageToClient(0, chart.x + chart.w / 2, chart.y + chart.h / 2);
  await page.touchscreen.tap(at.x, at.y);
  await page.click('.selection-menu button:has-text("차트 값 고치기")');
  await page.waitForSelector('.sheet.open .chart-table');
  const values = await page.$$eval('.sheet.open .chart-table td input', (els) => els.map((e) => e.value));
  assert.deepEqual(values, ['10', '20']);
  await page.fill('.sheet.open .chart-table td input >> nth=0', '15');
  await page.click('.sheet.open .primary-btn:has-text("저장")');
  // 시험 문서에는 HWP용 차트 사본이 없어 엔진이 쓰기를 거절한다 → 이유를 알리고 시트는 남는다.
  await page.waitForSelector('.toast-host:has-text("차트를 바꾸지 못했어요")');
  assert.ok(await page.$('.sheet.open .chart-table'));
  await page.goBack();
});

await step('메모: 고른 글에 넣고, 쪽에 표시하고, 읽고·고치고·지운다', async () => {
  await newDoc();
  await page.keyboard.type('회의 자료 초안입니다');
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 0 }, { sec: 0, para: 0, offset: 5 }));
  await openTab('입력');
  await page.click('.tile[aria-label="메모"]');
  await page.waitForSelector('.sheet.open .dialog-message:has-text("“회의 자료”에 메모를 달아요")');
  await page.fill('.sheet.open textarea.text-field', '숫자 다시 확인\n금요일까지');
  await page.fill('.sheet.open input.text-field', '홍길동');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForSelector('.toast-host:has-text("메모를 넣었어요")');
  await page.waitForSelector('.memo-mark');
  assert.equal(await editor((ed) => ed.doc.paraText({ sec: 0, para: 0, offset: 0 })), '회의 자료 초안입니다', '본문은 그대로');
  // 메모가 지워지지 않게 HWPX로 저장한다.
  await page.waitForFunction(() => document.querySelector('.app-title')?.textContent?.endsWith('.hwpx'));

  // 캐럿이 메모 위에 있으면 그 메모를 고친다.
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 2 }, { sec: 0, para: 0, offset: 2 }));
  await page.click('.tile[aria-label="메모"]');
  await page.waitForSelector('.sheet.open .dialog-message:has-text("홍길동")');
  assert.equal(await page.inputValue('.sheet.open textarea.text-field'), '숫자 다시 확인\n금요일까지');
  await page.fill('.sheet.open textarea.text-field', '고친 메모');
  await page.click('.sheet.open .dialog-form button[type="submit"]');
  await page.waitForSelector('.toast-host:has-text("메모를 고쳤어요")');

  // 보기 모드: 메모 단 글을 누르면 메모를 읽는다.
  await page.click('.done-btn');
  await page.waitForTimeout(400); // 보기 배율로 돌아가는 동안 표시가 다시 그려진다.
  const mark = await page.evaluate(() => {
    const r = document.querySelector('.memo-mark').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.touchscreen.tap(mark.x + mark.width / 2, mark.y + mark.height / 2);
  await page.waitForSelector('.sheet.open .memo-body:has-text("고친 메모")');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
  await page.click('[aria-label="더보기"]');
  await page.click('.sheet.open .sheet-row:has-text("메모")');
  await page.waitForSelector('.sheet.open .memo-card:has-text("고친 메모"):has-text("회의 자료")');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));

  // 지우면 글은 남고 표시는 사라진다.
  await page.click('[aria-label="편집하기"]');
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 1 }, { sec: 0, para: 0, offset: 1 }));
  await openTab('입력');
  await page.click('.tile[aria-label="메모"]');
  await page.click('.sheet.open .secondary-btn.danger:has-text("메모 지우기")');
  await page.click('.sheet.open .primary-btn:has-text("지우기")');
  await page.waitForSelector('.toast-host:has-text("메모를 지웠어요")');
  await page.waitForFunction(() => !document.querySelector('.memo-mark'));
  assert.equal(await editor((ed) => ed.doc.paraText({ sec: 0, para: 0, offset: 0 })), '회의 자료 초안입니다');
});

await step('편집 용지(F7): 크기·방향·제본·여백 일곱 가지를 mm로 바꾸고 잘못된 값은 막는다', async () => {
  await newDoc();
  await page.keyboard.type('편집 용지 시험');
  await openTab('쪽');
  await page.click('.panel-body .seg:has-text("여백·크기 자세히")');
  await page.waitForSelector('.sheet.open .mm-grid');
  assert.equal(await page.getAttribute('.sheet.open .chip-btn:has-text("A4")', 'aria-pressed'), 'true');
  await page.click('.sheet.open .chip-btn:has-text("B5")');
  assert.equal(await page.inputValue('.sheet.open input[aria-label="폭 (mm)"]'), '182');
  await page.click('.sheet.open .chip-btn:has-text("가로")');
  await page.click('.sheet.open .chip-btn:has-text("맞쪽")');
  const fill = async (label, value) => page.fill(`.sheet.open input[aria-label="${label} (mm)"]`, value);
  await fill('위쪽', '12');
  await fill('머리말', '8');
  await fill('왼쪽', '22.5');
  await fill('제본', '10');
  await fill('아래쪽', '14');
  await fill('꼬리말', '9');
  await fill('오른쪽', '18');
  await page.waitForSelector('.sheet.open .page-summary:has-text("글 쓰는 자리")');
  // 여백이 너무 크면 적용할 수 없다.
  await fill('왼쪽', '300');
  await page.waitForSelector('.sheet.open .page-summary.error');
  assert.equal(await page.isDisabled('.sheet.open .primary-btn:has-text("적용")'), true);
  await fill('왼쪽', '22.5');
  await page.click('.sheet.open .primary-btn:has-text("적용")');
  await page.waitForSelector('.toast-host:has-text("편집 용지를 바꿨어요")');
  const def = await editor((ed) => JSON.parse(ed.doc.raw.getPageDef(0)));
  const mmOf = (v) => Math.round((v / 283.465) * 10) / 10;
  assert.deepEqual(
    [def.width, def.height, def.marginTop, def.marginHeader, def.marginLeft, def.marginGutter, def.marginBottom, def.marginFooter, def.marginRight].map(mmOf),
    [182, 257, 12, 8, 22.5, 10, 14, 9, 18],
  );
  assert.equal(def.landscape, true);
  assert.equal(def.binding, 1);
  // 실행 취소로 되돌린다.
  await page.click('[aria-label="실행 취소"]');
  assert.equal(await editor((ed) => JSON.parse(ed.doc.raw.getPageDef(0)).landscape), false);
  // 하드웨어 키보드의 F7로도 연다.
  await page.click('.qb.qb-kb');
  await page.keyboard.press('F7');
  await page.waitForSelector('.sheet.open .mm-grid');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
});

await step('단축키: 한글 입력 상태의 Ctrl+B, 정렬, 낱말 이동, 복사·잘라내기, 도구 패널을 연 채로도', async () => {
  await newDoc();
  await page.keyboard.type('보고서 초안 입니다');
  // 한글 입력 상태에서는 e.key 가 자모로 온다. 조합 중에 눌러도 처리한다.
  const press = (key, code, mods = {}) =>
    page.evaluate(
      ([key, code, mods]) => {
        const ta = document.activeElement?.tagName === 'TEXTAREA' ? document.activeElement : document.body;
        const e = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...mods });
        ta.dispatchEvent(e);
        return e.defaultPrevented;
      },
      [key, code, mods],
    );
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  assert.equal(await press('ㅠ', 'KeyB', { ctrlKey: true }), true);
  assert.equal(await editor((ed) => ed.doc.charProps({ sec: 0, para: 0, offset: 1 }).bold), true);
  await press('Process', 'KeyC', { ctrlKey: true, shiftKey: true });
  assert.equal(await editor((ed) => ed.doc.paraProps({ sec: 0, para: 0, offset: 0 }).alignment), 'center');
  // 자간(Alt+Shift+W/N)·장평(K/J) 1%씩, 줄 간격(A/Z) 10%씩
  for (const code of ['KeyW', 'KeyW', 'KeyN', 'KeyW', 'KeyK', 'KeyJ', 'KeyJ', 'KeyA', 'KeyA', 'KeyZ'])
    await press('ㅈ', code, { altKey: true, shiftKey: true });
  const props = await editor((ed) => ({ c: ed.doc.charProps({ sec: 0, para: 0, offset: 1 }), p: ed.doc.paraProps({ sec: 0, para: 0, offset: 0 }) }));
  assert.equal(props.c.spacings[0], 2);
  assert.equal(props.c.ratios[0], 99);
  assert.equal(props.p.lineSpacing, 170);
  // Ctrl+→ 는 낱말 단위로 옮긴다.
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+ArrowRight');
  assert.equal(await editor((ed) => ed.caret.offset), 4);
  // 복사·잘라내기는 문서에서 고른 글(모양 포함)을 클립보드에 넣는다.
  await page.keyboard.press('Shift+Control+ArrowRight');
  const clip = (type) =>
    page.evaluate((type) => {
      const dt = new DataTransfer();
      document.activeElement.dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
      return { text: dt.getData('text/plain'), html: dt.getData('text/html') };
    }, type);
  const copied = await clip('copy');
  assert.equal(copied.text, '초안 ');
  assert.ok(copied.html.includes('font-weight:bold'), copied.html);
  await clip('cut');
  assert.equal(await paraText(), '보고서 입니다');
  // Alt+L 로 글자 도구를 열면 키보드(숨은 입력란)가 내려가도 단축키가 된다.
  await press('ㅣ', 'KeyL', { altKey: true });
  await page.waitForSelector('.tool-panel.open');
  assert.equal(await press('ㅋ', 'KeyZ', { ctrlKey: true }), true);
  assert.equal(await paraText(), '보고서 초안 입니다');
  // 한 글자를 조합하던 중에 누른 단축키: 조합한 글자는 한 번만 들어가고 단축키도 된다.
  await page.click('.qb.qb-kb');
  await page.keyboard.press('End');
  const boldBefore = await editor((ed) => !!ed.currentChar().bold);
  await cdp.send('Input.imeSetComposition', { text: '끝', selectionStart: 1, selectionEnd: 1 });
  await page.evaluate(() =>
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyB', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })),
  );
  await page.waitForTimeout(200);
  assert.equal(await paraText(), '보고서 초안 입니다끝');
  assert.equal(await editor((ed) => !!ed.currentChar().bold), !boldBefore);
  await page.keyboard.press('Backspace');
  // Ctrl+Enter 쪽 나누기, F1 단축키 목록
  await page.keyboard.press('End');
  const pages = await editor((ed) => ed.doc.pageCount());
  await page.keyboard.press('Control+Enter');
  assert.equal(await editor((ed) => ed.doc.pageCount()), pages + 1);
  await page.keyboard.press('F1');
  await page.waitForSelector('.sheet.open .shortcut-row:has-text("가운데 정렬")');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.open'));
});

await step('표 전체 고르기: 테두리를 눌러 고르고, 복사·붙여넣기·지우기', async () => {
  await newDoc();
  await page.keyboard.type('표 앞 글');
  await editor((ed) => ed.insertTable(2, 2));
  await page.keyboard.type('칸 글');
  const tables = () => editor((ed) => JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.filter((c) => c.type === 'table').length);
  // 칸 안을 누르면 글을 고치고, 바깥 테두리를 누르면 표 전체를 고른다.
  // 화면이 움직일 수 있으므로 누르기 직전에 잰다.
  const measure = () => page.evaluate(() => {
    const ed = window.__pocket.docScreen().editor;
    const t = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
    const r = ed.view.slots[0].el.getBoundingClientRect();
    const z = ed.view.zoom;
    return { x: r.x + (t.x + t.w / 2) * z, y: r.y + (t.y - 2) * z, inX: r.x + (t.x + 20) * z, inY: r.y + (t.y + t.h / 2) * z };
  });
  const borderAt = async () => {
    for (let prev = null; ; await page.waitForTimeout(150)) {
      const now = await measure();
      if (prev && Math.abs(prev.y - now.y) < 0.5) return now;
      prev = now;
    }
  };
  let border = await borderAt();
  await page.touchscreen.tap(border.inX, border.inY);
  assert.equal(await editor((ed) => ed.selectedObject), null);
  await page.waitForTimeout(500); // 두 번 탭으로 읽히지 않게
  border = await borderAt();
  await page.touchscreen.tap(border.x, border.y);
  await page.waitForFunction(() => window.__pocket.docScreen().editor.selectedObject?.kind === 'table');
  await page.waitForSelector('.selection-menu:not([hidden]) button:has-text("표 도구")');
  const clip = (type, text) =>
    page.evaluate(
      ([type, text]) => {
        const dt = new DataTransfer();
        if (text) dt.setData('text/plain', text);
        (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
        return dt.getData('text/plain');
      },
      [type, text],
    );
  const marker = await clip('copy');
  assert.equal(marker, '[표]');
  // 본문 끝에 붙이면 표가 하나 더 생긴다.
  await editor((ed) => ed.goTo({ sec: 0, para: ed.doc.paraCount({ sec: 0, para: 0, offset: 0 }) - 1, offset: 0 }));
  await clip('paste', marker);
  assert.equal(await tables(), 2);
  // 고른 표는 Delete 로 지우고, 실행 취소로 되살린다.
  await page.waitForTimeout(500);
  border = await borderAt();
  await page.touchscreen.tap(border.x, border.y);
  await page.waitForFunction(() => window.__pocket.docScreen().editor.selectedObject?.kind === 'table');
  await page.keyboard.press('Delete');
  assert.equal(await tables(), 1);
  assert.equal(await editor((ed) => !!ed.caret?.cellPath?.length), false);
  await page.click('[aria-label="실행 취소"]');
  assert.equal(await tables(), 2);
  // 표 탭의 '표 고르기'
  await editor((ed) => ed.goTo({ sec: 0, para: 1, offset: 0, cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }] }));
  await openTab('표');
  await page.click('.panel-body .tile[aria-label="표 고르기"]');
  assert.equal(await editor((ed) => ed.selectedObject?.kind), 'table');
  await page.keyboard.press('Escape');
  assert.equal(await editor((ed) => ed.selectedObject), null);
});

await step('손잡이를 화면 아래 끝까지 끌면 문서가 따라 내려가며 범위가 넓어진다', async () => {
  await newDoc();
  await editor((ed) => ed.insertText(Array.from({ length: 80 }, (_, i) => `긴 문단 ${i} 가나다라마바사아자차카타파하`).join('\n')));
  await editor((ed) => ed.goTo({ sec: 0, para: 0, offset: 0 }));
  await editor((ed) => ed.select({ sec: 0, para: 0, offset: 0 }, { sec: 0, para: 0, offset: 2 }));
  await page.waitForTimeout(200);
  const hb = await page.evaluate(() => {
    const r = document.querySelector('.sel-handle-end').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const vh = page.viewportSize().height;
  await touch('touchStart', hb.x, hb.y);
  for (let y = hb.y; y < vh - 20; y += 30) await touch('touchMove', hb.x, y);
  await page.waitForTimeout(800);
  await touch('touchEnd', 0, 0);
  const s = await editor((ed) => ({ para: ed.caret.para, anchor: ed.anchor?.para, rects: document.querySelectorAll('.sel-rect').length }));
  assert.equal(s.anchor, 0);
  assert.ok(s.para > 25, JSON.stringify(s));
  assert.ok(s.rects > 25, JSON.stringify(s));
});

await step('글자 수: 고른 글은 상태 줄에, 보기 탭에 바이트·원고지·목표 글자 수', async () => {
  await newDoc();
  await page.keyboard.type('자기소개서 첫 문장입니다');
  await page.keyboard.press('Shift+Home');
  await page.waitForFunction(() => document.querySelector('.app-status')?.textContent === '고른 글 13자 · 공백 빼고 11자');
  await page.keyboard.press('End');
  await page.waitForFunction(() => !document.querySelector('.app-status')?.textContent?.startsWith('고른 글'));
  await openTab('보기');
  const stats = await page.textContent('.panel-body .doc-stats');
  assert.match(stats, /바이트 \(한글 2바이트\)\s*24/);
  assert.match(stats, /바이트 \(한글 3바이트·UTF-8\)\s*35/);
  assert.match(stats, /원고지 \(200자, 대략\)\s*1장/);
  await page.fill('.panel-body .goal-input', '20');
  await page.waitForSelector('.panel-body .goal-text:has-text("13 / 20자 (공백 포함) · 7자 남았어요")');
  await page.click('.panel-body .chip-btn:has-text("공백 빼고")');
  await page.waitForSelector('.panel-body .goal-text:has-text("11 / 20자 (공백 빼고) · 9자 남았어요")');
  // 고친 뒤에는 다시 센다.
  await page.click('.qb.qb-kb');
  await page.keyboard.type(' 그리고 더 긴 글을 덧붙입니다');
  await openTab('보기');
  await page.waitForSelector('.panel-body .goal-text:has-text("넘었어요")');
});

await step('페이지 오류가 없다', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
await server.close();
const failed = results.filter(([s]) => s === '✗').length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
