begin;
create table if not exists public.reader_sessions (
 token_hash text primary key, user_id uuid not null references public.quiz_users(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '30 days'
);
create table if not exists public.reader_objects (
 user_id uuid not null references public.quiz_users(id) on delete cascade,
 key text not null check(length(key)<=240), version bigint not null default 1,
 payload jsonb not null, hash text not null, updated_at timestamptz not null default now(),
 primary key(user_id,key)
);
create table if not exists public.reader_chunks (
 user_id uuid not null references public.quiz_users(id) on delete cascade,
 hash text not null check(hash ~ '^[a-f0-9]{64}$'), part integer not null check(part between 0 and 255),
 data text not null check(length(data)<=700000), primary key(user_id,hash,part)
);
alter table public.reader_sessions enable row level security;
alter table public.reader_objects enable row level security;
alter table public.reader_chunks enable row level security;
revoke all on public.reader_sessions,public.reader_objects,public.reader_chunks from public,anon,authenticated;

create or replace function public.reader_user(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 select user_id into u from public.reader_sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if u is null then raise exception '登录已过期，请重新登录' using errcode='28000'; end if;
 return u;
end $$;
revoke all on function public.reader_user(text) from public,anon,authenticated;

create or replace function public.reader_login(p_username text,p_password text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u record; t text;
begin
 select * into u from public.quiz_login_user(p_username,p_password);
 t:=encode(extensions.gen_random_bytes(32),'hex');
 delete from public.reader_sessions where user_id=u.id and expires_at<now();
 insert into public.reader_sessions(token_hash,user_id) values(encode(extensions.digest(t,'sha256'),'hex'),u.id);
 return jsonb_build_object('id',u.id,'username',u.username,'token',t);
end $$;
create or replace function public.reader_logout(p_token text) returns void
language sql security definer set search_path='' as $$
 delete from public.reader_sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
$$;
create or replace function public.reader_list(p_token text,p_after text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.reader_user(p_token); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
 (select key,version,hash from public.reader_objects where user_id=u and key>p_after order by key limit 500) t;
 return result;
end $$;
create or replace function public.reader_get(p_token text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.reader_user(p_token); result jsonb;
begin
 select jsonb_build_object('payload',payload,'version',version,'hash',hash) into result from public.reader_objects where user_id=u and key=p_key;
 return result;
end $$;
create or replace function public.reader_put(p_token text,p_key text,p_version bigint,p_payload jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.reader_user(p_token); v bigint;
begin
 if length(p_key)>240 or p_hash !~ '^[a-f0-9]{64}$' or octet_length(p_payload::text)>12000000 then raise exception '无效同步数据'; end if;
 if p_version=0 then
  insert into public.reader_objects(user_id,key,payload,hash) values(u,p_key,p_payload,p_hash) on conflict do nothing returning version into v;
 else
  update public.reader_objects set payload=p_payload,hash=p_hash,version=version+1,updated_at=now() where user_id=u and key=p_key and version=p_version returning version into v;
 end if;
 return jsonb_build_object('ok',v is not null,'version',v);
end $$;
create or replace function public.reader_chunk_put(p_token text,p_hash text,p_part integer,p_data text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.reader_user(p_token);
begin
 insert into public.reader_chunks(user_id,hash,part,data) values(u,p_hash,p_part,p_data) on conflict do nothing;
end $$;
create or replace function public.reader_chunk_get(p_token text,p_hash text,p_part integer) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.reader_user(p_token); result text;
begin
 select data into result from public.reader_chunks where user_id=u and hash=p_hash and part=p_part;
 return result;
end $$;
revoke all on function public.reader_login(text,text),public.reader_logout(text),public.reader_list(text,text),public.reader_get(text,text),public.reader_put(text,text,bigint,jsonb,text),public.reader_chunk_put(text,text,integer,text),public.reader_chunk_get(text,text,integer) from public,anon,authenticated;
grant execute on function public.reader_login(text,text),public.reader_logout(text),public.reader_list(text,text),public.reader_get(text,text),public.reader_put(text,text,bigint,jsonb,text),public.reader_chunk_put(text,text,integer,text),public.reader_chunk_get(text,text,integer) to anon,authenticated;
commit;

create or replace function public.reader_health() returns text
language sql stable set search_path='' as $$ select 'ok'::text $$;
revoke all on function public.reader_health() from public;
grant execute on function public.reader_health() to anon,authenticated;
