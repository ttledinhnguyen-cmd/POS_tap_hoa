/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GOONG_API_KEY?: string;
  readonly VITE_SUPPORT_ZALO?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_BUSINESS_NAME?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// @goongmaps/goong-js không ship type definitions — declare module any
declare module "@goongmaps/goong-js";
declare module "@goongmaps/goong-js/dist/goong-js.css";
