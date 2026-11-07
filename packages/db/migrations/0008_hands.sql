alter table steps
  add constraint steps_id_task unique (id, task_id),
  drop constraint steps_output_check,
  add constraint steps_output_length check (char_length(output) between 1 and 16000);

update steps
set params = params || '{"open": null}'::jsonb
where action = 'open_app' and not params ? 'open';

alter table messages
  add column kind text not null default 'text',
  add column step_id uuid;

update messages set kind = 'plan' where task_id is not null;

alter table messages
  add constraint messages_kind_known check (kind in ('text', 'plan', 'question', 'report')),
  add constraint messages_step foreign key (step_id, task_id) references steps (id, task_id),
  add constraint messages_kind_links check (
    (kind = 'text' and task_id is null and step_id is null)
    or (kind in ('plan', 'report') and task_id is not null and step_id is null)
    or (kind = 'question' and task_id is not null and step_id is not null)
  ),
  add constraint messages_kind_from_venom check (kind = 'text' or speaker = 'venom');

create index messages_step on messages (step_id) where step_id is not null;
