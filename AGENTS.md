# Repository Guidelines

Pocket HWP는 안드로이드·iOS용 한글(HWP/HWPX) 뷰어·편집기입니다. 웹 앱(Vite + TypeScript)을
Capacitor 8로 감싸고, 문서 엔진은 npm `@rhwp/core`(rhwp WASM)를 씁니다.

## 원칙

- 패키지 관리는 `pnpm`만 씁니다.
- 엔진(`@rhwp/core`)은 고치지 않습니다. 앱 쪽 동작은 `src/`에, 네이티브 연동은 `android/`·`ios/`에 둡니다.
- 모든 문서 편집은 `Editor.edit()`을 거쳐 실행 취소 기록·다시 그리기·자동 저장이 함께 일어나게 합니다.
- 본문/표 셀 차이는 `EditableDocument`가 숨깁니다. UI 코드에서 rhwp 셀 API를 직접 부르지 않습니다.
- 문서 내용(사용자 파일)은 로그에 남기지 않습니다.
- 모바일 우선: 터치 대상 44px 이상, 안전 영역(`env(safe-area-inset-*)`), 가상 키보드 높이(`--kb`)를 고려합니다.
- UI 문구는 쉬운 한국어 존댓말(해요체)로 씁니다.

## 확인

변경 뒤에는 다음을 통과시켜 주세요.

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
```

네이티브 설정(`android/`, `ios/`, `capacitor.config.ts`)을 바꿨다면 `pnpm cap:sync` 후 기기나 에뮬레이터에서 확인합니다.
자세한 구조와 설계는 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)를 보세요.
