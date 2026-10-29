# Pocket HWP 개발하기

## 준비

- Node.js 22.23.4 이상 (2026년 10월 보안 패치 포함, `.node-version` 참고), pnpm 10 (`corepack enable`)
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

## 안드로이드 APK 릴리스

`v`로 시작하는 태그를 올리면 `.github/workflows/release.yml`이 서명된 APK를 만들어 GitHub Releases에 올립니다.
사용자는 휴대폰 브라우저로 Releases 페이지에서 바로 받아 설치합니다 (README의 설치 안내 참고).

### 1. 서명 키 만들기 (처음 한 번)

같은 키로 서명한 APK끼리만 업데이트가 됩니다. **키를 잃어버리면 기존 사용자는 지우고 다시 설치해야 하니**
키 파일과 비밀번호를 안전한 곳(비밀번호 관리자 등)에 따로 보관하세요. 저장소에는 절대 올리지 않습니다.

```sh
keytool -genkeypair -v -keystore pocket-hwp-release.jks -alias pocket-hwp \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 pocket-hwp-release.jks > keystore.b64   # macOS: base64 -i pocket-hwp-release.jks -o keystore.b64
```

### 2. GitHub에 비밀 값 넣기

저장소 **Settings → Secrets and variables → Actions → New repository secret**:

| 이름 | 값 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `keystore.b64` 파일 내용 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 비밀번호 |
| `ANDROID_KEY_ALIAS` | `pocket-hwp` (위에서 정한 alias) |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 (따로 정하지 않았으면 keystore 비밀번호와 같음) |

비밀 값이 없으면 워크플로는 임시 키로 서명하고 경고를 남깁니다. 그 APK는 설치는 되지만 다음 버전으로 업데이트되지 않습니다.

### 3. 릴리스 올리기

가장 쉬운 방법은 GitHub **Actions → 안드로이드 APK 릴리스 → Run workflow**에서 브랜치를 `main`으로 두고
**버전**(예: `0.2.0`)을 넣어 실행하는 것입니다. 빌드·서명 뒤 `v0.2.0` 태그와 릴리스를 만들고 APK를 붙입니다.
**사전 릴리스(베타)** 체크는 기본으로 켜져 있습니다. 같은 버전이 이미 있으면 아무것도 만들지 않고 멈춥니다.

태그로도 만들 수 있습니다. GitHub 웹의 **Releases → Draft a new release**에서 새 태그로 릴리스를 만들거나,

```sh
git tag v0.2.0
git push origin v0.2.0
```

몇 분 뒤 그 릴리스에 `PocketHWP-0.2.0.apk`가 붙습니다. 앱 버전 이름은 입력한 버전(또는 태그)에서, 버전 코드는
워크플로 실행 번호에서 가져오므로 새 릴리스가 항상 이전 릴리스보다 높은 버전 코드를 가집니다.
버전을 비우고 직접 실행하면 릴리스 없이 APK만 결과물로 받을 수 있습니다 (시험용).

## 구조

