# Pocket HWP 개발하기

## 준비

- Node.js 20.19 이상, pnpm 10 (`corepack enable`)
- 안드로이드: Android Studio 또는 Android SDK(compileSdk 36) + JDK 21
- iOS: macOS + Xcode 16 이상

```sh
pnpm install
```

## 명령

| 명령 | 하는 일 |
| --- | --- |
| `pnpm dev` | 개발 서버 (`--host`로 열려 있어 같은 네트워크의 휴대폰에서 접속 가능) |
| `pnpm build` | 타입 검사 + 웹 빌드 (`dist/`) |
| `pnpm typecheck` | TypeScript 검사 |
| `pnpm test` | 단위 테스트 (Vitest) |
| `pnpm test:e2e` | 모바일 화면(Pixel 7, 터치) E2E 테스트 — Playwright Chromium 필요 |
| `pnpm cap:sync` | 웹 빌드 후 안드로이드·iOS 프로젝트에 반영 |
| `pnpm android` / `pnpm ios` | 동기화 후 Android Studio / Xcode 열기 |
| `node scripts/screenshots.mjs` | README 스크린샷 다시 만들기 |
| `node scripts/render-icons.mjs` | `public/icons/icon.svg`에서 앱 아이콘 PNG 만들기 |

E2E 테스트를 처음 돌릴 때 브라우저가 없으면 `pnpm exec playwright install chromium`을 실행하세요.

앱 아이콘·스플래시를 바꿨다면:

```sh
node scripts/render-icons.mjs
pnpm dlx @capacitor/assets generate --iconBackgroundColor '#2f5ee8' --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#121316'
```

## 구조

```text
src/
  engine/      rhwp WASM 초기화, 번들 글꼴 등록
  doc/         문서 모델: 위치(DocPos), 본문/표 셀을 가리는 편집 API, 실행 취소, 입력 해석
  doc/ops/     한글 기능 묶음: 표, 스타일·번호, 쪽 설정, 입력(각주·수식·링크 등), 개체(그림·수식·글상자)
  view/        연속 스크롤 쪽 뷰(지연 캔버스 렌더링·확대), 터치 제스처
  editor/      편집기: 캐럿·선택·IME 입력 브리지·오버레이
  export/      HWP/HWPX 직렬화, 이미지 PDF, 평문
  platform/    파일 열기·공유(웹/Capacitor), 앱 보관함(IndexedDB), 클립보드
  app/         문서 세션(자동 저장), 뒤로 가기 스택
  ui/          홈·문서 화면, 빠른 도구 줄, 바텀 시트, 읽기 모드
  ui/panel/    키보드 자리에 올라오는 도구 패널과 탭(글자·문단·스타일·입력·표·쪽·보기)
android/       Capacitor 안드로이드 프로젝트 (MainActivity: 받은 문서 처리)
ios/           Capacitor iOS 프로젝트 (Info.plist: HWP/HWPX 문서 형식 등록)
public/        글꼴(OFL), 아이콘, PWA manifest, 서비스 워커
tests/unit     순수 로직 단위 테스트
tests/e2e      모바일 에뮬레이션 E2E
```

## 설계 메모

### 엔진

`@rhwp/core`(npm)의 `HwpDocument`를 그대로 씁니다. 엔진은 쪽을 Canvas로 그리고, 캐럿 좌표·hit-test·
선택 사각형·편집 API를 모두 96dpi 쪽 좌표(px)로 줍니다. 앱은 그 위에 HTML 오버레이로 캐럿과 선택을 그립니다.
엔진 버전은 `package.json`에 고정합니다. 올릴 때는 `rhwp.d.ts`의 API 변경을 확인하고 E2E를 돌리세요.

### 본문과 표 셀

`DocPos`는 본문이면 `{sec, para, offset}`, 표 셀/글상자 안이면 `cellPath`를 더 가집니다.
`EditableDocument`가 이 차이를 숨기고 셀 안에서는 `...ByPath` API를 부릅니다.
셀 안의 실제 문단 번호는 `cellPath`의 **마지막** 항목에 있습니다(`innerPara`).

