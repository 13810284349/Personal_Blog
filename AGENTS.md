# AGENTS.md

本文件是 Codex/开发代理进入本仓库时自动读取的入口文档。它只保留必须遵守的规则、常用命令和上下文索引；项目状态与长期决策分别维护在 `docs/STATUS.md` 和 `docs/DECISIONS.md`。

## 项目一句话

`自然选择` 是 YiYi 的个人博客，技术栈为 Astro 6 + TypeScript + MDX + Supabase + Netlify。文章内容来自 `src/content/posts/*.mdx`，公开互动数据由 Supabase 保存，浏览器不直连写库，服务端 API 负责所有数据库写入和 Bedrock 调用。

线上站点：https://macondo-co.netlify.app  
GitHub remote：`ssh://git@ssh.github.com:443/13810284349/Personal_Blog.git`

## 必读文档索引

- 每次接手任务先读 `docs/STATUS.md`，确认当前完成度、下一步和已知问题。
- 涉及架构、认证、安全边界、数据库策略、AI 调用策略或部署策略时，读 `docs/DECISIONS.md`。
- 涉及 API 请求/响应、公开 endpoint、Supabase 表/RPC、评论审核或 AI endpoint 时，读 `docs/API_TECHNICAL_DOCUMENTATION.md`。
- 涉及系统分层、部署架构、数据流、安全架构或演进路线时，读 `docs/TECHNICAL_ARCHITECTURE.md`。
- 涉及文章内容时，读 `src/content.config.ts` 和目标 `src/content/posts/*.mdx`。
- 涉及站点名、作者、副标题、导航或公开 URL 时，优先读 `src/lib/site.ts`。

## 常用命令

```bash
npm install
npm run dev
npm run check
npm run build
npm run preview
```

- 本地开发默认访问 `http://127.0.0.1:4321/` 或 Astro 输出的本地地址。
- 提交前至少运行 `npm run check`。
- 涉及页面、API、搜索索引或部署行为时运行 `npm run build`。
- `npm run build` 会先执行 `astro check`，再执行 `astro build`，最后运行 `pagefind --site dist` 生成 `dist/pagefind/`。

## 核心目录

- `src/lib/site.ts`：站点名、作者、副标题、导航、公开站点 URL。
- `src/content.config.ts`：文章 frontmatter schema。
- `src/content/posts/*.mdx`：文章正文。
- `src/layouts/BaseLayout.astro`：全站 HTML shell、导航、footer、SEO、AI 浮窗入口。
- `src/pages/posts/[slug].astro`：文章详情、目录、封面、相关文章、相邻文章、结构化数据。
- `src/pages/archive.astro`、`src/pages/search.astro`、`src/pages/tags/`：公开发现和索引页面。
- `src/pages/api/`：Astro API routes，由 `@astrojs/netlify` 映射为 Netlify Functions。
- `src/components/AiChat.astro`：公开页面右下角 AI 对话框。
- `src/pages/admin/comments.astro`：评论审核页，必须保持 `noindex, nofollow`。
- `src/lib/blogAiContext.ts`：`/api/ai` 的服务端本地文章检索 helper。
- `images/`：MDX 正文引用的本地图片资源。
- `supabase/migrations/`：Supabase 表、RLS、权限迁移。
- `docs/`：状态、决策、架构和 API 文档。

## 开发规则

- 保持现有极简阅读风格，不添加营销型首页或过重装饰。
- 文案优先中文，品牌/作者名从 `src/lib/site.ts` 读取，避免散落硬编码。
- UI 改动后检查桌面和移动宽度，确保文本不溢出、不重叠。
- 新组件放在 `src/components/`，共享工具放在 `src/lib/`。
- API 输入要做 slug、长度、URL、email 等校验；错误返回保持中文友好提示。
- 数据库写操作只在服务端 API 中进行。
- 不要回滚用户未说明要回滚的改动；如果工作区有不相关脏文件，忽略它们。

## 内容规则

文章 frontmatter 由 `src/content.config.ts` 约束：

