const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./paths");

function createDailySendStore(dataDir) {
  const legacyLastSentPath = path.join(dataDir, "last-sent.json");
  const claimsDir = path.join(dataDir, "send-claims");

  function todayKey(date = new Date()) {
    return date.toDateString();
  }

  function claimId(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function claimPath(date = new Date()) {
    return path.join(claimsDir, `${claimId(date)}.json`);
  }

  function readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  function hasLegacySentMarker(date = new Date()) {
    const data = readJson(legacyLastSentPath);
    return data?.date === todayKey(date);
  }

  function alreadyClaimedToday(date = new Date()) {
    return hasLegacySentMarker(date) || fs.existsSync(claimPath(date));
  }

  function claimDailySend(reason, date = new Date()) {
    if (hasLegacySentMarker(date)) {
      return { claimed: false, reason: "already-sent", date: todayKey(date) };
    }

    fs.mkdirSync(claimsDir, { recursive: true });
    const filePath = claimPath(date);
    const payload = {
      date: todayKey(date),
      status: "claimed",
      reason,
      startedAt: new Date().toISOString(),
      pid: process.pid,
    };

    let fd;
    try {
      fd = fs.openSync(filePath, "wx");
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2));
      return { claimed: true, path: filePath, ...payload };
    } catch (err) {
      if (err.code === "EEXIST") {
        return { claimed: false, reason: "already-claimed", date: todayKey(date), path: filePath };
      }
      throw err;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  function completeDailySend(claim, status, errorMessage) {
    if (!claim?.path) return;

    const existing = readJson(claim.path) || claim;
    const payload = {
      ...existing,
      status,
      completedAt: new Date().toISOString(),
    };
    if (errorMessage) payload.error = errorMessage;

    fs.writeFileSync(claim.path, JSON.stringify(payload, null, 2));

    if (status === "sent") {
      fs.mkdirSync(path.dirname(legacyLastSentPath), { recursive: true });
      fs.writeFileSync(legacyLastSentPath, JSON.stringify({ date: claim.date }));
    }
  }

  return {
    alreadyClaimedToday,
    claimDailySend,
    completeDailySend,
    todayKey,
  };
}

module.exports = {
  ...createDailySendStore(DATA_DIR),
  createDailySendStore,
};
