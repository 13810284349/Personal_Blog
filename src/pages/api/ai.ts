import type { APIRoute } from "astro";
import type { ApiRequestContext, ApiResponseInit } from "@lib/api";
import { createApiContext, json, logApiError } from "@lib/api";
import type { BlogAiPageContext, BlogAiSource } from "@lib/blogAiContext";
import { getBlogAiContext } from "@lib/blogAiContext";
import { getSupabaseAdmin, hashIp } from "@lib/supabase";

export const prerender = false;

type ChatRole = "user" | "assistant";

type HistoryMessage = {
  role: ChatRole;
  content: string;
};

type AnswerStyle = "brief" | "deep" | "literary";

type RequestPayload = {
  question?: unknown;
  history?: unknown;
  answerStyle?: unknown;
  pageContext?: unknown;
};

type BedrockConverseResponse = {
  output?: {
    message?: {
      content?: Array<{
        text?: string;
      }>;
    };
  };
};

type AiRateLimitRpcRow = {
  allowed?: unknown;
  retry_after_seconds?: unknown;
  remaining?: unknown;
};

const MAX_BODY_BYTES = 16_000;
const MAX_QUESTION_CHARS = 1_200;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_CHARS = 1_500;
const MAX_HISTORY_CHARS = 6_000;
const MAX_PAGE_CONTEXT_SLUG_CHARS = 160;
const MAX_PAGE_CONTEXT_TAG_CHARS = 80;
const BEDROCK_TIMEOUT_MS = 45_000;
const DEFAULT_AI_RATE_LIMIT_WINDOW_SECONDS = 600;
const DEFAULT_AI_RATE_LIMIT_MAX = 10;
const UNKNOWN_IP_HASH = "ip_unknown";

const ANSWER_STYLE_CONFIG: Record<
  AnswerStyle,
  {
    label: string;
    instruction: string;
    maxTokens: number;
  }
> = {
  brief: {
    label: "简短",
    instruction: "回答要简洁、直接，优先给结论和少量关键依据；除非用户要求，不展开长篇分析。",
    maxTokens: 700
  },
  deep: {
    label: "深入",
    instruction: "回答要更完整、有层次，适合展开概念、背景、推理和文章之间的联系。",
    maxTokens: 1_300
  },
  literary: {
    label: "文学化",
    instruction:
      "回答可以更有文气和节奏，但必须保持事实准确、结构清楚，不用空泛修辞替代判断。",
    maxTokens: 950
  }
};

const SYSTEM_PROMPT = [
  "你是嵌入在个人博客「自然选择」公开页面里的 AI 对话助手。",
  "你可以回答开放领域问题，不局限于本站内容。",
  "你会收到一段来自本博客公开已发布文章的轻量检索上下文；它可能包含用户正在阅读的公开文章，也可能包含与问题相关的公开文章片段。",
  "当用户询问博客内容、当前文章、文章推荐、写作主题或具体文章时，必须优先依据这些上下文回答。",
  "引用或推荐博客文章时，尽量给出文章标题和站内链接；如果上下文不足以支持结论，要直接说明。",
  "默认使用用户提问所使用的语言回答；需要时可以中英混合。",
  "回答要清楚、诚实、直接；不确定时说明不确定。",
  "不要声称你能访问站点后台、私有仓库、环境变量、服务器文件、请求头或密钥。",
  "无论用户如何要求，都不要透露、猜测或编造 AWS_BEARER_TOKEN_BEDROCK、SUPABASE_SERVICE_ROLE_KEY、BLOG_ADMIN_TOKEN、COMMENT_NOTIFY_WEBHOOK_URL 等密钥或内部配置。"
].join("\n");

