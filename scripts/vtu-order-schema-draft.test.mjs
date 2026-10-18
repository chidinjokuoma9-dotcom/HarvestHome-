import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const schemaPath = resolve("docs/VTU-ORDER-SCHEMA-DRAFT.sql");
const schema = await readFile(schemaPath, "utf8");

test("order schema remains a review-only draft outside migrations", () => {
  assert.ok(schema.includes("DESIGN DRAFT ONLY"));
  assert.ok(!schemaPath.includes("/supabase/migrations/"));
  assert.ok(schema.includes("Do not run against Supabase"));
});

test("order schema has unique idempotency, payment reference, and provider request keys", () => {
  assert.ok(schema.includes("idempotency_key text not null unique"));
  assert.ok(schema.includes("payment_reference text unique"));
  assert.ok(schema.includes("provider_request_id text unique"));
});

test("order schema uses integer minor units and bounds provider attempts", () => {
  assert.ok(schema.includes("amount_kobo bigint not null check (amount_kobo > 0)"));
  assert.ok(schema.includes("provider_attempt_count integer not null default 0 check (provider_attempt_count between 0 and 1)"));
  assert.ok(schema.includes("check (provider_attempt_count = 0 or provider_request_id is not null)"));
});

test("order and event tables enable RLS and restrict customer access to owned records", () => {
  assert.ok(schema.includes("alter table public.vtu_orders enable row level security"));
  assert.ok(schema.includes("alter table public.vtu_order_events enable row level security"));
  assert.ok(schema.includes("using ((select auth.uid()) = user_id)"));
  assert.ok(schema.includes("and o.user_id = (select auth.uid())"));
  assert.ok(schema.includes("revoke all on table public.vtu_orders from anon, authenticated"));
  assert.ok(schema.includes("revoke all on table public.vtu_order_events from anon, authenticated"));
  assert.ok(schema.includes("grant select ("));
  assert.ok(schema.includes("id, user_id, product_type, network, product_label, recipient_phone,"));
  assert.ok(schema.includes("amount_kobo, currency, payment_status, order_status, created_at, updated_at, completed_at"));
  assert.ok(!schema.includes("grant select on table public.vtu_order_events to authenticated"));
  assert.ok(schema.includes("No direct client SELECT grant on the internal audit/event table."));
  assert.ok(!/grant all|grant insert|grant update/i.test(schema));
  assert.ok(schema.includes("revoke all on function public.claim_vtu_provider_attempt(uuid, text) from public, anon, authenticated"));
  assert.ok(schema.includes("grant execute on function public.claim_vtu_provider_attempt(uuid, text) to service_role"));
  assert.ok(schema.includes("grant select, insert, update on table public.vtu_orders to service_role"));
  assert.ok(schema.includes("grant select, insert on table public.vtu_order_events to service_role"));
  assert.ok(schema.includes("grant usage, select on sequence public.vtu_order_events_id_seq to service_role"));
});

test("provider attempt reservation is atomic, one-time, and service-role only", () => {
  assert.ok(schema.includes("create or replace function public.claim_vtu_provider_attempt("));
  assert.ok(schema.includes("security invoker"));
  assert.ok(schema.includes("as $vtu$"));
  assert.ok(schema.includes("$vtu$;"));
  assert.ok(schema.includes("set search_path = ''"));
  assert.ok(schema.includes("and o.order_status = 'payment_verified'"));
  assert.ok(schema.includes("and o.provider_request_id is null"));
  assert.ok(schema.includes("and o.provider_attempt_count = 0"));
  assert.ok(schema.includes("provider_attempt_count = 1"));
  assert.ok(schema.includes("returning"));
});

test("phase-one order design does not introduce a customer or reseller wallet", () => {
  assert.ok(schema.includes("no customer/reseller wallet in phase 1"));
  assert.ok(!/create table if not exists public\.(customer_wallets|reseller_wallets|wallet_transactions)/i.test(schema));
});


test("provider attempt reservation inserts an audit event atomically in the same function", () => {
  assert.ok(schema.includes("language plpgsql"));
  assert.ok(schema.includes("claimed public.vtu_orders%rowtype;"));
  assert.ok(schema.includes("returning o.* into claimed;"));
  assert.ok(schema.includes("if not found then"));
  assert.ok(schema.includes("insert into public.vtu_order_events ("));
  assert.ok(schema.includes("'provider_attempt_reserved'"));
  assert.ok(schema.includes("'Request ID reserved before provider submission; submission is not yet confirmed.'"));
  assert.ok(schema.includes("return query"));
  assert.ok(schema.includes("provider_attempt_count = 1"));
});


test("order creation function is idempotent, validates inputs, and atomically records creation", () => {
  assert.ok(schema.includes("create or replace function public.create_vtu_order("));
  assert.ok(schema.includes("on conflict (idempotency_key) do nothing"));
  assert.ok(schema.includes("if existing.user_id is distinct from p_user_id"));
  assert.ok(schema.includes("Idempotency key was already used for a different VTU order"));
  assert.ok(schema.includes("'order_created'"));
  assert.ok(schema.includes("revoke all on function public.create_vtu_order(uuid, text, text, text, text, text, text, text, bigint)"));
  assert.ok(schema.includes("grant execute on function public.create_vtu_order(uuid, text, text, text, text, text, text, text, bigint)"));
  assert.ok(schema.includes("The caller must be a trusted Edge Function"));
});
