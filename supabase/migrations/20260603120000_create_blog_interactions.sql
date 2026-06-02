create extension if not exists pgcrypto;

create table if not exists public.blog_post_stats (
  slug text primary key,
  views_count bigint not null default 0 check (views_count >= 0),
  likes_count bigint not null default 0 check (likes_count >= 0),
  comments_count bigint not null default 0 check (comments_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_post_likes (
  id uuid primary key default gen_random_uuid(),
  post_slug text not null references public.blog_post_stats(slug) on delete cascade,
  visitor_id text not null check (char_length(visitor_id) between 8 and 128),
  created_at timestamptz not null default now(),
  unique (post_slug, visitor_id)
);

create table if not exists public.blog_comments (
  id uuid primary key default gen_random_uuid(),
  post_slug text not null references public.blog_post_stats(slug) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 80),
  author_email text check (author_email is null or char_length(author_email) <= 160),
  author_website text check (author_website is null or char_length(author_website) <= 240),
  body text not null check (char_length(body) between 2 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists blog_post_likes_post_slug_idx
  on public.blog_post_likes(post_slug);

create index if not exists blog_comments_post_status_created_idx
  on public.blog_comments(post_slug, status, created_at desc);

create index if not exists blog_comments_status_created_idx
  on public.blog_comments(status, created_at desc);

create or replace function public.set_blog_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_blog_post_stats_updated_at on public.blog_post_stats;
create trigger set_blog_post_stats_updated_at
  before update on public.blog_post_stats
  for each row execute function public.set_blog_updated_at();

drop trigger if exists set_blog_comments_updated_at on public.blog_comments;
create trigger set_blog_comments_updated_at
  before update on public.blog_comments
  for each row execute function public.set_blog_updated_at();

alter table public.blog_post_stats enable row level security;
alter table public.blog_post_likes enable row level security;
alter table public.blog_comments enable row level security;

revoke all on table public.blog_post_stats from anon, authenticated;
revoke all on table public.blog_post_likes from anon, authenticated;
revoke all on table public.blog_comments from anon, authenticated;

create or replace function public.increment_blog_post_view(p_slug text)
returns table (
  slug text,
  views_count bigint,
  likes_count bigint,
  comments_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.blog_post_stats as stats (slug, views_count)
  values (p_slug, 1)
  on conflict (slug)
  do update set
    views_count = stats.views_count + 1,
    updated_at = now();

  return query
  select stats.slug, stats.views_count, stats.likes_count, stats.comments_count
  from public.blog_post_stats as stats
  where stats.slug = p_slug;
end;
$$;

create or replace function public.register_blog_post_like(
  p_slug text,
  p_visitor_id text
)
returns table (
  liked boolean,
  slug text,
  views_count bigint,
  likes_count bigint,
  comments_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.blog_post_stats (slug)
  values (p_slug)
  on conflict (slug) do nothing;

  insert into public.blog_post_likes (post_slug, visitor_id)
  values (p_slug, p_visitor_id)
  on conflict (post_slug, visitor_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    update public.blog_post_stats as stats
    set likes_count = stats.likes_count + 1,
        updated_at = now()
    where stats.slug = p_slug;
  end if;

  return query
  select
    inserted_count > 0,
    stats.slug,
    stats.views_count,
    stats.likes_count,
    stats.comments_count
  from public.blog_post_stats as stats
  where stats.slug = p_slug;
end;
$$;

revoke all on function public.increment_blog_post_view(text) from public;
revoke all on function public.register_blog_post_like(text, text) from public;
grant execute on function public.increment_blog_post_view(text) to service_role;
grant execute on function public.register_blog_post_like(text, text) to service_role;
