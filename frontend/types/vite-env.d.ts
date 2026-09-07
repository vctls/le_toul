/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Custom prefixed variables
  readonly TUUL_API_HOSTNAME: string;
  readonly TUUL_DONATE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}