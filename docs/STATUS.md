# 项目状态

更新时间：2026-07-02

本文件记录当前完成度、接手状态和下一步。每次功能迭代结束后都应更新，避免把临时状态塞回 `AGENTS.md`。

## 已完成

- Astro 6 + TypeScript + MDX 博客主体已建立，文章内容位于 `src/content/posts/*.mdx`。
- 站点品牌、作者、副标题、导航和公开 URL 集中在 `src/lib/site.ts`。
- 首页、文章详情页、标签页、关于页、404 页已完成。
- `/archive` 按年份/月分组展示已发布文章。
- `/search` 使用 Pagefind 静态全文搜索，只索引公开文章正文与必要元数据。
- `/rss.xml`、`/sitemap.xml`、`/robots.txt` 已作为公开发现入口生成，并过滤草稿和后台页。
- 文章详情页已支持封面图、目录、h2/h3 标题锚点、相关文章推荐、上一篇/下一篇导航、Article JSON-LD 和 article Open Graph 元数据。
- 正文图片可从仓库内 `images/` 引用，正文图片样式由 `.prose img` 统一控制。
- Supabase 已承载阅读量、点赞、评论和 AI feedback 数据；浏览器不直连 service role 写库。
- 评论提交、服务端限流、重复正文检测、垃圾词拒绝、待审通知和后台审核页已实现。
- AI 对话框已在公开页面渲染，浏览器调用 `/api/ai`，服务端通过 Bedrock 调用 Claude，并用已发布文章做轻量本地检索上下文。
- AI 回答支持来源卡片和“有帮助 / 没帮助”反馈摘要保存。
- JSON API 已统一返回 `X-Request-Id`，错误 body 返回 `requestId`，服务端异常使用脱敏结构化日志便于 Netlify Function 排障。
- Netlify Git-based 自动部署已作为当前部署方式。
- 2026-07-02 已将项目迭代文档拆分为 `AGENTS.md`、`docs/STATUS.md`、`docs/DECISIONS.md`。

## 当前状态

- 生产站点：`https://macondo-co.netlify.app`。
- 技术栈：Astro 6、TypeScript、MDX、Supabase、Netlify、Pagefind、Bedrock Claude。
- 本地开发入口：`npm run dev`，默认访问 `http://127.0.0.1:4321/`。
- 基础验证命令：`npm run check`；涉及页面、API、搜索索引或部署行为时运行 `npm run build`。
- API 契约、环境变量、表/RPC 和前端调用方以 `docs/API_TECHNICAL_DOCUMENTATION.md` 为准。
- 系统分层、数据流、安全架构和部署架构以 `docs/TECHNICAL_ARCHITECTURE.md` 为准。
- 长期架构和安全取舍以 `docs/DECISIONS.md` 为准。

## 下一步

- 后续任务开始时，先根据 `AGENTS.md` 的文档索引读取相关文档，不要依赖模型记忆。
- 每次功能迭代结束后，按影响范围同步更新 `STATUS.md`、`DECISIONS.md`、`AGENTS.md`、API 文档或架构文档。
- 内容类迭代优先保持短 slug、明确摘要、稳定标签和有意义图片 alt。
- UI 类迭代继续保持极简阅读风格，并检查桌面与移动端文本是否溢出或重叠。
- API / AI / Supabase 类迭代优先保持服务端边界，不新增客户端密钥暴露面。

## 最近验证

- 2026-07-02：为 JSON API 增加 requestId 与脱敏错误日志后运行 `npm run check`，通过；仅保留既有 `document.execCommand("copy")` deprecation hint，无错误。
- 2026-07-02：运行 `npm run build`，通过；完成 Astro check、生产构建和 Pagefind 索引生成。
- 2026-07-02：本地 dev server 验证 `/api/post-stats` 无效 slug、`GET /api/ai` 405、`POST /api/ai-feedback` 无效 JSON 均返回 `X-Request-Id` 和错误 body `requestId`；评论 honeypot 成功响应仅在 header 返回 `X-Request-Id`，body 保持原成功结构；传入安全格式 `X-Request-Id` 时服务端会沿用。
- 2026-07-02：已推送 `main` commit `8200fb3`；Netlify 当前生产 deploy 仍锁定在旧 commit `66a597e`，线上 `macondo-co.netlify.app` 和 `main--macondo-co.netlify.app` 的 API 探针仍是旧响应，未完成线上 requestId 验证。未执行上传式部署。
- 2026-07-02：本次文档拆分和架构目录清单更新后运行 `npm run check`，通过；仅保留既有 `document.execCommand("copy")` deprecation hint，无错误。

## 已知问题

- 历史对话里曾出现敏感 Supabase 信息；正式长期运行前应确认数据库密码和 service role key 已轮换。
- Netlify 当前生产 deploy 显示 `locked: true` 且仍指向旧 commit `66a597e`；需要在 Netlify 解除 locked deploy 或恢复 GitHub main 自动构建发布后，再重新验证线上 `X-Request-Id`。
- `docs/TECHNICAL_ARCHITECTURE.md` 是详细架构文档；后续涉及架构变化时应顺手复核其中的仓库结构、功能清单和演进路线是否仍准确。
- 当前没有代码级阻塞项；线上发布阻塞在 Netlify locked deploy 状态。
