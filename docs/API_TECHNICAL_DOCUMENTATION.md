# 自然选择 API 技术文档

版本：v1.0  
更新时间：2026-07-02
生产站点：https://macondo-co.netlify.app

## 1. 总览

本项目采用 Astro 6 + Netlify adapter。`src/pages/api/*` 下的 JSON API 在生产构建中由 Netlify Functions 承载，RSS、sitemap、robots 则由 Astro endpoint 生成静态公开资源。

API 分为四类：

- 公开互动 API：阅读量、点赞、公开评论。
- 公开 AI API：公开页面对话框调用 Bedrock Claude，由服务端代理转发。
- 后台审核 API：评论审核列表与状态更新，需要 `BLOG_ADMIN_TOKEN`。
- 公开页面与发现 endpoint：`/posts/[slug]`、`/archive`、`/search`、`/rss.xml`、`/sitemap.xml`、`/robots.txt`，用于文章阅读、文章封面、社交分享图、结构化 SEO、文章目录与标题锚点、相关文章推荐、归档浏览、站内搜索、订阅和搜索引擎发现。

所有数据库写入都在服务端 API 内完成，浏览器端不会直接持有 Supabase service role key，也不会持有 Bedrock API key。

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
X-Request-Id: <request-id>
```

成功响应统一包含：

```json
{ "ok": true }
```

错误响应统一包含：

```json
{ "ok": false, "message": "中文错误提示。", "requestId": "<request-id>" }
```

请求 ID 与错误日志：

- 所有 JSON API 响应都会带 `X-Request-Id`；如果请求头传入安全格式的 `X-Request-Id`，服务端会沿用，否则生成新的 UUID。
- 错误响应 body 会额外返回同一个 `requestId`，方便把浏览器错误提示和 Netlify Function logs 对齐；成功响应 body 不新增字段。
- 服务端异常日志使用结构化字段：`requestId`、`endpoint`、`method`、`action`、`status`、脱敏后的错误摘要，以及少量安全定位字段。
- 普通输入校验错误不写错误日志；数据库、RPC、Bedrock、AI context、AI feedback 和评论通知等服务端或上游异常会写入日志。
- 日志不得记录密钥、token、原始 IP、`ip_hash`、邮箱、网站、user-agent、webhook URL、环境变量值、评论正文全文、AI 问题全文、history、prompt 或回答全文。

slug 校验规则：

- 只接受已发布文章 slug。
- 格式为小写字母、数字和连字符，长度最多 101 个字符。
- 草稿文章、未知文章、格式不合法 slug 都会被拒绝。

后台鉴权：

```http
Authorization: Bearer <BLOG_ADMIN_TOKEN>
```

不要在日志、截图、提交内容或浏览器端代码中暴露 `SUPABASE_SERVICE_ROLE_KEY`、`BLOG_ADMIN_TOKEN`、`COMMENT_NOTIFY_WEBHOOK_URL`、`AWS_BEARER_TOKEN_BEDROCK` 或数据库连接信息。

Supabase 服务端相关环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `SUPABASE_URL` | 无 | Supabase 项目 URL，用于服务端 API 读写公开互动数据 |
| `SUPABASE_SERVICE_ROLE_KEY` | 无 | Supabase 服务端 secret key（`sb_secret_...`）或 legacy `service_role` JWT；不能使用 `sb_publishable_...` |

评论防刷相关环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `COMMENT_RATE_LIMIT_POST_WINDOW_SECONDS` | `600` | 同一 IP hash + 同一文章的提交限制窗口 |
| `COMMENT_RATE_LIMIT_SITE_WINDOW_SECONDS` | `3600` | 同一 IP hash 全站提交数量统计窗口 |
| `COMMENT_RATE_LIMIT_SITE_MAX` | `5` | 全站窗口内允许的评论数 |
| `COMMENT_DUPLICATE_WINDOW_SECONDS` | `86400` | 重复正文检测窗口 |
| `COMMENT_SPAM_WORDS` | 空 | 逗号或换行分隔的敏感词/垃圾词，命中时直接拒绝 |

评论待审通知相关环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `COMMENT_NOTIFY_WEBHOOK_URL` | 空 | 新评论成功进入 `pending` 后接收通用 JSON webhook 的 `http` 或 `https` URL；空值时不发送通知 |

AI 对话相关环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `BEDROCK_REGION` | `us-east-1` | Bedrock Runtime 区域；不要使用 Netlify 保留变量名 `AWS_REGION` |
| `AWS_BEARER_TOKEN_BEDROCK` | 无 | Bedrock API key，仅服务端 `/api/ai` 读取，不能加 `PUBLIC_` 前缀 |
| `ANTHROPIC_MODEL` | 无 | 首选 Claude 模型，当前建议 `global.anthropic.claude-opus-4-8` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 空 | 可选 Sonnet fallback 模型 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 空 | 可选 Haiku fallback 模型 |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | `600` | 同一 IP hash 的 AI 请求限流窗口 |
| `AI_RATE_LIMIT_MAX` | `10` | 同一 IP hash 在窗口内允许的 AI 请求数 |

## 3. API 清单

| Endpoint | 方法 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| `/api/post-stats?slugs=...` | GET | 无 | 批量读取文章阅读、点赞、评论数 |
| `/api/record-view` | POST | 无 | 记录一次文章阅读 |
| `/api/like` | POST | 无 | 记录一次文章喜欢 |
| `/api/comments?slug=...` | GET | 无 | 读取已审核通过评论 |
| `/api/comments` | POST | 无 | 提交新评论，默认进入待审核 |
| `/api/ai` | POST | 无 | 公开页面 AI 对话框，服务端调用 Bedrock Claude |
| `/api/ai-feedback` | POST | 无 | 保存 AI 回答“有帮助 / 没帮助”反馈摘要 |
| `/api/admin/comments?status=...&q=...` | GET | Bearer token | 读取后台评论列表 |
| `/api/admin/comments` | PATCH | Bearer token | 更新评论审核状态 |
| `/posts/[slug]` | GET | 无 | 阅读已发布文章详情，含封面图、社交分享图、结构化 SEO、文章目录、标题锚点、相关文章推荐和相邻文章导航 |
| `/archive` | GET | 无 | 按年份/月浏览已发布文章归档 |
| `/search?q=...` | GET | 无 | Pagefind 静态全文搜索已发布文章 |
| `/rss.xml` | GET | 无 | RSS 2.0 订阅源 |
| `/sitemap.xml` | GET | 无 | 搜索引擎站点地图 |
| `/robots.txt` | GET | 无 | 爬虫访问规则 |

## 4. 公开互动与 AI API

### POST `/api/ai`

公开页面 AI 对话框调用入口。浏览器只发送问题、当前页面内存中的短对话历史，以及可选的公开页面上下文标识；Bedrock API key 只由服务端读取。服务端会从已发布 MDX 文章中做本地检索，把相关标题、摘要、标签、链接和正文片段压缩后注入模型上下文，用于回答博客内容、当前文章和文章推荐问题。

请求体：

```json
{
  "question": "用中文说一句你好",
  "history": [
    { "role": "user", "content": "上一轮问题" },
    { "role": "assistant", "content": "上一轮回答" }
  ],
  "answerStyle": "brief",
  "pageContext": {
    "kind": "post",
    "slug": "large-model-history"
  }
}
```

字段规则：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `question` | 是 | 1-1200 字符 |
| `history` | 否 | 最多保留最近 8 条 `{ role, content }`，`role` 只能是 `user` 或 `assistant` |
| `answerStyle` | 否 | `"brief"`、`"deep"`、`"literary"` 之一；缺失或无效时按 `"brief"` 处理 |
| `pageContext` | 否 | 支持 `{ kind: "home" }`、`{ kind: "post", slug }`、`{ kind: "tagIndex" }`、`{ kind: "tag", tag }`；slug 最长 160 字符，tag 最长 80 字符 |

成功响应：

```json
{
  "ok": true,
  "answer": "你好，愿你今天的判断慢一点，也稳一点。",
  "sources": [
    {
      "title": "文章标题",
      "description": "文章摘要",
      "url": "/posts/example-slug/"
    }
  ]
}
```

行为说明：

- 服务端按 `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL` 的顺序调用 Bedrock Converse API，前一个模型失败时尝试下一个可用 fallback；首选 Opus 4.8 时默认使用 `global.anthropic.claude-opus-4-8`，如有严格数据驻留要求可改用区域内模型 ID `anthropic.claude-opus-4-8` 并确认 `BEDROCK_REGION` 支持。
- 服务端会复用 `getPublishedPosts()` 检索公开已发布文章；不会读取草稿、后台页、评论审核数据、Supabase 私密字段、环境变量或 `.env`。
- 首页、文章详情页、标签索引页和标签详情页会发送可选 `pageContext`，浏览器只发送公开页面标识，不发送正文；服务端重新从已发布文章集合中读取标题、摘要、标签、链接和压缩正文片段。
- 当 `pageContext.kind` 为 `post` 且 slug 命中已发布文章时，服务端会把当前文章作为显式上下文；如果用户询问“相关、延伸、哪些文章”等问题，会优先加入共享标签的相关文章候选。
- 当 `pageContext.kind` 为 `tag` 时，服务端会优先把该标签下的已发布文章加入上下文和来源候选，但不会阻止普通开放问题。
- `answerStyle` 只影响本轮回答提示和 Bedrock `maxTokens`：`brief` 更短，`deep` 更完整，`literary` 更有文气但仍要求准确。
- `pageContext` 缺失、格式无效、slug 不存在或指向未发布内容时，服务端退回普通博客检索，不泄露草稿或私密内容。
- 本地检索使用标题、标签、摘要和正文片段的字段加权，并对单字段重复命中做上限控制，避免长文正文词频压过元数据。
- 本地检索会做少量站内主题同义词/中英文混合扩展，例如 `百年孤独/Macondo/马孔多`、`AI/大模型/LLM`、`Astro/Supabase/Netlify`、物理与科学史主题等。
- 正文检索按 h2/h3 所属段落片段打分，保留小节标题作为片段上下文，并只把 top 片段注入模型上下文。
- 对“入门、先看、哪篇适合、从哪开始”等问题，服务端会优先排序适合作为起点或概览的文章；单章深读类文章仍可作为补充来源。
- 本地检索不新增数据库、向量库、Pagefind API 或客户端索引下载；上下文只在服务端请求内临时生成，并限制总长度。
- 成功响应的 `sources` 最多包含 3 条公开已发布文章来源，只返回 `title`、`description`、`url`，用于前端在回答下方展示来源卡片；没有明显相关来源时为空数组。
- 服务端会限制请求体大小、问题长度、history 条数、history 单条长度和上游超时时间。
- 通过请求体、问题长度和 history 校验后的请求，会先执行 Supabase-backed IP hash 限流，再做博客上下文检索或调用 Bedrock；默认同一 IP hash 每 10 分钟最多 10 次。
- 限流使用 `x-nf-client-connection-ip`、`x-forwarded-for`、`x-real-ip` 推导客户端 IP 后做 hash；如果无法取得 IP，会落入共享的 `ip_unknown` 限流桶。
- 超出限流时返回 `429` 和中文错误提示，并带 `Retry-After` 响应头；限流记录只保存 `ip_hash` 和 `created_at`，不保存原始 IP、问题、history、回答或来源内容。
- 限流 RPC 不可用时服务端会失败关闭，返回“AI 服务暂时不可用。”，不会继续调用 Bedrock。
- 系统提示不限制开放问答主题，但明确禁止泄露、猜测或编造密钥、环境变量、请求头和内部实现细节。
- 上游错误只记录脱敏后的状态和摘要，不记录 Bearer token；浏览器只收到中文错误提示。
- 浏览器端 AI 组件只在当前页面会话内保留短对话上下文，刷新后清空；对话内容不落库，浏览器不调用 Supabase。
- 本地调试时将 Bedrock 变量写入项目根目录 `.env`，不要加 `PUBLIC_` 前缀；修改后重启 `npm run dev`。

### POST `/api/ai-feedback`

公开页面 AI 对话框的回答反馈入口。浏览器在用户点击“有帮助 / 没帮助”后提交当前回答的客户端消息 ID、评分、回答风格、公开页面上下文、来源卡片，以及问题/回答文本；服务端只保存截断摘要，不保存完整对话。

请求体：

```json
{
  "messageId": "9f1f6c7d-3b8d-4b2e-a9a1-7a7f2c2d1e8b",
  "rating": "helpful",
  "answerStyle": "brief",
  "pageContext": { "kind": "tag", "tag": "AI" },
  "question": "这个标签下先读哪篇？",
  "answer": "可以先从……",
  "sources": [
    {
      "title": "文章标题",
      "description": "文章摘要",
      "url": "/posts/example-slug/"
    }
  ]
}
```

字段规则：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `messageId` | 是 | 客户端生成的 8-140 字符安全 ID，用于幂等 upsert |
| `rating` | 是 | `"helpful"` 或 `"unhelpful"` |
| `answerStyle` | 否 | `"brief"`、`"deep"`、`"literary"` 之一；缺失或无效时按 `"brief"` 保存 |
| `pageContext` | 否 | 同 `/api/ai`，仅保存公开页面标识 |
| `question` | 是 | 服务端压缩空白并截断为 `question_excerpt`，最多保存 700 字符 |
| `answer` | 是 | 服务端压缩空白并截断为 `answer_excerpt`，最多保存 1800 字符 |
| `sources` | 否 | 最多 3 条 `/posts/` 站内公开来源，只保存标题、摘要和 URL |

行为说明：

- API 使用 service role 写入 `blog_ai_feedback`，浏览器不直连 Supabase。
- `client_message_id` 唯一；同一回答再次点击另一种评分会更新同一行。
- 不保存原始 IP、user-agent、完整 history、完整回答、Bedrock token、Supabase key、后台数据或草稿内容。
- 反馈数据用于之后调 prompt，不作为公开评论或公开内容展示；本轮不提供后台查看页面。

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
- 字段校验或垃圾词命中：`400`
- 同 IP hash 提交太频繁：`429`
- 重复正文：`409`

行为说明：

- 评论默认 `pending`，审核通过后才公开展示。
- 服务端会记录 `user_agent` 和经过简单 hash 的 IP 信息，用于后续排查垃圾评论；不会保存或返回原始 IP。
- 同一 IP hash + 同一文章默认 10 分钟只允许提交 1 条评论。
- 同一 IP hash 全站默认 1 小时最多提交 5 条评论。
- 重复正文会先做空白归一化和大小写归一化，默认 24 小时内拒绝重复提交；缺少 IP hash 时退化为同文章近期重复检测。
- `COMMENT_SPAM_WORDS` 命中昵称、正文或网站输入时，服务端直接返回中文错误提示，不写入审核队列。
- 提交评论时会确保 `blog_post_stats` 中存在对应文章统计行。
- 成功写入 `pending` 后，若配置了 `COMMENT_NOTIFY_WEBHOOK_URL`，服务端会发送待审通知；通知失败、超时或 webhook 返回非 2xx 不影响本次评论提交，只记录服务端错误。
- 待审通知只包含文章标题/链接、昵称、正文摘要、审核入口和评论 ID；不包含邮箱、网站、user-agent、IP hash 或原始 IP。

待审通知 payload：

```json
{
  "event": "comment.pending",
  "site": {
    "name": "自然选择",
    "url": "https://macondo-co.netlify.app"
  },
  "post": {
    "slug": "hello-world",
    "title": "文章标题",
    "url": "https://macondo-co.netlify.app/posts/hello-world"
  },
  "comment": {
    "id": "uuid",
    "authorName": "读者",
    "bodySummary": "写得很好。"
  },
  "reviewUrl": "https://macondo-co.netlify.app/admin/comments?status=pending&q=00000000-0000-4000-8000-000000000000"
}
```

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

读取指定状态的评论列表，可按关键词筛选；`q` 为完整 UUID 时按评论 ID 精确查找。

Query 参数：

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `status` | 否 | `pending` | 可选值：`pending`、`approved`、`rejected` |
| `q` | 否 | 空 | 关键词或评论 ID；完整 UUID 精确匹配 `id`，其他值匹配 `author_name`、`body`、`post_slug` |

成功响应：

```json
{
  "ok": true,
  "counts": {
    "pending": 3,
    "approved": 12,
    "rejected": 4
  },
  "comments": [
    {
      "id": "uuid",
      "post_slug": "hello-world",
      "author_name": "读者",
      "author_email": "reader@example.com",
      "author_website": "https://example.com/",
      "body": "写得很好。",
      "status": "pending",
      "created_at": "2026-06-04T00:00:00.000Z",
      "reviewed_at": null
    }
  ]
}
```

行为说明：

- 每次最多返回 100 条。
- 按创建时间倒序返回。
- `counts` 返回全局各状态评论数，不受当前 `status` 或 `q` 筛选影响，用于后台状态 tab 展示队列数量。
- `q` 会清洗长度和通配符；完整 UUID 使用 `blog_comments.id` 精确匹配，非 UUID 使用不区分大小写的包含搜索。
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
- 当状态恢复为 `pending` 时，`reviewed_at` 会被置空。
- 更新后会重新统计该文章 `approved` 评论数，并写回 `blog_post_stats.comments_count`。

## 7. 公开页面与发现 Endpoint

### GET `/posts/[slug]`

公开文章详情页，响应为 HTML 页面。

行为说明：

- 使用 `getPublishedPosts()` 生成静态路径，继承草稿过滤规则。
- 文章 frontmatter 的 `cover` 存在时，标题区后渲染正文宽度封面图，并通过 `BaseLayout` 输出 `og:image` 和 `twitter:image`。
- `cover` 需要是可公开访问的站内路径或绝对 URL；没有 `cover` 时不渲染封面图，也不输出图片 meta，Twitter card 保持 `summary`。
- 页面通过 `BaseLayout` 输出 `BlogPosting` JSON-LD，字段包含 `headline`、`description`、`url`、`mainEntityOfPage`、`datePublished`、`dateModified`、`author`、`keywords`、`inLanguage`，有 `cover` 时额外输出绝对地址 `image`。
- 页面通过 `BaseLayout` 输出 article Open Graph 元数据：`article:published_time`、`article:modified_time`、`article:author` 和按标签重复的 `article:tag`。
- SEO 的 `dateModified` 使用 `updatedAt ?? publishedAt`；视觉层面的“更新于”仍只在 frontmatter 存在 `updatedAt` 时展示。
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

- `npm run build` 会在 Astro 构建后运行 `pagefind --site dist`，生成 `dist/pagefind/` 静态搜索 bundle。
- `src/pages/search.astro` 只内嵌已发布文章的展示元数据，包括 slug、标题、描述、发布日期、格式化日期、标签和 URL。
- Pagefind 索引来源为构建后的文章 HTML，继承 Astro 静态路径的草稿过滤规则。
- 搜索范围为文章标题、描述、标签和 MDX 正文全文；文章页通过 `data-pagefind-body` 标记这些内容。
- 导航、footer、评论区、点赞区、相关文章推荐和相邻文章导航不进入搜索索引；相关组件或区域使用 `data-pagefind-ignore="all"` 或保持在 `data-pagefind-body` 外。
- 浏览器端使用 Pagefind JavaScript API 本地搜索，不新增 JSON API、不调用 Supabase、不产生数据库读写。
- 结果展示标题、日期、Pagefind 命中片段和标签；Pagefind 片段中的命中词使用 `<mark>` 高亮，标题、日期和标签来自构建期展示元数据并在渲染前转义。
- 空查询默认展示所有已发布文章，顺序沿用 `getPublishedPosts()` 的发布时间倒序。
- 非空查询按 Pagefind relevance 排序；搜索 bundle 缺失时页面显示中文提示，要求先运行 `npm run build` 再 `npm run preview`。
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
- RSS 根节点声明 Media RSS 命名空间；有 `cover` 的文章输出 `media:thumbnail` 和 `media:content medium="image"`，图片 URL 使用绝对地址，已知扩展名会输出 MIME `type`。
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
| `blog_ai_request_events` | AI 请求限流事件，只保存 IP hash 和创建时间 |
| `blog_ai_feedback` | AI 回答反馈摘要，用于后续 prompt 调整，不保存完整对话 |

当前 RPC：

| RPC | 用途 |
| --- | --- |
| `increment_blog_post_view(p_slug text)` | 创建或更新文章阅读量 |
| `register_blog_post_like(p_slug text, p_visitor_id text)` | 注册点赞并返回最新统计 |
| `reserve_blog_ai_request(p_ip_hash text, p_window_seconds integer, p_max_requests integer)` | 原子预约一次 AI 请求限流额度 |

评论防刷相关索引：

- `blog_comments_ip_post_created_idx`：支持同 IP hash + 同文章近期提交查询。
- `blog_comments_ip_created_idx`：支持同 IP hash 全站近期提交查询。
- `blog_ai_request_events_ip_created_idx`：支持同 IP hash AI 请求限流窗口查询。
- `blog_ai_request_events_created_idx`：支持清理过期限流事件。
- `blog_ai_feedback_rating_created_idx`：支持按有帮助/没帮助和创建时间查看反馈。
- `blog_ai_feedback_style_created_idx`：支持按回答风格和创建时间查看反馈。

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
| `src/pages/search.astro` | 不调用 JSON API，使用 Pagefind 静态 bundle 做浏览器端全文搜索 |
| `src/components/AiChat.astro` | `/api/ai`、`/api/ai-feedback` |
| `src/components/Engagement.astro` | `/api/record-view`、`/api/post-stats`、`/api/like` |
| `src/components/Comments.astro` | `/api/comments` |
| `src/pages/admin/comments.astro` | `/api/admin/comments` |
| `src/layouts/BaseLayout.astro` | 输出 canonical、RSS alternate、Open Graph、Twitter card、robots meta、article meta 和 JSON-LD；传入 `image` 时额外输出 `og:image`、`twitter:image` 和结构化数据图片 |

## 10. 验证命令

本地检查：

```bash
npm run check
npm run build
```

本地 endpoint 验证：

其中 `curl -i` 的错误探针应同时看到 `X-Request-Id` 响应头和 JSON body 中的 `requestId`。

```bash
curl -L http://127.0.0.1:4321/posts/hello-world/ | rg "上一篇|下一篇"
curl -L http://127.0.0.1:4321/posts/enterprise-ai-agent-platform/ | rg "article-toc|heading-anchor"
curl -L http://127.0.0.1:4321/archive
curl -L "http://127.0.0.1:4321/search?q=Astro" | rg "search-metadata|pagefind/pagefind.js"
curl -L http://127.0.0.1:4321/pagefind/pagefind.js | rg "pagefind"
curl -L http://127.0.0.1:4321/rss.xml
curl -L http://127.0.0.1:4321/sitemap.xml
curl -L http://127.0.0.1:4321/robots.txt
curl -L "http://127.0.0.1:4321/api/post-stats?slugs=hello-world"
curl -i "http://127.0.0.1:4321/api/post-stats?slugs=not-a-real-post"
curl -i -X GET http://127.0.0.1:4321/api/ai
curl -i -X POST http://127.0.0.1:4321/api/ai-feedback \
  -H "Content-Type: application/json" \
  --data 'not-json'