```yaml
title: 标题
description: 摘要
publishedAt: 2026-06-03
updatedAt: 2026-06-03 # 可选
tags:
  - Astro
draft: false
cover: /optional-cover.jpg # 可选，公开可访问的封面/社交分享图
```

- 草稿设置 `draft: true`，列表、详情页、RSS、sitemap、搜索和 API slug 校验都必须过滤草稿。
- 新增文章时优先使用短 slug、明确摘要、少量稳定标签。
- 文章图片优先放入 `images/`，在 MDX 中用相对路径引用，例如 `![说明](../../../images/example.png)`。
- 图片必须写有意义的 alt 文本；大图或截图提交前尽量压缩。
- 列表页、归档页、搜索页和标签页暂不展示封面，避免破坏极简阅读风格。

## 公开发现与阅读规则

- `/rss.xml`、`/sitemap.xml`、`/robots.txt` 由 Astro endpoint 生成，URL 来源集中在 `src/lib/site.ts`。
- `/archive`、`/search`、首页、标签页、RSS 和 sitemap 只展示或索引已发布文章。
- `/search` 使用 Pagefind；文章页用 `data-pagefind-body` 标记标题、描述、标签和正文。
- 评论、点赞、相关文章、相邻导航、AI 对话框等非正文区域应保持在 `data-pagefind-body` 外，必要时加 `data-pagefind-ignore="all"`。
- 文章目录必须复用 `render(post)` 返回的 `headings` 与 `heading.slug`，不要在页面层另写 slug 算法。
- h2/h3 标题通过 `HeadingH2.astro`、`HeadingH3.astro` 覆盖，保留 Astro/MDX 生成的稳定 id。
- 相关文章推荐和上一篇/下一篇导航必须复用 `getPublishedPosts()`，只链接已发布文章，不新增客户端脚本或 API。
- `cover` 应使用公开可访问的站内路径或绝对 URL，用于详情页封面、社交分享图、Article JSON-LD 和 RSS Media RSS 图片标签。

## Supabase 与评论规则

- 当前交互表：`blog_post_stats`、`blog_post_likes`、`blog_comments`。
- 公开互动 API 和后台审核 API 的完整契约见 `docs/API_TECHNICAL_DOCUMENTATION.md`。
- 不要把 `SUPABASE_SERVICE_ROLE_KEY` 暴露给浏览器端代码。
- 评论默认 `pending`，只有 `approved` 公开展示。
- 公开评论提交按 `ip_hash`、文章 slug、`created_at` 做服务端限流和重复正文检测；不要记录或返回原始 IP。
- `COMMENT_SPAM_WORDS` 命中时直接拒绝评论，不写入审核队列。
- `COMMENT_NOTIFY_WEBHOOK_URL` 只用于服务端待审通知；通知失败不影响评论提交。
- 待审通知不要包含邮箱、网站、user-agent、`ip_hash` 或原始 IP。
- 后台审核接口使用 `Authorization: Bearer <BLOG_ADMIN_TOKEN>`。
- 改 Supabase schema 前，先查看现有迁移，优先新增迁移，不要直接改已应用迁移。

## AI 对话规则

- `AiChat` 由 `BaseLayout` 在 `!noindex` 时全站公开渲染；后台审核页等 `noindex` 页面不显示。
- 浏览器只调用 `/api/ai`，不接收、不保存、不展示 Bedrock token 或本地文章索引。
- `/api/ai` 服务端读取 Bedrock 环境变量，按首选模型、Sonnet fallback、Haiku fallback 的顺序调用 Bedrock Converse API。
- `src/lib/blogAiContext.ts` 只检索已发布文章的标题、摘要、标签和正文片段；不要读取草稿、后台页、评论审核数据、Supabase 私密字段、环境变量或 `.env`。
- AI UI 必须保持 `data-pagefind-ignore="all"`，避免聊天内容进入 Pagefind 索引。
- AI UI 改动优先保持静态 CSS + 少量原生 pointer 事件，不新增前端框架、API、数据库或持久化状态。
- 修改 `/api/ai` 请求/响应格式、fallback 逻辑、检索策略或 AI feedback 行为时，同步更新 `docs/API_TECHNICAL_DOCUMENTATION.md`；涉及长期策略时同步 `docs/DECISIONS.md`。