```text
src/
  engine/      rhwp WASM 초기화, 번들 글꼴 등록
  doc/         문서 모델: 위치(DocPos), 본문/표 셀을 가리는 편집 API, 실행 취소, 입력 해석
  doc/ops/     한글 기능 묶음: 표, 스타일·번호, 쪽 설정, 입력(각주·수식·링크 등), 개체(그림·수식·글상자)
  view/        연속 스크롤 쪽 뷰(지연 캔버스 렌더링·확대), 터치 제스처
  editor/      편집기: 캐럿·선택·IME 입력 브리지·오버레이
  export/      HWP/HWPX 직렬화, 이미지 PDF, 평문
  platform/    파일 열기·공유·원래 파일에 저장(웹/Capacitor), 보관함·버전·서명(IndexedDB), 음성, 클립보드
  app/         문서 세션(자동 저장), 뒤로 가기 스택
  ui/          홈·문서 화면, 빠른 도구 줄, 바텀 시트, 읽기 모드
  ui/panel/    키보드 자리에 올라오는 도구 패널과 탭(글자·문단·스타일·입력·기호·표·쪽·보기)
android/       Capacitor 안드로이드 프로젝트 (MainActivity: 받은 문서 처리, DocumentFilesPlugin: 원래 파일에 저장)
ios/           Capacitor iOS 프로젝트 (Info.plist: HWP/HWPX 문서 형식 등록, DocumentFilesPlugin: 원래 파일에 저장)
public/        글꼴(OFL), 아이콘, PWA manifest, 서비스 워커
tests/unit     순수 로직·엔진(Node에서 WASM) 단위 테스트
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
입력/Enter/Backspace를 알아냅니다(`doc/input-diff.ts`). 조합 중에는 textarea 값을 건드리지 않습니다.

조합 중인 글은 실제 모양(글꼴·크기·자간·줄 간격·줄바꿈) 그대로 보이도록 **문서에 바로 넣어 두고**
(`Editor.showLive`, 실행 취소 기록 없이) 밑줄로 표시합니다. 조합이 바뀔 때마다 넣어 둔 글을 빼고 새 글을 넣으며,
`compositionend`에서 넣어 둔 글을 뺀 뒤 확정된 글을 평소 입력처럼(`Editor.edit`) 넣습니다. 그래서 실행 취소 기록에는
확정된 글만 남습니다. 조합 중에 다른 편집·실행 취소·명령이 들어오면 먼저 조합을 확정합니다(`settleComposition`).
엔진이 그 자리에 글을 넣지 못하면 예전처럼 캐럿 자리에 떠 있는 미리보기(`Overlay.showComposition`)로 대신합니다.

### 하드웨어 키보드 단축키

단축키는 `ui/shortcuts.ts`의 표 하나에 모읍니다(한글과 같은 조합을 먼저, 목록 시트 `F1`도 이 표로 그립니다).
키 이름은 `editor/keys.ts`의 `keyName`이 `'Ctrl+Shift+L'`처럼 만들며, 한글 입력 상태에서는 `e.key`가 `'ㅠ'` 같은
자모로 오므로 **글쇠 자리(`e.code`)를 먼저** 봅니다. 조합 중에 누른 Ctrl·Alt·기능 키는 조합을 확정한 뒤 처리합니다.
이동·지우기 키는 `Editor.handleKey`가 직접 다루고 나머지는 `EditorHost.shortcut(name)`으로 넘깁니다.

숨은 입력란에 포커스가 없을 때(보기 중, 도구 패널을 연 동안)도 되도록 `DocScreen`이 `document`의
`keydown`·`copy`·`cut`·`paste`를 받아 같은 길로 보냅니다(입력란·시트·읽기 모드에서 난 이벤트는 건너뜁니다).
숨은 textarea에는 고른 글이 없으므로 복사·잘라내기는 `copy`/`cut` 이벤트에서 문서의 고른 글을
평문과 HTML(`EditableDocument.htmlBetween`, 모양 포함)로 채웁니다.

### 표·개체 통째로 고르기

표는 `PageObject`(`kind: 'table'`)로 다룹니다. 칸을 누르면 글을 고치도록 `objectAt`은 **바깥 테두리 둘레**만
표 전체로 잡습니다(`Editor.selectTable()`로도 고릅니다). 표·그림·도형 복사는 엔진 안 클립보드(`copyControl`)에
넣고 시스템 클립보드에는 표식 글(`[표]`)만 넣습니다. 붙여 넣는 글이 그 표식과 같으면 `pasteControl`로 개체를 붙이고,
다르면(그사이 다른 앱에서 복사했으면) 평소처럼 글을 붙입니다. 엔진의 HTML 내보내기에는 표가 들어가지 않습니다.

손잡이·마우스로 고르다 화면 위·아래 끝(아래는 키보드·도구 줄을 피해 넉넉히)에 닿으면 `Editor.edgeScroll`이
문서를 굴리며 범위를 넓힙니다. `getSelectionRects`가 범위 전체를 못 재면 문단마다 따로 재어 보여 줍니다.

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

### 서식 채우기·쪽 번호

- 서식 채우기(`doc/ops/fields.ts`, `ui/form-fill.ts`)는 엔진의 누름틀 목록(`getFieldList`)을 돌고, 값은 `setFieldValue`로 넣습니다.
  누름틀 끝 위치에 글을 끼우면 누름틀 밖에 들어가므로, 캐럿 타이핑 대신 큰 입력칸 하나에 쓰고 넘어갈 때 넣습니다.
  누름틀이 없으면 `getPageControlLayout`의 표 칸 중 빈 칸을 대신 돕니다.
- 쪽 번호(`setPageNumber`)는 꼬리말 필드(`insertFieldInHf`, 1 = 현재 쪽, 2 = 전체 쪽)라서 쪽마다 알맞은 번호로 그려지고 저장해도 남습니다.

### 표·도형·쪽 꾸미기에서 알아 둘 엔진 특성

- `setCellProperties`·`setPageBorderFill`은 넘기지 않은 테두리·항목을 기본값(가장 가는 선, 테두리 없음)으로 되돌린다.
  그래서 `doc/ops/table.ts`·`page.ts`는 지금 값을 읽어 바꿀 것만 덮어써서 넘긴다(셀 배경색을 칠해도 테두리가 그대로 남게).
- 도형 색(`borderColor`·`fillBgColor`)은 0x00BBGGRR 정수다(`hwpColor`/`cssColor`).
- 캡션(`attachCaptionAt`)은 그리기 개체(도형·글상자)에만 붙는다.
- 차트 값은 `getChartData`가 주는 모양(`labels`, `series[{name, values}]`) 그대로 `setChartData`에 넘긴다.
  엔진은 HWPX 차트 XML과 HWP용 OLE 사본을 함께 고칠 수 없으면 아무것도 쓰지 않고 `invalid` 이유를 돌려준다.
- 편집 용지(`setPageDef`)의 폭·길이는 세로 기준 값이고 `landscape`가 방향을 바꾼다. `binding` 0 한쪽·1 맞쪽·2 위로.
  맞쪽은 짝수 쪽에서 `bindingMirrored`로 여백이 뒤집히지만, 위로(2)는 엔진이 아직 그릴 때 반영하지 않는다.
  `breakAtCursor(…, 'section')`은 ok를 돌려주지만 구역 수가 늘지 않아 "새 구역으로 적용"은 넣지 않았다.
- 머리말·꼬리말·각주는 캐럿으로 직접 고치지 않고, 누르면 여러 줄 입력 시트로 고친다(`doc/ops/notes.ts`).
  바뀌지 않은 줄은 건드리지 않아서 그 줄의 쪽 번호 필드·글자 모양이 남는다.
- 붙여넣기는 클립보드에 HTML이 있으면 `pasteHtml`로 모양째 넣고, 엔진이 읽지 못하면 글자만 넣는다.
- 인쇄는 앱에서 PDF를 만들어 `DocumentFiles.print`(안드로이드 PrintManager, iOS UIPrintInteractionController)로 넘기고,
  브라우저에서는 쪽 그림을 인쇄용 화면에 깔고 `window.print()`를 연다.

### 메모

엔진은 HWPX 메모(`fieldBegin type="MEMO"` + 내용 `subList`)를 읽고 HWPX로 다시 쓸 때 그대로 지키지만,
메모 내용을 꺼내거나 새로 만드는 API는 없습니다. 그래서 `doc/ops/memos.ts`는

1. 넣을 자리에 엔진 누름틀을 자리표로 끼우고(스냅샷으로 곧바로 되돌림) 문서를 HWPX로 내보낸 뒤,
2. HWPX 안의 자리표를 한글이 쓰는 모양 그대로의 메모 필드로 바꾸고(`memoProperties`도 없으면 넣음),
3. 그 HWPX를 `Editor.replaceDocument`로 다시 엽니다.

고치기·지우기도 같은 방식이고, 읽기는 내보낸 HWPX에서 메모 내용을 꺼냅니다. HWPX로 바꿀 때 엔진이 잃는 내용을
보고하면 메모를 쓰지 않습니다. 엔진은 HWP(5.0)로 저장할 때 메모를 지키지 못하므로, 메모가 있는 문서의 보관본은
HWPX로 두고(`DocumentSession.save`), HWP로 내보낼 때는 `exportDocument`가 손실 경고를 붙입니다.
문서를 통째로 바꾸므로 엔진 스냅샷이 이어지지 않아, 메모를 쓰면 실행 취소 기록이 비워집니다.
HWP 파일에서 연 메모(명령 `MEMO/…` 필드)는 엔진이 내용을 읽지 않아 목록에 자리만 보입니다.

### 실행 취소

rhwp 스냅샷(`saveSnapshot`/`restoreSnapshot`)을 씁니다. 연속 타이핑은 한 단계로 묶고, 버려진 스냅샷은
`discardSnapshot`으로 해제합니다. 한도는 엔진의 `snapshotCapacity()`를 넘지 않습니다.

### 버전 기록·서명

IndexedDB(`platform/db.ts`, 버전 2)에는 문서(`documents`) 말고도 문서별 이전 버전(`versions`, `docId` 색인)과
저장한 서명·도장(`signatures`)이 있습니다.

- 처음 연 파일은 "처음 상태" 버전으로 남기고(지우지 않음), 편집 중에는 자동 저장이 10분 이상 벌어질 때와 문서를 닫을 때 버전을 남깁니다.
  문서마다 자동 버전 20개를 넘으면 오래된 것부터 지웁니다. 되돌리기 직전 내용도 버전으로 남깁니다.
- 암호 문서의 버전은 보관본과 같이 암호가 걸린 채 저장됩니다. 보관함 백업 ZIP에는 버전과 서명이 들어가지 않습니다.
- 서명·도장 사진은 어두운 잉크·붉은 인주만 남기고 흰 바탕을 투명하게 바꾼 PNG(`removePaper`)로 넣습니다.

### 원래 파일에 저장

- 안드로이드: 앱 안 플러그인 `DocumentFilesPlugin.java`(MainActivity에서 등록, 인쇄도 맡음)가 `ACTION_OPEN_DOCUMENT`로 열고
  영구 읽기·쓰기 권한을 받아 둡니다. 쓰기는 영구 쓰기 권한이 있는 주소에만 합니다.
- iOS: `DocumentFilesPlugin.swift`(`MainViewController`에서 등록)가 문서 선택기로 제자리에서 열고 보안 북마크를 보관합니다.
- 웹: File System Access API(`showOpenFilePicker`) 파일 핸들을 IndexedDB에 둡니다. 크롬·엣지 컴퓨터 브라우저에서만 됩니다.
- 보관함 항목의 `source`가 원래 파일 자리입니다. 사본에는 넘기지 않습니다(사본을 고쳐도 원본을 덮어쓰지 않게).
- 받은 파일(VIEW/SEND 인텐트, iOS Inbox)은 원래 자리에 쓸 권한이 없어 공유 시트로만 저장합니다.

### 보관함과 데이터 보호

문서는 IndexedDB(`platform/library.ts`)에만 저장하고 서버로 보내지 않습니다. 웹 앱에서는 브라우저가
저장 공간 부족이나(모든 브라우저) 오래 쓰지 않음(사파리)을 이유로 데이터를 지울 수 있으므로:

- 문서를 처음 열 때 `navigator.storage.persist()`를 요청합니다 (`platform/storage.ts`).
- 각 문서에 `exportedAt`(마지막으로 앱 밖에 HWP/HWPX 사본을 남긴 때)을 기록하고, 편집 뒤 아직 내보내지 않은
  문서는 홈에서 "백업 전"으로 표시하고 알림을 띄웁니다.
- 보관함 전체를 ZIP(`export/zip.ts`, 압축 없이 담는 형식)으로 백업·복원합니다 (`app/backup.ts`).
  ZIP 안에는 문서 파일과 `pocket-hwp-backup.json` 목록이 들어 있어, 다른 앱에서 풀어도 바로 열 수 있습니다.
- 아이폰 사파리 탭에서 열면 홈 화면에 추가하라고 안내합니다 (탭과 홈 화면 앱은 보관함이 따로입니다).

### 보안

- 문서는 기기 밖으로 나가지 않습니다. 앱에는 서버가 없고 네트워크 요청 코드가 없으며, 문서는 캔버스로 그립니다.
  문서 안 링크는 http·https·mailto·tel만, 주소를 보여 주고 물어본 뒤 밖의 앱으로 엽니다 (`safeLinkUrl`).
- 배포용 빌드에는 콘텐츠 보안 정책(CSP)을 넣습니다(`vite.config.ts`). 앱 밖의 스크립트·주소는 불러오지 않고
  문서 엔진(WASM)만 따로 허용합니다. 개발 서버는 자동 새로고침 때문에 넣지 않습니다.
  `tests/e2e/prod.mjs`가 배포용 빌드를 띄워 주요 흐름에서 정책 위반이 없는지 확인합니다(`pnpm test:e2e`에 포함).
- 앱 보관함(WebView 저장소)은 안드로이드 자동 백업·iCloud 백업 대상입니다(`allowBackup="true"`, 기본값).
  폰을 바꿔도 문서가 따라오게 하려는 선택이고, 백업은 운영체제가 암호화해 올립니다. 개인정보 안내는 [PRIVACY.md](../PRIVACY.md).
- UI는 `h()`로 DOM을 만들고 글은 텍스트 노드로만 넣습니다. `innerHTML`은 쓰지 않습니다.
  수식 미리보기 SVG는 `<img>`로 보여 줘서 스크립트가 실행되지 않습니다.
- 암호 문서는 보관함에도 같은 암호로 저장하고, 암호와 첫 쪽 썸네일은 남기지 않습니다.
- 백업 ZIP은 남이 만든 파일일 수 있다고 보고 읽습니다. 한글 문서와 목록만 풀고, 푼 크기에 한도를 두며(압축 폭탄),
  목록의 id·형식·이름을 확인합니다 (`app/backup.ts`, `export/zip.ts`).
- 안드로이드는 `content://` 문서만 받습니다. `file://` 주소나 이 앱의 FileProvider 주소가 오면 버립니다
  (다른 앱이 이 앱의 내부 파일을 열게 만드는 것을 막기 위해). FileProvider는 공유용 캐시 폴더(`share/`)만 내줍니다.
