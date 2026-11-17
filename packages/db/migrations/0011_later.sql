create table later_items (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  device_id uuid not null,
  task_id uuid,
  title text not null check (char_length(title) between 1 and 120 and title ~ '\S'),
  body text not null check (char_length(body) between 1 and 32000 and body ~ '\S'),
  seen_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (device_id, account_id) references devices (id, account_id),
  foreign key (task_id, account_id) references tasks (id, account_id)
);

create index later_items_account on later_items (account_id, created_at desc, id desc);

grant select, insert, delete on later_items to venom_app;
grant update (seen_at) on later_items to venom_app;
