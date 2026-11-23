# HarvestHome Cloudflare R2 Storage Preparation

## Safety status

This branch is preparation only. It does not change the production Worker, Wrangler bindings, Supabase configuration, upload code, database schema, or any live storage bucket. Do not merge this document-only branch as a deployment change.

## Existing storage that must remain intact

- `listing-media`: marketplace listing photos/videos, advertising uploads, and partner storefront media.
- `profile-media`: profile images.
- `chat-media`: chat attachments, including signed-URL access.
- `newsroom-media`: newsroom/staff media.

Existing database rows contain Supabase Storage URLs/paths. Existing app display and upload flows depend on those URLs. No existing object should be copied, deleted, renamed, or redirected as part of the initial R2 test.

## Proposed low-risk architecture

1. Keep Supabase PostgreSQL, Auth, Realtime, and all four existing Supabase Storage buckets as the production source of truth.
2. Add a separate private Cloudflare R2 test bucket (suggested name: `harvesthome-media-test`) with public access disabled.
3. Bind that bucket to a non-production/test Worker environment only. Do not add a production binding yet.
4. Implement an authenticated, narrowly scoped test upload/read/delete API in the test environment. Require a valid Supabase user token and verify ownership/authorisation server-side; never trust a client-supplied user ID or object key.
5. Keep R2 credentials/bindings as Cloudflare secrets/configuration. Never put credentials in `Config.js`, browser JavaScript, or Git.
6. Test upload, retrieval, content-type handling, size limits, access denial, and deletion using test-only files.
7. Only after tests pass and the owner approves, consider moving one new, optional media type to R2. Existing media and core listing/chat/news uploads stay on Supabase until a separate migration plan is approved.

## Important implementation constraints

- Do not change current upload destinations or URL generation in `App.js`, `news-admin.html`, or other pages in the first stage.
- Do not modify Paystack, authentication, chat/realtime, seller verification, marketplace listing logic, or newsroom workflows.
- Do not add public R2 access or expose an R2 access key.
- Set explicit maximum object size and allowed MIME types; reject path traversal and arbitrary keys.
- Use a separate Worker environment or isolated test Worker so the production GitHub-to-Cloudflare deployment is not affected.
- Confirm the actual GitHub Actions/Cloudflare deployment workflow before any production-facing change.

## Owner action required before integration can be tested

Create the private R2 test bucket in the Cloudflare account and provide only its bucket name and confirmation that it exists. Do not send passwords, API tokens, access keys, or secret values in chat. The Cloudflare dashboard must be used by the account owner to create the bucket and configure its binding/secrets.

## Current status

Preparation branch created. No R2 bucket has been created, no Cloudflare account setting has been changed, no application code has been changed, and no production deployment has occurred.
