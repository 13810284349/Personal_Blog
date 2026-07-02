import { isPublishedPostSlug } from "./posts";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ApiRequestContext = {
  requestId: string;
  endpoint: string;
  method: string;
};

export type ApiResponseInit = ResponseInit & {
  requestId?: string | ApiRequestContext;
};

type ApiLogParams = {
  action: string;
  status?: number;
  error?: unknown;
  meta?: Record<string, unknown>;
  level?: "warn" | "error";
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const SENSITIVE_LOG_KEY_PATTERN =
  /(?:token|key|secret|authorization|cookie|email|ip_?hash|\bip\b|user[_-]?agent|webhook|body|question|history|prompt|answer|content|env|password|service[_-]?role)/i;

export function createApiContext(request: Request): ApiRequestContext {
  const requestId = normalizeRequestId(request.headers.get("X-Request-Id")) ?? createRequestId();
  const endpoint = new URL(request.url).pathname;

  return {
    requestId,
    endpoint,
    method: request.method
  };
}

export function json(data: JsonValue, init: ApiResponseInit = {}) {
  const { requestId, headers: initHeaders, ...responseInit } = init;
  const headers = new Headers(initHeaders);
  const resolvedRequestId = resolveRequestId(requestId);

  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (resolvedRequestId) headers.set("X-Request-Id", resolvedRequestId);

  return new Response(JSON.stringify(data), {
    ...responseInit,
    headers
  });
}

export function errorJson(message: string, status = 400, init: ApiResponseInit = {}) {
  const requestId = resolveRequestId(init.requestId);
  const data: JsonValue = requestId ? { ok: false, message, requestId } : { ok: false, message };

  return json(data, { ...init, status });
}

export function logApiError(context: ApiRequestContext, params: ApiLogParams) {
  const status = params.status ?? 500;
  const entry = {
    requestId: context.requestId,
    endpoint: context.endpoint,
    method: context.method,
    action: sanitizeLogText(params.action).slice(0, 120),
    status,
    error: summarizeError(params.error),
    ...(params.meta ? { meta: sanitizeLogValue(params.meta) } : {})
  };
  const logger = params.level ?? (status >= 500 ? "error" : "warn");

  if (logger === "error") {
    console.error("api.error", entry);
  } else {
    console.warn("api.error", entry);
  }
}

export function sanitizeLogText(value: string, maxLength = 700) {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|AKIA|ASIA|eyJ)[A-Za-z0-9_./+=:-]{16,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_./+=:-]{80,}\b/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
    .slice(0, maxLength);
}

function normalizeRequestId(value: unknown) {
  if (typeof value !== "string") return null;
  const requestId = value.trim();
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function resolveRequestId(requestId: ApiResponseInit["requestId"]) {
  if (!requestId) return null;
  return typeof requestId === "string" ? requestId : requestId.requestId;
}

function summarizeError(error: unknown) {
  if (!error) return "unknown";

  if (error instanceof Error) {
    return {
      name: sanitizeLogText(error.name, 80),
      message: sanitizeLogText(error.message)
    };
  }

  if (isRecord(error)) {
    const summary: Record<string, unknown> = {};

    for (const key of ["name", "code", "status", "message"]) {
      if (key in error) summary[key] = error[key];
    }

    if (Object.keys(summary).length > 0) return sanitizeLogValue(summary);
  }

  return sanitizeLogText(String(error));
}

function sanitizeLogValue(value: unknown, depth = 0, key = ""): unknown {
  if (key && SENSITIVE_LOG_KEY_PATTERN.test(key)) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeLogText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= 3) return "[truncated]";

  if (Array.isArray(value)) {
    return value.slice(0, 6).map((item) => sanitizeLogValue(item, depth + 1));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 16)
        .map(([entryKey, entryValue]) => [
          sanitizeLogText(entryKey, 80),
          sanitizeLogValue(entryValue, depth + 1, entryKey)
        ])
    );
  }

  return sanitizeLogText(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
