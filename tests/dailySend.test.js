const fs = require("fs");
const os = require("os");
const path = require("path");

const { createDailySendStore } = require("../dailySend");

function makeStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-send-"));
  return { dataDir, store: createDailySendStore(dataDir) };
}

describe("daily send claims", () => {
  test("allows only one claim per day", () => {
    const { store } = makeStore();
    const date = new Date("2026-05-11T11:00:00");

    const first = store.claimDailySend("cron", date);
    const second = store.claimDailySend("catch-up", date);

    expect(first.claimed).toBe(true);
    expect(second).toMatchObject({ claimed: false, reason: "already-claimed" });
  });

  test("treats a claimed day as already handled before completion", () => {
    const { store } = makeStore();
    const date = new Date("2026-05-11T11:00:00");

    store.claimDailySend("cron", date);

    expect(store.alreadyClaimedToday(date)).toBe(true);
  });

  test("writes the legacy last-sent marker only after a successful send", () => {
    const { dataDir, store } = makeStore();
    const date = new Date("2026-05-11T11:00:00");

    const claim = store.claimDailySend("cron", date);
    store.completeDailySend(claim, "sent");

    const marker = JSON.parse(fs.readFileSync(path.join(dataDir, "last-sent.json"), "utf-8"));
    expect(marker).toEqual({ date: "Mon May 11 2026" });
  });

  test("does not retry automatically after a failed claimed send", () => {
    const { store } = makeStore();
    const date = new Date("2026-05-11T11:00:00");

    const claim = store.claimDailySend("cron", date);
    store.completeDailySend(claim, "failed", "network error");
    const retry = store.claimDailySend("catch-up", date);

    expect(retry).toMatchObject({ claimed: false, reason: "already-claimed" });
  });
});
