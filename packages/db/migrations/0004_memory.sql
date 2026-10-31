create extension if not exists vector;

create table memories (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  type text not null check (type in ('fact', 'preference', 'event')),
  content text not null check (char_length(content) between 1 and 500 and content ~ '\S'),
  source text not null check (source in ('chat', 'settings')),
  source_request_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  embedding vector,
  embedding_model text check (char_length(embedding_model) between 1 and 100),
  words tsvector generated always as (to_tsvector('english'::regconfig, content)) stored,
  check ((embedding is null) = (embedding_model is null)),
  check ((source = 'chat') = (source_request_id is not null))
);

create index memories_account_time on memories (account_id, created_at, id);
create index memories_account_type on memories (account_id, type, updated_at);
create index memories_words on memories using gin (words);

create function memories_within_limit() returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.account_id::text, 4));
  if (select count(*) from memories where account_id = new.account_id) >= 500 then
    raise exception 'memory is full for account %', new.account_id
      using errcode = 'check_violation',
            constraint = 'memories_limit',
            hint = 'Forget something before saving more.';
  end if;
  return new;
end;
$$;

create trigger memories_limit
  before insert on memories
  for each row execute function memories_within_limit();

create function forget_memory(target_account uuid, target_memory uuid)
returns table (spoken_request uuid, removed_messages uuid[])
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  spoken uuid;
  removed uuid[] := '{}';
begin
  delete from memories
  where id = target_memory and account_id = target_account
  returning source_request_id into spoken;

  if not found then
    return;
  end if;

  if spoken is not null then
    with gone as (
      delete from messages
      where account_id = target_account and request_id = spoken
      returning id
    )
    select coalesce(array_agg(id order by id), '{}') into removed from gone;
  end if;

  return query select spoken, removed;
end;
$$;

revoke all on function memories_within_limit() from public;
revoke all on function forget_memory(uuid, uuid) from public;

grant select, insert on memories to venom_app;
grant update (type, content, updated_at, embedding, embedding_model) on memories to venom_app;
grant execute on function forget_memory(uuid, uuid) to venom_app;
