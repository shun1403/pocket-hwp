/**
 * 재배포 가능한(SIL OFL) 한글 폰트를 등록한다.
 *
 * rhwp는 한컴 전용 폰트(함초롬바탕, 한컴돋움 등)를 오픈소스 폰트로 폴백한다.
 * 폰트가 늦게 로드되면 줄바꿈 계산이 달라지므로 WASM 초기화 전에 먼저 로드한다.
 */
interface BundledFont {
  family: string;
  file: string;
  weight: '400' | '700';
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { family: 'Pretendard', file: 'Pretendard-Regular.woff2', weight: '400' },
  { family: 'Pretendard', file: 'Pretendard-Bold.woff2', weight: '700' },
  { family: 'Noto Serif KR', file: 'NotoSerifKR-Regular.woff2', weight: '400' },
  { family: 'Noto Serif KR', file: 'NotoSerifKR-Bold.woff2', weight: '700' },
  { family: 'NanumGothic', file: 'NanumGothic-Regular.woff2', weight: '400' },
  { family: '나눔고딕', file: 'NanumGothic-Regular.woff2', weight: '400' },
  { family: 'NanumMyeongjo', file: 'NanumMyeongjo-Regular.woff2', weight: '400' },
  { family: '나눔명조', file: 'NanumMyeongjo-Regular.woff2', weight: '400' },
];

export async function loadBundledFonts(baseUrl: string): Promise<void> {
  if (typeof FontFace === 'undefined') return;
  const loads = BUNDLED_FONTS.map(async (font) => {
    try {
      const face = new FontFace(font.family, `url(${baseUrl}fonts/${font.file})`, {
        weight: font.weight,
        display: 'swap',
      });
      await face.load();
      document.fonts.add(face);
    } catch {
      // 폰트 하나가 실패해도 시스템 폰트로 렌더링은 계속된다.
    }
  });
  await Promise.all(loads);
}
