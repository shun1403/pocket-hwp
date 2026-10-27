/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

/**
 * 배포용 빌드에만 넣는 콘텐츠 보안 정책: 앱 밖의 스크립트·주소를 불러오지 않는다.
 * 문서 엔진(WASM)만 따로 허용한다. 개발 서버는 자동 새로고침(웹소켓)을 써서 넣지 않는다.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  // Capacitor WebView와 GitHub Pages 하위 경로 모두에서 동작하도록 상대 경로로 빌드한다.
  base: './',
  plugins: [contentSecurityPolicy()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    exclude: ['@rhwp/core'],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
