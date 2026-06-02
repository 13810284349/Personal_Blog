import { getCollection } from "astro:content";

export type PostEntry = Awaited<ReturnType<typeof getPublishedPosts>>[number];

export async function getPublishedPosts() {
  const posts = await getCollection("posts", ({ data }) => !data.draft);

  return posts.sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime()
  );
}

export async function getPublishedPost(slug: string) {
  const posts = await getPublishedPosts();
  return posts.find((post) => post.id === slug);
}

export async function getPublishedPostSlugs() {
  const posts = await getPublishedPosts();
  return posts.map((post) => post.id);
}

export async function isPublishedPostSlug(slug: string) {
  const slugs = await getPublishedPostSlugs();
  return slugs.includes(slug);
}

export async function getAllTags() {
  const posts = await getPublishedPosts();
  const tagMap = new Map<string, number>();

  for (const post of posts) {
    for (const tag of post.data.tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }

  return [...tagMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function readingTime(body: string) {
  const text = body.replace(/<[^>]+>/g, "");
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const minutes = Math.max(1, Math.ceil((chineseChars + latinWords * 2) / 500));
  return `${minutes} 分钟`;
}

export function normalizeTagParam(tag: string) {
  return decodeURIComponent(tag).trim();
}
