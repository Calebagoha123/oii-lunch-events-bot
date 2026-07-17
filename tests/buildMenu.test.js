const cheerio = require("cheerio");
const axios = require("axios");

jest.mock("axios");
jest.mock("../src/menus/blavatnik");
jest.mock("../src/menus/schwarzman");
jest.mock("../src/events/whatson");
jest.mock("../src/events/nearby");
jest.mock("../src/puns");

const { getTodaysMenu, buildMenu } = require("../src/buildMenu");
const { parseExeterSection, fetchCohenQuad } = require("../src/menus/dakota");
const { fetchBlavatnik } = require("../src/menus/blavatnik");
const { fetchSchwarzman } = require("../src/menus/schwarzman");
const { getDailyPun } = require("../src/puns");
const { fetchWhatsOn } = require("../src/events/whatson");
const { fetchNearbyEvents } = require("../src/events/nearby");

// Realistic mock of the Exeter menu page structure
const MOCK_EXETER_HTML = `
<html><body>
  <h2>Another Section</h2>
  <p>Some other content</p>

  <h2>Dakota Café (Cohen Quad)</h2>
  <p>Panini</p>
  <ul>
    <li>Halloumi, Pickled Walnut and Pesto (V)</li>
    <li>Tuna Melt (Tuesday-Friday only)</li>
  </ul>
  <h3>Main Course</h3>
  <ul>
    <li>Monday – Pasta Bolognese • Roasted Tomato Sauce • Parmesan</li>
    <li>Tuesday – Fish &amp; Chips • Mushy Peas • Tartare Sauce</li>
    <li>Wednesday – Roast Chicken • Roast Potatoes • Gravy</li>
    <li>Thursday – Beef Stir Fry • Egg Fried Rice</li>
    <li>Friday – Veggie Burger • Sweet Potato Fries</li>
  </ul>
  <h3>Daily Options</h3>
  <ul>
    <li>Salad Bar</li>
    <li>Soup of the Day</li>
    <li>Fresh Bread Rolls</li>
  </ul>
  <p>Selection of Sides and Salads Each Day!</p>
  <p>Please note: all menu items are subject to change</p>

  <h2>Hall</h2>
  <p>Hall content here</p>
</body></html>
`;

const STALE_MODIFIED_META = `
<meta property="article:modified_time" content="2026-05-08T10:00:00+00:00" />
`;

// ── parseExeterSection ────────────────────────────────────────────────────────

describe("parseExeterSection", () => {
  test("returns items only for the requested day", () => {
    const $ = cheerio.load(MOCK_EXETER_HTML);
    const lines = parseExeterSection($, "Dakota Café (Cohen Quad)", "Monday");
    expect(lines).toContain("• Pasta Bolognese • Roasted Tomato Sauce • Parmesan");
    expect(lines.join("\n")).not.toMatch(/Fish|Roast Chicken|Beef Stir Fry|Veggie Burger/);
  });

  test("includes items without a day prefix on all days", () => {
    const $ = cheerio.load(MOCK_EXETER_HTML);
    const lines = parseExeterSection($, "Dakota Café (Cohen Quad)", "Friday");
    expect(lines).toContain("• Salad Bar");
    expect(lines).toContain("• Soup of the Day");
    expect(lines).toContain("• Fresh Bread Rolls");
  });

  test("includes h3 headings formatted as bold", () => {
    const $ = cheerio.load(MOCK_EXETER_HTML);
    const lines = parseExeterSection($, "Dakota Café (Cohen Quad)", "Monday");
    expect(lines).toContain("\n*Main Course*");
    expect(lines).toContain("\n*Daily Options*");
  });

  test("returns empty array when section is not found", () => {
    const $ = cheerio.load(MOCK_EXETER_HTML);
    const lines = parseExeterSection($, "Nonexistent Café", "Monday");
    expect(lines).toHaveLength(0);
  });

  test("excludes the Panini section entirely", () => {
    const $ = cheerio.load(MOCK_EXETER_HTML);
    const lines = parseExeterSection($, "Dakota Café (Cohen Quad)", "Monday");
    const joined = lines.join("\n");
    expect(joined).not.toContain("Panini");
    expect(joined).not.toContain("Halloumi");
    expect(joined).not.toContain("Tuna Melt");
  });

  test("excludes the disclaimer and sides/salads filler lines", () => {
    const $ = cheerio.load(MOCK_EXETER_HTML);
    const lines = parseExeterSection($, "Dakota Café (Cohen Quad)", "Monday");
    const joined = lines.join("\n");
    expect(joined).not.toContain("subject to change");
    expect(joined).not.toContain("Selection of Sides and Salads");
  });

  test("stops collecting at the next h2", () => {
    const $ = cheerio.load(MOCK_EXETER_HTML);
    const lines = parseExeterSection($, "Dakota Café (Cohen Quad)", "Monday");
    expect(lines.join("\n")).not.toContain("Hall content here");
  });
});

