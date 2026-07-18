const fs = require("fs");
const path = require("path");
const { DATA_DIR, PUNS_FILE } = require("./paths");

const DEFAULT_PUNS_PATH = PUNS_FILE;
const DEFAULT_STATE_PATH = path.join(DATA_DIR, "pun-state.json");

function dateKey(date = new Date()) {
  return date.toDateString();
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function loadPuns(filePath = DEFAULT_PUNS_PATH) {
  try {
    return fs.readFileSync(filePath, "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\d+\.\s*/, ""))
      .filter(Boolean);
  } catch (err) {
    console.error("Error loading puns:", err.message);
    return [];
  }
}

function pickRandom(items, random = Math.random) {
  return items[Math.floor(random() * items.length)];
}

function getDailyPun({
  date = new Date(),
  punsPath = DEFAULT_PUNS_PATH,
  statePath = DEFAULT_STATE_PATH,
  random = Math.random,
} = {}) {
  const puns = loadPuns(punsPath);
  if (!puns.length) return null;

  const today = dateKey(date);
  const state = readJson(statePath);
  if (state.date === today && state.pun && puns.includes(state.pun)) {
    return state.pun;
  }

  let used = Array.isArray(state.used)
    ? state.used.filter((pun) => puns.includes(pun))
    : [];
  if (used.length >= puns.length) used = [];

  const available = puns.filter((pun) => !used.includes(pun));
  const pun = pickRandom(available, random);
  const nextState = {
    date: today,
    pun,
    used: [...used, pun],
  };

  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2));
  } catch (err) {
    console.error("Error saving pun state:", err.message);
  }

  return pun;
}

module.exports = {
  dateKey,
  getDailyPun,
  loadPuns,
};
