const axios = require("axios");
const cheerio = require("cheerio");

const WHATS_ON_URL = "https://www.schwarzmancentre.ox.ac.uk/whats-on";

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parses a "17 Jul 2026" date into a UTC-midnight Date, or null.
 */
function parseCardDate(text) {
  const m = (text || "").trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

function midnightUTC(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * Collects today's showing times for one event card. Each card lists its
 * individual performances as `li.subshow` rows (a date, a time, a status
 * label); we keep the times whose date is today and that aren't past. Returns a
 * sorted list of "HH:MM" strings — empty for all-day events like exhibitions.
 */
function todaysShowtimes($, card, today) {
  const times = new Set();
  card.find("li.subshow").each((_, li) => {
    const row = $(li);
    const date = parseCardDate(row.find(".datetime .start").first().text());
    const time = row.find(".time .start").first().text().trim();
    const label = row.find(".label").first().text().trim();
    if (
      date &&
      date.getTime() === today.getTime() &&
      !/past event/i.test(label) &&
      /^\d{1,2}:\d{2}$/.test(time)
    ) {
      times.add(time);
    }
  });
  return [...times].sort();
}

/**
 * Parses the Schwarzman Centre "What's On" page into a list of events that are
 * running on `now`. Each event card carries a headline title, a date range
 * (`.start`/`.end`), a venue and genre tags; an event counts as "on today" when
 * today falls within its range.
 *
 * @returns {{title: string, venue: string, genres: string[]}[]}
 */
function parseWhatsOn(html, now = new Date()) {
  const $ = cheerio.load(html);
  const today = midnightUTC(now);
  const events = [];

  $(".eventCard").each((_, el) => {
    const card = $(el);
    const title = card.find(".title").first().text().replace(/\s+/g, " ").trim();
    if (!title) return;

    const start = parseCardDate(card.find(".start").first().text());
    const end = parseCardDate(card.find(".end").first().text()) || start;
    if (!start || !end) return;
    if (today < start || today > end) return;

    events.push({
      title,
      venue: card.find(".venue").first().text().replace(/\s+/g, " ").trim(),
      genres: card
        .find(".genres__link")
        .map((_, g) => $(g).text().trim())
        .get()
        .filter(Boolean),
      times: todaysShowtimes($, card, today),
    });
  });

  return events;
}

/**
 * Formats today's events as WhatsApp-flavoured lines (empty if none).
 */
function formatEvents(events) {
  return events.map((e) => {
    const times = e.times && e.times.length ? `🕐 ${e.times.join(", ")}` : "";
    const meta = [e.venue, e.genres.join(" · "), times].filter(Boolean).join(" · ");
    return meta ? `• *${e.title}* — ${meta}` : `• *${e.title}*`;
  });
}

/**
 * Fetches today's Schwarzman Centre events. Returns [] on any failure — the
 * "what's on" line is a nice-to-have and must never block the lunch menu.
 */
async function fetchWhatsOn(now = new Date()) {
  try {
    const { data: html } = await axios.get(WHATS_ON_URL, { timeout: 15000 });
    return formatEvents(parseWhatsOn(html, now));
  } catch (err) {
    console.error("What's On: fetch failed:", err.message);
    return [];
  }
}

module.exports = { fetchWhatsOn, parseWhatsOn, formatEvents, WHATS_ON_URL };
