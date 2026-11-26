create table howtos (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  device_id uuid not null,
  task_id uuid,
  name text not null check (char_length(name) between 1 and 60 and name ~ '\S'),
  app text check (app is null or (char_length(app) between 1 and 80 and app ~ '\S')),
  learned text not null check (learned in ('show', 'tell', 'job')),
  pinned boolean not null default false,
  applied integer not null default 0 check (applied >= 0),
  worked integer not null default 0 check (worked between 0 and applied),
  seconds integer check (seconds is null or seconds >= 0),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 40),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (device_id, account_id) references devices (id, account_id),
  foreign key (task_id, account_id) references tasks (id, account_id)
);

create index howtos_account on howtos (account_id, pinned desc, updated_at desc, id desc);
create unique index howtos_one_per_task on howtos (account_id, task_id) where task_id is not null;

grant select, insert, delete on howtos to venom_app;
grant update (name, pinned, applied, worked, steps, updated_at) on howtos to venom_app;
