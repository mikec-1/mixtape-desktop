/// <reference types="vite/client" />

// Accounts (account.ts, docs/accounts.md): your Supabase project, and where the web build is, for share links.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SHARE_URL?: string;
}

declare const __BUILD__: string; // the commit this was built from (vite.config.ts)
