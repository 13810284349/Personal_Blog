# AGENTS.md

本文件给后续大模型/开发代理快速接手本仓库使用。优先保持实现简洁、文案一致、密钥安全。

## 项目概览

- 项目：`自然选择`，作者/品牌文案当前为 `YiYi`，配置入口在 `src/lib/site.ts`。
- 技术栈：Astro 6 + TypeScript + MDX + Supabase + Netlify。
- 内容来源：文章正文放在 GitHub 仓库的 `src/content/posts/*.mdx`。
- 互动数据：评论、点赞、阅读量由 Supabase 保存，浏览器不直连写库，服务端 API 使用 service role key。
- 发现与订阅：`/rss.xml`、`/sitemap.xml`、`/robots.txt` 由 Astro endpoint 生成，URL 来源集中在 `src/lib/site.ts`。
- 公开索引：`/archive` 按年份/月分组展示所有已发布文章；`/search` 构建期生成本地搜索索引，入口都在主导航和 sitemap 中。
- 文章详情：`/posts/[slug]` 自动从 MDX 渲染结果提取 h2/h3 生成文章目录，标题保留 Astro 生成的稳定 id 并带可跳转锚点；正文后有相关文章推荐和上一篇/下一篇导航，均复用 `getPublishedPosts()`，只链接已发布文章。
- 图片能力：文章可在 MDX 中引用仓库内图片，当前图片资源放在根目录 `images/`，正文图片样式由 `src/styles/global.css` 的 `.prose img` 统一控制；文章 frontmatter 的 `cover` 用于详情页正文宽度封面图和社交分享图。
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
- `src/pages/archive.astro`：文章归档页，按年份/月展示已发布文章。
- `src/pages/search.astro`：站内搜索页，构建期从已发布文章生成内嵌索引，前端本地搜索。
- `src/pages/about.astro`：关于页。
- `src/pages/tags/`：标签列表和标签详情。
- `src/pages/posts/[slug].astro`：文章详情，包含正文、文章目录、标题锚点、相关文章推荐、互动组件和相邻文章导航。
- `src/components/ArticleToc.astro`：文章目录组件，接收 Astro `MarkdownHeading[]`，桌面端渲染右侧目录，移动端渲染正文前折叠目录。
- `src/components/HeadingH2.astro`、`src/components/HeadingH3.astro`：MDX h2/h3 覆盖组件，保留标题 id 并追加 hover/focus 可见的 `#` 锚点。
- `src/components/RelatedPosts.astro`：相关文章推荐组件，接收构建期算好的已发布文章列表，空列表时不渲染。
- `src/pages/admin/comments.astro`：轻量评论审核页。
- `src/pages/api/`：Astro API routes，由 `@astrojs/netlify` 映射为 Netlify Functions。
- `src/pages/rss.xml.ts`、`src/pages/sitemap.xml.ts`、`src/pages/robots.txt.ts`：RSS、站点地图和爬虫规则。
- `src/components/Comments.astro`：评论区。
- `src/components/Engagement.astro`：点赞和阅读量。
- `src/content/posts/*.mdx`：文章内容。
- `images/`：MDX 正文引用的本地图片资源。
- `docs/API_TECHNICAL_DOCUMENTATION.md`：当前 API 与公开 endpoint 技术文档。
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
cover: /optional-cover.jpg # 可选，公开可访问的封面/社交分享图
```

- 草稿设置 `draft: true`，列表和详情页应过滤草稿。
- `/archive`、`/search` 与首页、标签页、RSS、sitemap 一样，只展示或索引已发布文章。
- 文章详情页目录由 `render(post)` 返回的 `headings` 过滤 h2/h3 生成，使用 `heading.slug` 作为链接 hash；不要在页面层另写一套 slug 算法，避免目录链接和 Astro 输出的标题 id 脱节。
- h2/h3 标题通过 MDX `components={{ h2: HeadingH2, h3: HeadingH3 }}` 覆盖，标题文字变更时 id 会随 Astro/MDX 的 heading slug 更新。
- 文章没有 h2/h3 时不渲染目录；桌面目录位于右侧 aside，移动端目录位于正文前并默认折叠，不遮挡阅读。
- 相关文章推荐在文章详情页构建期计算：从 `getPublishedPosts()` 中排除当前文章，只保留与当前文章有共享标签的已发布文章；按共享标签数量降序，再按发布时间倒序，最多 3 篇。
- 当前文章没有标签，或没有任何共享标签文章时，不渲染相关文章区块；推荐区只展示标题、发布日期和描述，不新增客户端脚本。
- 文章详情页的“上一篇 / 下一篇”沿用 `getPublishedPosts()` 的发布时间倒序：`上一篇` 是数组中前一个、更近发布的文章；`下一篇` 是数组中后一个、更早发布的文章。
- 正文底部顺序为：相关文章推荐、相邻文章导航、评论区；相邻文章导航只在存在相邻已发布文章时展示，显示克制方向标签、文章标题和发布日期。
- `cover` 存在时，文章详情页在标题区后、正文列最前面展示正文宽度封面图，并通过 `BaseLayout` 输出 `og:image` 和 `twitter:image`；没有 `cover` 时不渲染封面图，也不输出图片 meta。
- `cover` 应使用可公开访问的站内路径或绝对 URL，例如 `/covers/post-title.png` 或 `https://example.com/post-title.png`；社交分享图推荐 1200×630。
- 列表页、归档页、搜索页和标签页暂不展示封面，避免破坏极简阅读风格。
- 新增文章时优先使用短 slug、明确摘要、少量稳定标签。
- 文章图片优先放入 `images/`，在 MDX 中用相对路径引用，例如 `![说明](../../../images/example.png)`。
- 图片必须写有意义的 alt 文本；大图或截图提交前尽量压缩，避免仓库体积无谓膨胀。