curl -i http://127.0.0.1:4321/api/ai \
  -H "Content-Type: application/json" \
  --data '{"question":"用中文说一句你好","answerStyle":"brief","pageContext":{"kind":"home"}}'
curl -i http://127.0.0.1:4321/api/ai-feedback \
  -H "Content-Type: application/json" \
  --data '{"messageId":"local-smoke-0001","rating":"helpful","answerStyle":"brief","question":"测试问题","answer":"测试回答","sources":[]}'
```

线上 endpoint 验证：

其中 `curl -i` 的错误探针应同时看到 `X-Request-Id` 响应头和 JSON body 中的 `requestId`。

```bash
curl -L https://macondo-co.netlify.app/posts/hello-world/ | rg "上一篇|下一篇"
curl -L https://macondo-co.netlify.app/posts/enterprise-ai-agent-platform/ | rg "article-toc|heading-anchor"
curl -L https://macondo-co.netlify.app/archive/
curl -L "https://macondo-co.netlify.app/search/?q=Astro" | rg "search-metadata|pagefind/pagefind.js"
curl -L https://macondo-co.netlify.app/pagefind/pagefind.js | rg "pagefind"
curl -L https://macondo-co.netlify.app/rss.xml
curl -L https://macondo-co.netlify.app/sitemap.xml
curl -L https://macondo-co.netlify.app/robots.txt
curl -L "https://macondo-co.netlify.app/api/post-stats?slugs=hello-world"
curl -i "https://macondo-co.netlify.app/api/post-stats?slugs=not-a-real-post"
curl -i -X GET https://macondo-co.netlify.app/api/ai
curl -i -X POST https://macondo-co.netlify.app/api/ai-feedback \
  -H "Content-Type: application/json" \
  --data 'not-json'
curl -i https://macondo-co.netlify.app/api/ai \
  -H "Content-Type: application/json" \
  --data '{"question":"用中文说一句你好","answerStyle":"brief","pageContext":{"kind":"home"}}'
curl -i https://macondo-co.netlify.app/api/ai-feedback \
  -H "Content-Type: application/json" \
  --data '{"messageId":"prod-smoke-0001","rating":"helpful","answerStyle":"brief","question":"测试问题","answer":"测试回答","sources":[]}'
```

安全验证：

```bash
curl -L https://macondo-co.netlify.app/admin/comments | rg "noindex, nofollow"
curl -L https://macondo-co.netlify.app/sitemap.xml | rg "admin|draft"
```

第二条命令不应返回匹配结果。
