/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHURCH_APP_URL?: string;
  readonly VITE_MEMBER_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
