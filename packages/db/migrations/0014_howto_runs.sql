create table howto_runs (
  task_id uuid primary key,
  account_id uuid not null references accounts (id),
  howto_id uuid not null references howtos (id) on delete cascade,
  step_by_step boolean not null,
  worked boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (task_id, account_id) references tasks (id, account_id)
);

create index howto_runs_howto on howto_runs (howto_id);

grant select, insert on howto_runs to venom_app;
grant update (worked) on howto_runs to venom_app;
