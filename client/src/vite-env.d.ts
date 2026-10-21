/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_DEMO_ENABLED?: string;
  readonly VITE_GOOGLE_AUTH_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Markdown imported as a string, for the legal pages rendered from `content/`. */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
