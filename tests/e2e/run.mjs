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

await step('페이지 오류가 없다', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
await server.close();
const failed = results.filter(([s]) => s === '✗').length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
