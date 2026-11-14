/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in the development server the end-to-end tests start (Day 18): see testing/. */
  readonly VITE_TEST_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
