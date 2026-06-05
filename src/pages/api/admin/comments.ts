import type { APIRoute } from "astro";
import {
  cleanText,
  errorJson,
  json,
  readJsonObject,
  requireAdmin
} from "@lib/api";
import { getSupabaseAdmin } from "@lib/supabase";

export const prerender = false;

const statuses = new Set(["pending", "approved", "rejected"]);

export const GET: APIRoute = async ({ request }) => {
  if (!requireAdmin(request)) return errorJson("未授权。", 401);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const rawQuery = cleanText(url.searchParams.get("q"), 80);
  const query = rawQuery.replace(/[%_*(),]/g, " ").replace(/\s+/g, " ").trim();

  if (!statuses.has(status)) return errorJson("无效评论状态。");

  try {
    const supabase = getSupabaseAdmin();
    let commentsQuery = supabase
      .from("blog_comments")
      .select(
        "id, post_slug, author_name, author_email, author_website, body, status, created_at, reviewed_at"
      )
      .eq("status", status);

    if (query) {
      const pattern = `%${query}%`;
      commentsQuery = commentsQuery.or(
        `author_name.ilike.${pattern},body.ilike.${pattern},post_slug.ilike.${pattern}`
      );
    }

    const { data, error } = await commentsQuery
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return json({ ok: true, comments: data ?? [] });
  } catch {
    return errorJson("评论读取失败。", 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  if (!requireAdmin(request)) return errorJson("未授权。", 401);

  const body = await readJsonObject(request);
  const id = cleanText(body?.id, 80);
  const status = cleanText(body?.status, 20);
  const reviewedAt = status === "pending" ? null : new Date().toISOString();

  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson("无效评论 ID。");
  if (!statuses.has(status)) return errorJson("无效评论状态。");

  try {
    const supabase = getSupabaseAdmin();
    const { data: updated, error } = await supabase
      .from("blog_comments")
      .update({
        status,
        reviewed_at: reviewedAt
      })
      .eq("id", id)
      .select("id, post_slug, status")
      .single();

    if (error) throw error;

    const { count, error: countError } = await supabase
      .from("blog_comments")
      .select("id", { count: "exact", head: true })
      .eq("post_slug", updated.post_slug)
      .eq("status", "approved");

    if (countError) throw countError;

    await supabase
      .from("blog_post_stats")
      .upsert(
        {
          slug: updated.post_slug,
          comments_count: count ?? 0,
          updated_at: new Date().toISOString()
        },
        { onConflict: "slug" }
      );

    return json({ ok: true, comment: updated });
  } catch {
    return errorJson("评论更新失败。", 500);
  }
};