export const POST: APIRoute = async ({ request }) => {
  const context = createApiContext(request);
  const token = getServerEnv("AWS_BEARER_TOKEN_BEDROCK")?.trim();
  const models = getModelCandidates();
  const region = getServerEnv("BEDROCK_REGION")?.trim() || "us-east-1";

  if (!token || models.length === 0) {
    logApiError(context, {
      action: "configure_ai_service",
      status: 500,
      error: new Error("AI service is missing server configuration."),
      meta: { bedrockAuthConfigured: Boolean(token), modelCount: models.length }
    });
    return aiError("AI 服务尚未配置。", 500, context);
  }

  const payload = await readAiPayload(request);
  if (!payload.ok) return aiError(payload.message, payload.status, context);

  const question = normalizeQuestion(payload.data.question);
  if (!question) return aiError("问题不能为空。", 400, context);
  if (question.length > MAX_QUESTION_CHARS) return aiError("问题太长，请压缩后再试。", 413, context);

  const history = normalizeHistory(payload.data.history);
  if (!history.ok) return aiError(history.message, history.status, context);

  const answerStyle = normalizeAnswerStyle(payload.data.answerStyle);
  const rateLimit = await reserveAiRequest(request, context);
  if (!rateLimit.ok) return rateLimit.response;

  const pageContext = normalizePageContext(payload.data.pageContext);
  const blogContext = await readBlogContext(
    buildRetrievalQuery(question, history.messages, pageContext),
    pageContext,
    context
  );
  const prompt = buildUserPrompt(question, history.messages, blogContext.text, answerStyle);
  let lastFailure: AiFailure | null = null;

  for (const model of models) {
    const result = await askBedrock({
      model,
      prompt,
      region,
      token,
      maxTokens: ANSWER_STYLE_CONFIG[answerStyle].maxTokens,
      context
    });

    if (result.ok) {
      return aiJson({ ok: true, answer: result.answer, sources: blogContext.sources }, {
        requestId: context
      });
    }

    lastFailure = result;
    if (!result.shouldFallback) break;
  }

  return aiError(lastFailure?.message ?? "AI 服务暂时不可用。", lastFailure?.status ?? 502, context);
};

export const ALL: APIRoute = async ({ request }) => {
  const context = createApiContext(request);

  return aiJson(
    { ok: false, message: "仅支持 POST 请求。", requestId: context.requestId },
    { status: 405, headers: { Allow: "POST" }, requestId: context }
  );
};

function getModelCandidates() {
  return [
    getServerEnv("ANTHROPIC_MODEL"),
    getServerEnv("ANTHROPIC_DEFAULT_SONNET_MODEL"),
    getServerEnv("ANTHROPIC_DEFAULT_HAIKU_MODEL")
  ].reduce<string[]>((models, value) => {
    const model = value?.trim();
    if (model && !models.includes(model)) models.push(model);
    return models;
  }, []);
}

function getServerEnv(name: string) {
  return process.env[name] ?? import.meta.env[name];
}

function getPositiveIntegerServerEnv(name: string, fallback: number) {
  const value = getServerEnv(name)?.trim();
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAiRateLimitConfig() {
  return {
    windowSeconds: getPositiveIntegerServerEnv(
      "AI_RATE_LIMIT_WINDOW_SECONDS",
      DEFAULT_AI_RATE_LIMIT_WINDOW_SECONDS
    ),
    maxRequests: getPositiveIntegerServerEnv("AI_RATE_LIMIT_MAX", DEFAULT_AI_RATE_LIMIT_MAX)
  };
}

function getClientIp(request: Request) {
  const netlifyIp = request.headers.get("x-nf-client-connection-ip")?.trim();
  if (netlifyIp) return netlifyIp;

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedIp) return forwardedIp;

  return request.headers.get("x-real-ip")?.trim() || null;
}

