import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const schemaPath = resolve("docs/VTU-ORDER-SCHEMA-DRAFT.sql");
const schema = await readFile(schemaPath, "utf8");

test("order schema remains a review-only draft outside migrations", async () => {
  assert.match(schema, /DESIGN DRAFT ONLY/i);
  assert.doesNotMatch(schemaPath, /supabase[\\/]migrations[\\/]/);
  assert.match(schema, /not run against Supabase/i);
});

test("order schema has unique idempotency, payment reference, and provider request keys", () => {
  assert.match(schema, /idempotency_key\\s+text\\s+not null unique/i);
  assert.match(schema, /payment_reference\\s+text unique/i);
  assert.match(schema, /provider_request_id\\s+text unique/i);
});

test("order schema uses integer minor units and bounds provider attempts", () => {
  assert.match(schema, /amount_kobo\\s+bigint not null check \\(amount_kobo > 0\\)/i);
  assert.match(schema, /provider_attempt_count integer not null default 0 check \\(provider_attempt_count between 0 and 1\\)/i);
  assert.match(schema, /provider_attempt_count = 0 or provider_request_id is not null/i);
});

test("order and event tables enable RLS and restrict customer access to owned records", () => {
  assert.match(schema, /alter table public\\.vtu_orders enable row level security/i);
  assert.match(schema, /alter table public\\.vtu_order_events enable row level security/i);
  assert.match(schema, /auth\\.uid\\(\\)\\) = user_id/i);
  assert.match(schema, /o\\.user_id = \\(select auth\\.uid\\(\\)\\)/i);
  assert.doesNotMatch(schema, /for (insert|update|delete) to authenticated/i);
  assert.match(schema, /revoke all on table public\\.vtu_orders from anon, authenticated/i);
  assert.match(schema, /revoke all on table public\\.vtu_order_events from anon, authenticated/i);
  assert.match(schema, /grant select on table public\\.vtu_orders to authenticated/i);
  assert.match(schema, /grant select on table public\\.vtu_order_events to authenticated/i);\n  assert.doesNotMatch(schema, /grant all|grant insert|grant update/i);
});

test("phase-one order design does not introduce a customer or reseller wallet", () => {
  assert.match(schema, /no customer\\/reseller wallet in phase 1/i);
  assert.doesNotMatch(schema, /create table if not exists public\\.(customer_wallets|reseller_wallets|wallet_transactions)/i);
});
