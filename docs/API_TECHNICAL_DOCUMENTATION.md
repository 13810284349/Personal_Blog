# 自然选择 API 技术文档

版本：v1.0  
更新时间：2026-06-04  
生产站点：https://macondo-co.netlify.app

## 1. 总览

本项目采用 Astro 6 + Netlify adapter。`src/pages/api/*` 下的 JSON API 在生产构建中由 Netlify Functions 承载，RSS、sitemap、robots 则由 Astro endpoint 生成静态公开资源。

API 分为三类：

- 公开互动 API：阅读量、点赞、公开评论。
- 后台审核 API：评论审核列表与状态更新，需要 `BLOG_ADMIN_TOKEN`。
- 公开页面与发现 endpoint：`/archive`、`/rss.xml`、`/sitemap.xml`、`/robots.txt`，用于归档浏览、订阅和搜索引擎发现。

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
| `/archive` | GET | 无 | 按年份/月浏览已发布文章归档 |
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

### GET `/archive`

公开文章归档页，响应为 HTML 页面。

行为说明：

- 使用 `getPublishedPosts()` 获取文章，继承草稿过滤规则。
- 按年份倒序、月份倒序、文章发布日期倒序展示。
- 月份显示为中文格式，例如 `06 月`。
- 页面不调用 Supabase，不产生数据库读写。
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
| `src/pages/archive.astro` | 不调用 JSON API，使用内容集合生成归档页 |
| `src/components/Engagement.astro` | `/api/record-view`、`/api/post-stats`、`/api/like` |
| `src/components/Comments.astro` | `/api/comments` |
| `src/pages/admin/comments.astro` | `/api/admin/comments` |
| `src/layouts/BaseLayout.astro` | 输出 canonical、RSS alternate、Open Graph、Twitter card、robots meta |

## 10. 验证命令

本地检查：

```bash
npm run check
npm run build
```

本地 endpoint 验证：

```bash
curl -L http://127.0.0.1:4321/archive
curl -L http://127.0.0.1:4321/rss.xml
curl -L http://127.0.0.1:4321/sitemap.xml
curl -L http://127.0.0.1:4321/robots.txt
curl -L "http://127.0.0.1:4321/api/post-stats?slugs=hello-world"
```

线上 endpoint 验证：

```bash
curl -L https://macondo-co.netlify.app/archive/
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
