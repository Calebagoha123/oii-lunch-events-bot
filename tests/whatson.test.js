const fs = require("fs");
const path = require("path");
const { parseWhatsOn, formatEvents } = require("../whatson");

const HTML = fs.readFileSync(
  path.join(__dirname, "fixtures", "whats-on.html"),
  "utf-8",
);

// Fixture spans: Anna Ridler (25 Apr–31 Aug), Sigur Rós (17–19 Jul),
// Mozart (1 Aug only).
const onSigurRosDay = new Date(Date.UTC(2026, 6, 17)); // 17 Jul 2026
const afterEverything = new Date(Date.UTC(2026, 8, 1)); // 1 Sep 2026

describe("parseWhatsOn", () => {
  test("returns only events whose date range covers today", () => {
    const titles = parseWhatsOn(HTML, onSigurRosDay).map((e) => e.title);
    expect(titles).toEqual([
      "Anna Ridler: A Perfect Language of Images",
      "Sigur Rós: Ára",
    ]);
    expect(titles).not.toContain("Mozart - The Marriage of Figaro");
  });

  test("includes a single-day event exactly on its day", () => {
    const titles = parseWhatsOn(HTML, new Date(Date.UTC(2026, 7, 1))).map((e) => e.title);
    expect(titles).toContain("Mozart - The Marriage of Figaro");
  });

  test("returns nothing once every event is in the past", () => {
    expect(parseWhatsOn(HTML, afterEverything)).toEqual([]);
  });

  test("captures venue and genres", () => {
    const sigur = parseWhatsOn(HTML, onSigurRosDay).find((e) =>
      e.title.startsWith("Sigur"),
    );
    expect(sigur.venue).toBe("Black Box");
    expect(sigur.genres).toContain("Music");
  });

  test("collects today's showtimes, excluding past ones", () => {
    const sigur = parseWhatsOn(HTML, onSigurRosDay).find((e) =>
      e.title.startsWith("Sigur"),
    );
    // 12:00 is a past event today; 18:00 and 20:00 remain; 18 Jul is a different day.
    expect(sigur.times).toEqual(["18:00", "20:00"]);
  });

  test("gives an all-day exhibition no showtimes", () => {
    const anna = parseWhatsOn(HTML, onSigurRosDay).find((e) =>
      e.title.startsWith("Anna"),
    );
    expect(anna.times).toEqual([]);
  });

  test("tolerates a page with no event cards", () => {
    expect(parseWhatsOn("<html><body></body></html>", onSigurRosDay)).toEqual([]);
  });
});

describe("formatEvents", () => {
  test("formats title with venue, genres and showtimes", () => {
    const lines = formatEvents([
      { title: "Sigur Rós: Ára", venue: "Black Box", genres: ["Immersive", "Music"], times: ["18:00", "20:00"] },
    ]);
    expect(lines[0]).toBe("• *Sigur Rós: Ára* — Black Box · Immersive · Music · 🕐 18:00, 20:00");
  });

  test("omits times for an all-day event", () => {
    const lines = formatEvents([
      { title: "Anna Ridler", venue: "Great Hall", genres: ["Digital"], times: [] },
    ]);
    expect(lines[0]).toBe("• *Anna Ridler* — Great Hall · Digital");
  });

  test("omits the dash when there's no venue or genre", () => {
    expect(formatEvents([{ title: "Mystery", venue: "", genres: [], times: [] }])[0]).toBe(
      "• *Mystery*",
    );
  });
});
