const { renderWhatsApp } = require("../render/whatsapp");
const { renderTeams, whatsappMarkupToMarkdown } = require("../render/teams");

const MENU = {
  date: "Friday, 17 Jul 2026",
  day: "Friday",
  pun: "This lunch is a big dill.",
  events: [
    { venue: "Schwarzman Centre", items: ["• *Sigur Rós: Ára* — Black Box · Music"] },
    { venue: "Blavatnik School of Government", items: ["• *Social Outcomes Conference*"] },
  ],
  sections: [
    {
      name: "Dakota Café (Cohen Quad)",
      info: "🕐 12:00–13:30 · 💷 £3.80",
      items: ["• Fish & Chips", "• Veg Curry"],
    },
  ],
  errors: [],
};

const EMPTY = { ...MENU, pun: null, sections: [], errors: [] };

describe("renderWhatsApp", () => {
  test("renders header, pun, section and items", () => {
    const msg = renderWhatsApp(MENU);
    expect(msg).toContain("🍽 *Lunch Menu*");
    expect(msg).toContain("📅 Friday, 17 Jul 2026");
    expect(msg).toContain("💬 _This lunch is a big dill._");
    expect(msg).toContain("*--- Dakota Café (Cohen Quad) ---*");
    expect(msg).toContain("• Fish & Chips");
  });

  test("renders the empty state", () => {
    expect(renderWhatsApp(EMPTY)).toContain("No menu items found for today");
  });

  test("puts What's On above the menu, grouped by venue", () => {
    const msg = renderWhatsApp(MENU);
    expect(msg).toContain("What's On Around You Today");
    expect(msg).toContain("Schwarzman Centre");
    expect(msg).toContain("Sigur Rós: Ára");
    expect(msg).toContain("Blavatnik School of Government");
    expect(msg).toContain("Social Outcomes Conference");
    // Events come before the first café section.
    expect(msg.indexOf("What's On")).toBeLessThan(msg.indexOf("Dakota"));
  });

  test("shows What's On even on a vacation day", () => {
    const msg = renderWhatsApp({ ...EMPTY, events: MENU.events, onVacation: true });
    expect(msg).toContain("Sigur Rós: Ára");
    expect(msg).toContain("vacation");
  });

  test("names failed sources", () => {
    const msg = renderWhatsApp({ ...MENU, errors: [{ name: "Blavatnik Café", message: "timeout" }] });
    expect(msg).toContain("Couldn't reach: Blavatnik Café");
  });

  test("omits the warning line when nothing failed", () => {
    expect(renderWhatsApp(MENU)).not.toContain("Couldn't reach");
  });
});

describe("whatsappMarkupToMarkdown", () => {
  test("converts single-asterisk bold to CommonMark bold", () => {
    expect(whatsappMarkupToMarkdown("*Base*")).toBe("**Base**");
    expect(whatsappMarkupToMarkdown("1 Base + *2 Sides*")).toBe("1 Base + **2 Sides**");
  });

  test("leaves plain text and bullets alone", () => {
    expect(whatsappMarkupToMarkdown("• Fish & Chips")).toBe("• Fish & Chips");
  });
});

describe("renderTeams", () => {
  test("wraps an Adaptive Card in the workflow-webhook envelope", () => {
    const payload = renderTeams(MENU);
    expect(payload.type).toBe("message");
    expect(payload.attachments[0].contentType).toBe(
      "application/vnd.microsoft.card.adaptive",
    );
    expect(payload.attachments[0].content.type).toBe("AdaptiveCard");
  });

  test("includes the date, section name and items", () => {
    const text = JSON.stringify(renderTeams(MENU));
    expect(text).toContain("Friday, 17 Jul 2026");
    expect(text).toContain("Dakota Café (Cohen Quad)");
    expect(text).toContain("Fish & Chips");
  });

  test("renders the empty state", () => {
    expect(JSON.stringify(renderTeams(EMPTY))).toContain("No menu items found for today");
  });

  test("flags failed sources in attention colour", () => {
    const body = renderTeams({
      ...MENU,
      errors: [{ name: "Blavatnik Café", message: "timeout" }],
    }).attachments[0].content.body;

    const warning = body.find((b) => b.text.includes("Couldn't reach"));
    expect(warning).toBeDefined();
    expect(warning.color).toBe("Attention");
    expect(warning.text).toContain("Blavatnik Café");
  });

  test("produces a JSON-serialisable payload", () => {
    expect(() => JSON.parse(JSON.stringify(renderTeams(MENU)))).not.toThrow();
  });
});
