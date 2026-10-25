// README용 스크린샷을 만든다. 데모 문서를 앱 안에서 직접 작성하므로 외부 문서가 필요 없다.
// 실행: node scripts/screenshots.mjs
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();

async function shoot(colorScheme, suffix) {
  const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR', colorScheme, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const run = (src) => page.evaluate((s) => new Function('ed', s)(window.__pocket.docScreen().editor), src);
  await page.goto('http://localhost:5198/');
  await page.click('text=새 문서');
  await page.waitForSelector('.doc.editing .page canvas');

  // 데모 문서 작성
  await run(`
    ed.applyPara({ alignment: 'center' });
    ed.applyChar({ bold: true, fontSize: 2000 });
    ed.insertText('2026년 동네 도서관 운영 계획');
    ed.enter();
    ed.applyPara({ alignment: 'justify' });
    ed.applyChar({ bold: false, fontSize: 1100 });
    ed.insertText('□ 추진 배경');
    ed.enter();
    ed.insertText(' ㅇ 주민 누구나 가까운 곳에서 책을 빌리고 모임을 열 수 있도록 작은 도서관 세 곳을 새로 연다.');
    ed.enter();
    ed.insertText(' ㅇ 휴대폰으로 문서를 열어 보고 바로 고칠 수 있도록 한글 문서를 모바일에서 다룬다.');
    ed.enter();
    ed.insertText('□ 주요 일정');
    ed.enter();
  `);
  await run(`ed.insertTable(4, 3);`);
  const cells = [['구분', '일정', '담당'], ['개관 준비', '3월', '문화팀'], ['프로그램 운영', '4~11월', '도서관'], ['결과 보고', '12월', '기획팀']];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      await run(`
        const base = ed.caret.cellPath ? ed.caret : null;
        const para = base ? base.para : ed.caret.para - 1;
        ed.caret = { sec: 0, para, offset: 0, cellPath: [{ controlIndex: 0, cellIndex: ${r * 3 + c}, cellParaIndex: 0 }] };
        ed.insertText(${JSON.stringify(cells[r][c])});
      `);
    }
  }
  await page.click('.done-btn');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}view${suffix}.png` });

  // 두 번 탭: 본문 폭 맞춤
  const box = await page.locator('.page').first().boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 120);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 120);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}fit${suffix}.png` });

  // 편집: 낱말 선택 + 서식 도구
  await page.click('.fab');
  await run(`ed.select({ sec: 0, para: 2, offset: 21 }, { sec: 0, para: 2, offset: 26 });`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}edit${suffix}.png` });

  await page.click('.tool[aria-label="글자·문단 모양"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}format${suffix}.png` });
  await page.keyboard.press('Escape');
  await page.click('.done-btn');

  await page.click('[aria-label="읽기 모드"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}reader${suffix}.png` });
  await page.click('[aria-label="읽기 모드 닫기"]');
  await page.click('[aria-label="문서 닫기"]');
  await page.waitForSelector('.home:not([hidden]) .recent-item');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}home${suffix}.png` });
  await context.close();
}

await shoot('light', '');
await browser.close();
await server.close();
