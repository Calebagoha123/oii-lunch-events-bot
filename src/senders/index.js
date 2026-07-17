const teams = require("./teams");
const whatsapp = require("./whatsapp");

const AVAILABLE = { teams, whatsapp };
const DEFAULT_SENDERS = "teams";

/**
 * Resolves the active senders from the SENDERS env var (comma-separated).
 *
 *   SENDERS=teams            → Teams only (default)
 *   SENDERS=teams,whatsapp   → both, for the migration period
 *   SENDERS=whatsapp         → WhatsApp only (deprecated)
 */
function resolveSenders(value = process.env.SENDERS) {
  const requested = (value || DEFAULT_SENDERS)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const unknown = requested.filter((s) => !AVAILABLE[s]);
  if (unknown.length) {
    throw new Error(
      `Unknown sender(s) in SENDERS: ${unknown.join(", ")}. ` +
        `Valid values: ${Object.keys(AVAILABLE).join(", ")}.`,
    );
  }
  if (!requested.length) {
    throw new Error("SENDERS resolved to an empty list.");
  }

  const unconfigured = requested.filter((s) => !AVAILABLE[s].isConfigured());
  if (unconfigured.length) {
    throw new Error(
      `Sender(s) selected but not configured: ${unconfigured.join(", ")}. ` +
        `Check the required env vars in .env.example.`,
    );
  }

  return requested.map((s) => AVAILABLE[s]);
}

module.exports = { resolveSenders, AVAILABLE };
