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

await page.click('.done-btn');
await page.click('[aria-label="읽기 모드"]');
await shot('reader');

await browser.close();
await server.close();
