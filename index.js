require("dotenv").config();
const cron = require("node-cron");
const { buildMenu } = require("./scraper");
const { renderWhatsApp } = require("./render/whatsapp");
const { resolveSenders } = require("./senders");
const { sendAlert } = require("./alerts");
const { checkForNewMenu: refreshBlavatnik } = require("./blavatnik");
const { checkForNewSchwarzmanMenu: refreshSchwarzman } = require("./schwarzman");
const {
  alreadyClaimedToday,
  claimDailySend,
  completeDailySend,
} = require("./dailySend");

const DRY_RUN = process.argv.includes("--dry-run");
const SEND_NOW = process.argv.includes("--send-now");
const REFRESH = process.argv.includes("--refresh");

let senders = [];
let cronStarted = false;
let catchUpTimerStarted = false;

async function refreshEmailMenus() {
  await Promise.all([refreshBlavatnik(), refreshSchwarzman()]);
}

/**
 * Builds today's menu and hands it to every active sender. A sender failing
 * doesn't stop the others; the menu going out somewhere beats nowhere.
 */
async function sendMenu() {
  const menu = await buildMenu();

  if (menu.errors.length) {
    await sendAlert(
      "Menu sources degraded",
      `Today's menu was built with ${menu.errors.length} source(s) failing:\n\n` +
        menu.errors.map((e) => `- ${e.name}: ${e.message}`).join("\n") +
        `\n\nThe message was still sent, minus those sources.\nSee RUNBOOK.md.`,
    );
  }

  const results = await Promise.allSettled(
    senders.map(async (sender) => {
      await sender.send(menu);
      console.log(`Menu sent via ${sender.name}.`);
    }),
  );

  const failed = results
    .map((r, i) => ({ r, sender: senders[i] }))
    .filter(({ r }) => r.status === "rejected");

  for (const { r, sender } of failed) {
    console.error(`Error sending via ${sender.name}:`, r.reason?.message);
  }

  if (failed.length === senders.length) {
    await sendAlert(
      "Failed to send menu",
      `The lunch bot could not deliver today's menu via any sender.\n\n` +
        failed.map(({ sender, r }) => `- ${sender.name}: ${r.reason?.message}`).join("\n") +
        `\n\nSee RUNBOOK.md.`,
    );
    return false;
  }

  if (failed.length) {
    await sendAlert(
      "Some senders failed",
      failed.map(({ sender, r }) => `- ${sender.name}: ${r.reason?.message}`).join("\n"),
    );
  }

  return true;
}

async function sendDailyMenu(reason) {
  const claim = claimDailySend(reason);
  if (!claim.claimed) {
    console.log(`Daily menu skipped: ${claim.reason}.`);
    return false;
  }

  let sent = false;
  try {
    sent = await sendMenu();
  } catch (err) {
    console.error("Error sending menu:", err.message);
    await sendAlert(
      "Failed to send menu",
      `The lunch bot failed to send today's menu.\n\nError: ${err.message}\n\nSee RUNBOOK.md.`,
    );
  }
  completeDailySend(
    claim,
    sent ? "sent" : "failed",
    sent ? undefined : "sendMenu returned false",
  );
  return sent;
}

async function catchUpIfMissed() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const isWeekday = day >= 1 && day <= 5;

  if (isWeekday && now.getHours() >= 11 && !alreadyClaimedToday()) {
    console.log("Catch-up: missed 11 AM send, sending now...");
    await sendDailyMenu("catch-up");
  }
}

function startCronJob() {
  if (cronStarted) return;
  cronStarted = true;
  cron.schedule("0 11 * * 1-5", async () => {
    console.log("Cron triggered: sending daily menu...");
    await sendDailyMenu("cron");
  });
  console.log("Cron job scheduled: 11:00 AM Mon–Fri");
}

function startCatchUpTimer() {
  if (catchUpTimerStarted) return;
  catchUpTimerStarted = true;
  setInterval(() => {
    catchUpIfMissed().catch((err) =>
      console.error("Catch-up check failed:", err.message),
    );
  }, 60 * 1000);
  console.log("Catch-up checker scheduled: every 60 seconds");
}

/**
 * Handles !menu / !refresh. WhatsApp-only: a Teams workflow webhook is one-way,
 * so on Teams these are replaced by `--send-now` / `--refresh` (see RUNBOOK.md).
 */
async function handleCommand(command, reply) {
  if (command === "!refresh") {
    console.log("!refresh requested");
    await reply("Refreshing menus from Gmail...");
    try {
      await refreshEmailMenus();
      await reply("Done! Menus refreshed. Send !menu to see the latest.");
    } catch (err) {
      console.error("Error refreshing menus:", err.message);
      await reply("Something went wrong refreshing the menus.");
    }
    return;
  }

  console.log("!menu requested");
  try {
    await reply(renderWhatsApp(await buildMenu()));
  } catch (err) {
    console.error("Error fetching menu:", err.message);
    await reply("Sorry, I couldn't fetch today's menu. Try again later.");
  }
}

/**
 * Renders today's menu to stdout. No sends, no credentials, no WhatsApp
 * session — this is the contributor's inner loop.
 */
async function dryRun() {
  const menu = await buildMenu();
  console.log("─".repeat(60));
  console.log(renderWhatsApp(menu));
  console.log("─".repeat(60));
  console.log(`\nSections: ${menu.sections.length}  Errors: ${menu.errors.length}`);
  for (const err of menu.errors) console.log(`  ⚠️  ${err.name}: ${err.message}`);
  console.log("\nTeams Adaptive Card payload:");
  console.log(JSON.stringify(require("./render/teams").renderTeams(menu), null, 2));
}

async function main() {
  if (DRY_RUN) {
    await dryRun();
    return;
  }

  if (REFRESH) {
    console.log("Refreshing menus from Gmail...");
    await refreshEmailMenus();
    console.log("Done.");
    if (!SEND_NOW) return;
  }

  senders = resolveSenders();
  console.log(`Active senders: ${senders.map((s) => s.name).join(", ")}`);

  const whatsapp = senders.find((s) => s.name === "whatsapp");
  if (whatsapp) whatsapp.onCommand(handleCommand);

  await Promise.all(senders.map((s) => s.connect()));

  if (SEND_NOW) {
    const sent = await sendMenu();
    await Promise.all(senders.map((s) => s.close()));
    process.exit(sent ? 0 : 1);
  }

  startCronJob();
  startCatchUpTimer();
  await catchUpIfMissed();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await sendAlert("Startup failed", `The lunch bot failed to start.\n\nError: ${err.message}`);
  process.exit(1);
});
