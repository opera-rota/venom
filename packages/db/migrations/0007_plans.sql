alter table messages
  add column task_id uuid,
  add constraint messages_task foreign key (task_id, account_id) references tasks (id, account_id),
  add constraint messages_task_from_venom check (task_id is null or speaker = 'venom');

create index messages_task on messages (task_id) where task_id is not null;

alter table accounts
  add column skip_asking text[] not null default '{}'
    constraint accounts_skip_asking_allowed check (
      skip_asking <@ array['deletes', 'posts', 'reaches_outside']::text[] and cardinality(skip_asking) <= 3
    );

grant update (skip_asking) on accounts to venom_app;
