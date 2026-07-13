"use client";
import { createBrowserClient } from "@supabase/ssr";
import { authCookieOptions } from "./cookieOptions";

// Fallbacks keep the production BUILD from crashing when env vars are not
// inlined yet. At runtime in the browser the real NEXT_PUBLIC_* values are used.
// You MUST still set the real values in your host (Vercel) for data to load.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (_client) return _client;
  _client = createBrowserClient(URL, ANON, authCookieOptions ? { cookieOptions: authCookieOptions } : undefined);
  return _client;
}

/** True only when real Supabase credentials are configured. */
export const supabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
