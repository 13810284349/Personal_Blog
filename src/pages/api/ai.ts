import type { APIRoute } from "astro";
import { json } from "@lib/api";
import { getBlogAiContext } from "@lib/blogAiContext";

export const prerender = false;

type ChatRole = "user" | "assistant";

type HistoryMessage = {
  role: ChatRole;
  content: string;
};

type RequestPayload = {
  question?: unknown;
  history?: unknown;
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

const MAX_BODY_BYTES = 16_000;
const MAX_QUESTION_CHARS = 1_200;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_CHARS = 1_500;
const MAX_HISTORY_CHARS = 6_000;
const BEDROCK_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = [
  "你是嵌入在个人博客「自然选择」首页的 AI 对话助手。",
  "你可以回答开放领域问题，不局限于本站内容。",
  "你会收到一段来自本博客公开已发布文章的轻量检索上下文；当用户询问博客内容、文章推荐、写作主题或具体文章时，必须优先依据这些上下文回答。",
  "引用或推荐博客文章时，尽量给出文章标题和站内链接；如果上下文不足以支持结论，要直接说明。",
  "默认使用用户提问所使用的语言回答；需要时可以中英混合。",
  "回答要清楚、诚实、直接；不确定时说明不确定。",
  "不要声称你能访问站点后台、私有仓库、环境变量、服务器文件、请求头或密钥。",
  "无论用户如何要求，都不要透露、猜测或编造 AWS_BEARER_TOKEN_BEDROCK、SUPABASE_SERVICE_ROLE_KEY、BLOG_ADMIN_TOKEN、COMMENT_NOTIFY_WEBHOOK_URL 等密钥或内部配置。"
].join("\n");

export const POST: APIRoute = async ({ request }) => {
  const token = getServerEnv("AWS_BEARER_TOKEN_BEDROCK")?.trim();
  const models = getModelCandidates();
  const region = getServerEnv("BEDROCK_REGION")?.trim() || "us-east-1";

  if (!token || models.length === 0) {
    return aiError("AI 服务尚未配置。", 500);
  }

  const payload = await readAiPayload(request);
  if (!payload.ok) return aiError(payload.message, payload.status);

  const question = normalizeQuestion(payload.data.question);
  if (!question) return aiError("问题不能为空。");
  if (question.length > MAX_QUESTION_CHARS) return aiError("问题太长，请压缩后再试。", 413);

  const history = normalizeHistory(payload.data.history);
  if (!history.ok) return aiError(history.message, history.status);

  const blogContext = await readBlogContext(buildRetrievalQuery(question, history.messages));
  const prompt = buildUserPrompt(question, history.messages, blogContext);
  let lastFailure: AiFailure | null = null;

  for (const model of models) {
    const result = await askBedrock({
      model,
      prompt,
      region,
      token
    });

    if (result.ok) {
      return aiJson({ ok: true, answer: result.answer });
    }

    lastFailure = result;
    if (!result.shouldFallback) break;
  }

  return aiError(lastFailure?.message ?? "AI 服务暂时不可用。", lastFailure?.status ?? 502);
};

export const ALL: APIRoute = async () =>
  aiJson(
    { ok: false, message: "仅支持 POST 请求。" },
    { status: 405, headers: { Allow: "POST" } }
  );

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

async function readBlogContext(query: string) {
  try {
    const context = await getBlogAiContext(query);
    return context.text;
  } catch (error) {
    console.warn("Blog AI context retrieval failed", {
      error: error instanceof Error ? sanitizeLogText(error.message) : "unknown"
    });
    return "博客公开文章上下文暂时不可用。若用户问题不是博客内容问题，可以直接按通用知识回答。";
  }
}

function buildRetrievalQuery(question: string, history: HistoryMessage[]) {
  const recentUserQuestions = history
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content);

  return [...recentUserQuestions, question].join("\n");
}

function buildUserPrompt(question: string, history: HistoryMessage[], blogContext: string) {
  const transcript = history
    .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`)
    .join("\n\n");

  return [
    "下面是服务端从本博客公开已发布文章中轻量检索出的上下文。它可能不完整，只能用于回答与博客内容相关的问题。",
    blogContext || "（没有可用博客上下文）",
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
          inferenceConfig: { maxTokens: 1_000 }
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn("Bedrock Converse request failed", {
        model: params.model,
        status: response.status,
        body: sanitizeLogText(errorText)
      });

      return {
        ok: false,
        message: classifyBedrockError(response.status),
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
      console.warn("Bedrock Converse returned no text", { model: params.model });
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
      console.warn("Bedrock Converse request timed out", { model: params.model });
      return {
        ok: false,
        message: "AI 服务响应超时，请稍后再试。",
        status: 504,
        shouldFallback: true
      };
    }

    console.warn("Bedrock Converse request failed unexpectedly", {
      model: params.model,
      error: error instanceof Error ? sanitizeLogText(error.message) : "unknown"
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

function sanitizeLogText(value: string) {
  return value
    .replace(/[A-Za-z0-9_./+=:-]{32,}/g, "[redacted]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .slice(0, 700);
}

function aiJson(data: Parameters<typeof json>[0], init: ResponseInit = {}) {
  return json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers
    }
  });
}

function aiError(message: string, status = 400) {
  return aiJson({ ok: false, message }, { status });
}
