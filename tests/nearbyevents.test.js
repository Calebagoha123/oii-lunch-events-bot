const fs = require("fs");
const path = require("path");
const { groupNearbyEvents } = require("../nearbyevents");

const venues = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "oxfevents-venues.json"), "utf-8"),
).venues;
const events = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "oxfevents-events.json"), "utf-8"),
).events;

describe("groupNearbyEvents", () => {
  test("matches a maths event by venue_id on its day, with its start time", () => {
    const groups = groupNearbyEvents(venues, events, new Date(Date.UTC(2026, 7, 12)));
    const maths = groups.find((g) => g.venue.startsWith("Andrew Wiles"));
    expect(maths).toBeDefined();
    expect(maths.items[0]).toContain("Count me in");
    // Time is read literally from the ISO string (17:00), not TZ-converted.
    expect(maths.items[0]).toContain("🕐 17:00");
  });

  test("matches a Blavatnik event by venue name when venue_id is null", () => {
    const groups = groupNearbyEvents(venues, events, new Date(Date.UTC(2026, 8, 3)));
    const blav = groups.find((g) => g.venue === "Blavatnik School of Government");
    expect(blav).toBeDefined();
    expect(blav.items[0]).toContain("Social Outcomes Conference");
  });

  test("ignores events at unrelated venues", () => {
    // The decoy "Ignore Me" is at "Some Other Hall" on 17 Jul.
    const groups = groupNearbyEvents(venues, events, new Date(Date.UTC(2026, 6, 17)));
    expect(JSON.stringify(groups)).not.toContain("Ignore Me");
  });

  test("returns nothing on a day with no nearby events", () => {
    expect(groupNearbyEvents(venues, events, new Date(Date.UTC(2026, 6, 17)))).toEqual([]);
  });

  test("tolerates empty inputs", () => {
    expect(groupNearbyEvents([], [], new Date())).toEqual([]);
    expect(groupNearbyEvents(null, null, new Date())).toEqual([]);
  });
});