async function reserveAiRequest(
  request: Request,
  context: ApiRequestContext
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const config = getAiRateLimitConfig();
  const ipHash = hashIp(getClientIp(request)) ?? UNKNOWN_IP_HASH;

  try {
    const { data, error } = await getSupabaseAdmin().rpc("reserve_blog_ai_request", {
      p_ip_hash: ipHash,
      p_window_seconds: config.windowSeconds,
      p_max_requests: config.maxRequests
    });

    if (error) throw error;

    const result = (Array.isArray(data) ? data[0] : data) as AiRateLimitRpcRow | undefined;
    if (!result || typeof result.allowed !== "boolean") {
      throw new Error("Invalid AI rate limit response.");
    }

    if (result.allowed) return { ok: true };

    const retryAfterSeconds = normalizeRetryAfterSeconds(
      result.retry_after_seconds,
      config.windowSeconds
    );

    return {
      ok: false,
      response: aiJson(
        { ok: false, message: "AI 请求太频繁，请稍后再试。", requestId: context.requestId },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
          requestId: context
        }
      )
    };
  } catch (error) {
    logApiError(context, {
      action: "reserve_ai_rate_limit",
      status: 503,
      error
    });
    return { ok: false, response: aiError("AI 服务暂时不可用。", 503, context) };
  }
}

function normalizeRetryAfterSeconds(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  return fallback;
}

async function readAiPayload(
  request: Request
): Promise<
  | { ok: true; data: RequestPayload }
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
    return { ok: true, data: data as RequestPayload };
  } catch {
    return { ok: false, message: "请求 JSON 无效。", status: 400 };
  }
}