## 发现与订阅

当前公开发现入口：

- `GET /rss.xml`：RSS 2.0 feed，只包含已发布文章。
- `GET /sitemap.xml`：包含首页、关于页、归档页、标签页和已发布文章，不包含草稿和后台页。
- `GET /robots.txt`：允许公开内容抓取，`Disallow: /admin/`，并声明 sitemap 地址。

规则：

- canonical、Open Graph、Twitter card、RSS alternate link 由 `src/layouts/BaseLayout.astro` 统一输出；文章 `cover` 通过可选 `image` prop 输出 `og:image` 和 `twitter:image`。
- 公开站点 URL 由 `site.url` 提供，优先读取 `PUBLIC_SITE_URL`，默认回退到 `https://macondo-co.netlify.app`。
- `/archive` 是公开 HTML 页面，不调用 Supabase，不新增 API；文章排序和草稿过滤应复用 `getPublishedPosts()`。
- `/search` 是公开 HTML 页面，不调用 Supabase，不新增 API；构建期复用 `getPublishedPosts()` 生成只含已发布文章的搜索索引，搜索范围为标题、描述、标签和清洗截断后的正文摘要。
- `/posts/[slug]` 的封面图、文章目录和标题锚点是静态 HTML 页面行为，不调用 Supabase，不新增 API；目录数据应复用 Astro/MDX 的 `headings`，锚点应复用标题已有 id。
- `/posts/[slug]` 的相关文章推荐是静态 HTML 页面行为，不调用 Supabase，不新增 API；排序、草稿过滤和日期格式应复用 `getPublishedPosts()`、文章 `tags` 与 `formatDate()`。
- `/posts/[slug]` 的相邻文章导航是静态 HTML 页面行为，不调用 Supabase，不新增 API；排序、草稿过滤和日期格式应复用 `getPublishedPosts()` 与 `formatDate()`。
- 后台审核页必须保持 `noindex, nofollow`。
- 新增公开页面后，应评估是否加入 `site.nav` 和 `sitemap.xml.ts`。

## Supabase

当前交互表：

- `blog_post_stats`
- `blog_post_likes`
- `blog_comments`

当前 API：

- `GET /api/post-stats?slugs=...`
- `POST /api/record-view`
- `POST /api/like`
- `GET /api/comments?slug=...`
- `POST /api/comments`
- `GET /api/admin/comments`
- `PATCH /api/admin/comments`

公开非 JSON endpoint：

- `GET /posts/[slug]`
- `GET /archive`
- `GET /search`
- `GET /rss.xml`
- `GET /sitemap.xml`
- `GET /robots.txt`

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
  - `https://macondo-co.netlify.app/archive/`
  - `https://macondo-co.netlify.app/search/?q=Astro`
  - `https://macondo-co.netlify.app/about`
  - 一个文章详情页
  - 评论/点赞/阅读量 API 是否正常。

## 开发约定

- 维持现有极简阅读风格，不添加营销型首页或过重装饰。
- 文案优先中文，品牌/作者名从 `src/lib/site.ts` 读取，避免散落硬编码。
- UI 改动后检查桌面和移动宽度，确保文本不溢出、不重叠。
- 文章封面、目录、标题锚点、相关文章推荐等阅读辅助能力保持克制：优先静态 HTML/CSS，避免新增客户端脚本、API 或数据库依赖。
- 新组件放在 `src/components/`，共享工具放在 `src/lib/`。
- API 输入要做 slug、长度、URL、email 等校验；错误返回保持中文友好提示。
- 数据库写操作只在服务端 API 中进行。
- 公开发现 endpoint 不应泄露后台页、草稿文章或未发布内容。

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
