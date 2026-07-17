const { resolveSenders } = require("../src/senders");

describe("resolveSenders", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SENDERS;
    delete process.env.TEAMS_WEBHOOK_URL;
    delete process.env.GROUP_NAME;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test("defaults to teams", () => {
    process.env.TEAMS_WEBHOOK_URL = "https://example.com/hook";
    expect(resolveSenders().map((s) => s.name)).toEqual(["teams"]);
  });

  test("supports running both during migration", () => {
    process.env.TEAMS_WEBHOOK_URL = "https://example.com/hook";
    process.env.GROUP_NAME = "Lunch Crew";
    process.env.SENDERS = "teams,whatsapp";
    expect(resolveSenders().map((s) => s.name)).toEqual(["teams", "whatsapp"]);
  });

  test("tolerates whitespace and casing", () => {
    process.env.TEAMS_WEBHOOK_URL = "https://example.com/hook";
    expect(resolveSenders(" TEAMS ").map((s) => s.name)).toEqual(["teams"]);
  });

  test("rejects an unknown sender by name", () => {
    expect(() => resolveSenders("slack")).toThrow(/Unknown sender\(s\).*slack/);
  });

  test("fails loudly when a selected sender is unconfigured", () => {
    expect(() => resolveSenders("teams")).toThrow(/not configured: teams/);
  });

  test("names every unconfigured sender, not just the first", () => {
    expect(() => resolveSenders("teams,whatsapp")).toThrow(/teams, whatsapp/);
  });
});
