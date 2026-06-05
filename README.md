# 自然选择

一个基于 Astro、MDX、Supabase 和 Netlify 的个人博客。

## 本地开发

1. 在 Supabase 控制台轮换已经暴露过的数据库密码和 service role key。
2. 复制 `.env.example` 为 `.env`，填入轮换后的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 和 `BLOG_ADMIN_TOKEN`。
3. 安装依赖并运行：

```bash
npm install
npm run dev
```

`npm run dev` 用于常规页面开发。Pagefind 搜索索引需要在静态构建后生成，验证全文搜索时请运行：

```bash
npm run build
npm run preview
```

## 部署

Netlify 已连接 GitHub 仓库，`main` 分支 push 后会自动触发生产构建和部署。

部署配置：

- Build command: `npm run build`
- Publish directory: `dist`
- Environment variables: 与 `.env.example` 一致

`npm run build` 会先执行 Astro 检查与构建，再运行 Pagefind，在 `dist/pagefind/` 生成纯静态全文搜索 bundle。

发布流程：

```bash
npm run check
npm run build
git push origin main
```

推送后在 Netlify Deploys 中确认最新 deploy 关联 GitHub commit、branch 为 `main`，状态为 Published/Ready。

## 内容

文章放在 `src/content/posts/*.mdx`。草稿文章设置 `draft: true` 后不会在列表和详情页中发布。