### 한글 입력 (IME)

모바일 키보드는 빈 입력칸에서 Backspace를 보내지 않거나 `beforeinput` 취소를 무시하는 경우가 많습니다.
그래서 화면에 보이지 않는 `textarea`에 표식 문자(ZWSP) 하나를 넣어 두고, 입력 이벤트 뒤의 값을 표식과 비교해
입력/Enter/Backspace를 알아냅니다(`doc/input-diff.ts`). 조합 중에는 값을 건드리지 않고 캐럿 위치에
미리보기만 그리며, `compositionend`에서 확정된 글자를 문서에 넣습니다.

### 렌더링과 메모리

쪽 자리는 문서 크기대로 미리 잡고 화면 근처 쪽만 그립니다. 화면에서 4화면 이상 멀어진 쪽의 캔버스는
비워서 메모리를 돌려줍니다(iOS WebView 캔버스 메모리 한도 대응). 편집 중에는 반응성을 위해 렌더링 배율을
devicePixelRatio 2로 제한하고, 같은 프레임의 여러 입력을 한 번에 그립니다.

### 편집 UI

편집 모드의 아래쪽은 두 층입니다. 키보드 바로 위의 **빠른 도구 줄**(`QuickBar`)은 자주 쓰는 것만 두고,
`서식`/`입력`/`표`를 누르면 키보드를 내리고 그 자리에 **도구 패널**(`ToolPanel`)을 올립니다.
문서를 탭하면 입력칸에 포커스가 가면서 패널이 닫히고 키보드가 돌아옵니다. 패널에서 고르는 모든 편집은
`Editor.command()`를 거쳐 실행 취소·다시 그리기·자동 저장이 함께 일어납니다. 새 기능은 `doc/ops/`에
엔진 호출을 두고, `ui/panel/tabs/`에 버튼을 붙이면 됩니다.

rhwp의 글자 위치(charOffset)에는 개체(각주·수식·그림 등)가 자리를 차지하지 않습니다. 개체를 넣은 뒤
캐럿을 한 칸 옮기는 식의 계산을 하지 마세요.

### 실행 취소

rhwp 스냅샷(`saveSnapshot`/`restoreSnapshot`)을 씁니다. 연속 타이핑은 한 단계로 묶고, 버려진 스냅샷은
`discardSnapshot`으로 해제합니다. 한도는 엔진의 `snapshotCapacity()`를 넘지 않습니다.

### 받은 파일

- 안드로이드: `MainActivity`가 `content://` 문서를 앱 캐시에 원래 이름으로 복사하고 `file://` VIEW 인텐트로 바꿔
  넘깁니다. 웹 코드는 Capacitor App 플러그인의 `appUrlOpen`으로 받습니다. 공유(SEND)도 같은 경로입니다.
- iOS: `CFBundleDocumentTypes`/`UTImportedTypeDeclarations`로 `com.hancom.hwp`·`com.hancom.hwpx`를 등록했고,
  문서는 앱 Inbox로 복사되어 `file://` 주소로 들어옵니다.
- 데스크톱 PWA: manifest `file_handlers` + `launchQueue`.

### 뒤로 가기

화면·시트·편집 모드마다 history 항목을 하나 쌓고 `popstate`로 닫습니다(`app/back.ts`).
Capacitor는 뒤로 버튼 리스너가 없으면 WebView `history.back()`을 부르므로 안드로이드 뒤로 버튼도 같은 경로를 탑니다.
`history.back()`은 비동기라서 돌아가는 중에는 새 `pushState`를 미뤄 기록이 어긋나지 않게 합니다.

## 앞으로 할 일

- 여러 셀을 끌어 선택해 합치기, 표 크기·테두리 편집
- 각주·머리말/꼬리말을 본문처럼 직접 고치기, 꼬리말 쪽 번호
- 원본 위치에 다시 저장(안드로이드 SAF `ACTION_OPEN_DOCUMENT` 쓰기 권한, iOS 문서 브라우저)
- 큰 문서에서 Web Worker로 엔진 옮기기
