import { formatDate, getPublishedPosts } from "@lib/posts";
import { site } from "@lib/site";

const MAX_CONTEXT_CHARS = 10_000;
const MAX_RELEVANT_POSTS = 5;
const MAX_SOURCE_POSTS = 3;
const MAX_SNIPPETS_PER_POST = 2;
const MAX_CURRENT_POST_SNIPPETS = 4;
const MAX_SNIPPET_CHARS = 520;
const MAX_CATALOG_POSTS = 24;
const MAX_RELATED_CONTEXT_POSTS = 5;
const MIN_SOURCE_SCORE = 2;
const MAX_QUERY_TERMS = 120;
const MAX_BODY_SEGMENTS_FOR_SCORE = 3;
const MIN_SEGMENT_CHARS = 80;
const MAX_FIELD_MATCHES = 3;
const MAX_SNIPPET_MATCHES = 4;

const FIELD_WEIGHTS = {
  title: 14,
  tags: 12,
  description: 7,
  heading: 4,
  segment: 1.6
} as const;

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
  "哪篇",
  "文章",
  "博客",
  "推荐",
  "适合",
  "开始",
  "先看",
  "为什",
  "么的"
]);

const SYNONYM_GROUPS = [
  [
    "百年孤独",
    "one hundred years of solitude",
    "hundred years of solitude",
    "cien anos de soledad",
    "cien años de soledad",
    "macondo",
    "马孔多",
    "buendia",
    "buendía",
    "布恩迪亚",
    "marquez",
    "márquez",
    "马尔克斯",
    "加西亚马尔克斯",
    "garcia marquez",
    "gabriel garcia marquez",
    "羊皮卷",
    "梅尔基亚德斯"
  ],
  [
    "ai",
    "artificial intelligence",
    "人工智能",
    "大模型",
    "大型语言模型",
    "语言模型",
    "llm",
    "large language model",
    "gpt",
    "chatgpt",
    "transformer",
    "agent",
    "智能体",
    "多模态",
    "推理模型"
  ],
  [
    "astro",
    "mdx",
    "supabase",
    "netlify",
    "pagefind",
    "博客技术栈",
    "技术栈",
    "小博客",
    "静态站点",
    "个人博客"
  ],
  [
    "物理",
    "物理学",
    "科学史",
    "爱因斯坦",
    "einstein",
    "相对论",
    "广义相对论",
    "狭义相对论",
    "光量子",
    "布朗运动",
    "引力波",
    "宇宙学",
    "spacetime",
    "时空"
  ],
  [
    "论文解读",
    "paper",
    "论文",
    "attention is all you need",
    "transformer",
    "gpt",
    "rlhf",
    "webgpt",
    "instructgpt"
  ],
  [
    "飞书",
    "lark",
    "feishu",
    "协作平台",
    "团队日常",
    "agent 平台",
    "ai agent",
    "企业 ai",
    "技能体系",
    "skills"
  ]
];

const STARTER_POSITIVE_TERMS = [
  "入门",
  "导读",
  "概览",
  "简史",
  "梳理",
  "起点",
  "脉络",
  "结构",
  "阅读",
  "时间",
  "家族",
  "历史",
  "发展",
  "如何",
  "为什么",
  "核心",
  "全部",
  "小说解读",
  "技术脉络"
];

const DEEP_DIVE_MARKERS = [
  "第九章",
  "单章",
  "这一章",
  "本章",
  "深度分析",
  "全面深度",
  "经典表达"
];

type IndexedPost = {
  order: number;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  publishedAtText: string;
  url: string;
  normalizedTitle: string;
  normalizedDescription: string;
  normalizedTags: string;
  normalizedMetadata: string;
  segments: IndexedSegment[];
};

type IndexedSegment = {
  order: number;
  heading: string;
  text: string;
  normalizedHeading: string;
  normalizedText: string;
};

type SearchQuery = {
  terms: SearchTerm[];
  includesCatalog: boolean;
  includesRelatedIntent: boolean;
  includesCurrentPostIntent: boolean;
  includesStarterIntent: boolean;
};

type SearchTerm = {
  term: string;
  weight: number;
};

type ScoredSegment = IndexedSegment & {
  score: number;
};

