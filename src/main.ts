import './styles/app.css';
import { onBack } from './app/back';
import { DocumentSession } from './app/session';
import { engineVersion, initEngine } from './engine/rhwp';
import { MIME } from './platform/bytes';
import { canOpenInPlace, pickDocumentInPlace } from './platform/document-files';
import { isNative, listenIncomingFiles, pickFile, shareFile } from './platform/files';
import { library } from './platform/library';
import { requestPersistence } from './platform/storage';
import { askText } from './ui/dialog';
import { DocScreen } from './ui/doc-screen';
import { h } from './ui/dom';
import { HomeScreen } from './ui/home';
import { icon } from './ui/icons';
import { Sheet } from './ui/sheet';
import { toast } from './ui/toast';

const app = document.getElementById('app')!;
let docScreen: DocScreen | null = null;
let leaveDoc: (() => void) | null = null;
let busy = false;

const home = new HomeScreen({
  openFile: () => void chooseFile(),
  newDocument: () => void withLoading(() => DocumentSession.createBlank(), true),
  openSample: () => void withLoading(() => DocumentSession.createSample()),
  openEntry: (id) => void withLoading((pw) => DocumentSession.openEntry(id, pw)),
  shareEntry: (id) => void shareEntry(id),
  about: () => openAbout(),
});
home.onDropFile = (file) => void openBytes(file.name, file.arrayBuffer());
app.append(home.el);
void home.refresh();

trackKeyboard();
// 앱이 백그라운드로 가거나 탭이 숨겨질 때 바로 저장한다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void docScreen?.flush();
});
void initEngine().catch((err) => {
  console.error(err);
  toast('문서 엔진을 불러오지 못했어요. 앱을 다시 열어 주세요.', 5000);
});
void listenIncomingFiles(
  (f) => void openBytes(f.name, Promise.resolve(f.bytes)),
  () => toast('받은 파일을 읽지 못했어요.'),
);
void setupNativeChrome();
registerServiceWorker();

if (import.meta.env.DEV) {
  // 개발·E2E 테스트에서 현재 문서 화면을 들여다보기 위한 창구
  (window as unknown as Record<string, unknown>).__pocket = { docScreen: () => docScreen };
}

async function chooseFile(): Promise<void> {
  // 앱·크롬 계열 컴퓨터 브라우저에서는 원래 파일에 다시 저장할 수 있게 연다.
  if (canOpenInPlace()) {
    let picked: Awaited<ReturnType<typeof pickDocumentInPlace>> = null;
    try {
      picked = await pickDocumentInPlace();
    } catch (err) {
      console.error(err);
      toast('파일을 열지 못했어요.');
      return;
    }
    if (picked) {
      const { name, bytes, source, handle } = picked;
      await withLoading((pw) => DocumentSession.open(name, bytes, { password: pw, source, handle }));
    }
    return;
  }
  const file = await pickFile('.hwp,.hwpx,application/x-hwp,application/haansofthwp,application/vnd.hancom.hwp,application/hwp+zip,application/vnd.hancom.hwpx');
  if (file) await openBytes(file.name, file.arrayBuffer());
}

async function openBytes(name: string, data: Promise<ArrayBuffer | Uint8Array>): Promise<void> {
  const bytes = new Uint8Array(await data);
  await withLoading((pw) => DocumentSession.open(name, bytes, { password: pw }));
}

const isPasswordError = (err: unknown) => /암호|비밀번호|password|encrypt/i.test(String(err));
const isWrongPassword = (err: unknown) => /일치하지 않|incorrect|wrong/i.test(String(err));

/**
 * 문서를 여는 동안 로딩 화면을 보여 주고, 열리면 문서 화면으로 넘어간다.
 * 암호 문서면 암호를 물어보고 다시 연다.
 */
