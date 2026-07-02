import type { APIRoute } from "astro";
import { json } from "@lib/api";
import { getSupabaseAdmin } from "@lib/supabase";

export const prerender = false;

type AnswerStyle = "brief" | "deep" | "literary";
type FeedbackRating = "helpful" | "unhelpful";

type AiPageContext =
  | { kind: "home" }
  | { kind: "post"; slug: string }
  | { kind: "tagIndex" }
  | { kind: "tag"; tag: string };

type AiSource = {
  title: string;
  description: string;
  url: string;
};

type FeedbackPayload = {
  messageId?: unknown;
  rating?: unknown;
  question?: unknown;
  answer?: unknown;
  answerStyle?: unknown;
  pageContext?: unknown;
  sources?: unknown;
};

const MAX_BODY_BYTES = 14_000;
const MAX_MESSAGE_ID_CHARS = 140;
const MAX_QUESTION_EXCERPT_CHARS = 700;
const MAX_ANSWER_EXCERPT_CHARS = 1_800;
const MAX_SOURCE_DESCRIPTION_CHARS = 220;
const MAX_PAGE_CONTEXT_SLUG_CHARS = 160;
const MAX_PAGE_CONTEXT_TAG_CHARS = 80;

export const POST: APIRoute = async ({ request }) => {
  const payload = await readFeedbackPayload(request);
  if (!payload.ok) return feedbackError(payload.message, payload.status);

  const messageId = normalizeMessageId(payload.data.messageId);
  const rating = normalizeRating(payload.data.rating);
  const answerStyle = normalizeAnswerStyle(payload.data.answerStyle);
  const questionExcerpt = cleanExcerpt(payload.data.question, MAX_QUESTION_EXCERPT_CHARS);
  const answerExcerpt = cleanExcerpt(payload.data.answer, MAX_ANSWER_EXCERPT_CHARS);
  const pageContext = normalizePageContext(payload.data.pageContext);
  const sources = normalizeSources(payload.data.sources);

  if (!messageId) return feedbackError("反馈标识无效。");
  if (!rating) return feedbackError("反馈类型无效。");
  if (!questionExcerpt || !answerExcerpt) return feedbackError("反馈内容不完整。");

  try {
    const now = new Date().toISOString();
    const { error } = await getSupabaseAdmin()
      .from("blog_ai_feedback")
      .upsert(
        {
          client_message_id: messageId,
          rating,
          answer_style: answerStyle,
          page_context: pageContext,
          question_excerpt: questionExcerpt,
          answer_excerpt: answerExcerpt,
          sources,
          updated_at: now
        },
        { onConflict: "client_message_id" }
      );

    if (error) throw error;

    return feedbackJson({ ok: true });
  } catch (error) {
    console.warn("AI feedback save failed", {
      error: error instanceof Error ? sanitizeLogText(error.message) : "unknown"
    });
    return feedbackError("反馈暂时无法保存。", 500);
  }
};

export const ALL: APIRoute = async () =>
  feedbackJson(
    { ok: false, message: "仅支持 POST 请求。" },
    { status: 405, headers: { Allow: "POST" } }
  );

async function readFeedbackPayload(
  request: Request
): Promise<
  | { ok: true; data: FeedbackPayload }
  | { ok: false; message: string; status: number }
> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false, message: "请求内容太大。", status: 413 };
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return { ok: false, message: "请求内容读取失败。", status: 400 };
  }

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return { ok: false, message: "请求内容太大。", status: 413 };
  }

  try {
    const data = JSON.parse(rawBody) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, message: "请求格式不正确。", status: 400 };
    }

    return { ok: true, data: data as FeedbackPayload };
  } catch {
    return { ok: false, message: "请求 JSON 无效。", status: 400 };
  }
}

function normalizeMessageId(value: unknown) {
  if (typeof value !== "string") return "";
  const messageId = value.trim();
  if (messageId.length < 8 || messageId.length > MAX_MESSAGE_ID_CHARS) return "";
  return /^[A-Za-z0-9._:-]+$/.test(messageId) ? messageId : "";
}

function normalizeRating(value: unknown): FeedbackRating | null {
  return value === "helpful" || value === "unhelpful" ? value : null;
}

function normalizeAnswerStyle(value: unknown): AnswerStyle {
  return value === "deep" || value === "literary" || value === "brief" ? value : "brief";
}

function cleanExcerpt(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizePageContext(value: unknown): AiPageContext | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const kind = "kind" in value ? value.kind : null;
  if (kind === "home" || kind === "tagIndex") return { kind };

  const slug = "slug" in value && typeof value.slug === "string" ? value.slug.trim() : "";
  const tag = "tag" in value && typeof value.tag === "string" ? value.tag.trim() : "";

  if (
    kind === "post" &&
    slug &&
    slug.length <= MAX_PAGE_CONTEXT_SLUG_CHARS &&
    !/[\u0000-\u001f\u007f]/.test(slug)
  ) {
    return { kind, slug };
  }

  if (
    kind === "tag" &&
    tag &&
    tag.length <= MAX_PAGE_CONTEXT_TAG_CHARS &&
    !/[\u0000-\u001f\u007f]/.test(tag)
  ) {
    return { kind, tag };
  }

  return null;
}

function normalizeSources(value: unknown): AiSource[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;

      const title = "title" in item && typeof item.title === "string" ? cleanExcerpt(item.title, 140) : "";
      const description =
        "description" in item && typeof item.description === "string"
          ? cleanExcerpt(item.description, MAX_SOURCE_DESCRIPTION_CHARS)
          : "";
      const url = "url" in item && typeof item.url === "string" ? item.url.trim() : "";

      if (!title || !url.startsWith("/posts/") || /[\u0000-\u001f\u007f]/.test(url)) {
        return null;
      }

      return { title, description, url };
    })
    .filter((source): source is AiSource => Boolean(source))
    .slice(0, 3);
}

function sanitizeLogText(value: string) {
  return value
    .replace(/[A-Za-z0-9_./+=:-]{32,}/g, "[redacted]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function feedbackJson(data: Parameters<typeof json>[0], init: ResponseInit = {}) {
  return json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers
    }
  });
}

function feedbackError(message: string, status = 400) {
  return feedbackJson({ ok: false, message }, { status });
}
