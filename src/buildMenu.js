const { DAYS } = require("./dates");
const { fetchCohenQuad } = require("./menus/dakota");
const { fetchBlavatnik } = require("./menus/blavatnik");
const { fetchSchwarzman } = require("./menus/schwarzman");
const { fetchWhatsOn } = require("./events/whatson");
const { fetchNearbyEvents } = require("./events/nearby");
const { getDailyPun } = require("./puns");

// --- Menu sources ---
// Each has a fetch(today) returning string[] or { items, stale }.
// To add a café, add an entry here and a fetcher under src/menus/.
const MENU_SOURCES = [
  {
    name: "Dakota Café (Cohen Quad)",
    info: "🕐 12:00–13:30 · 💷 £3.80",
    fetch: fetchCohenQuad,
  },
  {
    name: "Blavatnik Café",
    info: "🕐 12:00–13:30 · 💷 £5.50",
    fetch: fetchBlavatnik,
  },
  {
    name: "Schwarzman Centre",
    info: "🕐 12:00–14:00 · 💷 £7.95",
    fetch: fetchSchwarzman,
  },
];

/**
 * Fetch every source and return the day's menu as structured data.
 *
 * Presentation lives in the renderers under `render/` — this function decides
 * *what* is in the message, never how it looks. `items` are still
 * WhatsApp-flavoured strings because the fetchers themselves emit markup; the
 * renderers translate as needed.
 *
 * @returns {Promise<{date: string, day: string, pun: string|null,
 *   events: Array<{venue: string, items: string[]}>,
 *   sections: Array<{name: string, info: string, items: string[], stale: boolean}>,
 *   errors: Array<{name: string, message: string}>,
 *   stale: string[], onVacation: boolean}>}
 */
async function buildMenu(now = new Date()) {
  const today = DAYS[now.getDay()];
  const date = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // What's on around you today — a banner above the menu, grouped by building.
  // Schwarzman comes from its own site (authoritative); Blavatnik and the Andrew
  // Wiles building come from the oxfevents aggregator. Both fail soft to [].
  const [schwarzmanLines, nearbyGroups] = await Promise.all([
    fetchWhatsOn(now),
    fetchNearbyEvents(now),
  ]);
  const events = [];
  if (schwarzmanLines.length) {
    events.push({ venue: "Schwarzman Centre", items: schwarzmanLines });
  }
  events.push(...nearbyGroups);

  const sections = [];
  const errors = [];
  const stale = [];

  for (const source of MENU_SOURCES) {
    try {
      // Fetchers return either string[] or { items, stale } — normalise both.
      const result = await source.fetch(today);
      const items = Array.isArray(result) ? result : result.items || [];
      const isStale = Array.isArray(result) ? false : Boolean(result.stale);

      if (isStale) stale.push(source.name);
      if (items.length) {
        sections.push({ name: source.name, info: source.info, items, stale: isStale });
      }
    } catch (err) {
      console.error(`Error fetching ${source.name}:`, err.message);
      errors.push({ name: source.name, message: err.message });
    }
  }

  // getDailyPun() advances persisted rotation state, so only spend a pun on a
  // message that actually has a menu in it.
  const pun = sections.length ? getDailyPun() : null;

  // "Vacation" is a high-confidence claim: EVERY source reported stale and none
  // returned items. If only some sources are stale and others are merely empty
  // or unconfigured (e.g. Gmail creds missing), we don't know it's vacation — we
  // just have no menu, which renders as the plain empty state instead.
  const onVacation =
    !sections.length && !errors.length && stale.length === MENU_SOURCES.length;

  return { date, day: today, pun, events, sections, errors, stale, onVacation };
}

/**
 * Compile all menus into a single WhatsApp message.
 * @deprecated Prefer buildMenu() plus an explicit renderer.
 */
async function getTodaysMenu() {
  const { renderWhatsApp } = require("./render/whatsapp");
  return renderWhatsApp(await buildMenu());
}

module.exports = { buildMenu, getTodaysMenu, MENU_SOURCES };
