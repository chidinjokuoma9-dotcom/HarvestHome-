-- Public storefront visitors may read only the active subscription expiry for a published store.
-- No seller/payment details are exposed; expired subscriptions remain private to the owner/staff.
drop policy if exists partner_store_subscriptions_public_active on public.partner_store_subscriptions;
create policy partner_store_subscriptions_public_active
  on public.partner_store_subscriptions for select to anon, authenticated
  using (
    status = 'active'
    and ends_at > now()
    and exists (
      select 1 from public.partner_storefronts f
      where f.id = storefront_id
        and f.is_published = true
        and f.removed_at is null
    )
  );
grant select on public.partner_store_subscriptions to anon, authenticated;
