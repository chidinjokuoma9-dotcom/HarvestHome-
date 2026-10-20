async function getPublicConfig(env, requestUrl) {
  try {
    const response = await env.ASSETS.fetch(new Request(new URL("/Config.js", requestUrl).toString()));
    if (!response.ok) return null;
    const source = await response.text();
    const supabaseUrl = source.match(/SUPABASE_URL\s*:\s*["']([^"']+)["']/)?.[1];
    const anonKey = source.match(/SUPABASE_ANON_KEY\s*:\s*["']([^"']+)["']/)?.[1];
    const publicUrl = source.match(/PUBLIC_APP_URL\s*:\s*["']([^"']+)["']/)?.[1];
    if (!supabaseUrl || !anonKey) return null;
    return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey, publicUrl: publicUrl || requestUrl.origin };
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replaceMeta(html, attribute, key, value) {
  const pattern = new RegExp("<meta\\s+" + attribute + "=[\\\"']" + key + "[\\\"']\\s+content=[\\\"'][^\\\"']*[\\\"']\\s*/?>", "i");
  const tag = '<meta ' + attribute + '="' + escapeHtml(key) + '" content="' + escapeHtml(value) + '">';
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace(/<\/head>/i, "  " + tag + "\n</head>");
}

function replaceTitle(html, title) {
  const safeTitle = escapeHtml(title);
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + safeTitle + "</title>");
  }
  return html.replace(/<\/head>/i, "  <title>" + safeTitle + "</title>\n</head>");
}

function publicStorageUrl(baseUrl, storagePath) {
  const path = String(storagePath || "").replace(/^\/+/, "");
  if (!path) return "";
  return baseUrl + "/storage/v1/object/public/listing-media/" +
    path.split("/").map(part => encodeURIComponent(part)).join("/");
}

async function loadApprovedListing(config, listingId) {
  const params = new URLSearchParams({
    id: "eq." + listingId,
    status: "eq.approved",
    select: "id,title,description,price,currency,mode,country,location,category,cover_url,status,publication_plan,publish_expires_at",
    limit: "1"
  });
  const response = await fetch(config.supabaseUrl + "/rest/v1/listings?" + params.toString(), {
    headers: {
      apikey: config.anonKey,
      Authorization: "Bearer " + config.anonKey,
      Accept: "application/json"
    }
  });
  if (!response.ok) return null;
  const rows = await response.json();
  const listing = Array.isArray(rows) ? rows[0] : null;
  if (!listing || String(listing.status || "").toLowerCase() !== "approved") return null;

  const isFree = String(listing.publication_plan || "free").toLowerCase() === "free";
  if (isFree && listing.publish_expires_at && new Date(listing.publish_expires_at).getTime() <= Date.now()) return null;
  return listing;
}

