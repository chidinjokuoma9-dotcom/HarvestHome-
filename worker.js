export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // HarvestHome is a single-page app. Serve the main app for the
    // Supabase password-recovery route so the recovery hash can be
    // processed by App.js instead of returning a Cloudflare 404.
    if (url.pathname === "/update-password") {
      const appUrl = new URL("/", request.url);
      return env.ASSETS.fetch(new Request(appUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