async function withLoading(open: (password?: string) => Promise<DocumentSession | null>, startEditing = false): Promise<void> {
  if (busy) return;
  busy = true;
  const loading = h('div.loading', { role: 'status' }, h('div.spinner'), h('p', {}, '문서를 여는 중…'));
  app.append(loading);
  try {
    if (docScreen) await closeDoc();
    let password: string | undefined;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const session = await open(password);
        if (!session) toast('문서를 찾지 못했어요.');
        else showDoc(session, startEditing);
        return;
      } catch (err) {
        if (!isPasswordError(err) || attempt >= 3) throw err;
        loading.hidden = true;
        const answer = await askText('문서 암호', '', '열기', {
          secret: true,
          message: password && isWrongPassword(err) ? '암호가 맞지 않아요. 다시 입력해 주세요.' : '암호가 걸린 문서예요. 암호를 입력해 주세요.',
        });
        loading.hidden = false;
        if (!answer) return;
        password = answer;
      }
    }
  } catch (err) {
    console.error(err);
    toast(
      isPasswordError(err) ? '암호가 맞지 않거나 지원하지 않는 암호 방식이에요.' : '이 문서를 열지 못했어요. 손상되었거나 지원하지 않는 형식일 수 있어요.',
      4000,
    );
  } finally {
    loading.remove();
    busy = false;
  }
}

function showDoc(session: DocumentSession, startEditing: boolean): void {
  const screen = new DocScreen(session, () => void closeDoc(), {
    reopen: (id) => void withLoading((pw) => DocumentSession.openEntry(id, pw)),
    openCopy: (name, bytes) => void withLoading((pw) => DocumentSession.open(name, bytes, { password: pw })),
  });
  docScreen = screen;
  home.el.hidden = true;
  app.append(screen.el);
  screen.mount();
  // 문서를 다루기 시작하면 브라우저에 보관함을 지우지 말라고 요청한다.
  void requestPersistence();
  leaveDoc = onBack(() => {
    leaveDoc = null;
    void closeDoc();
  });
  if (startEditing) screen.setEditing(true);
}

async function closeDoc(): Promise<void> {
  const screen = docScreen;
  if (!screen) return;
  docScreen = null;
  leaveDoc?.();
  leaveDoc = null;
  await screen.close();
  home.el.hidden = false;
  await home.refresh();
}

async function shareEntry(id: string): Promise<void> {
  const entry = await library.get(id);
  if (!entry) return;
  const result = await shareFile(entry.name, entry.bytes, MIME[entry.format]);
  if (result === 'downloaded') toast('파일을 내려받았어요.');
  if (result !== 'cancelled') {
    await library.markExported([id]);
    await home.refresh();
  }
}

function openAbout(): void {
  const sheet = new Sheet({ title: 'Pocket HWP' });
  sheet.body.append(
    h('p', {}, '휴대폰과 태블릿에서 한글(HWP·HWPX) 문서를 보고 고치는 오픈소스 앱입니다.'),
    h(
      'dl.info-list',
      {},
      h('dt', {}, '문서 엔진'),
      h('dd', {}, `rhwp ${engineVersion()} (MIT)`),
      h('dt', {}, '라이선스'),
      h('dd', {}, 'MIT · 글꼴은 SIL OFL 1.1'),
    ),
    h('a.sheet-row', { href: 'https://github.com/shun1403/pocket-hwp', target: '_blank', rel: 'noopener' }, icon('github'), '소스 코드 (GitHub)'),
    h('p.sheet-note', {}, '본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.'),
    h(
      'p.sheet-note',
      {},
      '“한글”, “한컴”, “HWP”, “HWPX”는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 앱은 한글과컴퓨터와 제휴·후원·승인 관계가 없는 독립 오픈소스 프로젝트입니다.',
    ),
  );
  sheet.open();
}

/**
 * 가상 키보드 높이를 CSS 변수 --kb 로 알린다.
 * 네이티브 앱은 WebView 자체가 줄어들어 0이 되고, 모바일 브라우저에서는 visualViewport로 계산한다.
 */
function trackKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
    document.documentElement.classList.toggle('kb-open', kb > 40);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

async function setupNativeChrome(): Promise<void> {
  if (!isNative) return;
  document.documentElement.classList.add('native');
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => void StatusBar.setStyle({ style: dark.matches ? Style.Dark : Style.Light });
    dark.addEventListener('change', apply);
    apply();
  } catch {
    // 상태 표시줄 플러그인이 없는 환경
  }
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    const root = document.documentElement;
    void Keyboard.addListener('keyboardWillShow', () => root.classList.add('kb-open'));
    void Keyboard.addListener('keyboardWillHide', () => root.classList.remove('kb-open'));
  } catch {
    // 키보드 플러그인이 없는 환경
  }
}

function registerServiceWorker(): void {
  if (isNative || import.meta.env.DEV || import.meta.env.VITE_SANDBOXED || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
