// 모바일 화면(Pixel 7, 터치)으로 앱을 띄워 주요 흐름을 끝까지 검증한다.
// 실행: pnpm test:e2e   (Chromium이 없으면 `pnpm exec playwright install chromium`)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR', acceptDownloads: true });
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
const caretClient = () =>
  page.evaluate(() => {
    const r = document.querySelector('.caret').getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2 };
  });

await page.goto('http://localhost:5199/');
await page.waitForSelector('.home');

await step('새 문서를 만들면 바로 편집 모드로 열린다', async () => {
  await page.click('text=새 문서');
  await page.waitForSelector('.doc.editing .page canvas');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'ime-input');
});

await step('영문 입력과 한글 조합 입력이 문서에 들어간다', async () => {
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
  await page.click('.tool[aria-label="굵게"]');
  const bold = await editor((ed) => ed.doc.charProps({ ...ed.caret, offset: 1 }).bold);
  assert.equal(bold, true);
  assert.equal(await page.getAttribute('.tool[aria-label="굵게"]', 'aria-pressed'), 'true');
  // 길게 누른 뒤에도 키보드(입력칸 포커스)가 유지되어야 한다.
  assert.equal(await page.evaluate(() => document.activeElement.className), 'ime-input');
});

await step('표를 넣고 셀 안에 글을 쓴다', async () => {
  await page.keyboard.press('End');
  await page.click('.tool[aria-label^="넣기"]');
  await page.click('text=표 넣기');
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

await step('페이지 오류가 없다', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
await server.close();
const failed = results.filter(([s]) => s === '✗').length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
