const axios = require("axios");

const ALERT_LABEL = "bot-alert";

/**
 * Raises an operational alert as a GitHub issue on the bot's own repo. Silently
 * no-ops when GitHub isn't configured, so missing credentials never take the
 * bot down.
 *
 * De-duplicates: if an open issue with the same title already exists (e.g. a
 * café that's been down all week), it adds a comment to that issue instead of
 * opening a fresh one each day. Every repo collaborator is notified, so alerts
 * survive any one maintainer leaving — no shared mailbox to own.
 *
 * Needs GITHUB_REPO ("owner/name") and GITHUB_TOKEN (a token with issues:write
 * on that repo). See the README handover section.
 */
async function sendAlert(subject, body) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return false;

  const title = `[lunch-bot] ${subject}`;
  const api = axios.create({
    baseURL: `https://api.github.com/repos/${repo}`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "oii-lunch-events-bot",
    },
    timeout: 15000,
  });

  try {
    // De-dupe against an already-open alert with the same title. Filtering by
    // label keeps this cheap; the list endpoint also returns PRs, so skip those.
    const { data: openIssues } = await api.get("/issues", {
      params: { state: "open", labels: ALERT_LABEL, per_page: 100 },
    });
    const existing = openIssues.find(
      (issue) => issue.title === title && !issue.pull_request,
    );

    if (existing) {
      await api.post(`/issues/${existing.number}/comments`, {
        body: `Still failing as of ${new Date().toISOString()}.\n\n${body}`,
      });
      console.log(`Alert: commented on existing issue #${existing.number}.`);
    } else {
      const { data: created } = await api.post("/issues", {
        title,
        body,
        labels: [ALERT_LABEL],
      });
      console.log(`Alert: opened issue #${created.number}.`);
    }
    return true;
  } catch (err) {
    const detail = err.response
      ? `${err.response.status} ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error("Failed to raise GitHub alert:", detail);
    return false;
  }
}

module.exports = { sendAlert };
