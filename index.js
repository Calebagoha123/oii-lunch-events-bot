require("dotenv").config();
const QRCode = require("qrcode");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const { getTodaysMenu } = require("./scraper");
const { checkForNewMenu: refreshBlavatnik } = require("./blavatnik");
const { checkForNewSchwarzmanMenu: refreshSchwarzman } = require("./schwarzman");
const { alreadyClaimedToday, claimDailySend, completeDailySend } = require("./dailySend");

const GROUP_NAME = process.env.GROUP_NAME;
if (!GROUP_NAME) {
  console.error("ERROR: GROUP_NAME not set in .env");
  process.exit(1);
}

const SEND_NOW = process.argv.includes("--send-now");

let sock;
let groupJid = null;
let cronStarted = false;
let reconnectTimer = null;
let connectInProgress = false;

async function sendAlert(subject, body) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.ALERT_EMAIL;
  if (!user || !pass || !to) return;
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: user,
      to,
      subject: `[lunch-bot] ${subject}`,
      text: body,
    });
    console.log("Alert email sent.");
  } catch (err) {
    console.error("Failed to send alert email:", err.message);
  }
}

async function cacheGroupJid() {
  try {
    const groups = await sock.groupFetchAllParticipating();
    const group = Object.values(groups).find((g) => g.subject === GROUP_NAME);
    if (group) {
      groupJid = group.id;
      console.log(`Group "${GROUP_NAME}" found.`);
    } else {
      console.error(`Group "${GROUP_NAME}" not found.`);
    }
  } catch (err) {
    console.error("Error fetching groups:", err.message);
  }
}

async function sendMenuToGroup() {
  try {
    if (!groupJid) await cacheGroupJid();
    if (!groupJid) {
      const msg = `Group "${GROUP_NAME}" not found.`;
      console.error(msg);
      await sendAlert("Group not found", msg);
      return false;
    }
    const menu = await getTodaysMenu();
    await sock.sendMessage(groupJid, { text: menu });
    console.log(`Menu sent to "${GROUP_NAME}".`);
    return true;
  } catch (err) {
    console.error("Error sending menu:", err.message);
    await sendAlert(
      "Failed to send menu",
      `The lunch bot failed to send today's menu.\n\nError: ${err.message}\n\nCheck logs: docker compose logs --tail=200 bot`
    );
    return false;
  }
}

async function sendDailyMenu(reason) {
  const claim = claimDailySend(reason);
  if (!claim.claimed) {
    console.log(`Daily menu skipped: ${claim.reason}.`);
    return false;
  }

  const sent = await sendMenuToGroup();
  completeDailySend(
    claim,
    sent ? "sent" : "failed",
    sent ? undefined : "sendMenuToGroup returned false",
  );
  return sent;
}

async function catchUpIfMissed() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours();
  const isWeekday = day >= 1 && day <= 5;
  const isPast11 = hour >= 11;

  if (isWeekday && isPast11 && !alreadyClaimedToday()) {
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

function scheduleReconnect(statusCode) {
  if (reconnectTimer) return;

  console.log(`Connection closed (code ${statusCode}), reconnecting...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToWhatsApp();
  }, 5000);
}

async function connectToWhatsApp() {
  if (connectInProgress) return;
  connectInProgress = true;
  try {
    await createWhatsAppSocket();
  } catch (err) {
    console.error("Fatal startup error:", err.message);
    await sendAlert(
      "Startup failed",
      `The lunch bot failed while starting WhatsApp.\n\nError: ${err.message}`
    );
    scheduleReconnect("startup-error");
  } finally {
    connectInProgress = false;
  }
}

async function createWhatsAppSocket() {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
  } = await import("@whiskeysockets/baileys");

  const pino = (await import("pino")).default;

  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();

  const activeSock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
  });
  sock = activeSock;

  activeSock.ev.on("creds.update", saveCreds);

  activeSock.ev.on("connection.update", async (update) => {
    if (activeSock !== sock) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR with WhatsApp on your phone:\n");
      console.log(await QRCode.toString(qr, { type: "terminal", small: true }));
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.error("Logged out from WhatsApp.");
        await sendAlert(
          "Logged out",
          "The lunch bot was logged out of WhatsApp. Please re-authenticate by restarting and scanning the QR code."
        );
        process.exit(1);
      } else {
        scheduleReconnect(statusCode);
      }
    }

    if (connection === "open") {
      console.log("WhatsApp connected!");
      await cacheGroupJid();

      if (SEND_NOW) {
        await sendMenuToGroup();
        process.exit(0);
      }

      startCronJob();
      await catchUpIfMissed();
    }
  });

  activeSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (activeSock !== sock) return;
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      if (body !== "!menu" && body !== "!refresh") continue;

      const chatJid = msg.key.remoteJid;
      if (!chatJid.endsWith("@g.us")) continue;

      if (groupJid && chatJid !== groupJid) continue;
      if (!groupJid) {
        const meta = await sock.groupMetadata(chatJid);
        if (meta.subject !== GROUP_NAME) continue;
        groupJid = chatJid;
      }

      if (body === "!refresh") {
        console.log(`!refresh requested in "${GROUP_NAME}"`);
        await sock.sendMessage(chatJid, { text: "Refreshing menus from Gmail..." });
        try {
          await Promise.all([refreshBlavatnik(), refreshSchwarzman()]);
          await sock.sendMessage(chatJid, {
            text: "Done! Menus refreshed. Send !menu to see the latest.",
          });
        } catch (err) {
          console.error("Error refreshing menus:", err.message);
          await sock.sendMessage(chatJid, {
            text: "Something went wrong refreshing the menus.",
          });
        }
        continue;
      }

      console.log(`!menu requested in "${GROUP_NAME}"`);
      try {
        const menu = await getTodaysMenu();
        await sock.sendMessage(chatJid, { text: menu });
      } catch (err) {
        console.error("Error fetching menu:", err.message);
        await sock.sendMessage(chatJid, {
          text: "Sorry, I couldn't fetch today's menu. Try again later.",
        });
      }
    }
  });
}

connectToWhatsApp();
