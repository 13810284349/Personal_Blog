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
import { getSupabaseAdmin, hashIp } from "@lib/supabase";

export const prerender = false;

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

  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from("blog_post_stats")
      .upsert({ slug }, { onConflict: "slug", ignoreDuplicates: true });

    const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
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
        ip_hash: hashIp(forwardedIp ?? null)
      })
      .select("id, status")
      .single();

    if (error) throw error;

    return json({ ok: true, comment: data }, { status: 201 });
  } catch {
    return errorJson("评论提交失败。", 500);
  }
};
