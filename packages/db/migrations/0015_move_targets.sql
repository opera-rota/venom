alter table moves
  add column target jsonb check (target is null or jsonb_typeof(target) = 'object');

update moves
set target = jsonb_build_object('kind', null, 'name', found[1], 'window', found[2])
from (
  select id as move_id, regexp_match(detail, '^(?:Double-clicked|Clicked) mark [0-9]+ ''(.*)'' in ''(.*)''\.$') as found
  from moves
  where move->>'name' = 'click' and detail is not null
) clicked
where moves.id = clicked.move_id and clicked.found is not null;

update moves
set target = jsonb_build_object('kind', null, 'name', found[1], 'window', null)
from (
  select id as move_id, regexp_match(detail, 'mark [0-9]+ ''([^'']*)''') as found
  from moves
  where move->>'name' in ('type', 'scroll') and move->>'mark' is not null and detail is not null
) marked
where moves.id = marked.move_id and marked.found is not null;

update moves
set target = jsonb_build_object('kind', null, 'name', null, 'window', found[1])
from (
  select id as move_id, regexp_match(detail, '^Pressed [^ ]+ in ''(.*)''\.$') as found
  from moves
  where move->>'name' = 'key' and detail is not null
) pressed
where moves.id = pressed.move_id and pressed.found is not null;