type ScoredPost = IndexedPost & {
  score: number;
  snippets: string[];
};

export type BlogAiSource = {
  title: string;
  description: string;
  url: string;
};

export type BlogAiPageContext =
  | { kind: "home" }
  | { kind: "post"; slug: string }
  | { kind: "tagIndex" }
  | { kind: "tag"; tag: string };

export type BlogAiContext = {
  text: string;
  sources: BlogAiSource[];
  totalPosts: number;
  relevantPosts: number;
  includesCatalog: boolean;
};

export async function getBlogAiContext(
  query: string,
  pageContext?: BlogAiPageContext
): Promise<BlogAiContext> {
  const posts = await getPublishedPosts();
  const indexedPosts = posts.map((post, order) => {
    const rawBody = post.body ?? "";
    const normalizedTitle = normalizeForSearch(post.data.title);
    const normalizedDescription = normalizeForSearch(post.data.description);
    const normalizedTags = normalizeForSearch(post.data.tags.join(" "));

    return {
      order,
      slug: post.id,
      title: post.data.title,
      description: post.data.description,
      tags: post.data.tags,
      publishedAtText: formatDate(post.data.publishedAt),
      url: postUrl(post.id),
      normalizedTitle,
      normalizedDescription,
      normalizedTags,
      normalizedMetadata: [normalizedTitle, normalizedDescription, normalizedTags].join(" "),
      segments: buildSegments(rawBody)
    };
  });

  const searchQuery = buildSearchQuery(query);
  const includesCatalog =
    searchQuery.includesCatalog || pageContext?.kind === "home" || pageContext?.kind === "tagIndex";
  const tagContext = pageContext?.kind === "tag" ? pageContext.tag : undefined;
  const tagPosts = tagContext ? getTagPosts(indexedPosts, tagContext) : [];
  const currentPost =
    pageContext?.kind === "post"
      ? indexedPosts.find((post) => post.slug === pageContext.slug)
      : undefined;
  const currentPostSnippets = currentPost ? pickCurrentPostSnippets(currentPost, searchQuery) : [];
  const relatedPosts = currentPost ? getRelatedPosts(indexedPosts, currentPost) : [];
  const scoredPosts = indexedPosts
    .filter((post) => post.slug !== currentPost?.slug)
    .map((post) => applyPageContextScore(scorePost(post, searchQuery), tagContext))
    .filter((post) => includesCatalog || post.score > 0 || isTaggedPost(post, tagContext))
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const relevantPosts = (includesCatalog
    ? scoredPosts.slice(0, MAX_RELEVANT_POSTS)
    : scoredPosts
  ).slice(0, MAX_RELEVANT_POSTS);

  return {
    text: buildContextText({
      pageContext,
      includesCatalog,
      includesRelatedIntent: searchQuery.includesRelatedIntent,
      includesStarterIntent: searchQuery.includesStarterIntent,
      currentPost,
      currentPostSnippets,
      posts: indexedPosts,
      tagContext,
      tagPosts,
      relatedPosts,
      relevantPosts
    }),
    sources: buildSources({
      currentPost,
      includesCatalog,
      includesCurrentPostIntent: searchQuery.includesCurrentPostIntent,
      includesRelatedIntent: searchQuery.includesRelatedIntent,
      tagContext,
      tagPosts,
      relatedPosts,
      relevantPosts
    }),
    totalPosts: indexedPosts.length,
    relevantPosts: relevantPosts.length + (currentPost ? 1 : 0),
    includesCatalog
  };
}

function scorePost(post: IndexedPost, searchQuery: SearchQuery): ScoredPost {
  const metadataScore =
    scoreField(post.normalizedTitle, searchQuery.terms, FIELD_WEIGHTS.title, MAX_FIELD_MATCHES) +
    scoreField(post.normalizedTags, searchQuery.terms, FIELD_WEIGHTS.tags, MAX_FIELD_MATCHES) +
    scoreField(
      post.normalizedDescription,
      searchQuery.terms,
      FIELD_WEIGHTS.description,
      MAX_FIELD_MATCHES
    );
  const scoredSegments = scoreSegments(post.segments, searchQuery);
  const segmentScore = scoredSegments
    .slice(0, MAX_BODY_SEGMENTS_FOR_SCORE)
    .reduce((score, segment) => score + segment.score, 0);
  const starterBoost = scoreStarterFit(post, searchQuery);
  const score = metadataScore + segmentScore + starterBoost;

  return {
    ...post,
    score,
    snippets: pickSnippets(post.segments, searchQuery, scoredSegments)
  };
}

