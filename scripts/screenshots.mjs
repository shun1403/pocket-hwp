// README용 스크린샷을 만든다. 앱에 들어 있는 샘플 문서를 쓰므로 외부 문서가 필요 없다.
// 실행: node scripts/screenshots.mjs
import { rm } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR', deviceScaleFactor: 2 });
// 처음 편집할 때 뜨는 사용법 안내는 스크린샷에서 뺀다.
await context.addInitScript(() => localStorage.setItem('tips:edit-seen', 'true'));
const page = await context.newPage();
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}${name}.png` });
};
const run = (src) => page.evaluate((s) => new Function('ed', s)(window.__pocket.docScreen().editor), src);

await rm(OUT, { recursive: true, force: true });
await page.goto('http://localhost:5198/');
await page.waitForSelector('.home');
await shot('home');

await page.click('.sample-btn');
await page.waitForSelector('.doc .page canvas');
await shot('view');

await page.click('.edit-btn');
await run(`ed.select({ sec: 0, para: 1, offset: 0 }, { sec: 0, para: 1, offset: 3 });`);
await shot('edit');

await page.click('.qb[aria-label="서식 도구"]');
await shot('format');

await page.click('.panel-tab:has-text("입력")');
await shot('insert');

// 표 칸 안에 캐럿을 두고 표 탭
await run(`
  const t = JSON.parse(ed.doc.raw.getPageControlLayout(0)).controls.find((c) => c.type === 'table');
  ed.select({ sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: 4, cellParaIndex: 0 }] },
            { sec: 0, para: t.paraIdx, offset: 0, cellPath: [{ controlIndex: t.controlIdx, cellIndex: 4, cellParaIndex: 0 }] });
`);
await page.click('.panel-tab:has-text("표")');
await shot('table');

await page.click('.panel-tab:has-text("기호")');
await shot('symbol');

// 서명 넣기 시트: 손가락 서명을 흉내 낸다.
await page.click('.panel-tab:has-text("입력")');
await page.click('.tile[aria-label="서명·도장"]');
await page.waitForSelector('.sheet.open .sign-canvas');
await page.waitForTimeout(400);
const pad = await page.locator('.sheet.open .sign-canvas').boundingBox();
const cdp = await context.newCDPSession(page);
const stroke = Array.from({ length: 24 }, (_, i) => ({
  x: pad.x + pad.width * (0.15 + i * 0.03),
  y: pad.y + pad.height * (0.5 + 0.18 * Math.sin(i * 0.9)),
}));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stroke[0]] });
for (const p of stroke.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await shot('sign');
await page.goBack();
await page.waitForFunction(() => !document.querySelector('.sheet.open'));

// 서식 채우기: 샘플 문서의 누름틀을 채운다.
await page.click('.panel-tab:has-text("입력")');
await page.click('.tile[aria-label="서식 채우기"]');
await page.waitForSelector('.form-fill:not([hidden])');
await page.fill('.ff-input', '홍길동');
await shot('fill');
await page.click('.ff-done');

await page.click('.done-btn');
await page.click('[aria-label="읽기 모드"]');
await shot('reader');

await browser.close();
await server.close();
