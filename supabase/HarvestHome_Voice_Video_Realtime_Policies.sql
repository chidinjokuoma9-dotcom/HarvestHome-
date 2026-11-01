-- HarvestHome one-to-one call signalling authorization
-- Apply once, only after reviewing this migration and approving the live database change.
-- IMPORTANT: Supabase project setting 'Allow public access to channels' must be OFF
-- to enforce private-only channels. Do not apply while that setting remains ON.
-- This does not create call tables or store audio, video, or signalling payloads.
-- Private channel topic format: hh-call:<conversation UUID>
-- Both participants must already be authenticated and pass conversations RLS.


create policy "HarvestHome call participants can receive broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1
    from public.conversations as c
    where realtime.topic() = 'hh-call:' || c.id::text
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
    from public.conversations as c
    where realtime.topic() = 'hh-call:' || c.id::text
      and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
  )
);
