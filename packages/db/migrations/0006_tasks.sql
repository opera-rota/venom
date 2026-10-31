alter table steps drop constraint steps_status_check;

alter table steps
  add constraint steps_status_check check (
    status in ('pending', 'waiting', 'running', 'done', 'failed', 'skipped', 'stopped', 'ignored')
  ),
  add column set_aside_reason text check (char_length(set_aside_reason) between 1 and 300),
  add column set_aside_at timestamptz,
  add column set_aside_by uuid,
  add constraint steps_set_aside_has_reason check ((status in ('skipped', 'ignored')) = (set_aside_reason is not null)),
  add constraint steps_set_aside_whole check ((set_aside_reason is null) = (set_aside_at is null) and (set_aside_reason is null) = (set_aside_by is null)),
  add constraint steps_set_aside_device foreign key (set_aside_by, account_id) references devices (id, account_id);

create function steps_moves_allowed() returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status || '>' || new.status <> all (array[
    'pending>waiting', 'pending>running', 'pending>skipped', 'pending>ignored',
    'waiting>pending', 'waiting>stopped',
    'running>done', 'running>failed', 'running>stopped',
    'failed>pending', 'failed>skipped', 'failed>ignored',
    'stopped>pending',
    'skipped>pending', 'skipped>ignored',
    'ignored>pending', 'ignored>failed'
  ]) then
    raise exception 'step % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'restrict_violation',
            hint = 'Steps follow the task state machine. Finished work stays finished.';
  end if;
  return new;
end;
$$;

create trigger steps_moves_allowed
  before update of status on steps
  for each row execute function steps_moves_allowed();

create function tasks_moves_allowed() returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status || '>' || new.status <> all (array[
    'created>planned', 'created>running', 'created>cancelled',
    'planned>running', 'planned>cancelled',
    'running>awaiting_confirmation', 'running>completed', 'running>failed', 'running>stopped', 'running>cancelled',
    'awaiting_confirmation>running', 'awaiting_confirmation>cancelled', 'awaiting_confirmation>stopped', 'awaiting_confirmation>failed',
    'stopped>running', 'failed>running', 'cancelled>running'
  ]) then
    raise exception 'task % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'restrict_violation',
            hint = 'A completed task stays completed. Stopped, failed and cancelled tasks can only be resumed.';
  end if;
  return new;
end;
$$;

create trigger tasks_moves_allowed
  before update of status on tasks
  for each row execute function tasks_moves_allowed();

revoke all on function steps_moves_allowed() from public;
revoke all on function tasks_moves_allowed() from public;

grant update (set_aside_reason, set_aside_at, set_aside_by) on steps to venom_app;
