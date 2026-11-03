/**
 * Scheduled function: rebuilds the site every Monday just after midnight in
 * Goa, so /yoga opens on the new week. The weekly schedule renders the week
 * containing the *build date* as its static HTML
 * (src/data/load-yoga-schedule.mjs), so without a fresh build the page keeps
 * opening on whatever week it was last deployed in.
 *
 * It POSTs to a Netlify build hook for the production branch. Scheduled
 * functions only run on the published deploy and can't be invoked by URL —
 * use "Run now" in the Netlify UI (Logs → Functions) to trigger it by hand.
 */
export default async () => {
  // A secret in all but name — anyone holding the URL can trigger builds.
  // Never log it.
  const hookUrl = process.env.WEEKLY_BUILD_HOOK_URL;
  if (!hookUrl) {
    console.error("weekly-rebuild: WEEKLY_BUILD_HOOK_URL env var is not set");
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  const url = new URL(hookUrl);
  // Labels the deploy in the Netlify deploy list.
  url.searchParams.set("trigger_title", "Weekly rebuild (yoga schedule week)");

  try {
    const response = await fetch(url, { method: "POST", body: "{}" });
    if (!response.ok) {
      throw new Error(`Build hook returned status ${response.status}`);
    }
  } catch (error) {
    // The message only — a fetch error's cause can carry the request URL.
    console.error(
      "weekly-rebuild: build hook call failed:",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  console.log("weekly-rebuild: production build triggered");
  return new Response(null, { status: 204 });
};

// Netlify cron runs in UTC. Sunday 19:00 UTC is Monday 00:30 in Goa (UTC+5:30,
// no daylight saving). The half-hour past midnight guarantees the build reads
// Monday's date, and the week it opens on, when it computes "today".
export const config = {
  schedule: "0 19 * * 0",
};
