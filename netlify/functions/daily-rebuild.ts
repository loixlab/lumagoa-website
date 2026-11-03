/**
 * Scheduled function: rebuilds the site every night just after midnight in
 * Goa. /yoga is built from the schedule Google Sheet and renders the week
 * containing the *build date* as its static HTML
 * (src/data/load-yoga-schedule.mjs), so this nightly build is what picks up
 * the office's sheet edits, moves the page to the new week on Mondays and
 * drops past classes from the JSON-LD. (The sheet's "Publish schedule now"
 * button triggers the same kind of build on demand, through its own hook.)
 *
 * It POSTs to a Netlify build hook for the production branch. Scheduled
 * functions only run on the published deploy and can't be invoked by URL —
 * use "Run now" in the Netlify UI (Logs → Functions) to trigger it by hand.
 */
export default async () => {
  // A secret in all but name — anyone holding the URL can trigger builds.
  // Never log it.
  const hookUrl = process.env.DAILY_BUILD_HOOK_URL;
  if (!hookUrl) {
    console.error("daily-rebuild: DAILY_BUILD_HOOK_URL env var is not set");
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    // Parsed inside the try: a malformed value throws a TypeError whose
    // `input` property is the raw env value — uncaught, the runtime would
    // log the secret along with it.
    const url = new URL(hookUrl);
    // Labels the deploy in the Netlify deploy list.
    url.searchParams.set("trigger_title", "Daily rebuild (yoga schedule)");

    const response = await fetch(url, { method: "POST", body: "{}" });
    if (!response.ok) {
      throw new Error(`Build hook returned status ${response.status}`);
    }
  } catch (error) {
    // The message only — an invalid-URL error carries the raw value in
    // `input`, and a fetch error's cause can carry the request URL.
    console.error(
      "daily-rebuild: build hook call failed:",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  console.log("daily-rebuild: production build triggered");
  return new Response(null, { status: 204 });
};

// Netlify cron runs in UTC. 19:00 UTC is 00:30 the next day in Goa (UTC+5:30,
// no daylight saving). The half-hour past midnight guarantees the build reads
// the new date — and on Mondays the new week — when it computes "today".
export const config = {
  schedule: "0 19 * * *",
};
