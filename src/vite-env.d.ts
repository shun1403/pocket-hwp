/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 파일 내려받기·공유가 막힌 미리보기 프레임용 빌드 (`pnpm build:preview`) */
  readonly VITE_SANDBOXED?: string;
}
