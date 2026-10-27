// 배포용 빌드(dist, 콘텐츠 보안 정책 포함)를 띄워 주요 흐름에서 보안 정책 위반·오류가 없는지 본다.
// 실행: pnpm build && node tests/e2e/prod.mjs
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 5198, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8' },
});
const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR', acceptDownloads: true });
await context.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP 위반: ${e.violatedDirective} ${e.blockedURI}`));
});
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`오류: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['✓', name]);
    console.log(`✓ ${name}`);
  } catch (err) {
    results.push(['✗', name]);
    console.log(`✗ ${name}\n  ${String(err).split('\n').slice(0, 4).join('\n  ')}`);
  }
}

await page.goto('http://localhost:5198/');
const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');

await step('배포용 빌드에 콘텐츠 보안 정책이 들어 있다', async () => {
  assert.ok(csp?.includes("default-src 'self'"), csp ?? '없음');
});

await step('샘플 문서를 열고 글꼴·엔진이 정책 안에서 뜬다', async () => {
  await page.click('.sample-btn');
  await page.waitForSelector('.doc .page canvas', { timeout: 60000 });
  assert.ok((await page.evaluate(() => document.fonts.size)) > 0);
});

await step('편집: 안내를 닫고 글을 쓰고 수식 미리보기를 본다', async () => {
  await page.click('[aria-label="편집하기"]');
  await page.click('.sheet.open .primary-btn:has-text("알겠어요")');
  await page.keyboard.type('보안 정책 시험 ');
  await page.click('.qb[aria-label="입력 도구"]');
  await page.click('.tile[aria-label="수식"]');
  await page.fill('.sheet.open textarea, .sheet.open .text-field >> nth=0', 'a over b');
  await page.waitForSelector('.equation-preview img, .equation-preview svg', { timeout: 10000 });
  await page.goBack();
  await page.click('.done-btn');
});

await step('PDF로 보내기 (blob 다운로드)', async () => {
  await page.click('[aria-label="보내기"]');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.sheet.open .sheet-row:has-text("PDF")')]);
  assert.ok((await download.suggestedFilename()).endsWith('.pdf'));
});

await step('보안 정책 위반·페이지 오류가 없다', async () => {
  assert.deepEqual(problems, []);
});

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
const failed = results.filter(([s]) => s === '✗').length;
console.log(`\n${results.length - failed}/${results.length} 통과 (배포용 빌드)`);
process.exit(failed ? 1 : 0);
