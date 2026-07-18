const path = require("path");

// Anchor runtime state to the repo root, independent of where a module lives
// under src/. The data dir is bind-mounted in Docker as ./data:/app/data, so it
// must stay at the project root.
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUNS_FILE = path.join(ROOT, "puns.txt");

module.exports = { ROOT, DATA_DIR, PUNS_FILE };
