alter table accounts
  add column email_verified_at timestamptz;

alter table devices
  add column credential_hash bytea unique check (credential_hash is null or octet_length(credential_hash) = 32),
  add column revoked_at timestamptz,
  add constraint devices_revoked_matches_status check ((status = 'revoked') = (revoked_at is not null));

create table account_secrets (
  account_id uuid primary key references accounts (id),
  opaque_record bytea not null check (octet_length(opaque_record) between 64 and 1024),
  created_at timestamptz not null default clock_timestamp()
);

create table signups (
  id uuid primary key default uuidv7(),
  account_id uuid not null unique default uuidv7(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null,
  code_hash bytea not null check (octet_length(code_hash) = 32),
  code_attempts smallint not null default 0 check (code_attempts between 0 and 5),
  verified_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (completed_at is null or verified_at is not null)
);

create index signups_email_recent on signups (lower(email), created_at);

create table attach_attempts (
  id uuid primary key default uuidv7(),
  email text not null,
  account_id uuid references accounts (id),
  login_state bytea,
  proven_at timestamptz,
  code_hash bytea check (code_hash is null or octet_length(code_hash) = 32),
  code_attempts smallint not null default 0 check (code_attempts between 0 and 5),
  device_id uuid references devices (id),
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (proven_at is null or (account_id is not null and code_hash is not null)),
  check (completed_at is null or (proven_at is not null and device_id is not null))
);

create index attach_attempts_email_recent on attach_attempts (lower(email), created_at);

grant insert on accounts, devices to venom_app;
grant update (name, capabilities, status, last_seen_at, revoked_at) on devices to venom_app;
grant select, insert on account_secrets to venom_app;
grant select, insert, update on signups, attach_attempts to venom_app;
