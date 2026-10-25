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

await step('조합 중에는 캐럿 자리에 미리보기를 보여 준다', async () => {
  await cdp.send('Input.imeSetComposition', { text: '무', selectionStart: 1, selectionEnd: 1 });
  assert.equal(await page.textContent('.composition'), '무');
  await cdp.send('Input.insertText', { text: '' });
  await page.waitForFunction(() => !document.querySelector('.composition'));
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
  // 표의 첫 칸을 찾아 탭한다.
  const target = await editor((ed) => {
    for (let y = 40; y < 400; y += 4) {
      const pos = ed.doc.hitTest(0, 200, y);
      if (pos?.cellPath) return { y };
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
  await page.fill('.sheet.open .text-field[type="password"]', 'pocket123');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.sheet.open .dialog-form button[type="submit"]')]);
  locked = await readFile(await download.path());
  assert.equal(locked.subarray(0, 4).toString('hex'), 'd0cf11e0');
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

await step('페이지 오류가 없다', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
await server.close();
const failed = results.filter(([s]) => s === '✗').length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
