import type { APIRoute } from "astro";
import {
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

  if (!slug) return errorJson("无效文章 slug。", 400, { requestId: context });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("increment_blog_post_view", {
      p_slug: slug
    });

    if (error) throw error;

    return json({ ok: true, stats: data?.[0] ?? null }, { requestId: context });
  } catch (error) {
    logApiError(context, {
      action: "record_post_view",
      status: 500,
      error,
      meta: { slug }
    });
    return errorJson("阅读量记录失败。", 500, { requestId: context });
  }
};
