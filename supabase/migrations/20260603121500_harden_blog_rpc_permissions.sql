alter function public.set_blog_updated_at() set search_path = public;

revoke all on function public.increment_blog_post_view(text) from anon;
revoke all on function public.increment_blog_post_view(text) from authenticated;
revoke all on function public.register_blog_post_like(text, text) from anon;
revoke all on function public.register_blog_post_like(text, text) from authenticated;

grant execute on function public.increment_blog_post_view(text) to service_role;
grant execute on function public.register_blog_post_like(text, text) to service_role;