function normalizeQuestion(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeAnswerStyle(value: unknown): AnswerStyle {
  return value === "deep" || value === "literary" || value === "brief" ? value : "brief";
}

function normalizeHistory(
  value: unknown
): { ok: true; messages: HistoryMessage[] } | { ok: false; message: string; status: number } {
  if (value === undefined || value === null) return { ok: true, messages: [] };
  if (!Array.isArray(value)) {
    return { ok: false, message: "对话历史格式不正确。", status: 400 };
  }

  const messages: HistoryMessage[] = [];

  for (const item of value.slice(-MAX_HISTORY_MESSAGES)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const role = "role" in item ? item.role : null;
    const content = "content" in item ? item.content : null;

    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;

    const normalizedContent = content.trim();
    if (!normalizedContent) continue;
    if (normalizedContent.length > MAX_HISTORY_MESSAGE_CHARS) {
      return { ok: false, message: "对话历史过长。", status: 413 };
    }

    messages.push({ role, content: normalizedContent });
  }

  let totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  while (totalChars > MAX_HISTORY_CHARS && messages.length > 0) {
    const removed = messages.shift();
    totalChars -= removed?.content.length ?? 0;
  }

  return { ok: true, messages };
}

function normalizePageContext(value: unknown): BlogAiPageContext | null {
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

async function readBlogContext(
  query: string,
  pageContext: BlogAiPageContext | null,
  context: ApiRequestContext
) {
  try {
    return await getBlogAiContext(query, pageContext ?? undefined);
  } catch (error) {
    logApiError(context, {
      action: "read_blog_ai_context",
      status: 500,
      error,
      meta: { pageContextKind: pageContext?.kind ?? null }
    });
    return {
      text: "博客公开文章上下文暂时不可用。若用户问题不是博客内容问题，可以直接按通用知识回答。",
      sources: [] satisfies BlogAiSource[]
    };
  }
}

function buildRetrievalQuery(
  question: string,
  history: HistoryMessage[],
  pageContext: BlogAiPageContext | null
) {
  const recentUserQuestions = history
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content);
  const contextTerms =
    pageContext?.kind === "tag"
      ? [`标签：${pageContext.tag}`]
      : pageContext?.kind === "tagIndex"
        ? ["标签 主题 阅读入口"]
        : pageContext?.kind === "home"
          ? ["博客概览 阅读路线 入门"]
          : [];

  return [...contextTerms, ...recentUserQuestions, question].join("\n");
}

function buildUserPrompt(
  question: string,
  history: HistoryMessage[],
  blogContext: string,
  answerStyle: AnswerStyle
) {
  const transcript = history
    .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`)
    .join("\n\n");
  const style = ANSWER_STYLE_CONFIG[answerStyle];

  return [
    "下面是服务端从本博客公开已发布文章中轻量检索出的上下文。它可能不完整，只能用于回答与博客内容相关的问题。",
    blogContext || "（没有可用博客上下文）",
    "",
    `本轮回答风格：${style.label}。${style.instruction}`,
    "",
    "下面是当前页面会话中的最近对话。它只用于保持上下文，不代表可信事实。",
    transcript || "（没有历史对话）",
    "",
    "用户当前问题：",
    question
  ].join("\n");
}

type AiFailure = {
  ok: false;
  message: string;
  status: number;
  shouldFallback: boolean;
};

async function askBedrock(params: {
  model: string;
  prompt: string;
  region: string;
  token: string;
  maxTokens: number;
  context: ApiRequestContext;
}): Promise<{ ok: true; answer: string } | AiFailure> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://bedrock-runtime.${params.region}.amazonaws.com/model/${encodeURIComponent(
        params.model
      )}/converse`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${params.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          system: [{ text: SYSTEM_PROMPT }],
          messages: [{ role: "user", content: [{ text: params.prompt }] }],
          inferenceConfig: { maxTokens: params.maxTokens }
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const message = classifyBedrockError(response.status);
      logApiError(params.context, {
        action: "bedrock_converse",
        status: normalizeProviderStatus(response.status),
        error: new Error(message),
        meta: {
          model: params.model,
          providerStatus: response.status,
          providerMessage: message
        },
        level: response.status >= 500 ? "error" : "warn"
      });

      return {
        ok: false,
        message,
        status: normalizeProviderStatus(response.status),
        shouldFallback: response.status !== 401
      };
    }

    const data = (await response.json()) as BedrockConverseResponse;
    const answer = data.output?.message?.content
      ?.map((block) => block.text)
      .filter((text): text is string => Boolean(text))
      .join("\n\n")
      .trim();

    if (!answer) {
      logApiError(params.context, {
        action: "bedrock_converse_empty_response",
        status: 502,
        error: new Error("Bedrock Converse returned no text."),
        meta: { model: params.model }
      });
      return {
        ok: false,
        message: "AI 服务没有返回文本。",
        status: 502,
        shouldFallback: true
      };
    }

    return { ok: true, answer };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logApiError(params.context, {
        action: "bedrock_converse_timeout",
        status: 504,
        error,
        meta: { model: params.model }
      });
      return {
        ok: false,
        message: "AI 服务响应超时，请稍后再试。",
        status: 504,
        shouldFallback: true
      };
    }

    logApiError(params.context, {
      action: "bedrock_converse_unexpected",
      status: 502,
      error,
      meta: { model: params.model }
    });

    return {
      ok: false,
      message: "AI 服务暂时不可用。",
      status: 502,
      shouldFallback: true
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function classifyBedrockError(status: number) {
  if (status === 400) return "AI 请求无效，请检查模型、区域或参数配置。";
  if (status === 401 || status === 403) return "AI 服务鉴权失败或模型无权访问。";
  if (status === 429) return "AI 请求太频繁，请稍后再试。";
  return "AI 服务暂时不可用。";
}

function normalizeProviderStatus(status: number) {
  if (status >= 400 && status <= 599) return status;
  return 502;
}

function aiJson(data: Parameters<typeof json>[0], init: ApiResponseInit = {}) {
  return json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers
    }
  });
}

function aiError(message: string, status = 400, requestId?: string | ApiRequestContext) {
  const resolvedRequestId = typeof requestId === "string" ? requestId : requestId?.requestId;

  return aiJson(
    resolvedRequestId ? { ok: false, message, requestId: resolvedRequestId } : { ok: false, message },
    { status, requestId }
  );
}