## 环境变量与密钥

本地复制 `.env.example` 为 `.env` 后填写真实值。仓库只能提交 `.env.example`，不能提交 `.env`。

服务端私密变量：

- `SUPABASE_SERVICE_ROLE_KEY`
- `BLOG_ADMIN_TOKEN`
- `COMMENT_NOTIFY_WEBHOOK_URL`
- `AWS_BEARER_TOKEN_BEDROCK`

公开或非私密配置：

- `SUPABASE_URL`
- `PUBLIC_SITE_URL`
- `BEDROCK_REGION`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `COMMENT_RATE_LIMIT_POST_WINDOW_SECONDS`
- `COMMENT_RATE_LIMIT_SITE_WINDOW_SECONDS`
- `COMMENT_RATE_LIMIT_SITE_MAX`
- `COMMENT_DUPLICATE_WINDOW_SECONDS`
- `COMMENT_SPAM_WORDS`
- `AI_RATE_LIMIT_WINDOW_SECONDS`
- `AI_RATE_LIMIT_MAX`

规则：

- 不要给 Bedrock、Supabase service role、admin token 或 webhook URL 加 `PUBLIC_` 前缀。
- 不要在日志、截图、文档、终端输出或提交内容中展示真实密钥、数据库密码、admin token、webhook URL 或 Bedrock token。
- 如果需要调试环境变量，只输出变量名是否存在，不输出变量值。

## Netlify 与部署规则

- 本项目使用 `@astrojs/netlify` adapter，生产构建启用 `netlify()` adapter。
- `netlify.toml` 的 Build command 为 `npm run build`，Publish directory 为 `dist`，Node 版本为 `22`。
- 当前站点已连接 GitHub 仓库，`main` 分支 `git push origin main` 后由 Netlify 自动触发生产构建和部署。
- 不再使用上传式部署；不要把本地 `.env`、`dist/`、`.netlify/` 或临时构建产物作为部署包上传。
- 修改 Netlify 环境变量后需要重新部署，Netlify Functions 才会读取新值。

部署后重点检查：

- `https://macondo-co.netlify.app/`
- `https://macondo-co.netlify.app/archive/`
- `https://macondo-co.netlify.app/search/?q=Astro`
- `https://macondo-co.netlify.app/about`
- 一个文章详情页
- 评论、点赞、阅读量 API
- AI 浮窗是否能回答“这个博客写什么的？”并引用真实文章标题或 `/posts/.../` 链接
- 如配置了 `COMMENT_NOTIFY_WEBHOOK_URL`，提交一条测试评论确认后台可见且通知到达

## 文档更新规则

- 每次功能迭代结束，更新 `docs/STATUS.md` 的已完成、当前状态、下一步、最近验证或已知问题。
- 如果改变架构、认证、安全边界、数据库策略、AI 调用策略或部署策略，更新 `docs/DECISIONS.md`。
- 如果改变开发方式、部署方式、验证命令、项目约定或 Codex 协作流程，更新本文件。
- 如果改变 API 请求/响应、公开 endpoint、环境变量、数据表/RPC 或前端调用方，更新 `docs/API_TECHNICAL_DOCUMENTATION.md`。
- 如果改变系统分层、运行模式、部署架构、数据流或安全架构，更新 `docs/TECHNICAL_ARCHITECTURE.md`。
- 不要把 `.env`、密钥、真实 token、私密连接串写入任何文档。

## Git 工作流

```bash
git status --short
npm run check
npm run build
git add <files>
git commit -m "Concise English commit message"
git push origin main
```

- 提交前确认 `git status --short` 不包含 `.env`、`dist/`、`.netlify/`、`node_modules/`。
- 推送到 `main` 后，到 Netlify Deploys 确认新 deploy 关联 GitHub commit、branch 为 `main`、状态为 `Published/Ready`。
- 此项目历史对话里曾出现过敏感 Supabase 信息；正式长期运行前应确认数据库密码和 service role key 已轮换。