// ── fetchCohenQuad ────────────────────────────────────────────────────────────

describe("fetchCohenQuad", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns the day's items, not stale, when the page has no old metadata", async () => {
    axios.get.mockResolvedValue({ data: MOCK_EXETER_HTML });
    const { items, stale } = await fetchCohenQuad("Wednesday");
    expect(items).toContain("• Roast Chicken • Roast Potatoes • Gravy");
    expect(items.join("\n")).not.toMatch(/Monday|Tuesday|Thursday|Friday/);
    expect(stale).toBe(false);
  });

  test("still returns today's items but flags stale when the page metadata is old", async () => {
    axios.get.mockResolvedValue({ data: MOCK_EXETER_HTML.replace("<html><body>", `<html><head>${STALE_MODIFIED_META}</head><body>`) });
    const { items, stale } = await fetchCohenQuad("Monday");
    expect(items).toContain("• Pasta Bolognese • Roasted Tomato Sauce • Parmesan");
    expect(stale).toBe(true);
  });

  test("drops heading-only output (no items) and flags stale — the vacation case", async () => {
    axios.get.mockResolvedValue({
      data: `<html><head>${STALE_MODIFIED_META}</head><body><h2>Dakota Café (Cohen Quad)</h2><p>Soup of the Day</p><h2>Hall</h2></body></html>`,
    });
    const { items, stale } = await fetchCohenQuad("Monday");
    expect(items).toEqual([]);
    expect(stale).toBe(true);
  });

  test("returns no items when the site has no matching section", async () => {
    axios.get.mockResolvedValue({ data: "<html><body><h2>Other</h2></body></html>" });
    const { items, stale } = await fetchCohenQuad("Monday");
    expect(items).toHaveLength(0);
    expect(stale).toBe(false);
  });

  test("throws when axios fails", async () => {
    axios.get.mockRejectedValue(new Error("Network error"));
    await expect(fetchCohenQuad("Monday")).rejects.toThrow("Network error");
  });
});

// ── getTodaysMenu ─────────────────────────────────────────────────────────────

