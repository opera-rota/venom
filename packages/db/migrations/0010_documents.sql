alter table messages
  add column document jsonb,
  add constraint messages_document_shape check (
    document is null or coalesce(
      jsonb_typeof(document) = 'object'
      and document ?& array['title', 'body']
      and document - 'title' - 'body' = '{}'::jsonb
      and jsonb_typeof(document -> 'title') = 'string'
      and jsonb_typeof(document -> 'body') = 'string'
      and char_length(document ->> 'title') between 1 and 120
      and char_length(document ->> 'body') between 1 and 32000,
      false
    )
  ),
  add constraint messages_document_from_venom check (document is null or (speaker = 'venom' and kind = 'text'));
