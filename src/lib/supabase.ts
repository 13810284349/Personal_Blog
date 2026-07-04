import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = getServerEnv("SUPABASE_URL");
  const serviceRoleKey = getServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase server environment variables.");
  }

  if (serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be a server-side secret key, not a publishable key.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function getServerEnv(name: string) {
  return process.env[name] ?? import.meta.env[name];
}

export function hashIp(ip: string | null) {
  if (!ip) return null;
  let hash = 0;

  for (let index = 0; index < ip.length; index += 1) {
    hash = (hash << 5) - hash + ip.charCodeAt(index);
    hash |= 0;
  }

  return `ip_${Math.abs(hash).toString(36)}`;
}
