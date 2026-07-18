const axios = require("axios");
const cheerio = require("cheerio");
const { DAYS, getWeekMonday } = require("../dates");

// --- Dakota Café (Cohen Quad, Exeter College) ---
// Scraped from the Exeter College catering site.

const EXETER_MENU_URL =
  "https://www.exeter.ox.ac.uk/students/catering/todays-menus/";

const DAY_PREFIX_RE = new RegExp(`^(${DAYS.join("|")})\\s*[–—-]\\s*`);

// Sections to skip entirely from the Cohen Quad menu.
const SKIP_SECTIONS_RE = /^panini$/i;
// Lines to drop from the output.
const SKIP_LINES_RE = /please note.*subject to change|selection of sides and salads/i;

function stripCalories(text) {
  return text
    .replace(/\s*[—–-]\s*~?\d[\d,]*\s*kcal/gi, "")
    .replace(/\s*\(?\s*~?\d[\d,]*\s*kcal\s*\)?/gi, "")
    .trim();
}

/**
 * Fetch today's Dakota menu.
 * @returns {Promise<{items: string[], stale: boolean}>}
 */
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

module.exports = { fetchCohenQuad, parseExeterSection, EXETER_MENU_URL };
