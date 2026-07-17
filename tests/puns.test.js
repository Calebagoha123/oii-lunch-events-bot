const fs = require("fs");
const os = require("os");
const path = require("path");

const { getDailyPun, loadPuns } = require("../src/puns");

function makeFiles(puns) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puns-"));
  const punsPath = path.join(dir, "puns.txt");
  const statePath = path.join(dir, "pun-state.json");
  fs.writeFileSync(punsPath, puns.join("\n"));
  return { punsPath, statePath };
}

describe("daily puns", () => {
  test("loads puns from a text file and strips numbering", () => {
    const { punsPath } = makeFiles(["1. Lettuce begin.", "2. Soup there it is."]);
    expect(loadPuns(punsPath)).toEqual(["Lettuce begin.", "Soup there it is."]);
  });

  test("reuses the same pun throughout a day", () => {
    const { punsPath, statePath } = makeFiles(["A", "B", "C"]);
    const date = new Date("2026-05-12T11:00:00");

    const first = getDailyPun({ date, punsPath, statePath, random: () => 0.4 });
    const second = getDailyPun({ date, punsPath, statePath, random: () => 0.9 });

    expect(first).toBe("B");
    expect(second).toBe("B");
  });

  test("does not repeat puns until the list is exhausted", () => {
    const { punsPath, statePath } = makeFiles(["A", "B"]);

    const first = getDailyPun({
      date: new Date("2026-05-12T11:00:00"),
      punsPath,
      statePath,
      random: () => 0,
    });
    const second = getDailyPun({
      date: new Date("2026-05-13T11:00:00"),
      punsPath,
      statePath,
      random: () => 0,
    });

    expect(first).toBe("A");
    expect(second).toBe("B");
  });

  test("starts a new cycle after all puns have been used", () => {
    const { punsPath, statePath } = makeFiles(["A", "B"]);

    getDailyPun({ date: new Date("2026-05-12T11:00:00"), punsPath, statePath, random: () => 0 });
    getDailyPun({ date: new Date("2026-05-13T11:00:00"), punsPath, statePath, random: () => 0 });
    const third = getDailyPun({
      date: new Date("2026-05-14T11:00:00"),
      punsPath,
      statePath,
      random: () => 0,
    });

    expect(third).toBe("A");
  });
});
