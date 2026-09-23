# HarvestHome V7 — Supabase + Cloudflare Pages

This version removes Wrangler/D1 from the frontend deployment. Upload the contents of this folder to Cloudflare Pages as a static site after configuring Supabase.

## 1. Create Supabase project
Create a project at https://supabase.com/ . In SQL Editor, run `supabase/schema.sql`.

## 2. Configure the frontend
Edit `Config.js` and replace:
- YOUR_SUPABASE_URL
- YOUR_SUPABASE_ANON_KEY
- YOUR_PAYSTACK_PUBLIC_KEY

The anon key is intended for browser use with RLS enabled. Never put a Paystack secret key in Config.js.

## 3. Password reset
In Supabase Authentication > URL Configuration, set your Site URL to your Cloudflare Pages URL and add the same URL as a Redirect URL. The app uses Supabase Auth's password recovery flow.

## 4. Admin / Moderator
After creating your account, change the role in `public.profiles` from Buyer/Seller to Admin or Moderator using the Supabase SQL Editor. RLS protects staff-only actions.

Example:
update public.profiles set role='Admin' where id='YOUR_USER_UUID';

## 5. Seller photos/video
The SQL creates a `listing-media` Storage bucket. The frontend can use Supabase Storage with the authenticated user's session. Keep video sizes reasonable; for large production videos consider a dedicated video pipeline.

## 6. Paystack
Deploy the included Supabase Edge Function `supabase/functions/paystack-initialize` using the Supabase CLI. Then add the Paystack secret as an Edge Function secret:

supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxx
supabase functions deploy paystack-initialize

The Paystack secret is never placed in the browser.

## 7. Cloudflare Pages
This folder has no wrangler.toml and no Cloudflare Functions. You can upload the project files through the Cloudflare Pages static upload flow. Keep `index.html` at the root.

## Important
The existing marketplace UI is preserved. The production data model is supplied in Supabase SQL. Before launch, connect seller listing creation/media upload and moderation screens to the Supabase `listings` and `listing_media` tables instead of browser-only storage.

### Edge function deployment
Install Supabase CLI and link the project, then run:

supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxx
supabase functions deploy paystack-initialize
supabase functions deploy paystack-verify

The browser only receives the Supabase anon key. The Paystack secret stays in Supabase Edge Function secrets.
