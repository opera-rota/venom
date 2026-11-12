alter table tasks
  add column kind text not null default 'plan' check (kind in ('plan', 'goal'));

create table moves (
  id uuid primary key default uuidv7(),
  task_id uuid not null,
  account_id uuid not null,
  number integer not null check (number between 1 and 1000),
  intent text not null check (char_length(intent) between 1 and 200),
  seen text not null check (char_length(seen) between 1 and 300),
  move jsonb not null check (jsonb_typeof(move) = 'object' and move ? 'name'),
  effects text[] not null default '{}'
    check (effects <@ array['deletes', 'pays', 'posts', 'uses_credential', 'reaches_outside']),
  status text not null check (status in ('asking', 'running', 'done', 'failed', 'refused', 'declined', 'stopped')),
  detail text check (char_length(detail) between 1 and 300),
  asked_at timestamptz,
  answered_at timestamptz,
  answered_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (task_id, number),
  unique (id, task_id),
  foreign key (task_id, account_id) references tasks (id, account_id),
  foreign key (answered_by, account_id) references devices (id, account_id),
  check (status <> 'asking' or asked_at is not null),
  check (status <> 'running' or started_at is not null),
  check ((status in ('asking', 'running')) = (finished_at is null))
);

create index moves_task on moves (task_id, number);
create index moves_asking on moves (account_id) where status = 'asking';

create function moves_moves_allowed() returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status || '>' || new.status <> all (array[
    'asking>running', 'asking>declined', 'asking>stopped', 'asking>failed',
    'running>done', 'running>failed', 'running>refused', 'running>stopped'
  ]) then
    raise exception 'move % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'restrict_violation',
            hint = 'A finished move stays finished.';
  end if;
  return new;
end;
$$;

create trigger moves_moves_allowed
  before update of status on moves
  for each row execute function moves_moves_allowed();

alter table messages
  add column move_id uuid,
  add constraint messages_move foreign key (move_id, task_id) references moves (id, task_id),
  drop constraint messages_kind_links,
  add constraint messages_kind_links check (
    (kind = 'text' and task_id is null and step_id is null and move_id is null)
    or (kind in ('plan', 'report') and task_id is not null and step_id is null and move_id is null)
    or (kind = 'question' and task_id is not null and (step_id is null) <> (move_id is null))
  );

create index messages_move on messages (move_id) where move_id is not null;

revoke all on function moves_moves_allowed() from public;

grant select, insert on moves to venom_app;
grant update (status, detail, asked_at, answered_at, answered_by, started_at, finished_at) on moves to venom_app;
