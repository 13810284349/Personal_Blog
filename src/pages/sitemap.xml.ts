import type { APIRoute } from "astro";
import { absoluteUrl, escapeXml, sitemapDate } from "@lib/discovery";
import { getAllTags, getPublishedPosts } from "@lib/posts";

type SitemapEntry = {
  path: string;
  lastmod?: Date;
};

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const tags = await getAllTags();

  const entries: SitemapEntry[] = [
    { path: "/" },
    { path: "/about" },
    { path: "/search" },
    { path: "/tags" },
    { path: "/archive" },
    ...tags.map((tag) => ({
      path: `/tags/${encodeURIComponent(tag.name)}`
    })),
    ...posts.map((post) => ({
      path: `/posts/${post.id}`,
      lastmod: post.data.updatedAt ?? post.data.publishedAt
    }))
  ];

  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastmod
        ? `
    <lastmod>${sitemapDate(entry.lastmod)}</lastmod>`
        : "";

      return `
  <url>
    <loc>${escapeXml(absoluteUrl(entry.path))}</loc>${lastmod}
  </url>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
};
