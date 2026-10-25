/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Capacitor WebView와 GitHub Pages 하위 경로 모두에서 동작하도록 상대 경로로 빌드한다.
  base: './',
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
