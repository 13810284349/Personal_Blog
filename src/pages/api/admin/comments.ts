import type { APIRoute } from "astro";
import {
  cleanText,
  createApiContext,
  errorJson,
  json,
  logApiError,
  readJsonObject,
  requireAdmin
} from "@lib/api";
import { getSupabaseAdmin } from "@lib/supabase";

export const prerender = false;

const statusValues = ["pending", "approved", "rejected"] as const;
const statuses = new Set<string>(statusValues);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ request }) => {
  const context = createApiContext(request);

  if (!requireAdmin(request)) return errorJson("未授权。", 401, { requestId: context });

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const rawQuery = cleanText(url.searchParams.get("q"), 80);
  const query = rawQuery.replace(/[%_*(),]/g, " ").replace(/\s+/g, " ").trim();

  if (!statuses.has(status)) return errorJson("无效评论状态。", 400, { requestId: context });

  try {
    const supabase = getSupabaseAdmin();
    let commentsQuery = supabase
      .from("blog_comments")
      .select(
        "id, post_slug, author_name, author_email, author_website, body, status, created_at, reviewed_at"
      )
      .eq("status", status);

    if (uuidPattern.test(query)) {
      commentsQuery = commentsQuery.eq("id", query.toLowerCase());
    } else if (query) {
      const pattern = `%${query}%`;
      commentsQuery = commentsQuery.or(
        `author_name.ilike.${pattern},body.ilike.${pattern},post_slug.ilike.${pattern}`
      );
    }

    const [{ data, error }, ...countResults] = await Promise.all([
      commentsQuery.order("created_at", { ascending: false }).limit(100),
      ...statusValues.map((value) =>
        supabase
          .from("blog_comments")
          .select("id", { count: "exact", head: true })
          .eq("status", value)
      )
    ]);

    if (error) throw error;

    const counts = statusValues.reduce<Record<(typeof statusValues)[number], number>>(
      (total, value, index) => {
        const result = countResults[index];
        if (result.error) throw result.error;
        total[value] = result.count ?? 0;
        return total;
      },
      { pending: 0, approved: 0, rejected: 0 }
    );

    return json({ ok: true, comments: data ?? [], counts }, { requestId: context });
  } catch (error) {
    logApiError(context, {
      action: "admin_list_comments",
      status: 500,
      error,
      meta: { status, hasQuery: Boolean(query) }
    });
    return errorJson("评论读取失败。", 500, { requestId: context });
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const context = createApiContext(request);

  if (!requireAdmin(request)) return errorJson("未授权。", 401, { requestId: context });

  const body = await readJsonObject(request);
  const id = cleanText(body?.id, 80);
  const status = cleanText(body?.status, 20);
  const reviewedAt = status === "pending" ? null : new Date().toISOString();

  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson("无效评论 ID。", 400, { requestId: context });
  if (!statuses.has(status)) return errorJson("无效评论状态。", 400, { requestId: context });

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

    return json({ ok: true, comment: updated }, { requestId: context });
  } catch (error) {
    logApiError(context, {
      action: "admin_update_comment",
      status: 500,
      error,
      meta: { commentId: id, status }
    });
    return errorJson("评论更新失败。", 500, { requestId: context });
  }
};
