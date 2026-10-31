# HarvestHome voice and video calling — safe implementation plan

## Scope
Add optional one-to-one voice and video calls inside an existing buyer–seller conversation. Keep the current chat, marketplace, payments, authentication, PWA, public pages, SEO metadata, AdSense placements, and existing storage buckets unchanged.

## Safety boundaries
- This work is isolated on `feature/harvesthome-voice-video-calls`; do not merge to `main` or deploy until reviewed and explicitly approved.
- No changes to Paystack, listing workflows, existing message records, existing chat-media bucket, ads.txt, sitemap.xml, robots.txt, canonical URLs, or public page metadata.
- No call recording, no audio/video uploads, and no persistent media storage.
- Do not add third-party paid services or billing-enabled products.
- No public call rooms. Both callers must be authenticated participants in the same existing conversation.
- Do not expose service-role keys or other secrets in browser code.

## Existing application findings
- The existing chat is implemented in `App.js` using the `conversations` and `messages` tables.
- Chat messages are refreshed by a five-second polling timer.
- Existing conversation SELECT/UPDATE policies restrict access to buyer/seller participants (and staff).
- Realtime private-channel authorization was inspected: there were no existing policies on `realtime.messages` at the time of inspection.
- A draft participant-only Broadcast policy migration has been added at `supabase/HarvestHome_Voice_Video_Realtime_Policies.sql`; it has NOT been applied to the live database.
- Supabase documentation requires private channels and the project-level `Allow public access` setting to be disabled for private-only authorization. That project-wide setting has not yet been verified; changing it without checking existing channel usage could affect other Realtime features.
- The existing chat-media bucket is unrelated to calling and must not be changed.

## Proposed architecture
1. WebRTC peer connection handles media directly between the two browsers/devices.
2. Supabase Realtime Broadcast carries short-lived call signaling only: offer, answer, ICE candidates, accept/decline, and hang-up.
3. Use private Realtime channels with database authorization that verifies the authenticated user is either `buyer_id` or `seller_id` for the conversation in the channel topic.
4. Use public STUN for initial connectivity testing. Do not add TURN credentials or a paid relay. Clearly document that some mobile networks/NATs may prevent direct calls until a safe relay option is separately approved.
5. Keep call state in memory only; clean up tracks, peer connection, channel subscriptions, and event handlers when a call ends or the chat closes.

## User interface
- Add Voice call and Video call actions to the existing private chat header.
- Incoming call UI: caller, call type, Accept, Decline.
- In-call controls: mute/unmute, camera on/off (video calls), end call.
- Handle permission denial, unsupported browser, offline state, busy/rejected call, timeout, and remote hang-up.
- No AdSense units or ad prompts in chat/call UI.

## Staged delivery
- Stage A: prepare the isolated implementation and SQL migration on this feature branch only; no live database writes or production deployment.
- Stage B: inspect the project's Realtime `Allow public access` setting and inventory any existing Realtime channel usage before deciding whether it can safely be disabled. Do not toggle it blindly.
- Stage C: review all changed files and SQL/RLS policy behavior; run static checks and test two authenticated accounts.
- Stage D: create/update a draft PR for review. Do not merge without the owner's explicit approval.
- Stage E: only after security review and explicit approval, apply the minimal SQL migration (if required) and deploy in a controlled way.

## Acceptance tests before release
- Buyer can call only the seller in that same conversation; seller can call only that buyer.
- An unrelated logged-in account cannot subscribe to, send, or receive call signaling.
- No anonymous or public channel can join a call.
- Existing messages, photo sharing, edit/delete, clear-chat behavior, notifications, and conversation list still work.
- Calls cleanly release microphone/camera on end, decline, timeout, navigation, and permission errors.
- No media is recorded, uploaded, or retained.
- Public marketplace pages, ads.txt, sitemap.xml, robots.txt, canonical URLs, and existing AdSense placements are unchanged.
- No paid services, billing settings, or new subscriptions are enabled.
