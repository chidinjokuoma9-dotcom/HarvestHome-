-- HarvestHome one-to-one call signalling authorization
-- Apply only after reviewing the Realtime "Allow public access" setting.
-- This migration does not create call tables or store audio/video/signalling payloads.
-- Channel topic format: hh-call:<conversation UUID>

create policy "HarvestHome call participants can receive broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1
    from public.conversations c
    where c.id = (
      substring(realtime.topic() from '^hh-call:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$')
    )::uuid
    and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
  )
);

create policy "HarvestHome call participants can send broadcasts"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and exists (
    select 1
    from public.conversations c
    where c.id = (
      substring(realtime.topic() from '^hh-call:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$')
    )::uuid
    and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
  )
);
