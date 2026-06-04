# 自然选择 API 技术文档

版本：v1.0  
更新时间：2026-06-04  
生产站点：https://macondo-co.netlify.app

## 1. 总览

本项目采用 Astro 6 + Netlify adapter。`src/pages/api/*` 下的 JSON API 在生产构建中由 Netlify Functions 承载，RSS、sitemap、robots 则由 Astro endpoint 生成静态公开资源。

API 分为三类：

- 公开互动 API：阅读量、点赞、公开评论。
- 后台审核 API：评论审核列表与状态更新，需要 `BLOG_ADMIN_TOKEN`。
- 公开页面与发现 endpoint：`/posts/[slug]`、`/archive`、`/search`、`/rss.xml`、`/sitemap.xml`、`/robots.txt`，用于文章阅读、文章封面、社交分享图、文章目录与标题锚点、相关文章推荐、归档浏览、站内搜索、订阅和搜索引擎发现。

所有数据库写入都在服务端 API 内完成，浏览器端不会直接持有 Supabase service role key。

## 2. 通用约定

Base URL：

```text
https://macondo-co.netlify.app
```

本地开发：

```text
http://127.0.0.1:4321
```

JSON API 响应头：

```http
Content-Type: application/json
```

成功响应统一包含：

```json
{ "ok": true }
```

错误响应统一包含：

```json
{ "ok": false, "message": "中文错误提示。" }
```

slug 校验规则：

- 只接受已发布文章 slug。
- 格式为小写字母、数字和连字符，长度最多 101 个字符。
- 草稿文章、未知文章、格式不合法 slug 都会被拒绝。

后台鉴权：

```http
Authorization: Bearer <BLOG_ADMIN_TOKEN>
```

不要在日志、截图、提交内容或浏览器端代码中暴露 `SUPABASE_SERVICE_ROLE_KEY`、`BLOG_ADMIN_TOKEN` 或数据库连接信息。

## 3. API 清单

| Endpoint | 方法 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| `/api/post-stats?slugs=...` | GET | 无 | 批量读取文章阅读、点赞、评论数 |
| `/api/record-view` | POST | 无 | 记录一次文章阅读 |
| `/api/like` | POST | 无 | 记录一次文章喜欢 |
| `/api/comments?slug=...` | GET | 无 | 读取已审核通过评论 |
| `/api/comments` | POST | 无 | 提交新评论，默认进入待审核 |
| `/api/admin/comments?status=...` | GET | Bearer token | 读取后台评论列表 |
| `/api/admin/comments` | PATCH | Bearer token | 更新评论审核状态 |
| `/posts/[slug]` | GET | 无 | 阅读已发布文章详情，含封面图、社交分享图、文章目录、标题锚点、相关文章推荐和相邻文章导航 |
| `/archive` | GET | 无 | 按年份/月浏览已发布文章归档 |
| `/search?q=...` | GET | 无 | 前端本地搜索已发布文章 |
| `/rss.xml` | GET | 无 | RSS 2.0 订阅源 |
| `/sitemap.xml` | GET | 无 | 搜索引擎站点地图 |
| `/robots.txt` | GET | 无 | 爬虫访问规则 |

## 4. 公开互动 API

### GET `/api/post-stats`

批量读取文章统计数据。

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `slugs` | 是 | 逗号分隔的已发布文章 slug，例如 `hello-world,stack-for-a-small-blog` |

成功响应：

```json
{
  "ok": true,
  "stats": {
    "hello-world": {
      "views_count": 12,
      "likes_count": 3,
      "comments_count": 1
    }
  }
}
```

行为说明：

- 会去重请求中的 slug。
- 任一 slug 无效或不是已发布文章时，返回错误。
- Supabase 中暂无统计行时，该 slug 返回 `0` 计数。

### POST `/api/record-view`

记录一次文章阅读量。

请求体：

```json
{ "slug": "hello-world" }
```

成功响应：

```json
{
  "ok": true,
  "stats": {
    "slug": "hello-world",
    "views_count": 13,
    "likes_count": 3,
    "comments_count": 1
  }
}
```

行为说明：

- 通过 Supabase RPC `increment_blog_post_view` 自增阅读量。
- 如果统计行不存在，RPC 会创建统计行并把阅读量置为 `1`。

### POST `/api/like`

记录一次文章喜欢。

请求体：

