// Claude 아티팩트처럼 내려받기·공유·서비스 워커가 막힌 미리보기 프레임에 올릴 빌드를 만든다.
// 결과: dist-preview/ (page.html = 미리보기 페이지 본문, 나머지는 함께 올릴 파일)
// 실행: node scripts/build-preview.mjs
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { build } from 'vite';

const outDir = new URL('../dist-preview/', import.meta.url).pathname;
process.env.VITE_SANDBOXED = '1';
await build({ build: { outDir, emptyOutDir: true }, logLevel: 'warn' });

// 미리보기 프레임에서 쓰지 않는 파일
await rm(join(outDir, 'sw.js'), { force: true });
await rm(join(outDir, 'manifest.webmanifest'), { force: true });

const html = await readFile(join(outDir, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
const page = [
  '<title>Pocket HWP</title>',
  '<meta name="theme-color" content="#2f5ee8" />',
  ...css.map((href) => `<link rel="stylesheet" href="${href}" />`),
  '<div id="app"></div>',
  ...js.map((src) => `<script type="module" crossorigin src="${src}"></script>`),
  '',
].join('\n');
await writeFile(join(outDir, 'page.html'), page);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
const files = (await walk(outDir))
  .map((f) => relative(outDir, f))
  .filter((f) => f !== 'index.html' && f !== 'page.html')
  .sort();
await writeFile(join(outDir, 'files.json'), JSON.stringify(files, null, 2));
console.log(`page.html + ${files.length} files → ${outDir}`);
