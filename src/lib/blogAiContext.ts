import { formatDate, getPublishedPosts } from "@lib/posts";
import { site } from "@lib/site";

const MAX_CONTEXT_CHARS = 10_000;
const MAX_RELEVANT_POSTS = 5;
const MAX_SNIPPETS_PER_POST = 2;
const MAX_SNIPPET_CHARS = 520;
const MAX_CATALOG_POSTS = 24;

const CHINESE_STOP_TERMS = new Set([
  "这个",
  "那个",
  "什么",
  "怎么",
  "如何",
  "可以",
  "帮我",
  "一下",
  "一点",
  "哪些",
  "哪个",
  "为什",
  "么的"
]);

type IndexedPost = {
  order: number;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  publishedAtText: string;
  url: string;
  text: string;
  normalizedTitle: string;
  normalizedDescription: string;
  normalizedTags: string;
  normalizedText: string;
  paragraphs: string[];
};

type ScoredPost = IndexedPost & {
  score: number;
  snippets: string[];
};

export type BlogAiContext = {
  text: string;
  totalPosts: number;
  relevantPosts: number;
  includesCatalog: boolean;
};

export async function getBlogAiContext(query: string): Promise<BlogAiContext> {
  const posts = await getPublishedPosts();
  const indexedPosts = posts.map((post, order) => {
    const text = stripMdx(post.body ?? "");

    return {
      order,
      slug: post.id,
      title: post.data.title,
      description: post.data.description,
      tags: post.data.tags,
      publishedAtText: formatDate(post.data.publishedAt),
      url: postUrl(post.id),
      text,
      normalizedTitle: normalizeForSearch(post.data.title),
      normalizedDescription: normalizeForSearch(post.data.description),
      normalizedTags: normalizeForSearch(post.data.tags.join(" ")),
      normalizedText: normalizeForSearch(text),
      paragraphs: splitParagraphs(text)
    };
  });

  const terms = extractSearchTerms(query);
  const includesCatalog = isCatalogIntent(query);
  const scoredPosts = indexedPosts
    .map((post) => scorePost(post, terms))
    .filter((post) => includesCatalog || post.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const relevantPosts = (includesCatalog ? scoredPosts.slice(0, MAX_RELEVANT_POSTS) : scoredPosts).slice(
    0,
    MAX_RELEVANT_POSTS
  );

  return {
    text: buildContextText({
      includesCatalog,
      posts: indexedPosts,
      relevantPosts
    }),
    totalPosts: indexedPosts.length,
    relevantPosts: relevantPosts.length,
    includesCatalog
  };
}

function scorePost(post: IndexedPost, terms: string[]): ScoredPost {
  const score =
    scoreText(post.normalizedTitle, terms, 10) +
    scoreText(post.normalizedTags, terms, 8) +
    scoreText(post.normalizedDescription, terms, 5) +
    scoreText(post.normalizedText, terms, 1);

  return {
    ...post,
    score,
    snippets: pickSnippets(post.paragraphs, terms)
  };
}

function buildContextText(params: {
  includesCatalog: boolean;
  posts: IndexedPost[];
  relevantPosts: ScoredPost[];
}) {
  const lines: string[] = [
    `站点：${site.name}`,
    `副标题：${site.subtitle}`,
    `简介：${site.description}`,
    "以下上下文只来自本博客公开已发布文章；不包含草稿、后台数据、评论审核数据、环境变量或服务器私密信息。"
  ];

  if (params.posts.length === 0) {
    lines.push("当前没有可用于检索的已发布文章。");
    return lines.join("\n");
  }

  if (params.includesCatalog) {
    lines.push("", "已发布文章清单（从新到旧，压缩摘要）：");
    for (const post of params.posts.slice(0, MAX_CATALOG_POSTS)) {
      lines.push(formatPostSummary(post));
    }
  }

  lines.push("", "与当前问题最相关的文章片段：");

  if (params.relevantPosts.length === 0) {
    lines.push("未检索到明显相关的已发布文章。若用户问题不是博客内容问题，可以直接按通用知识回答。");
    return clampContext(lines.join("\n"));
  }

  for (const post of params.relevantPosts) {
    lines.push(formatPostSummary(post));
    if (post.snippets.length > 0) {
      lines.push("片段：");
      for (const snippet of post.snippets) {
        lines.push(`- ${snippet}`);
      }
    }
  }

  return clampContext(lines.join("\n"));
}

function formatPostSummary(post: IndexedPost) {
  const tags = post.tags.length > 0 ? post.tags.join("、") : "无标签";
  return `- 《${post.title}》｜${post.publishedAtText}｜${post.url}｜标签：${tags}｜摘要：${post.description}`;
}

function pickSnippets(paragraphs: string[], terms: string[]) {
  if (terms.length === 0) return paragraphs.slice(0, 1).map(limitSnippet);

  return paragraphs
    .map((paragraph) => ({
      paragraph,
      score: scoreText(normalizeForSearch(paragraph), terms, 1)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SNIPPETS_PER_POST)
    .map((item) => limitSnippet(item.paragraph));
}

function scoreText(text: string, terms: string[], weight: number) {
  return terms.reduce((score, term) => score + countOccurrences(text, term) * weight, 0);
}

function countOccurrences(text: string, term: string) {
  if (!term) return 0;

  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }

  return count;
}

function extractSearchTerms(value: string) {
  const normalized = normalizeForSearch(value);
  const terms = new Set<string>();

  for (const token of normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []) {
    terms.add(token);
  }

  for (const run of normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    if (run.length <= 8 && !CHINESE_STOP_TERMS.has(run)) terms.add(run);

    for (let index = 0; index <= run.length - 2; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (!CHINESE_STOP_TERMS.has(bigram)) terms.add(bigram);
    }

    for (let index = 0; index <= run.length - 3; index += 1) {
      const trigram = run.slice(index, index + 3);
      if (!CHINESE_STOP_TERMS.has(trigram)) terms.add(trigram);
    }
  }

  return [...terms].slice(0, 80);
}

function isCatalogIntent(query: string) {
  const normalized = normalizeForSearch(query);

  return (
    /博客.*(写|讲|内容|主题|关于|是什么|有什么)/.test(normalized) ||
    /(这个|本)?博客(写|讲|内容|主题|关于|是什么|有什么)/.test(normalized) ||
    /(文章|博客).*(推荐|开始|先看|哪篇|入门)/.test(normalized) ||
    /(推荐|开始|先看|哪篇|入门).*(文章|博客)/.test(normalized) ||
    /(文章列表|全部文章|所有文章|最新文章|最近文章|有哪些文章|归档|标签)/.test(normalized)
  );
}

function stripMdx(value: string) {
  return value
    .replace(/^---[\s\S]*?---/, "\n")
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/^import\s+.*$/gm, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<\/?[^>\n]+>/g, " ")
    .replace(/[#{}`*_~>]/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length >= 20);
}

function limitSnippet(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_SNIPPET_CHARS) return normalized;
  return `${normalized.slice(0, MAX_SNIPPET_CHARS).trim()}...`;
}

function normalizeForSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u3400-\u9fff_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampContext(value: string) {
  if (value.length <= MAX_CONTEXT_CHARS) return value;
  return `${value.slice(0, MAX_CONTEXT_CHARS).trim()}\n（以上为截断后的公开文章上下文。）`;
}

function postUrl(slug: string) {
  return `/posts/${slug.split("/").map(encodeURIComponent).join("/")}/`;
}
