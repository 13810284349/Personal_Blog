import { isPublishedPostSlug } from "./posts";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function json(data: JsonValue, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}

export function errorJson(message: string, status = 400) {
  return json({ ok: false, message }, { status });
}

export function normalizeSlug(value: unknown) {
  if (typeof value !== "string") return null;
  const slug = value.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) return null;
  return slug;
}

export async function requirePublishedSlug(value: unknown) {
  const slug = normalizeSlug(value);
  if (!slug) return null;
  return (await isPublishedPostSlug(slug)) ? slug : null;
}

export function requireAdmin(request: Request) {
  const token = process.env.BLOG_ADMIN_TOKEN;
  if (!token) return false;
  const header = request.headers.get("Authorization") ?? "";
  return header === `Bearer ${token}`;
}

export async function readJsonObject(request: Request) {
  try {
    const data = await request.json();
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function cleanBody(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function cleanOptionalEmail(value: unknown) {
  const email = cleanText(value, 160);
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function cleanOptionalUrl(value: unknown) {
  const url = cleanText(value, 240);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}