async function listingImage(config, listing) {
  const cover = String(listing.cover_url || "").trim();
  if (/^https:\/\//i.test(cover)) return cover;
  if (cover && !/^https?:\/\//i.test(cover)) {
    const fromPath = publicStorageUrl(config.supabaseUrl, cover);
    if (fromPath) return fromPath;
  }

  try {
    const params = new URLSearchParams({
      listing_id: "eq." + listing.id,
      media_type: "eq.image",
      select: "storage_path",
      limit: "1"
    });
    const response = await fetch(config.supabaseUrl + "/rest/v1/listing_media?" + params.toString(), {
      headers: {
        apikey: config.anonKey,
        Authorization: "Bearer " + config.anonKey,
        Accept: "application/json"
      }
    });
    if (response.ok) {
      const rows = await response.json();
      if (Array.isArray(rows) && rows[0]?.storage_path) {
        return publicStorageUrl(config.supabaseUrl, rows[0].storage_path);
      }
    }
  } catch {}
  return "https://harvesthome.ng/favicon.svg?v=2";
}

function listingDescription(listing) {
  const category = String(listing.category || "marketplace").trim();
  return "View photos and full details for this " + category.toLowerCase() +
    " listing on HarvestHome. Open the listing to learn more and contact the seller.";
}

async function withListingPreview(env, requestUrl, html, listingId) {
  if (!listingId || listingId.length > 128) return html;
  const config = await getPublicConfig(env, requestUrl);
  if (!config) return html;

  let listing;
  try {
    listing = await loadApprovedListing(config, listingId);
  } catch {
    return html;
  }

  if (!listing) {
    const unavailableTitle = "Listing unavailable | HarvestHome";
    html = replaceTitle(html, unavailableTitle);
    html = replaceMeta(html, "property", "og:title", unavailableTitle);
    html = replaceMeta(html, "name", "twitter:title", unavailableTitle);
    html = replaceMeta(html, "property", "og:description", "This listing is no longer available. Explore other offers on HarvestHome.");
    html = replaceMeta(html, "name", "twitter:description", "This listing is no longer available. Explore other offers on HarvestHome.");
    return html;
  }

  const title = String(listing.title || "Marketplace listing").trim().slice(0, 180) + " | HarvestHome";
  const description = listingDescription(listing);
  const image = await listingImage(config, listing);
  const canonicalUrl = new URL("/", config.publicUrl);
  canonicalUrl.searchParams.set("listing", String(listing.id));
  canonicalUrl.searchParams.set("shared", "listing");
  canonicalUrl.searchParams.set("preview", "3");
  canonicalUrl.searchParams.set("share_version", requestUrl.searchParams.get("share_version") || "2");
  const canonical = canonicalUrl.toString();

  html = replaceTitle(html, title);
  html = replaceMeta(html, "property", "og:title", title);
  html = replaceMeta(html, "property", "og:description", description);
  html = replaceMeta(html, "property", "og:url", canonical);
  html = replaceMeta(html, "property", "og:type", "website");
  html = replaceMeta(html, "property", "og:image", image);
  html = replaceMeta(html, "property", "og:image:secure_url", image);
  html = replaceMeta(html, "property", "og:image:alt", String(listing.title || "HarvestHome listing photo"));
  html = replaceMeta(html, "name", "twitter:card", "summary_large_image");
  html = replaceMeta(html, "name", "twitter:title", title);
  html = replaceMeta(html, "name", "twitter:description", description);
  html = replaceMeta(html, "name", "twitter:image", image);
  html = html.replace(/<link\s+rel=["']canonical["']\s+href=["'][^"']*["']\s*\/?>/i,
    '<link rel="canonical" href="' + escapeHtml(canonical) + '">');
  return html;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Keep the Supabase password-recovery route working through the SPA.
    if (url.pathname === "/update-password") {
      const appUrl = new URL("/", request.url);
      return env.ASSETS.fetch(new Request(appUrl, request));
    }

    // Social crawlers do not run marketplace JavaScript. Serve the same app
    // HTML with listing-specific Open Graph/Twitter metadata for share URLs.
    const listingId = url.searchParams.get("listing");
    const isSharedListing = url.searchParams.get("shared") === "listing" && listingId;
    if (request.method === "GET" && url.pathname === "/" && isSharedListing) {
      const assetResponse = await env.ASSETS.fetch(new Request(new URL("/", url).toString(), {
        method: "GET",
        headers: { Accept: "text/html" }
      }));
      if (!assetResponse.ok) return assetResponse;

      let html = await assetResponse.text();
      try {
        html = await withListingPreview(env, url, html, listingId);
      } catch {
        // A preview metadata failure must not prevent the marketplace from opening.
      }

      const headers = new Headers(assetResponse.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      headers.delete("etag");
      headers.delete("last-modified");
      headers.set("content-type", "text/html; charset=utf-8");
      headers.set("cache-control", "public, max-age=0, s-maxage=300");
      return new Response(html, { status: assetResponse.status, headers });
    }

    return env.ASSETS.fetch(request);
  }
};
