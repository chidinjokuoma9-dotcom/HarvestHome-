-- HarvestHome marketplace seller-presence authorization
-- Apply only after reviewing and approving this database change.
-- Requires Supabase Realtime 'Allow public access to channels' to be OFF.
-- The client joins hh-marketplace-presence-v1 as a private channel.
-- Only authenticated users may publish/read this limited presence channel.
-- No marketplace listings, messages, or user records are created or modified.

create policy "HarvestHome authenticated users can receive marketplace presence"
on realtime.messages
for select
to authenticated
using (
  extension = 'presence'
  and realtime.topic() = 'hh-marketplace-presence-v1'
);

create policy "HarvestHome authenticated users can publish marketplace presence"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'presence'
  and realtime.topic() = 'hh-marketplace-presence-v1'
);
