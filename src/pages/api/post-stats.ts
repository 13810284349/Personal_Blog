import type { APIRoute } from "astro";
import { errorJson, json, normalizeSlug } from "@lib/api";
import { getPublishedPostSlugs } from "@lib/posts";
import { getSupabaseAdmin } from "@lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const requested = (url.searchParams.get("slugs") ?? "")
    .split(",")
    .map((slug) => normalizeSlug(slug))
    .filter((slug): slug is string => Boolean(slug));

  if (!requested.length) return errorJson("缺少文章 slug。");

  const knownSlugs = new Set(await getPublishedPostSlugs());
  const slugs = [...new Set(requested)].filter((slug) => knownSlugs.has(slug));

  if (slugs.length !== requested.length) return errorJson("包含无效文章 slug。");

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("blog_post_stats")
      .select("slug, views_count, likes_count, comments_count")
      .in("slug", slugs);

    if (error) throw error;

    const stats = Object.fromEntries(
      slugs.map((slug) => [
        slug,
        {
          views_count: 0,
          likes_count: 0,
          comments_count: 0
        }
      ])
    );

    for (const row of data ?? []) {
      stats[row.slug] = {
        views_count: row.views_count,
        likes_count: row.likes_count,
        comments_count: row.comments_count
      };
    }

    return json({ ok: true, stats });
  } catch {
    return errorJson("Supabase 暂时不可用。", 500);
  }
};