function applyPageContextScore(post: ScoredPost, tagContext?: string): ScoredPost {
  if (!isTaggedPost(post, tagContext)) return post;

  return {
    ...post,
    score: post.score + 28
  };
}

function isTaggedPost(post: IndexedPost, tagContext?: string) {
  if (!tagContext) return false;
  const normalizedTag = normalizeTagValue(tagContext);
  return post.tags.some((tag) => normalizeTagValue(tag) === normalizedTag);
}

function getTagPosts(posts: IndexedPost[], tagContext: string) {
  return posts.filter((post) => isTaggedPost(post, tagContext));
}

function normalizeTagValue(value: string) {
  return normalizeForSearch(value).replace(/\s+/g, "");
}

function buildContextText(params: {
  pageContext?: BlogAiPageContext;
  includesCatalog: boolean;
  includesRelatedIntent: boolean;
  includesStarterIntent: boolean;
  currentPost?: IndexedPost;
  currentPostSnippets: string[];
  posts: IndexedPost[];
  tagContext?: string;
  tagPosts: IndexedPost[];
  relatedPosts: IndexedPost[];
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

  if (params.pageContext?.kind === "home") {
    lines.push("", "当前页面上下文：用户正在浏览博客首页，通常需要站点概览、入门文章或阅读路线。");
  }

  if (params.pageContext?.kind === "tagIndex") {
    lines.push("", "当前页面上下文：用户正在浏览标签索引页，通常需要理解主题分布或选择阅读入口。");
  }

  if (params.currentPost) {
    lines.push("", "当前页面上下文：用户正在阅读这篇公开已发布文章。");
    lines.push(formatPostSummary(params.currentPost));

    if (params.currentPostSnippets.length > 0) {
      lines.push("当前文章正文片段：");
      for (const snippet of params.currentPostSnippets) {
        lines.push(`- ${snippet}`);
      }
    }
  }

  if (params.tagContext) {
    lines.push("", `当前页面上下文：用户正在浏览标签「${params.tagContext}」下的公开文章。`);

    if (params.tagPosts.length === 0) {
      lines.push("没有找到该标签下的已发布文章。");
    } else {
      lines.push("该标签下的文章（从新到旧）：");
      for (const post of params.tagPosts.slice(0, MAX_RELATED_CONTEXT_POSTS)) {
        lines.push(formatPostSummary(post));
      }
    }
  }

  if (params.currentPost && params.includesRelatedIntent) {
    lines.push("", "与当前文章同标签的相关文章候选：");

    if (params.relatedPosts.length === 0) {
      lines.push("未找到与当前文章共享标签的已发布文章。");
    } else {
      for (const post of params.relatedPosts.slice(0, MAX_RELATED_CONTEXT_POSTS)) {
        lines.push(formatPostSummary(post));
      }
    }
  }

  if (params.includesStarterIntent) {
    lines.push(
      "",
      "当前问题包含入门/先看意图；下方“最相关文章片段”已优先排序适合作为起点或概览的文章。"
    );
  }

  if (params.includesCatalog) {
    lines.push("", "已发布文章清单（从新到旧，压缩摘要）：");
    for (const post of params.posts.slice(0, MAX_CATALOG_POSTS)) {
      lines.push(formatPostSummary(post));
    }
  }

  lines.push(
    "",
    params.currentPost ? "与当前问题最相关的其他文章片段：" : "与当前问题最相关的文章片段："
  );

  if (params.relevantPosts.length === 0) {
    lines.push(
      params.currentPost
        ? "除当前文章外，未检索到明显相关的其他已发布文章。"
        : "未检索到明显相关的已发布文章。若用户问题不是博客内容问题，可以直接按通用知识回答。"
    );
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

function buildSources(params: {
  currentPost?: IndexedPost;
  includesCatalog: boolean;
  includesCurrentPostIntent: boolean;
  includesRelatedIntent: boolean;
  tagContext?: string;
  tagPosts: IndexedPost[];
  relatedPosts: IndexedPost[];
  relevantPosts: ScoredPost[];
}): BlogAiSource[] {
  const sources: BlogAiSource[] = [];
  const seenUrls = new Set<string>();

  function addSource(post: IndexedPost) {
    if (seenUrls.has(post.url) || sources.length >= MAX_SOURCE_POSTS) return;
    seenUrls.add(post.url);
    sources.push({
      title: post.title,
      description: post.description,
      url: post.url
    });
  }

  if (params.currentPost && params.includesCurrentPostIntent) addSource(params.currentPost);

  if (params.currentPost && params.includesRelatedIntent) {
    for (const post of params.relatedPosts) addSource(post);
  }

  if (params.tagContext) {
    for (const post of params.tagPosts) addSource(post);
  }

  for (const post of params.relevantPosts) {
    if (params.includesCatalog || post.score >= MIN_SOURCE_SCORE) addSource(post);
  }

  return sources;
}

function pickSnippets(
  segments: IndexedSegment[],
  searchQuery: SearchQuery,
  scoredSegments = scoreSegments(segments, searchQuery)
) {
  if (segments.length === 0) return [];
  if (searchQuery.terms.length === 0) {
    return segments.slice(0, 1).map((segment) => limitSnippet(formatSegmentSnippet(segment)));
  }

  const matchedSegments = scoredSegments.filter((segment) => segment.score > 0);
  const snippetSegments = matchedSegments.length > 0 ? matchedSegments : segments.slice(0, 1);

  return snippetSegments
    .slice(0, MAX_SNIPPETS_PER_POST)
    .map((segment) => limitSnippet(formatSegmentSnippet(segment)));
}

function pickCurrentPostSnippets(post: IndexedPost, searchQuery: SearchQuery) {
  const snippets = new Set<string>();

  for (const snippet of pickSnippets(post.segments, searchQuery)) {
    snippets.add(snippet);
  }

  for (const segment of post.segments) {
    snippets.add(limitSnippet(formatSegmentSnippet(segment)));
    if (snippets.size >= MAX_CURRENT_POST_SNIPPETS) break;
  }

  return [...snippets].slice(0, MAX_CURRENT_POST_SNIPPETS);
}

function getRelatedPosts(posts: IndexedPost[], currentPost: IndexedPost) {
  const currentTags = new Set(currentPost.tags);
  if (currentTags.size === 0) return [];

  return posts
    .filter((post) => post.slug !== currentPost.slug)
    .map((post) => {
      const sharedTagsCount = post.tags.reduce(
        (count, tag) => count + (currentTags.has(tag) ? 1 : 0),
        0
      );

      return { post, sharedTagsCount };
    })
    .filter(({ sharedTagsCount }) => sharedTagsCount > 0)
    .sort(
      (a, b) =>
        b.sharedTagsCount - a.sharedTagsCount ||
        a.post.order - b.post.order
    )
    .slice(0, MAX_RELATED_CONTEXT_POSTS)
    .map(({ post }) => post);
}

function scoreSegments(segments: IndexedSegment[], searchQuery: SearchQuery): ScoredSegment[] {
  return segments
    .map((segment) => ({
      ...segment,
      score:
        scoreField(
          segment.normalizedHeading,
          searchQuery.terms,
          FIELD_WEIGHTS.heading,
          MAX_FIELD_MATCHES
        ) +
        scoreField(
          segment.normalizedText,
          searchQuery.terms,
          FIELD_WEIGHTS.segment,
          MAX_SNIPPET_MATCHES
        )
    }))
    .sort((a, b) => b.score - a.score || a.order - b.order);
}

function scoreStarterFit(post: IndexedPost, searchQuery: SearchQuery) {
  if (!searchQuery.includesStarterIntent) return 0;

  let score = 0;

  for (const marker of STARTER_POSITIVE_TERMS) {
    if (normalizedIncludesTerm(post.normalizedMetadata, normalizeForSearch(marker))) {
      score += 6;
    }
  }

  if (/从.+到/.test(post.normalizedTitle)) score += 12;
  if (/(简史|梳理|导读|概览|脉络)/.test(post.normalizedMetadata)) score += 14;
  if (/(结构|阅读|历史|发展|家族|时间)/.test(post.normalizedDescription)) score += 10;
  if (normalizedIncludesTerm(post.normalizedTags, normalizeForSearch("小说解读"))) score += 12;

  for (const marker of DEEP_DIVE_MARKERS) {
    if (normalizedIncludesTerm(post.normalizedMetadata, normalizeForSearch(marker))) {
      score -= 18;
    }
  }

  return score;
}

function scoreField(text: string, terms: SearchTerm[], fieldWeight: number, maxMatches: number) {
  if (!text || terms.length === 0) return 0;

  return terms.reduce(
    (score, term) =>
      score + countTermMatches(text, term.term, maxMatches) * term.weight * fieldWeight,
    0
  );
}

function countTermMatches(text: string, term: string, maxMatches: number) {
  if (!term) return 0;

  let count = 0;

  if (isLatinToken(term)) {
    const matcher = new RegExp(`(?:^|\\s)${escapeRegExp(term)}(?=\\s|$)`, "g");
    while (matcher.exec(text) && count < maxMatches) count += 1;
    return count;
  }

  let index = text.indexOf(term);
  while (index !== -1 && count < maxMatches) {
    count += 1;
    index = text.indexOf(term, index + Math.max(1, term.length));
  }

  return count;
}

function buildSearchQuery(value: string): SearchQuery {
  const includesRelatedIntent = isRelatedIntent(value);
  const includesStarterIntent = isStarterIntent(value);
  const terms = extractSearchTerms(value);

  return {
    terms,
    includesCatalog: isCatalogIntent(value) || includesStarterIntent,
    includesRelatedIntent,
    includesCurrentPostIntent: isCurrentPostIntent(value, includesRelatedIntent),
    includesStarterIntent
  };
}

function extractSearchTerms(value: string) {
  const normalized = normalizeForSearch(value);
  const terms = new Map<string, SearchTerm>();

  function addTerm(value: string, weight: number) {
    const term = normalizeForSearch(value);
    if (!isUsefulSearchTerm(term)) return;

    const existing = terms.get(term);
    if (!existing || existing.weight < weight) {
      terms.set(term, { term, weight });
    }
  }

  for (const phrase of extractQuotedPhrases(value)) {
    addTerm(phrase, 3.4);
  }

  for (const token of normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []) {
    addTerm(token, 1.4);
  }

  for (const run of normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    if (run.length <= 8) addTerm(run, 2.6);

    for (const size of [4, 3, 2]) {
      for (let index = 0; index <= run.length - size; index += 1) {
        const term = run.slice(index, index + size);
        addTerm(term, size === 4 ? 1.8 : size === 3 ? 1.25 : 0.8);
      }
    }
  }

  for (const group of SYNONYM_GROUPS) {
    const aliases = group.map(normalizeForSearch).filter(Boolean);
    const hasMatch = aliases.some((alias) => normalizedIncludesTerm(normalized, alias));
    if (!hasMatch) continue;

    for (const alias of aliases) {
      addTerm(alias, 2.8);
    }
  }

  return [...terms.values()]
    .sort((a, b) => b.weight - a.weight || b.term.length - a.term.length)
    .slice(0, MAX_QUERY_TERMS);
}

function extractQuotedPhrases(value: string) {
  const phrases: string[] = [];
  const patterns = [/《([^》]+)》/g, /["“”']([^"“”']{2,})["“”']/g];

  for (const pattern of patterns) {
    let match = pattern.exec(value);
    while (match) {
      phrases.push(match[1]);
      match = pattern.exec(value);
    }
  }

  return phrases;
}

function isUsefulSearchTerm(term: string) {
  if (!term || term.length < 2 || CHINESE_STOP_TERMS.has(term)) return false;
  if (/^[\u3400-\u9fff]{2,}$/.test(term) && CHINESE_STOP_TERMS.has(term)) return false;
  return true;
}

function normalizedIncludesTerm(text: string, term: string) {
  if (!text || !term) return false;
  if (isLatinToken(term)) {
    return new RegExp(`(?:^|\\s)${escapeRegExp(term)}(?=\\s|$)`).test(text);
  }

  return text.includes(term);
}

function isLatinToken(term: string) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(term);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function isStarterIntent(query: string) {
  const normalized = normalizeForSearch(query);

  return (
    /(入门|导读|概览|新手|初学|起点|从哪开始|从哪里开始|先看|开始读|阅读顺序)/.test(
      normalized
    ) ||
    /(哪篇|哪几篇).*(适合|先看|开始|入门)/.test(normalized) ||
    /(适合|先看|开始|入门).*(哪篇|哪几篇)/.test(normalized)
  );
}

function isRelatedIntent(query: string) {
  const normalized = normalizeForSearch(query);

  return (
    /(相关|关联|相近|类似|同类|延伸|扩展|继续读|推荐阅读)/.test(normalized) ||
    /(哪些|哪几篇|哪篇).*(文章|博客|内容).*(相关|类似|延伸|推荐)/.test(normalized) ||
    /(文章|博客|内容).*(相关|类似|延伸|推荐).*(哪些|哪几篇|哪篇)/.test(normalized)
  );
}

function isCurrentPostIntent(query: string, includesRelatedIntent: boolean) {
  const normalized = normalizeForSearch(query);

  return (
    includesRelatedIntent ||
    /(这篇|本文|此文|当前文章|这篇文章|这篇博文|这篇博客|文中|原文)/.test(normalized) ||
    /(总结|概括|提炼|短评|主旨|中心思想|读后感)/.test(normalized)
  );
}

function buildSegments(value: string) {
  const body = value
    .replace(/^---[\s\S]*?---/, "\n")
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/^import\s+.*$/gm, "")
    .replace(/\r/g, "\n");
  const segments: IndexedSegment[] = [];
  let currentHeading = "";
  let paragraphLines: string[] = [];
  let pendingHeading = "";
  let pendingText = "";

  function pushPending() {
    const text = pendingText.replace(/\s+/g, " ").trim();
    if (text) {
      segments.push({
        order: segments.length,
        heading: pendingHeading,
        text,
        normalizedHeading: normalizeForSearch(pendingHeading),
        normalizedText: normalizeForSearch(text)
      });
    }

    pendingHeading = "";
    pendingText = "";
  }

  function addParagraph(heading: string, text: string) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;

    if (!pendingText) {
      pendingHeading = heading;
      pendingText = normalized;
      if (normalized.length >= MIN_SEGMENT_CHARS) pushPending();
      return;
    }

    if (
      pendingHeading === heading &&
      (pendingText.length < MIN_SEGMENT_CHARS || normalized.length < MIN_SEGMENT_CHARS)
    ) {
      pendingText = `${pendingText} ${normalized}`;
      if (pendingText.length >= MIN_SEGMENT_CHARS) pushPending();
      return;
    }

    pushPending();
    pendingHeading = heading;
    pendingText = normalized;
    if (normalized.length >= MIN_SEGMENT_CHARS) pushPending();
  }

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    addParagraph(currentHeading, paragraphLines.join(" "));
    paragraphLines = [];
  }

  for (const line of body.split("\n")) {
    const headingMatch = line.match(/^\s{0,3}#{2,3}\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flushParagraph();
      pushPending();
      currentHeading = cleanInlineMdx(headingMatch[1]);
      continue;
    }

    if (/^\s{0,3}#{1,6}\s+/.test(line)) {
      flushParagraph();
      pushPending();
      continue;
    }

    const cleaned = cleanInlineMdx(line);
    if (!cleaned) {
      flushParagraph();
      continue;
    }

    paragraphLines.push(cleaned);
  }

  flushParagraph();
  pushPending();

  return segments;
}

function cleanInlineMdx(value: string) {
  return value
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<\/?[^>\n]+>/g, " ")
    .replace(/^\s*>+\s?/g, "")
    .replace(/^\s*[-*+]\s+/g, "")
    .replace(/^\s*\d+\.\s+/g, "")
    .replace(/[#{}`*_~]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function formatSegmentSnippet(segment: IndexedSegment) {
  return segment.heading ? `${segment.heading}：${segment.text}` : segment.text;
}

function limitSnippet(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_SNIPPET_CHARS) return normalized;
  return `${normalized.slice(0, MAX_SNIPPET_CHARS).trim()}...`;
}

function normalizeForSearch(value: string) {
  return value
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
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
