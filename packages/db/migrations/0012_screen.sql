alter table devices
  add column in_use boolean not null default false,
  add column locked boolean not null default false,
  add constraint devices_in_use_not_revoked check (not (in_use and status = 'revoked'));

create unique index devices_one_in_use on devices (account_id) where in_use;

grant update (in_use, locked) on devices to venom_app;
