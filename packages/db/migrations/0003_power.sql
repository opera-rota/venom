create table engine_choices (
  account_id uuid primary key references accounts (id),
  engine text not null check (engine ~ '^[a-z]{2,24}$'),
  chosen_at timestamptz not null default clock_timestamp()
);

create table power_ledger (
  id bigint generated always as identity primary key,
  account_id uuid not null references accounts (id),
  occurred_at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('grant', 'answer')),
  units bigint not null,
  engine text check (engine ~ '^[a-z]{2,24}$'),
  engine_class text check (engine_class in ('free', 'swift', 'titan')),
  request_id uuid unique,
  model text check (char_length(model) between 1 and 100),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cost_micro_usd bigint check (cost_micro_usd >= 0),
  note text check (char_length(note) between 1 and 200),
  check (
    (kind = 'grant' and units > 0 and request_id is null and engine is null and engine_class is null)
    or (
      kind = 'answer' and units <= 0 and request_id is not null and engine is not null and engine_class is not null
      and input_tokens is not null and output_tokens is not null and cost_micro_usd is not null
      and (engine_class <> 'free' or units = 0)
    )
  )
);

create index power_ledger_account_time on power_ledger (account_id, occurred_at);
create index power_ledger_account_engine on power_ledger (account_id, engine, occurred_at) where kind = 'answer';

create function power_ledger_refuse_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'power_ledger is append-only: % is refused', tg_op
    using errcode = 'restrict_violation',
          hint = 'Power is changed by adding a grant or an answer, never by editing the ledger.';
end;
$$;

create trigger power_ledger_no_update_or_delete
  before update or delete on power_ledger
  for each row execute function power_ledger_refuse_change();

create trigger power_ledger_no_truncate
  before truncate on power_ledger
  for each statement execute function power_ledger_refuse_change();

revoke all on function power_ledger_refuse_change() from public;

grant select, insert on power_ledger to venom_app;
grant select, insert on engine_choices to venom_app;
grant update (engine, chosen_at) on engine_choices to venom_app;
