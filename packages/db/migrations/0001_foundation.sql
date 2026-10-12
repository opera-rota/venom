create table accounts (
  id uuid primary key default uuidv7(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null,
  listening_mode text not null default 'press_to_talk'
    check (listening_mode in ('wake_word', 'press_to_talk')),
  confirmation_strictness text not null default 'standard'
    check (confirmation_strictness in ('standard', 'strict')),
  created_at timestamptz not null default clock_timestamp()
);

create unique index accounts_email_key on accounts (lower(email));

create table devices (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  type text not null check (type in ('computer', 'phone', 'tv', 'watch')),
  name text not null check (char_length(name) between 1 and 80),
  platform text not null check (
    platform in ('windows', 'macos', 'linux', 'android', 'ios', 'android_tv', 'tvos', 'wear_os', 'watchos')
  ),
  capabilities jsonb not null check (jsonb_typeof(capabilities) = 'object'),
  status text not null default 'registered'
    check (status in ('registered', 'active', 'offline', 'revoked')),
  last_seen_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, account_id)
);

create index devices_account on devices (account_id);

create table messages (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  device_id uuid not null,
  request_id uuid not null,
  speaker text not null check (speaker in ('user', 'venom')),
  text text not null check (char_length(text) between 1 and 16000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (device_id, account_id) references devices (id, account_id)
);

create index messages_account_timeline on messages (account_id, created_at, id);
create index messages_request on messages (request_id);

create table audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  account_id uuid references accounts (id),
  device_id uuid references devices (id),
  request_id uuid,
  actor text not null check (actor in ('user', 'venom', 'system')),
  action text not null check (action ~ '^[a-z]+(\.[a-z_]+)+$'),
  subject_id uuid,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object')
);

create index audit_log_account_time on audit_log (account_id, occurred_at);
create index audit_log_request on audit_log (request_id) where request_id is not null;

create function audit_log_refuse_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is refused', tg_op
    using errcode = 'restrict_violation',
          hint = 'Audit records can be added, never changed or removed.';
end;
$$;

create trigger audit_log_no_update_or_delete
  before update or delete on audit_log
  for each row execute function audit_log_refuse_change();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_refuse_change();

revoke all on all tables in schema public from public;
revoke all on function audit_log_refuse_change() from public;

grant usage on schema public to venom_app;
grant select on accounts, devices to venom_app;
grant select, insert on messages, audit_log to venom_app;
