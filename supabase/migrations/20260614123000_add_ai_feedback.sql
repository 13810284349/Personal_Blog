create extension if not exists pgcrypto;

create table if not exists public.blog_ai_feedback (
  id uuid primary key default gen_random_uuid(),
  client_message_id text not null unique check (char_length(client_message_id) between 8 and 140),
  rating text not null check (rating in ('helpful', 'unhelpful')),
  answer_style text not null check (answer_style in ('brief', 'deep', 'literary')),
  page_context jsonb,
  question_excerpt text not null check (char_length(question_excerpt) <= 700),
  answer_excerpt text not null check (char_length(answer_excerpt) <= 1800),
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blog_ai_feedback_rating_created_idx
  on public.blog_ai_feedback(rating, created_at desc);

create index if not exists blog_ai_feedback_style_created_idx
  on public.blog_ai_feedback(answer_style, created_at desc);

alter table public.blog_ai_feedback enable row level security;

revoke all on table public.blog_ai_feedback from public;
revoke all on table public.blog_ai_feedback from anon, authenticated;
grant select, insert, update on table public.blog_ai_feedback to service_role;
