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

## 部署

Netlify 连接 GitHub 仓库后使用以下配置：

- Build command: `npm run build`
- Publish directory: `dist`
- Environment variables: 与 `.env.example` 一致

## 内容

文章放在 `src/content/posts/*.mdx`。草稿文章设置 `draft: true` 后不会在列表和详情页中发布。
