# AGENTS.md

本文件给后续大模型/开发代理快速接手本仓库使用。优先保持实现简洁、文案一致、密钥安全。

## 项目概览

- 项目：`自然选择`，作者/品牌文案当前为 `YiYi`，配置入口在 `src/lib/site.ts`。
- 技术栈：Astro 6 + TypeScript + MDX + Supabase + Netlify。
- 内容来源：文章正文放在 GitHub 仓库的 `src/content/posts/*.mdx`。
- 互动数据：评论、点赞、阅读量由 Supabase 保存，浏览器不直连写库，服务端 API 使用 service role key。
- 线上站点：https://macondo-co.netlify.app
- GitHub remote：`ssh://git@ssh.github.com:443/13810284349/Personal_Blog.git`

## 常用命令

```bash
npm install
npm run dev
npm run check
npm run build
npm run preview
```

- 本地开发默认访问 `http://127.0.0.1:4321/` 或 Astro 输出的本地地址。
- 提交前至少运行 `npm run check`；涉及页面、API 或部署行为时运行 `npm run build`。
- `npm run build` 会先执行 `astro check`，再执行 `astro build`。

## 目录速览

- `src/lib/site.ts`：站点名、作者、副标题、导航。
- `src/layouts/BaseLayout.astro`：全站 HTML shell、页眉、导航、footer。
- `src/pages/index.astro`：首页文章列表。
- `src/pages/about.astro`：关于页。
- `src/pages/tags/`：标签列表和标签详情。
- `src/pages/posts/[slug].astro`：文章详情。
- `src/pages/admin/comments.astro`：轻量评论审核页。
- `src/pages/api/`：Astro API routes，由 `@astrojs/netlify` 映射为 Netlify Functions。
- `src/components/Comments.astro`：评论区。
- `src/components/Engagement.astro`：点赞和阅读量。
- `src/content/posts/*.mdx`：文章内容。
- `supabase/migrations/`：Supabase 表、RLS、权限迁移。
- `netlify.toml`：Netlify 构建和安全 header 配置。

## 内容模型

文章 frontmatter 由 `src/content.config.ts` 约束：

```yaml
title: 标题
description: 摘要
publishedAt: 2026-06-03
updatedAt: 2026-06-03 # 可选
tags:
  - Astro
draft: false
cover: /optional-cover.jpg # 可选
```

- 草稿设置 `draft: true`，列表和详情页应过滤草稿。
- 新增文章时优先使用短 slug、明确摘要、少量稳定标签。

## Supabase

当前交互表：

- `blog_post_stats`
- `blog_post_likes`
- `blog_comments`

当前 API：

- `GET /api/post-stats?slug=...`
- `POST /api/record-view`
- `POST /api/like`
- `GET /api/comments?slug=...`
- `POST /api/comments`
- `GET /api/admin/comments`
- `PATCH /api/admin/comments`

规则：

- 不要把 `SUPABASE_SERVICE_ROLE_KEY` 暴露给浏览器端代码。
- 不要提交 `.env`、数据库连接串、service role key、admin token。
- 评论默认 `pending`，只有 `approved` 公开展示。
- 后台审核接口使用 `Authorization: Bearer <BLOG_ADMIN_TOKEN>`。
- 改 Supabase schema 前，先查看现有迁移，优先新增迁移，不要直接改已应用迁移。

## 环境变量

本地复制 `.env.example` 为 `.env` 后填写真实值。仓库只能提交 `.env.example`。

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-rotated-service-role-key
BLOG_ADMIN_TOKEN=replace-with-a-long-random-token
PUBLIC_SITE_URL=https://macondo-co.netlify.app
```

- `SUPABASE_URL`：服务端 Supabase client 使用。
- `SUPABASE_SERVICE_ROLE_KEY`：仅服务端 API/Netlify Functions 使用，必须保密。
- `BLOG_ADMIN_TOKEN`：评论审核页调用后台接口使用，必须保密。
- `PUBLIC_SITE_URL`：公开站点 URL，可放在客户端可见环境变量中。

## Netlify

本项目使用 Astro 的 Netlify adapter：

- `@astrojs/netlify` 已安装。
- `astro.config.mjs` 中生产构建启用 `netlify()` adapter。
- `netlify.toml`：
  - Build command: `npm run build`
  - Publish directory: `dist`
  - Node: `22`

注意：

- 当前站点曾使用上传式部署；若未连接 GitHub 自动部署，部署时使用干净临时 clone，避免把本地 `.env` 上传。
- Netlify 环境变量必须至少包含 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`BLOG_ADMIN_TOKEN`、`PUBLIC_SITE_URL`。
- 修改环境变量后需要重新部署，Netlify Functions 才会读取新值。
- 部署后检查：
  - `https://macondo-co.netlify.app/`
  - `https://macondo-co.netlify.app/about`
  - 一个文章详情页
  - 评论/点赞/阅读量 API 是否正常。

## 开发约定

- 维持现有极简阅读风格，不添加营销型首页或过重装饰。
- 文案优先中文，品牌/作者名从 `src/lib/site.ts` 读取，避免散落硬编码。
- UI 改动后检查桌面和移动宽度，确保文本不溢出、不重叠。
- 新组件放在 `src/components/`，共享工具放在 `src/lib/`。
- API 输入要做 slug、长度、URL、email 等校验；错误返回保持中文友好提示。
- 数据库写操作只在服务端 API 中进行。

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
- 不要回滚用户未说明要回滚的改动。
- 如果发现不相关脏文件，先确认来源，不要擅自覆盖。

## 安全提醒

- 此项目历史对话里曾出现过敏感 Supabase 信息；正式长期运行前应轮换数据库密码和 service role key。
- 截图、日志、终端输出里不要展示 service role key、数据库密码、admin token。
- 如果需要调试环境变量，只输出变量名是否存在，不输出变量值。