```json
{
  "slug": "hello-world",
  "visitorId": "browser-generated-visitor-id"
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `slug` | 必须是已发布文章 slug |
| `visitorId` | 8-128 字符，只允许字母、数字、`.`、`_`、`:`、`-` |

成功响应：

```json
{
  "ok": true,
  "liked": true,
  "stats": {
    "liked": true,
    "slug": "hello-world",
    "views_count": 13,
    "likes_count": 4,
    "comments_count": 1
  }
}
```

行为说明：

- 前端用 `localStorage` 保存访客 ID 和单篇文章 liked 状态。
- 数据库通过 `(post_slug, visitor_id)` 唯一约束兜底去重。
- 重复点赞不会增加计数，响应中的 `liked` 为 `false`。

## 5. 评论 API

### GET `/api/comments`

读取某篇文章已公开评论。

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `slug` | 是 | 已发布文章 slug |

成功响应：

```json
{
  "ok": true,
  "comments": [
    {
      "id": "uuid",
      "author_name": "读者",
      "author_website": "https://example.com/",
      "body": "写得很好。",
      "created_at": "2026-06-04T00:00:00.000Z"
    }
  ]
}
```

行为说明：

- 只返回 `status = approved` 的评论。
- 不返回邮箱、IP hash、user agent 等非公开字段。
- 按创建时间升序返回。

### POST `/api/comments`

提交新评论。

请求体：

```json
{
  "slug": "hello-world",
  "authorName": "读者",
  "authorEmail": "reader@example.com",
  "authorWebsite": "https://example.com",
  "body": "写得很好。",
  "company": ""
}
```

字段规则：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `slug` | 是 | 已发布文章 slug |
| `authorName` | 是 | 1-80 字符 |
| `authorEmail` | 否 | 最多 160 字符，若填写必须是邮箱格式 |
| `authorWebsite` | 否 | 最多 240 字符，若填写必须是 `http` 或 `https` URL |
| `body` | 是 | 2-2000 字符 |
| `company` | 否 | honeypot 字段，真实用户应留空 |

成功响应：

```json
{
  "ok": true,
  "comment": {
    "id": "uuid",
    "status": "pending"
  }
}
```

状态码：

- 成功创建：`201`
- honeypot 命中：返回 `200`，但不写入真实评论。

行为说明：

- 评论默认 `pending`，审核通过后才公开展示。
- 服务端会记录 `user_agent` 和经过简单 hash 的 IP 信息，用于后续排查垃圾评论。
- 提交评论时会确保 `blog_post_stats` 中存在对应文章统计行。

## 6. 后台审核 API

后台 API 统一要求：

```http
Authorization: Bearer <BLOG_ADMIN_TOKEN>
```

未带 token 或 token 不匹配时返回：

```json
{ "ok": false, "message": "未授权。" }
```

状态码为 `401`。

### GET `/api/admin/comments`

读取指定状态的评论列表。

Query 参数：

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `status` | 否 | `pending` | 可选值：`pending`、`approved`、`rejected` |

成功响应：

```json
{
  "ok": true,
  "comments": [
    {
      "id": "uuid",
      "post_slug": "hello-world",
      "author_name": "读者",
      "author_email": "reader@example.com",
      "author_website": "https://example.com/",
      "body": "写得很好。",
      "status": "pending",
      "created_at": "2026-06-04T00:00:00.000Z"
    }
  ]
}
```

行为说明：

- 每次最多返回 100 条。
- 按创建时间倒序返回。
- 后台响应包含邮箱和网站，供审核判断使用。

### PATCH `/api/admin/comments`

更新评论审核状态。

请求体：

```json
{
  "id": "comment-uuid",
  "status": "approved"
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `id` | UUID 格式 |
| `status` | `pending`、`approved`、`rejected` 之一 |

成功响应：

```json
{
  "ok": true,
  "comment": {
    "id": "uuid",
    "post_slug": "hello-world",
    "status": "approved"
  }
}
```

行为说明：

- 更新评论状态时会写入 `reviewed_at`。
- 更新后会重新统计该文章 `approved` 评论数，并写回 `blog_post_stats.comments_count`。

## 7. 公开页面与发现 Endpoint

### GET `/posts/[slug]`

公开文章详情页，响应为 HTML 页面。

行为说明：

- 使用 `getPublishedPosts()` 生成静态路径，继承草稿过滤规则。
- 文章 frontmatter 的 `cover` 存在时，标题区后渲染正文宽度封面图，并通过 `BaseLayout` 输出 `og:image` 和 `twitter:image`。
- `cover` 需要是可公开访问的站内路径或绝对 URL；没有 `cover` 时不渲染封面图，也不输出图片 meta，Twitter card 保持 `summary`。
- 列表页、归档页、搜索页和标签页不展示 `cover`。
- 使用 `render(post)` 返回的 `headings` 过滤 h2/h3 生成文章目录，目录链接使用 Astro/MDX 生成的 `heading.slug`。
- h2/h3 标题通过 MDX 自定义组件渲染，保留原有 `id` 并追加 hover/focus 可见的 `#` 锚点链接，支持直接 hash 跳转。
- 文章没有 h2/h3 时不渲染目录；桌面端目录位于右侧 aside，移动端目录位于正文前的折叠 `<details>`。
- 文章目录和标题锚点是纯静态 HTML/CSS 行为，不调用 Supabase，不新增 JSON API、数据库表或环境变量。
- 页面底部在正文之后、评论区之前依次渲染相关文章推荐和相邻文章导航。
- 相关文章推荐在 `getStaticPaths()` 阶段计算，数据来源为 `getPublishedPosts()` 返回的已发布文章；候选文章会排除当前文章。
- 推荐排序规则为：共享唯一标签数量降序；共享数量相同则按 `publishedAt` 时间倒序；最多渲染 3 篇。
- 当前文章没有标签，或没有任何候选文章共享标签时，不渲染相关文章区块。
- `src/components/RelatedPosts.astro` 只展示文章发布日期、标题和描述，不展示标签墙，不调用 JSON API。
- 相邻文章导航沿用 `getPublishedPosts()` 的发布时间倒序：`上一篇` 是数组中前一个、更近发布的文章；`下一篇` 是数组中后一个、更早发布的文章。
- 每个相邻链接展示方向标签、文章标题和 `formatDate(publishedAt)` 格式化后的发布日期。
- 最新文章只显示 `下一篇`，最旧文章只显示 `上一篇`；只有一篇已发布文章时不渲染导航。
- 相关文章推荐和相邻文章导航本身不调用 Supabase，不新增 JSON API、数据库表或环境变量；评论区和阅读/点赞组件仍按各自前端模块调用互动 API。
- 相关文章推荐样式由 `src/styles/global.css` 的 `.related-posts` 系列规则控制，延续正文底部的极简阅读风格。
- 桌面端相邻文章导航左右并排，移动端单列，样式由 `src/styles/global.css` 的 `.post-nav` 系列规则控制。
- 文章目录样式由 `.article-toc` 系列规则控制，标题锚点样式由 `.anchored-heading` 和 `.heading-anchor` 控制。

### GET `/archive`

公开文章归档页，响应为 HTML 页面。

行为说明：

- 使用 `getPublishedPosts()` 获取文章，继承草稿过滤规则。
- 按年份倒序、月份倒序、文章发布日期倒序展示。
- 月份显示为中文格式，例如 `06 月`。
- 页面不调用 Supabase，不产生数据库读写。
- 入口由 `src/lib/site.ts` 的主导航提供，并应出现在 sitemap 中。

### GET `/search`

公开站内搜索页，响应为 HTML 页面。

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `q` | 否 | 初始搜索关键词，例如 `/search?q=Astro` |

行为说明：

- 构建期使用 `getPublishedPosts()` 生成内嵌搜索索引，继承草稿过滤规则。
- 索引字段包含 slug、标题、描述、发布日期、标签、正文摘要和合并后的搜索文本。
- 正文摘要从 `post.body` 清洗 Markdown/MDX 标记后截取约 500 字符，不索引全文。
- 浏览器端使用原生 JavaScript 本地搜索，不新增 JSON API、不调用 Supabase、不产生数据库读写。
- 搜索范围为标题、描述、标签和正文摘要；多关键词按空格拆分，所有关键词都需命中。
- 结果展示标题、日期、命中片段和标签；命中词用 `<mark>` 高亮，并在渲染前转义文本。
- 空查询默认展示所有已发布文章，顺序沿用 `getPublishedPosts()` 的发布时间倒序。
- 入口由 `src/lib/site.ts` 的主导航提供，并应出现在 sitemap 中。

### GET `/rss.xml`

生成 RSS 2.0 订阅源。

响应头：

```http
Content-Type: application/rss+xml; charset=utf-8
```

内容范围：

- 只包含已发布文章。
- 每篇文章包含 title、link、guid、description、pubDate、category。
- feed URL、站点 URL 使用 `site.url` 生成。

### GET `/sitemap.xml`

生成 sitemap。

响应头：

```http
Content-Type: application/xml; charset=utf-8
```

内容范围：

- 首页 `/`
- 关于页 `/about`
- 搜索页 `/search`
- 归档页 `/archive`
- 标签总览 `/tags`
- 标签详情页 `/tags/[tag]`
- 已发布文章 `/posts/[slug]`

排除范围：

- 草稿文章。
- 后台页 `/admin/comments`。
- API routes。

### GET `/robots.txt`

生成爬虫规则。

响应头：

```http
Content-Type: text/plain; charset=utf-8
```

当前内容：

```text
User-agent: *
Allow: /
Disallow: /admin/
Sitemap: https://macondo-co.netlify.app/sitemap.xml
```

## 8. 数据表与 RPC

当前交互数据使用 Supabase：

| 表 | 用途 |
| --- | --- |
| `blog_post_stats` | 每篇文章阅读量、点赞数、公开评论数 |
| `blog_post_likes` | 文章喜欢去重记录 |
| `blog_comments` | 评论内容、审核状态和审核元数据 |

当前 RPC：

| RPC | 用途 |
| --- | --- |
| `increment_blog_post_view(p_slug text)` | 创建或更新文章阅读量 |
| `register_blog_post_like(p_slug text, p_visitor_id text)` | 注册点赞并返回最新统计 |

权限规则：

- 表启用 RLS。
- `anon` 和 `authenticated` 不直接访问交互表。
- API 使用 service role key 访问 Supabase。
- RPC 只授予 `service_role` 执行权限。

## 9. 前端调用方

| 前端模块 | 调用 API |
| --- | --- |
| `src/pages/posts/[slug].astro` | 不为封面图、文章目录、标题锚点、相关文章推荐和相邻文章导航调用 JSON API；详情页内的互动组件另行调用对应 API |
| `src/components/ArticleToc.astro` | 不调用 JSON API，接收 Astro `MarkdownHeading[]` 渲染静态目录 |
| `src/components/HeadingH2.astro`、`src/components/HeadingH3.astro` | 不调用 JSON API，保留标题 id 并渲染静态 hash 锚点 |
| `src/components/RelatedPosts.astro` | 不调用 JSON API，接收构建期计算好的相关文章列表；空列表时不输出 HTML |
| `src/pages/archive.astro` | 不调用 JSON API，使用内容集合生成归档页 |
| `src/pages/search.astro` | 不调用 JSON API，构建期生成搜索索引，浏览器端本地搜索 |
| `src/components/Engagement.astro` | `/api/record-view`、`/api/post-stats`、`/api/like` |
| `src/components/Comments.astro` | `/api/comments` |
| `src/pages/admin/comments.astro` | `/api/admin/comments` |
| `src/layouts/BaseLayout.astro` | 输出 canonical、RSS alternate、Open Graph、Twitter card、robots meta；传入 `image` 时额外输出 `og:image` 和 `twitter:image` |

## 10. 验证命令

本地检查：

```bash
npm run check
npm run build
```

本地 endpoint 验证：

```bash
curl -L http://127.0.0.1:4321/posts/hello-world/ | rg "上一篇|下一篇"
curl -L http://127.0.0.1:4321/posts/enterprise-ai-agent-platform/ | rg "article-toc|heading-anchor"
curl -L http://127.0.0.1:4321/archive
curl -L "http://127.0.0.1:4321/search?q=Astro" | rg "小博客的技术栈|search-index"
curl -L http://127.0.0.1:4321/rss.xml
curl -L http://127.0.0.1:4321/sitemap.xml
curl -L http://127.0.0.1:4321/robots.txt
curl -L "http://127.0.0.1:4321/api/post-stats?slugs=hello-world"
```

线上 endpoint 验证：

```bash
curl -L https://macondo-co.netlify.app/posts/hello-world/ | rg "上一篇|下一篇"
curl -L https://macondo-co.netlify.app/posts/enterprise-ai-agent-platform/ | rg "article-toc|heading-anchor"
curl -L https://macondo-co.netlify.app/archive/
curl -L "https://macondo-co.netlify.app/search/?q=Astro" | rg "小博客的技术栈|search-index"
curl -L https://macondo-co.netlify.app/rss.xml
curl -L https://macondo-co.netlify.app/sitemap.xml
curl -L https://macondo-co.netlify.app/robots.txt
curl -L "https://macondo-co.netlify.app/api/post-stats?slugs=hello-world"
```

安全验证：

```bash
curl -L https://macondo-co.netlify.app/admin/comments | rg "noindex, nofollow"
curl -L https://macondo-co.netlify.app/sitemap.xml | rg "admin|draft"
```

第二条命令不应返回匹配结果。
