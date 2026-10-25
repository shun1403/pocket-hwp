// public/icons/icon.svg 에서 PWA·네이티브 앱 아이콘 PNG를 만든다.
// 실행: node scripts/render-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, out, { padding = 0, background = 'transparent' } = {}) {
  const inner = size - padding * 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${background}"><div style="padding:${padding}px;width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await writeFile(new URL(out, import.meta.url), await page.screenshot({ omitBackground: background === 'transparent' }));
}

await render(192, '../public/icons/icon-192.png');
await render(512, '../public/icons/icon-512.png');
// maskable: 안전 영역(가운데 80%) 안에 들어오도록 여백을 둔다.
await render(512, '../public/icons/icon-maskable-512.png', { padding: 52, background: '#2f5ee8' });
// @capacitor/assets 입력
await render(1024, '../resources/icon.png');
await render(1024, '../resources/icon-foreground.png', { padding: 210 });
await render(2732, '../resources/splash.png', { padding: 1166, background: '#ffffff' });
await render(2732, '../resources/splash-dark.png', { padding: 1166, background: '#121316' });
await browser.close();
