alter table devices
  add column public_key bytea check (public_key is null or octet_length(public_key) = 32),
  add column key_enrolled_at timestamptz,
  add constraint devices_key_matches_time check ((public_key is null) = (key_enrolled_at is null));

create unique index devices_public_key on devices (public_key) where public_key is not null;

create function devices_key_enrolled_once() returns trigger
language plpgsql
as $$
begin
  if old.public_key is not null and new.public_key is distinct from old.public_key then
    raise exception 'device % already has a key', old.id
      using errcode = 'restrict_violation',
            hint = 'A device key is enrolled once. Attach the device again to get a new one.';
  end if;
  return new;
end;
$$;

create trigger devices_key_once
  before update of public_key, key_enrolled_at on devices
  for each row execute function devices_key_enrolled_once();

create table live_challenges (
  id uuid primary key default uuidv7(),
  device_id uuid not null references devices (id),
  nonce bytea not null check (octet_length(nonce) = 32),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create index live_challenges_device_recent on live_challenges (device_id, created_at);

create table stops (
  id uuid primary key,
  account_id uuid not null references accounts (id),
  device_id uuid,
  scope jsonb not null check (jsonb_typeof(scope) = 'object'),
  stopped_at timestamptz not null default clock_timestamp(),
  foreign key (device_id, account_id) references devices (id, account_id)
);

create index stops_account_time on stops (account_id, stopped_at);

create table tasks (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  origin_device_id uuid not null,
  target_device_id uuid,
  request_text text not null check (char_length(request_text) between 1 and 4000),
  status text not null check (
    status in ('created', 'planned', 'running', 'awaiting_confirmation', 'completed', 'failed', 'cancelled', 'stopped')
  ),
  result text check (char_length(result) between 1 and 600),
  stop_id uuid references stops (id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id, account_id),
  foreign key (origin_device_id, account_id) references devices (id, account_id),
  foreign key (target_device_id, account_id) references devices (id, account_id)
);

create index tasks_account_recent on tasks (account_id, created_at desc, id desc);
create index tasks_active on tasks (account_id) where status in ('running', 'awaiting_confirmation');

create table steps (
  id uuid primary key default uuidv7(),
  task_id uuid not null,
  account_id uuid not null,
  position integer not null check (position between 0 and 99),
  summary text not null check (char_length(summary) between 1 and 300),
  action text not null check (
    action in ('wait', 'open_app', 'type_text', 'click', 'run_script', 'take_screenshot', 'call_connector')
  ),
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  target_device_id uuid not null,
  effects text[] not null default '{}'
    check (effects <@ array['deletes', 'pays', 'posts', 'uses_credential', 'reaches_outside']),
  requires_confirmation boolean not null,
  reversible boolean not null,
  on_failure text not null check (on_failure in ('abort', 'retry', 'reroute')),
  status text not null default 'pending'
    check (status in ('pending', 'waiting', 'running', 'done', 'failed', 'skipped', 'stopped')),
  output text check (char_length(output) between 1 and 300),
  asked_at timestamptz,
  answered_at timestamptz,
  answered_by uuid references devices (id),
  started_at timestamptz,
  finished_at timestamptz,
  unique (task_id, position),
  foreign key (task_id, account_id) references tasks (id, account_id),
  foreign key (target_device_id, account_id) references devices (id, account_id),
  check (status <> 'waiting' or asked_at is not null),
  check (status not in ('running', 'done') or started_at is not null),
  check (status not in ('done', 'failed', 'stopped') or finished_at is not null)
);

create index steps_task on steps (task_id, position);

create function steps_finished_work_stays() returns trigger
language plpgsql
as $$
begin
  if old.status = 'done' and new.status <> 'done' then
    raise exception 'step % is finished and stays finished', old.id
      using errcode = 'restrict_violation',
            hint = 'Stopping or failing a task never undoes the steps it already finished.';
  end if;
  return new;
end;
$$;

create trigger steps_done_is_final
  before update of status on steps
  for each row execute function steps_finished_work_stays();

revoke all on function devices_key_enrolled_once() from public;
revoke all on function steps_finished_work_stays() from public;

grant update (public_key, key_enrolled_at) on devices to venom_app;
grant update (confirmation_strictness) on accounts to venom_app;
grant select, insert on live_challenges, tasks, steps, stops to venom_app;
grant update (used_at) on live_challenges to venom_app;
grant update (status, result, stop_id, updated_at) on tasks to venom_app;
grant update (status, output, asked_at, answered_at, answered_by, started_at, finished_at) on steps to venom_app;
