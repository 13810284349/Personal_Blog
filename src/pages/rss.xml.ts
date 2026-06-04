import type { APIRoute } from "astro";
import { absoluteUrl, escapeXml } from "@lib/discovery";
import { getPublishedPosts } from "@lib/posts";
import { site } from "@lib/site";

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const rssUrl = absoluteUrl("/rss.xml");
  const homeUrl = absoluteUrl("/");
  const latestDate =
    posts[0]?.data.updatedAt ?? posts[0]?.data.publishedAt ?? new Date();

  const items = posts
    .map((post) => {
      const postUrl = absoluteUrl(`/posts/${post.id}`);
      const categories = post.data.tags
        .map((tag) => `<category>${escapeXml(tag)}</category>`)
        .join("");

      return `
    <item>
      <title>${escapeXml(post.data.title)}</title>
      <link>${escapeXml(postUrl)}</link>
      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>
      <description>${escapeXml(post.data.description)}</description>
      <pubDate>${post.data.publishedAt.toUTCString()}</pubDate>
      ${categories}
    </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <link>${escapeXml(homeUrl)}</link>
    <description>${escapeXml(site.description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${latestDate.toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(rssUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8"
    }
  });
};