describe("getTodaysMenu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDailyPun.mockReturnValue(null);
    fetchWhatsOn.mockResolvedValue([]);
    fetchNearbyEvents.mockResolvedValue([]);
    axios.get.mockResolvedValue({ data: MOCK_EXETER_HTML });
  });

  test("includes Cohen Quad menu items when scraper returns data", async () => {
    fetchBlavatnik.mockResolvedValue([]);
    fetchSchwarzman.mockResolvedValue([]);
    jest.spyOn(Date.prototype, "getDay").mockReturnValue(2); // Tuesday

    const msg = await getTodaysMenu();
    expect(msg).toContain("Lunch Menu");
    expect(msg).toContain("Dakota Café (Cohen Quad)");
    expect(msg).toContain("Fish & Chips");

    jest.restoreAllMocks();
  });

  test("includes Blavatnik section when items are returned", async () => {
    axios.get.mockResolvedValue({ data: "<html><body></body></html>" });
    fetchBlavatnik.mockResolvedValue(["• Tomato Soup — ~120kcal", "• Grilled Salmon — ~380kcal"]);
    fetchSchwarzman.mockResolvedValue([]);

    const msg = await getTodaysMenu();
    expect(msg).toContain("Blavatnik Café");
    expect(msg).toContain("Tomato Soup");
    expect(msg).toContain("Grilled Salmon");
  });

  test("includes Schwarzman section when items are returned", async () => {
    axios.get.mockResolvedValue({ data: "<html><body></body></html>" });
    fetchBlavatnik.mockResolvedValue([]);
    fetchSchwarzman.mockResolvedValue([
      "*1 Base + 1 Protein + 2 Sides*",
      "",
      "*Base*",
      "• Bulgur w/ Roasted Mediterranean Veg",
      "• Coconut Jasmin Rice",
    ]);

    const msg = await getTodaysMenu();
    expect(msg).toContain("Schwarzman Centre");
    expect(msg).toContain("1 Base + 1 Protein + 2 Sides");
    expect(msg).toContain("Bulgur");
  });

  test("includes all sections when all return items", async () => {
    fetchBlavatnik.mockResolvedValue(["• Tomato Soup — ~120kcal"]);
    fetchSchwarzman.mockResolvedValue(["*1 Base + 1 Protein + 2 Sides*"]);

    jest.spyOn(Date.prototype, "getDay").mockReturnValue(2); // Tuesday

    const msg = await getTodaysMenu();
    expect(msg).toContain("Dakota Café (Cohen Quad)");
    expect(msg).toContain("Schwarzman Centre");
    expect(msg).toContain("Blavatnik Café");

    jest.restoreAllMocks();
  });

  test("shows 'No menu items' when all sources return nothing", async () => {
    axios.get.mockResolvedValue({ data: "<html><body></body></html>" });
    fetchBlavatnik.mockResolvedValue([]);
    fetchSchwarzman.mockResolvedValue([]);

    const msg = await getTodaysMenu();
    expect(msg).toContain("No menu items found for today");
  });

  test("continues if one source throws, and says which one failed", async () => {
    fetchSchwarzman.mockRejectedValue(new Error("Network error"));
    fetchBlavatnik.mockResolvedValue(["• Tomato Soup — ~120kcal"]);
    jest.spyOn(Date.prototype, "getDay").mockReturnValue(2); // Tuesday

    const msg = await getTodaysMenu();
    expect(msg).toContain("Blavatnik Café");
    expect(msg).toContain("Dakota Café (Cohen Quad)");
    // A failed source must be reported, not silently omitted.
    expect(msg).toContain("Couldn't reach: Schwarzman Centre");

    jest.restoreAllMocks();
  });

  test("reports the failure through buildMenu's errors array", async () => {
    fetchSchwarzman.mockRejectedValue(new Error("Network error"));
    fetchBlavatnik.mockResolvedValue([]);
    jest.spyOn(Date.prototype, "getDay").mockReturnValue(2); // Tuesday

    const menu = await buildMenu();
    expect(menu.errors).toEqual([
      { name: "Schwarzman Centre", message: "Network error" },
    ]);
    expect(menu.sections.map((s) => s.name)).toEqual(["Dakota Café (Cohen Quad)"]);

    jest.restoreAllMocks();
  });

  test("groups Schwarzman and nearby events under buildMenu.events", async () => {
    fetchWhatsOn.mockResolvedValue(["• *Sigur Rós: Ára* — Black Box · Music"]);
    fetchNearbyEvents.mockResolvedValue([
      { venue: "Blavatnik School of Government", items: ["• *Social Outcomes Conference*"] },
    ]);
    fetchBlavatnik.mockResolvedValue([]);
    fetchSchwarzman.mockResolvedValue([]);

    const menu = await buildMenu();
    expect(menu.events).toEqual([
      { venue: "Schwarzman Centre", items: ["• *Sigur Rós: Ára* — Black Box · Music"] },
      { venue: "Blavatnik School of Government", items: ["• *Social Outcomes Conference*"] },
    ]);
  });

  test("flags onVacation when every source is stale with nothing to show", async () => {
    // Old page metadata, and no items parse out for the day.
    axios.get.mockResolvedValue({
      data: `<html><head>${STALE_MODIFIED_META}</head><body><h2>Dakota Café (Cohen Quad)</h2><p>Soup of the Day</p><h2>Hall</h2></body></html>`,
    });
    fetchBlavatnik.mockResolvedValue({ items: [], stale: true });
    fetchSchwarzman.mockResolvedValue({ items: [], stale: true });

    const menu = await buildMenu();
    expect(menu.onVacation).toBe(true);
    expect(menu.sections).toHaveLength(0);
    expect(menu.stale).toEqual(
      expect.arrayContaining(["Dakota Café (Cohen Quad)", "Blavatnik Café", "Schwarzman Centre"]),
    );
  });

  test("does not burn a pun when there is no menu to attach it to", async () => {
    axios.get.mockResolvedValue({ data: "<html><body></body></html>" });
    fetchBlavatnik.mockResolvedValue([]);
    fetchSchwarzman.mockResolvedValue([]);

    const menu = await buildMenu();
    expect(menu.pun).toBeNull();
    expect(getDailyPun).not.toHaveBeenCalled();
  });

  test("adds the daily pun when one is available", async () => {
    getDailyPun.mockReturnValue("This lunch is a big dill.");
    fetchBlavatnik.mockResolvedValue([]);
    fetchSchwarzman.mockResolvedValue([]);
    jest.spyOn(Date.prototype, "getDay").mockReturnValue(2); // Tuesday

    const msg = await getTodaysMenu();
    expect(msg).toContain("💬 _This lunch is a big dill._");
    expect(msg).toContain("Dakota Café (Cohen Quad)");

    jest.restoreAllMocks();
  });
});
