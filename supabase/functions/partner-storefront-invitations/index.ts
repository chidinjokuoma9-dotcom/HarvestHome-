import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://harvesthome.ng", "https://www.harvesthome.ng"]);
const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://harvesthome.ng",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}
function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validImage(file: File | null, label: string) {
  if (!file || file.size === 0) return null;
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(file.type)) throw new Error(label + " must be PNG, JPG, WEBP or GIF.");
  if (file.size > 5 * 1024 * 1024) throw new Error(label + " must be 5 MB or smaller.");
  return file;
}
function extension(type: string) {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string,string>)[type];
}
function validWebsite(value: string) {
  if (!value) return null;
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Please enter a valid website address.");
  return u.href.slice(0, 300);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Server configuration is incomplete." }, 500, origin);

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const contentType = req.headers.get("content-type") || "";
    let input: Record<string, unknown> = {};
    let form: FormData | null = null;
    if (contentType.includes("multipart/form-data")) {
      form = await req.formData();
      for (const key of ["action", "token", "business_name", "slug", "tagline", "description", "country", "website", "phone"]) {
        const value = form.get(key);
        if (typeof value === "string") input[key] = value;
      }
    } else {
      input = await req.json();
    }

    const action = String(input.action || "");
    const token = String(input.token || "");

    // Invitation preview and submission are bearer-token actions. The token is
    // random, stored only as a SHA-256 hash, scoped to one application and expires.
    if (action === "preview" || action === "submit") {
      if (!/^[a-f0-9]{64}$/i.test(token)) return json({ error: "This invitation link is invalid. Please contact HarvestHome." }, 400, origin);
      const tokenHash = await sha256(token);
      const { data: invitation, error: inviteError } = await admin
        .from("partner_storefront_invitations").select("*").eq("token_hash", tokenHash).maybeSingle();
      if (inviteError || !invitation) return json({ error: "This invitation link is invalid or has already been used." }, 404, origin);
      const now = new Date();
      if (invitation.revoked_at || invitation.used_at || new Date(invitation.expires_at) <= now) {
        return json({ error: "This invitation has expired or has already been used. Please contact HarvestHome for a new invitation." }, 410, origin);
      }
      const { data: application, error: appError } = await admin.from("partnership_applications")
        .select("id,organisation_name,contact_name,email,country,website,phone,status,archived_at")
        .eq("id", invitation.partnership_application_id).maybeSingle();
      if (appError || !application || application.status !== "approved" || application.archived_at) {
        return json({ error: "This partnership invitation is no longer active. Please contact HarvestHome." }, 403, origin);
      }
      if (String(application.email).toLowerCase() !== String(invitation.email).toLowerCase()) {
        return json({ error: "The invitation email no longer matches the partnership application." }, 403, origin);
      }

      if (action === "preview") {
        return json({
          invitation: { email: invitation.email, expires_at: invitation.expires_at },
          partner: {
            organisation_name: application.organisation_name,
            contact_name: application.contact_name,
            email: application.email,
            country: application.country,
            website: application.website,
            phone: application.phone,
          },
        }, 200, origin);
      }

      // A seller account is linked by email only; the partner never shares a
      // password or signs in to this private setup form.
      let partnerUser: { id: string; email?: string } | null = null;
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
        if (error) return json({ error: "We could not verify the HarvestHome account. Please try again." }, 500, origin);
        const found = data.users.find(u => (u.email || "").toLowerCase() === String(invitation.email).toLowerCase());
        if (found) { partnerUser = { id: found.id, email: found.email }; break; }
        if (data.users.length < 500) break;
      }
      if (!partnerUser) {
        return json({
          error: "Please first create your own HarvestHome account using this same email address and choose Seller during registration. You keep your password private. After registering, reopen this invitation link to finish your storefront."
        }, 409, origin);
      }

      const businessName = String(input.business_name || "").trim();
      const slug = String(input.slug || "").trim().toLowerCase();
      const tagline = String(input.tagline || "").trim().slice(0, 180);
      const description = String(input.description || "").trim().slice(0, 4000);
      const country = String(input.country || application.country || "Nigeria").trim().slice(0, 100);
      const phone = String(input.phone || "").trim().slice(0, 40) || null;
      let website: string | null;
      try { website = validWebsite(String(input.website || "").trim()); }
      catch (e) { return json({ error: e instanceof Error ? e.message : "Invalid website." }, 400, origin); }
      if (businessName.length < 2 || businessName.length > 160) return json({ error: "Enter a business name between 2 and 160 characters." }, 400, origin);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "Use lowercase letters, numbers and hyphens for your storefront address." }, 400, origin);
      if (description.length < 20) return json({ error: "Please provide a business description of at least 20 characters." }, 400, origin);
      if (country.length < 2) return json({ error: "Please enter your country or location." }, 400, origin);

      let logo: File | null;
      let cover: File | null;
      try {
        const lf = form?.get("logo");
        const cf = form?.get("cover");
        logo = validImage(lf instanceof File ? lf : null, "Logo");
        cover = validImage(cf instanceof File ? cf : null, "Cover image");
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Invalid image." }, 400, origin);
      }

      const { data: existing, error: existingError } = await admin.from("partner_storefronts")
        .select("id,seller_id,is_published,removed_at,logo_url,cover_url")
        .eq("partnership_application_id", application.id).maybeSingle();
      if (existingError) return json({ error: "Could not check the existing storefront. Please try again." }, 500, origin);
      if (existing?.is_published) return json({ error: "This partner storefront is already published. Please contact HarvestHome if you need to update it." }, 409, origin);
      if (existing?.removed_at) return json({ error: "This storefront has been removed by HarvestHome. Please contact the Admin team." }, 403, origin);
      if (existing && existing.seller_id !== partnerUser.id) return json({ error: "This application is already linked to another HarvestHome account. Please contact support@harvesthome.ng." }, 409, origin);

      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      if (invitation.locked_at && new Date(invitation.locked_at) > new Date(cutoff)) {
        return json({ error: "This invitation is currently being submitted. Please wait a few minutes and refresh." }, 409, origin);
      }
      if (invitation.locked_at) {
        await admin.from("partner_storefront_invitations").update({ locked_at: null })
          .eq("id", invitation.id).eq("locked_at", invitation.locked_at);
      }
      const { data: locked, error: lockError } = await admin.from("partner_storefront_invitations")
        .update({ locked_at: now.toISOString() }).eq("id", invitation.id).is("locked_at", null)
        .is("used_at", null).is("revoked_at", null).select("id").maybeSingle();
      if (lockError || !locked) return json({ error: "This invitation is already being used or has expired. Please refresh or contact HarvestHome." }, 409, origin);

      const uploadedPaths: string[] = [];
      try {
        let logoUrl = existing?.logo_url || null;
        let coverUrl = existing?.cover_url || null;
        if (logo) {
          const path = "partner-storefronts/" + application.id + "/" + crypto.randomUUID() + "-logo." + extension(logo.type);
          const { error } = await admin.storage.from("listing-media").upload(path, logo, { contentType: logo.type, cacheControl: "31536000", upsert: false });
          if (error) throw new Error("Logo upload failed. Please try again.");
          uploadedPaths.push(path);
          logoUrl = admin.storage.from("listing-media").getPublicUrl(path).data.publicUrl;
        }
        if (cover) {
          const path = "partner-storefronts/" + application.id + "/" + crypto.randomUUID() + "-cover." + extension(cover.type);
          const { error } = await admin.storage.from("listing-media").upload(path, cover, { contentType: cover.type, cacheControl: "31536000", upsert: false });
          if (error) throw new Error("Cover image upload failed. Please try again.");
          uploadedPaths.push(path);
          coverUrl = admin.storage.from("listing-media").getPublicUrl(path).data.publicUrl;
        }

        const { error: saveError } = await admin.from("partner_storefronts").upsert({
          partnership_application_id: application.id,
          seller_id: partnerUser.id,
          slug,
          business_name: businessName,
          tagline,
          description,
          country,
          website,
          phone,
          logo_url: logoUrl,
          cover_url: coverUrl,
          is_published: false,
          agreement_confirmed: false,
          agreement_confirmed_by: null,
          agreement_confirmed_at: null,
          partner_submission_status: "submitted",
          partner_submitted_at: now.toISOString(),
          updated_at: now.toISOString(),
        }, { onConflict: "partnership_application_id" });
        if (saveError) throw new Error(saveError.code === "23505" ? "That storefront address is already in use. Please choose another." : "We could not save your storefront. Please try again.");

        const { error: consumeError } = await admin.from("partner_storefront_invitations")
          .update({ used_at: new Date().toISOString(), locked_at: null })
          .eq("id", invitation.id).eq("locked_at", now.toISOString()).is("used_at", null);
        if (consumeError) throw new Error("Your storefront was saved, but invitation confirmation failed. Please contact HarvestHome before resubmitting.");
        return json({ message: "Thank you. Your storefront has been submitted successfully and is now awaiting HarvestHome review. It is not public yet." }, 200, origin);
      } catch (e) {
        if (uploadedPaths.length) await admin.storage.from("listing-media").remove(uploadedPaths);
        await admin.from("partner_storefront_invitations").update({ locked_at: null })
          .eq("id", invitation.id).eq("locked_at", now.toISOString()).is("used_at", null);
        throw e;
      }
    }

    // All administrative actions require a real, current Admin session.
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!bearer) return json({ error: "Please sign in as a HarvestHome Admin." }, 401, origin);
    const { data: userData, error: userError } = await admin.auth.getUser(bearer);
    if (userError || !userData.user) return json({ error: "Your session is invalid. Please sign in again." }, 401, origin);
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role").eq("id", userData.user.id).maybeSingle();
    if (profileError || profile?.role !== "Admin") return json({ error: "Only the HarvestHome Admin can send invitations, publish or remove partner storefronts." }, 403, origin);
    const adminId = userData.user.id;

    if (action === "invite") {
      const applicationId = String(input.application_id || "");
      if (!validUuid(applicationId)) return json({ error: "Choose a valid partnership application." }, 400, origin);
      const { data: app, error } = await admin.from("partnership_applications")
        .select("id,organisation_name,email,status,archived_at")
        .eq("id", applicationId).maybeSingle();
      if (error || !app || app.status !== "approved" || app.archived_at) return json({ error: "Only active applications marked Approved for discussion can receive an invitation." }, 400, origin);
      const { data: existing } = await admin.from("partner_storefronts").select("id,is_published,removed_at")
        .eq("partnership_application_id", applicationId).maybeSingle();
      if (existing?.is_published) return json({ error: "This partner already has a published storefront." }, 409, origin);
      if (existing?.removed_at) return json({ error: "This storefront was removed by an Admin. Restore it through Admin review before sending another invitation." }, 409, origin);

      const now = new Date();
      await admin.from("partner_storefront_invitations").update({ revoked_at: now.toISOString() })
        .eq("partnership_application_id", applicationId).is("used_at", null).is("revoked_at", null);
      const rawToken = newToken();
      const { data: saved, error: saveError } = await admin.from("partner_storefront_invitations").insert({
        partnership_application_id: applicationId,
        email: String(app.email).toLowerCase(),
        token_hash: await sha256(rawToken),
        expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: adminId,
      }).select("id,expires_at").single();
      if (saveError || !saved) return json({ error: "Could not create the invitation. Please try again." }, 500, origin);
      const invitationUrl = "https://harvesthome.ng/partner-storefront-setup.html?invite=" + rawToken;
      return json({ invitation: { id: saved.id, email: app.email, organisation_name: app.organisation_name, expires_at: saved.expires_at, url: invitationUrl } }, 200, origin);
    }

    if (action === "list_invitations") {
      const { data, error } = await admin.from("partner_storefront_invitations")
        .select("id,partnership_application_id,email,expires_at,created_at,used_at,revoked_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) return json({ error: "Could not load partner invitations." }, 500, origin);
      const ids = [...new Set((data || []).map(x => x.partnership_application_id))];
      const { data: apps } = ids.length ? await admin.from("partnership_applications").select("id,organisation_name").in("id", ids) : { data: [] };
      const names = new Map((apps || []).map(x => [x.id, x.organisation_name]));
      return json({ invitations: (data || []).map(x => ({ ...x, organisation_name: names.get(x.partnership_application_id) || "Partner application" })) }, 200, origin);
    }

    if (action === "publish") {
      const storeId = String(input.storefront_id || "");
      if (!validUuid(storeId) || input.agreement_confirmed !== true) return json({ error: "Confirm that partner checks and the written agreement are complete before publishing." }, 400, origin);
      const { data: store, error: storeError } = await admin.from("partner_storefronts")
        .select("id,partnership_application_id,partner_submission_status,removed_at")
        .eq("id", storeId).maybeSingle();
      if (storeError || !store || store.removed_at) return json({ error: "This storefront cannot be published. It may have been removed." }, 404, origin);
      const { data: app } = await admin.from("partnership_applications").select("status,archived_at")
        .eq("id", store.partnership_application_id).maybeSingle();
      if (!app || app.status !== "approved" || app.archived_at) return json({ error: "The partnership application must remain active and approved for discussion." }, 403, origin);
      if (store.partner_submission_status !== "submitted") return json({ error: "Only a partner-submitted storefront can be published." }, 409, origin);
      const { error } = await admin.from("partner_storefronts").update({
        is_published: true, agreement_confirmed: true, agreement_confirmed_by: adminId,
        agreement_confirmed_at: new Date().toISOString(), partner_submission_status: "published",
        updated_at: new Date().toISOString(),
      }).eq("id", storeId);
      if (error) return json({ error: "Could not publish this storefront. Please try again." }, 500, origin);
      return json({ message: "Partner storefront published successfully." }, 200, origin);
    }

    if (action === "remove") {
      const storeId = String(input.storefront_id || "");
      const reason = String(input.reason || "").trim().slice(0, 500);
      if (!validUuid(storeId)) return json({ error: "Choose a valid storefront." }, 400, origin);
      const { data: store } = await admin.from("partner_storefronts").select("id,is_published,removed_at").eq("id", storeId).maybeSingle();
      if (!store || store.removed_at) return json({ error: "This storefront is already removed or could not be found." }, 404, origin);
      const { error } = await admin.from("partner_storefronts").update({
        is_published: false, removed_at: new Date().toISOString(), removed_by: adminId,
        removal_reason: reason || "Removed by HarvestHome Admin.", updated_at: new Date().toISOString(),
      }).eq("id", storeId);
      if (error) return json({ error: "Could not remove this partner storefront." }, 500, origin);
      return json({ message: "The storefront has been removed from public view. The partner's HarvestHome account and marketplace listings have not been deleted." }, 200, origin);
    }

    if (action === "delete_storefront") {
      const storeId = String(input.storefront_id || "");
      if (!validUuid(storeId)) return json({ error: "Choose a valid storefront." }, 400, origin);
      const { data: store, error: findError } = await admin.from("partner_storefronts")
        .select("id,business_name,is_published").eq("id", storeId).maybeSingle();
      if (findError || !store) return json({ error: "Storefront not found." }, 404, origin);
      const { error } = await admin.from("partner_storefronts").delete().eq("id", storeId);
      if (error) return json({ error: "Could not delete this storefront record. Existing marketplace listings and the partner account are not part of this deletion." }, 500, origin);
      return json({ message: "The storefront record was deleted. The partner's HarvestHome account and marketplace listings were not deleted." }, 200, origin);
    }

    if (action === "delete_invitation") {
      const invitationId = String(input.invitation_id || "");
      if (!validUuid(invitationId)) return json({ error: "Choose a valid invitation." }, 400, origin);
      const { data: invitation } = await admin.from("partner_storefront_invitations")
        .select("id,used_at").eq("id", invitationId).maybeSingle();
      if (!invitation) return json({ error: "Invitation not found." }, 404, origin);
      if (invitation.used_at) return json({ error: "A completed invitation is retained for record-keeping and cannot be deleted here." }, 409, origin);
      const { error } = await admin.from("partner_storefront_invitations").delete().eq("id", invitationId);
      if (error) return json({ error: "Could not delete this unused invitation." }, 500, origin);
      return json({ message: "Unused invitation deleted." }, 200, origin);
    }

    return json({ error: "Unknown action." }, 400, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The partner request could not be completed." }, 400, origin);
  }
});
