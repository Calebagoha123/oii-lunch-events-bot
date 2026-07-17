const axios = require("axios");
const cheerio = require("cheerio");
const { fetchBlavatnik } = require("./blavatnik");
const { fetchSchwarzman } = require("./schwarzman");
const { fetchWhatsOn } = require("./whatson");
const { fetchNearbyEvents } = require("./nearbyevents");
const { getDailyPun } = require("./puns");

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DAY_PREFIX_RE = new RegExp(
  `^(${DAYS.join("|")})\\s*[–—-]\\s*`,
);

function stripCalories(text) {
  return text
    .replace(/\s*[—–-]\s*~?\d[\d,]*\s*kcal/gi, "")
    .replace(/\s*\(?\s*~?\d[\d,]*\s*kcal\s*\)?/gi, "")
    .trim();
}

// --- Menu sources ---
// Each has a fetch function that returns an array of formatted lines.
// To add Schwarzman, Blavatnik, etc., just add a new entry here.

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
 * Fetch every menu source and return the day's menu as structured data.
 *
 * Presentation lives in the renderers under `render/` — this function decides
 * *what* is in the message, never how it looks. `items` are still
 * WhatsApp-flavoured strings because the fetchers themselves emit markup; the
 * renderers translate as needed.
 *
 * @returns {Promise<{date: string, day: string, pun: string|null,
 *   events: string[],
 *   sections: Array<{name: string, info: string, items: string[]}>,
 *   errors: Array<{name: string, message: string}>}>}
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

// --- Cohen Quad (Exeter College) ---

const EXETER_MENU_URL =
  "https://www.exeter.ox.ac.uk/students/catering/todays-menus/";

function getWeekMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function fetchCohenQuad(today) {
  const { data: html } = await axios.get(EXETER_MENU_URL);
  const $ = cheerio.load(html);
  const lines = parseExeterSection($, "Dakota Café (Cohen Quad)", today);

  // A stale page still yields *heading* lines ("Soup of the Day") with no items
  // beneath them for today, so line count alone can't tell fresh from stale.
  // Only bullet lines ("• …") are actual food; decide freshness from the page's
  // own modified date, always.
  const hasItems = lines.some((l) => l.trimStart().startsWith("•"));

  const modified = $('meta[property="article:modified_time"]').attr("content");
  const stale = modified ? new Date(modified) < getWeekMonday() : false;

  if (stale) {
    console.log(`Dakota: page last updated ${new Date(modified).toDateString()}, not refreshed this week.`);
    // During vacation the page lists only a few weekdays; today may have none.
    // Surface whatever real items exist, flagged stale — never bare headings.
    return { items: hasItems ? lines : [], stale: true };
  }

  return { items: hasItems ? lines : [], stale: false };
}

/**
 * Parse a section from the Exeter menu page.
 * Finds the <h2> matching sectionName, collects content until the next <h2>.
 * Filters day-specific items to only show today's.
 */
// Sections to skip entirely from the Cohen Quad menu
const SKIP_SECTIONS_RE = /^panini$/i;
// Lines to drop from the output
const SKIP_LINES_RE = /please note.*subject to change|selection of sides and salads/i;

function parseExeterSection($, sectionName, today) {
  const lines = [];

  let sectionH2 = null;
  $("h2").each((_, el) => {
    if ($(el).text().trim().includes(sectionName)) {
      sectionH2 = $(el);
      return false;
    }
  });

  if (!sectionH2) return lines;

  let skipUntilNext = false;
  let current = sectionH2.next();
  while (current.length && !current.is("h2")) {
    const tag = current.prop("tagName");

    if (tag === "H3" || tag === "P") {
      const text = current.text().trim();
      if (!text) {
        current = current.next();
        continue;
      }

      // Check if this heading starts a section we want to skip
      const isHeading =
        tag === "H3" ||
        (tag === "P" &&
          text.length < 60 &&
          !text.includes("•") &&
          !DAY_PREFIX_RE.test(text) &&
          current.next().is("ul"));

      if (isHeading && SKIP_SECTIONS_RE.test(text)) {
        skipUntilNext = true;
        current = current.next();
        continue;
      }

      if (isHeading) {
        skipUntilNext = false;
        lines.push(`\n*${text}*`);
      } else if (!skipUntilNext && !SKIP_LINES_RE.test(text)) {
        lines.push(text);
      }
    } else if (tag === "UL" && !skipUntilNext) {
      current.find("> li").each((_, li) => {
        const liText = $(li).text().trim().replace(/\s+/g, " ");
        const dayMatch = liText.match(DAY_PREFIX_RE);

        if (dayMatch) {
          if (dayMatch[1] === today) {
            lines.push(`• ${stripCalories(liText.replace(DAY_PREFIX_RE, ""))}`);
          }
        } else {
          lines.push(`• ${stripCalories(liText)}`);
        }
      });
    }

    current = current.next();
  }

  return lines;
}

module.exports = { buildMenu, getTodaysMenu, fetchCohenQuad, parseExeterSection };
