const publicSiteUrl = (
  import.meta.env.PUBLIC_SITE_URL ?? "https://macondo-co.netlify.app"
).replace(/\/+$/, "");

export const site = {
  name: "自然选择",
  author: "YiYi",
  subtitle: "YiYi 的个人博客",
  description: "在技术、阅读和日常观察之间，保存一些缓慢但真实的判断。",
  url: publicSiteUrl,
  nav: [
    { href: "/", label: "文章" },
    { href: "/search", label: "搜索" },
    { href: "/tags", label: "标签" },
    { href: "/archive", label: "归档" },
    { href: "/about", label: "关于" },
    { href: "/admin/comments", label: "审核" }
  ]
};
