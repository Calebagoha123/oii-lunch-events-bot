const axios = require("axios");
const { renderTeams } = require("../render/teams");

/**
 * Posts the menu to a Teams channel via a Power Automate workflow webhook.
 *
 * The webhook URL comes from the channel: ⋯ → Workflows → "Post to a channel
 * when a webhook request is received". (The older Office 365 "Incoming Webhook"
 * connector was disabled by Microsoft in May 2026 and is not an option.)
 */
const name = "teams";

function isConfigured() {
  return Boolean(process.env.TEAMS_WEBHOOK_URL);
}

async function connect() {
  if (!isConfigured()) {
    throw new Error("TEAMS_WEBHOOK_URL is not set");
  }
}

async function send(menu) {
  const response = await axios.post(process.env.TEAMS_WEBHOOK_URL, renderTeams(menu), {
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });
  return response.status;
}

async function close() {}

module.exports = { name, isConfigured, connect, send, close };