- CI는 읽기 권한으로 돌고, Releases에 올리는 작업만 쓰기 권한을 받습니다. PR 빌드에는 서명 키를 주지 않습니다.
  외부 GitHub 액션은 커밋 SHA로 고정합니다.
- 서명 키(`*.jks`, `*.keystore`, `*.b64`)는 `.gitignore`로 막아 두었습니다.

보안 문제를 발견하면 [SECURITY.md](../SECURITY.md)를 보세요.

### 받은 파일

- 안드로이드: `MainActivity`가 `content://` 문서를 앱 캐시에 원래 이름으로 복사하고 `file://` VIEW 인텐트로 바꿔
  넘깁니다(밖에서 온 `file://` 주소는 받지 않습니다). 웹 코드는 Capacitor App 플러그인의 `appUrlOpen`으로 받습니다. 공유(SEND)도 같은 경로입니다.
- iOS: `CFBundleDocumentTypes`/`UTImportedTypeDeclarations`로 `com.hancom.hwp`·`com.hancom.hwpx`를 등록했고,
  문서는 앱 Inbox로 복사되어 `file://` 주소로 들어옵니다.
- 데스크톱 PWA: manifest `file_handlers` + `launchQueue`.

### 뒤로 가기

화면·시트·편집 모드마다 history 항목을 하나 쌓고 `popstate`로 닫습니다(`app/back.ts`).
Capacitor는 뒤로 버튼 리스너가 없으면 WebView `history.back()`을 부르므로 안드로이드 뒤로 버튼도 같은 경로를 탑니다.
`history.back()`은 비동기라서 돌아가는 중에는 새 `pushState`를 미뤄 기록이 어긋나지 않게 합니다.

## 앞으로 할 일

- 손가락으로 끌어서 표 여러 칸 고르기, 도형을 끌어서 옮기기·크기 바꾸기
- 그림·표 캡션 (엔진 지원 뒤)
- 큰 문서에서 Web Worker로 엔진 옮기기
