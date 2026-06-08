import type { APIRoute } from "astro";
import {
  cleanBody,
  cleanOptionalEmail,
  cleanOptionalUrl,
  cleanText,
  errorJson,
  json,
  readJsonObject,
  requirePublishedSlug
} from "@lib/api";
import { notifyPendingComment } from "@lib/commentNotifications";
import { getSupabaseAdmin, hashIp } from "@lib/supabase";

export const prerender = false;

const DEFAULT_POST_WINDOW_SECONDS = 600;
const DEFAULT_SITE_WINDOW_SECONDS = 3600;
const DEFAULT_SITE_MAX = 5;
const DEFAULT_DUPLICATE_WINDOW_SECONDS = 86400;

function getPositiveIntegerEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCommentAbuseConfig() {
  return {
    postWindowSeconds: getPositiveIntegerEnv(
      "COMMENT_RATE_LIMIT_POST_WINDOW_SECONDS",
      DEFAULT_POST_WINDOW_SECONDS
    ),
    siteWindowSeconds: getPositiveIntegerEnv(
      "COMMENT_RATE_LIMIT_SITE_WINDOW_SECONDS",
      DEFAULT_SITE_WINDOW_SECONDS
    ),
    siteMax: getPositiveIntegerEnv("COMMENT_RATE_LIMIT_SITE_MAX", DEFAULT_SITE_MAX),
    duplicateWindowSeconds: getPositiveIntegerEnv(
      "COMMENT_DUPLICATE_WINDOW_SECONDS",
      DEFAULT_DUPLICATE_WINDOW_SECONDS
    ),
    spamWords: (process.env.COMMENT_SPAM_WORDS ?? "")
      .split(/[,\n]/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean)
  };
}

function getClientIp(request: Request) {
  const netlifyIp = request.headers.get("x-nf-client-connection-ip")?.trim();
  if (netlifyIp) return netlifyIp;

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedIp) return forwardedIp;

  return request.headers.get("x-real-ip")?.trim() || null;
}

function createdAfter(seconds: number) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function normalizeCommentBody(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function containsSpamWord(values: string[], spamWords: string[]) {
  if (!spamWords.length) return false;
  const content = values.join("\n").toLowerCase();
  return spamWords.some((word) => content.includes(word));
}

async function hasRecentPostComment(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ipHash: string,
  slug: string,
  since: string
) {
  const { count, error } = await supabase
    .from("blog_comments")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("post_slug", slug)
    .gte("created_at", since);

  if (error) throw error;
  return (count ?? 0) > 0;
}

async function countRecentSiteComments(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ipHash: string,
  since: string
) {
  const { count, error } = await supabase
    .from("blog_comments")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (error) throw error;
  return count ?? 0;
}

async function hasRecentDuplicateComment(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  params: {
    ipHash: string | null;
    slug: string;
    normalizedBody: string;
    since: string;
  }
) {
  let query = supabase.from("blog_comments").select("body").gte("created_at", params.since);

  query = params.ipHash ? query.eq("ip_hash", params.ipHash) : query.eq("post_slug", params.slug);

  const { data, error } = await query.limit(200);
  if (error) throw error;

  return (data ?? []).some(
    (comment) => normalizeCommentBody(comment.body ?? "") === params.normalizedBody
  );
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const slug = await requirePublishedSlug(url.searchParams.get("slug"));

  if (!slug) return errorJson("无效文章 slug。");

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("blog_comments")
      .select("id, author_name, author_website, body, created_at")
      .eq("post_slug", slug)
      .eq("status", "approved")
      .order("created_at", { ascending: true });

    if (error) throw error;

    return json({ ok: true, comments: data ?? [] });
  } catch {
    return errorJson("评论读取失败。", 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const body = await readJsonObject(request);
  const slug = await requirePublishedSlug(body?.slug);
  const authorName = cleanText(body?.authorName, 80);
  const commentBody = cleanBody(body?.body, 2000);
  const emailInput = cleanText(body?.authorEmail, 160);
  const websiteInput = cleanText(body?.authorWebsite, 240);
  const authorEmail = cleanOptionalEmail(emailInput);
  const authorWebsite = cleanOptionalUrl(websiteInput);

  if (!slug) return errorJson("无效文章 slug。");
  if (cleanText(body?.company, 80)) return json({ ok: true, status: "pending" });
  if (authorName.length < 1) return errorJson("昵称不能为空。");
  if (commentBody.length < 2) return errorJson("评论内容太短。");
  if (emailInput && !authorEmail) return errorJson("邮箱格式不正确。");
  if (websiteInput && !authorWebsite) return errorJson("网站地址格式不正确。");

  const abuseConfig = getCommentAbuseConfig();
  const ipHash = hashIp(getClientIp(request));
  const normalizedBody = normalizeCommentBody(commentBody);

  if (containsSpamWord([authorName, commentBody, authorWebsite ?? websiteInput], abuseConfig.spamWords)) {
    return errorJson("评论内容包含暂不支持提交的词语，请调整后再试。");
  }

  try {
    const supabase = getSupabaseAdmin();

    if (ipHash) {
      const hasRecentComment = await hasRecentPostComment(
        supabase,
        ipHash,
        slug,
        createdAfter(abuseConfig.postWindowSeconds)
      );

      if (hasRecentComment) return errorJson("同一篇文章评论提交太频繁，请稍后再试。", 429);

      const siteCommentCount = await countRecentSiteComments(
        supabase,
        ipHash,
        createdAfter(abuseConfig.siteWindowSeconds)
      );

      if (siteCommentCount >= abuseConfig.siteMax) {
        return errorJson("评论提交太频繁，请稍后再试。", 429);
      }
    }

    const hasDuplicateComment = await hasRecentDuplicateComment(supabase, {
      ipHash,
      slug,
      normalizedBody,
      since: createdAfter(abuseConfig.duplicateWindowSeconds)
    });

    if (hasDuplicateComment) return errorJson("请不要重复提交相同评论。", 409);

    await supabase
      .from("blog_post_stats")
      .upsert({ slug }, { onConflict: "slug", ignoreDuplicates: true });

    const { data, error } = await supabase
      .from("blog_comments")
      .insert({
        post_slug: slug,
        author_name: authorName,
        author_email: authorEmail,
        author_website: authorWebsite,
        body: commentBody,
        status: "pending",
        user_agent: request.headers.get("user-agent"),
        ip_hash: ipHash
      })
      .select("id, status")
      .single();

    if (error) throw error;

    await notifyPendingComment({
      slug,
      commentId: data.id,
      authorName,
      body: commentBody
    });

    return json({ ok: true, comment: data }, { status: 201 });
  } catch {
    return errorJson("评论提交失败。", 500);
  }
};
