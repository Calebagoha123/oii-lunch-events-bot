const axios = require("axios");

// oxfevents.com is a Next.js aggregator with a clean JSON API. Structured JSON
// is far more robust to scrape than its client-rendered HTML.
const EVENTS_URL = "https://www.oxfevents.com/api/events?limit=500";
const VENUES_URL = "https://www.oxfevents.com/api/venues";

// Buildings near the Schwarzman Centre we want to surface. The Schwarzman
// Centre itself is intentionally excluded — whatson.js covers it authoritatively
// (oxfevents misses some of its shows).
const VENUE_GROUPS = [
  { label: "Blavatnik School of Government", re: /blavatnik school of government/i },
  { label: "Andrew Wiles Building (Maths)", re: /andrew wiles|mathematical institute|oxford mathematics/i },
];

function dayUTC(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function coversToday(event, todayUTC) {
  const start = event.date_start && new Date(event.date_start);
  if (!start || Number.isNaN(start.getTime())) return false;
  const end = event.date_end ? new Date(event.date_end) : start;
  return dayUTC(start) <= todayUTC && todayUTC <= dayUTC(end);
}

/**
 * The event's start time as a bare "HH:MM", taken *literally* from the ISO
 * string. oxfevents labels its timestamps `+00:00` but they're actually Oxford
 * wall-clock time (verified against the Schwarzman site), so converting via Date
 * would shift them an hour in summer — read the digits directly instead.
 * Only returns a time when the event starts today (an ongoing multi-day event
 * has no meaningful time for a given day).
 */
function startTimeIfToday(event, todayUTC) {
  const m = String(event.date_start || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return "";
  const startDay = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (startDay !== todayUTC) return "";
  const [hh, mm] = [m[4], m[5]];
  if (hh === "00" && mm === "00") return ""; // all-day / unspecified
  return `${hh}:${mm}`;
}

/**
 * Groups today's oxfevents events by our target buildings.
 *
 * @param venues  [{id, name}] from /api/venues (for venue_id → building mapping)
 * @param events  [event] from /api/events
 * @returns {{venue: string, items: string[]}[]}
 */
function groupNearbyEvents(venues, events, now = new Date()) {
  const today = dayUTC(now);

  // Map each target building's venue_ids (a building has many room-level ids).
  const idLabel = {};
  for (const v of venues || []) {
    const group = VENUE_GROUPS.find((g) => g.re.test(v.name || ""));
    if (group) idLabel[v.id] = group.label;
  }

  const labelFor = (event) => {
    if (event.venue_id && idLabel[event.venue_id]) return idLabel[event.venue_id];
    const venueName = (event.enriched_data && event.enriched_data.venueName) || "";
    const group = VENUE_GROUPS.find((g) => g.re.test(venueName));
    return group ? group.label : null;
  };

  const byVenue = new Map();
  for (const event of events || []) {
    const label = labelFor(event);
    if (!label || !coversToday(event, today)) continue;
    if (!byVenue.has(label)) byVenue.set(label, []);
    const time = startTimeIfToday(event, today);
    const title = (event.title || "").trim();
    byVenue.get(label).push(time ? `• *${title}* — 🕐 ${time}` : `• *${title}*`);
  }

  // Preserve VENUE_GROUPS order.
  return VENUE_GROUPS.filter((g) => byVenue.has(g.label)).map((g) => ({
    venue: g.label,
    items: byVenue.get(g.label),
  }));
}

/**
 * Fetches today's events at the nearby buildings. Returns [] on any failure —
 * this is a nice-to-have banner and must never block the lunch menu.
 */
async function fetchNearbyEvents(now = new Date()) {
  try {
    const [venuesRes, eventsRes] = await Promise.all([
      axios.get(VENUES_URL, { timeout: 15000 }),
      axios.get(EVENTS_URL, { timeout: 15000 }),
    ]);
    const venues = venuesRes.data.venues || venuesRes.data || [];
    const events = eventsRes.data.events || eventsRes.data || [];
    return groupNearbyEvents(venues, events, now);
  } catch (err) {
    console.error("Nearby events: fetch failed:", err.message);
    return [];
  }
}

module.exports = { fetchNearbyEvents, groupNearbyEvents, VENUE_GROUPS };
