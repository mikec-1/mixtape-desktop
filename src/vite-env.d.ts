/// <reference types="vite/client" />

// Accounts (account.ts, docs/accounts.md): your Supabase project, and where the web build is, for share links.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SHARE_URL?: string;
  readonly VITE_SENTRY_DSN?: string; // crash reports and Send Feedback (crash.ts)
  readonly VITE_FEEDBACK_EMAIL?: string; // where Send Feedback writes to when crash reports are off
}

declare const __BUILD__: string; // the commit this was built from (vite.config.ts)
