// SECURITY: This file uses the SUPABASE_SERVICE_ROLE_KEY, which bypasses all RLS.
// It must NEVER be imported from client components, browser code, or any file
// that is not exclusively server-side. The `server-only` import enforces this at
// build time — Next.js will throw a build error if this file lands in a client bundle.
import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
