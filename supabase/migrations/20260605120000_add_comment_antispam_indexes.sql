create index if not exists blog_comments_ip_post_created_idx
  on public.blog_comments(ip_hash, post_slug, created_at desc)
  where ip_hash is not null;

create index if not exists blog_comments_ip_created_idx
  on public.blog_comments(ip_hash, created_at desc)
  where ip_hash is not null;
