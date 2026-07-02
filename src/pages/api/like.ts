import type { APIRoute } from "astro";
import {
  cleanText,
  createApiContext,
  errorJson,
  json,
  logApiError,
  readJsonObject,
  requirePublishedSlug
} from "@lib/api";
import { getSupabaseAdmin } from "@lib/supabase";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const context = createApiContext(request);
  const body = await readJsonObject(request);
  const slug = await requirePublishedSlug(body?.slug);
  const visitorId = cleanText(body?.visitorId, 128);

  if (!slug) return errorJson("无效文章 slug。", 400, { requestId: context });
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(visitorId)) {
    return errorJson("无效访客标识。", 400, { requestId: context });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("register_blog_post_like", {
      p_slug: slug,
      p_visitor_id: visitorId
    });

    if (error) throw error;

    const result = data?.[0] ?? null;
    return json({
      ok: true,
      liked: Boolean(result?.liked),
      stats: result
    }, { requestId: context });
  } catch (error) {
    logApiError(context, {
      action: "register_post_like",
      status: 500,
      error,
      meta: { slug }
    });
    return errorJson("点赞失败。", 500, { requestId: context });
  }
};
