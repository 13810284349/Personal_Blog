# 项目决策记录

更新时间：2026-07-02

本文件记录会长期影响项目迭代的架构、认证、安全、数据库、AI 和部署策略。新增或修改这些策略时，在这里追加决策记录；不要把真实密钥、token、连接串或私密 URL 写入本文档。

## ADR-001：采用静态优先的 Astro + MDX 博客架构

日期：2026-07-02  
状态：已接受

背景：个人博客应优先保证阅读体验、低运维成本和稳定发布流程，文章内容需要像普通文本一样可版本化。

决策：文章正文放在 `src/content/posts/*.mdx`，由 Astro Content Collection 管理；公开页面尽量静态生成，互动能力通过服务端 API 补充。

影响：新增文章主要是新增 MDX 文件；公开列表、标签、归档、RSS、sitemap、搜索和文章详情都必须过滤草稿。

后续条件：只有当内容规模或协作流程明显超出 MDX 管理能力时，才重新评估 CMS 或外部内容源。

## ADR-002：Supabase 写入只走服务端 API

日期：2026-07-02  
状态：已接受

背景：阅读量、点赞、评论和 AI feedback 需要持久化，但不能把 service role key 暴露给浏览器。

决策：浏览器只调用 `src/pages/api/*`；服务端 API 使用 `SUPABASE_SERVICE_ROLE_KEY` 访问 Supabase。浏览器端不直接写库，不持有 service role key。

影响：所有数据库写操作必须在服务端 API 内完成，并做输入校验、长度限制和中文友好错误提示。

后续条件：如引入登录用户体系或公开客户端写库，必须重新设计 RLS、权限模型和 API 文档。

## ADR-003：评论采用轻量审核，不引入用户体系

日期：2026-07-02  
状态：已接受

背景：个人博客需要评论互动，但完整账号体系会增加复杂度和维护成本。

决策：评论默认进入 `pending`；只有 `approved` 评论公开展示。后台审核接口使用 `Authorization: Bearer <BLOG_ADMIN_TOKEN>`。评论提交使用 IP hash 限流、重复正文检测和环境变量维护的垃圾词拒绝。

影响：后台审核页必须保持 `noindex, nofollow`；通知和日志不应包含原始 IP、邮箱、网站、user-agent、`ip_hash` 或私密字段。

后续条件：如果垃圾评论规模超出当前能力，再评估验证码、第三方审核、登录或更细粒度风控。

## ADR-004：公开发现使用 Astro endpoint + Pagefind

日期：2026-07-02  
状态：已接受

背景：博客需要被搜索引擎发现，也需要站内搜索，但不希望为搜索引入运行时服务。

决策：`/rss.xml`、`/sitemap.xml`、`/robots.txt` 由 Astro endpoint 生成；`/search` 使用 Pagefind 在构建后生成静态索引。

影响：搜索范围应限制为已发布文章标题、描述、标签和正文；导航、footer、评论、点赞、相关文章、相邻导航和 AI 对话内容不得进入 Pagefind 索引。

后续条件：只有当静态索引无法满足搜索质量或规模需求时，才评估外部搜索服务。

## ADR-005：文章阅读辅助能力保持静态、克制

日期：2026-07-02  
状态：已接受

背景：文章详情页需要更好的阅读和分享体验，但博客整体风格应保持轻量。

决策：封面图、文章目录、h2/h3 标题锚点、相关文章推荐、上一篇/下一篇导航、BlogPosting JSON-LD 和 article Open Graph 元数据都在构建期或静态 HTML 中完成。

影响：目录必须复用 Astro/MDX `render(post)` 返回的 `headings`；相关文章和相邻文章必须复用 `getPublishedPosts()`，只链接已发布文章；这些能力不新增 Supabase、API 或客户端状态。

后续条件：如果引入更复杂的推荐系统或个性化阅读流，必须重新评估数据来源、隐私和缓存策略。

## ADR-006：AI 对话由服务端代理 Bedrock，并只注入公开文章上下文

日期：2026-07-02  
状态：已接受

背景：公开页面需要 AI 对话能力，但 Bedrock token、草稿内容和后台数据不能暴露给浏览器或模型上下文。

决策：`AiChat` 只调用 `/api/ai`；服务端读取 Bedrock 环境变量，按首选模型、Sonnet fallback、Haiku fallback 顺序调用 Bedrock Converse API。`src/lib/blogAiContext.ts` 只检索已发布文章的标题、摘要、标签、链接和正文片段。

影响：AI 上下文不读取草稿、后台页、评论审核数据、Supabase 私密字段、环境变量或 `.env`；AI 对话框必须使用 `data-pagefind-ignore="all"`；对话 history 只保留在当前页面内存。

后续条件：如果改为向量检索、外部知识库、持久化对话或多用户记忆，必须新增安全评估并同步 API 文档。

## ADR-007：部署采用 GitHub main 分支触发 Netlify 自动构建

日期：2026-07-02  
状态：已接受

背景：个人博客需要可重复、可追踪的发布流程，避免本地上传构建产物带来的密钥和产物污染风险。

决策：站点连接 GitHub 仓库，`main` 分支 push 后由 Netlify 自动执行 `npm run build` 并发布 `dist`。不使用上传式部署。

影响：不要提交 `.env`、`dist/`、`.netlify/`、`node_modules/` 或临时构建产物。修改 Netlify 环境变量后需要重新部署，Functions 才会读取新值。

后续条件：如引入预览环境、分支部署或手动审批发布，需要更新部署策略、验证清单和本文档。

## ADR-008：Codex 协作文档拆分为入口、状态和决策

日期：2026-07-02  
状态：已接受

背景：原 `AGENTS.md` 同时承载规则、状态、历史和详细技术说明，后续迭代容易产生上下文噪音。

决策：`AGENTS.md` 保留 Codex 自动读取入口、常用命令、安全红线、文档索引和文档更新规则；`docs/STATUS.md` 记录已完成、当前状态、下一步、最近验证和已知问题；`docs/DECISIONS.md` 记录长期架构、安全、认证、数据库、AI 和部署决策。

影响：后续任务必须按 `AGENTS.md` 的索引读取相关文档；每次功能迭代结束后按影响范围更新状态、决策、API 文档或架构文档。

后续条件：如果文档再次变长，应优先拆出专题文档，而不是把详细历史放回 `AGENTS.md`。

## ADR-009：API 观测采用 requestId 与脱敏结构化日志

日期：2026-07-02  
状态：已接受

背景：博客读者侧功能已较完整，生产环境剩余高优先级风险之一是 API、Supabase、Bedrock 或通知链路异常时难以快速关联浏览器错误和 Netlify Function logs。

决策：所有 JSON API 响应统一返回 `X-Request-Id`；错误 body 额外返回同一个 `requestId`。服务端异常使用结构化日志记录 `requestId`、endpoint、method、action、status 和脱敏错误摘要，不引入外部日志平台或新运行时依赖。

影响：普通输入校验错误不写错误日志；数据库、RPC、Bedrock、AI context、AI feedback 和评论通知等服务端或上游异常写入日志。日志不得包含密钥、token、原始 IP、`ip_hash`、邮箱、网站、user-agent、webhook URL、环境变量值、评论正文全文、AI 问题全文、history、prompt 或回答全文。

后续条件：如果流量或排障复杂度超过 Netlify Function logs 能力，再评估 Sentry、OpenTelemetry、外部日志平台或告警系统。
