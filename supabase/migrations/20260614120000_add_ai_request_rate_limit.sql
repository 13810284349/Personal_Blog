create extension if not exists pgcrypto;

create table if not exists public.blog_ai_request_events (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null check (char_length(ip_hash) between 3 and 128),
  created_at timestamptz not null default now()
);

create index if not exists blog_ai_request_events_ip_created_idx
  on public.blog_ai_request_events(ip_hash, created_at desc);

create index if not exists blog_ai_request_events_created_idx
  on public.blog_ai_request_events(created_at desc);

alter table public.blog_ai_request_events enable row level security;

revoke all on table public.blog_ai_request_events from public;
revoke all on table public.blog_ai_request_events from anon, authenticated;
grant select, insert, delete on table public.blog_ai_request_events to service_role;

create or replace function public.reserve_blog_ai_request(
  p_ip_hash text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_ip_hash text;
  normalized_window integer;
  normalized_max integer;
  now_at timestamptz;
  window_start timestamptz;
  recent_count integer;
  oldest_recent timestamptz;
begin
  normalized_ip_hash := coalesce(nullif(trim(p_ip_hash), ''), 'ip_unknown');
  normalized_ip_hash := left(normalized_ip_hash, 128);
  if char_length(normalized_ip_hash) < 3 then
    normalized_ip_hash := 'ip_unknown';
  end if;

  normalized_window := least(greatest(coalesce(p_window_seconds, 600), 1), 86400);
  normalized_max := least(greatest(coalesce(p_max_requests, 10), 1), 1000);
  now_at := clock_timestamp();
  window_start := now_at - make_interval(secs => normalized_window);

  perform pg_advisory_xact_lock(hashtext('blog_ai_request_events'), hashtext(normalized_ip_hash));

  delete from public.blog_ai_request_events
  where created_at < window_start;

  select count(*)::integer, min(created_at)
  into recent_count, oldest_recent
  from public.blog_ai_request_events
  where ip_hash = normalized_ip_hash
    and created_at >= window_start;

  if recent_count >= normalized_max then
    allowed := false;
    retry_after_seconds := greatest(
      1,
      ceiling(
        extract(epoch from (coalesce(oldest_recent, now_at) + make_interval(secs => normalized_window) - now_at))
      )::integer
    );
    remaining := 0;
    return next;
    return;
  end if;

  insert into public.blog_ai_request_events (ip_hash, created_at)
  values (normalized_ip_hash, now_at);

  allowed := true;
  retry_after_seconds := 0;
  remaining := greatest(normalized_max - recent_count - 1, 0);
  return next;
end;
$$;

revoke all on function public.reserve_blog_ai_request(text, integer, integer) from public;
revoke all on function public.reserve_blog_ai_request(text, integer, integer) from anon, authenticated;
grant execute on function public.reserve_blog_ai_request(text, integer, integer) to service_role;
