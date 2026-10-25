import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.pockethwp',
  appName: 'Pocket HWP',
  webDir: 'dist',
  android: {
    // 큰 문서 WASM 메모리와 캔버스를 위해 하드웨어 가속은 기본값(켜짐)을 쓴다.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
  },
  plugins: {
    Keyboard: {
      // 키보드가 올라오면 WebView 자체를 줄여 편집 도구 줄이 키보드 바로 위에 붙게 한다.
      resize: 'native',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
