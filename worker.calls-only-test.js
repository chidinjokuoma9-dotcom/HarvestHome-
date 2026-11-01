import harvestHomeWorker from "./worker.js";

export default {
  async fetch(request, env, ctx) {
    const response = await harvestHomeWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
