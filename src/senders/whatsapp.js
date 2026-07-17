const QRCode = require("qrcode");
const { renderWhatsApp } = require("../render/whatsapp");
const { sendAlert } = require("../alerts");

/**
 * DEPRECATED — WhatsApp backend.
 *
 * This backend exists only to bridge the migration to Teams. It carries the
 * costs Teams doesn't have: a session bound to one personal phone number, a QR
 * that must be physically rescanned from that handset to re-authenticate, and
 * a hosting constraint (WhatsApp blocks cloud IP ranges).
 *
 * Once the Teams channel has traction, DELETE THIS FILE, the `qrcode` and
 * `@whiskeysockets/baileys` dependencies, and the auth_info_baileys/ mount.
 * Nothing else depends on it. See README "Deprecation".
 */
const name = "whatsapp";

let sock;
let groupJid = null;
let reconnectTimer = null;
let connectInProgress = false;
let commandHandler = null;
const recentMessages = new Map();
const MAX_RECENT_MESSAGES = 200;

function isConfigured() {
  return Boolean(process.env.GROUP_NAME);
}

function rememberMessage(msg) {
  const id = msg?.key?.id;
  if (!id || !msg.message) return;

  recentMessages.set(id, msg.message);
  if (recentMessages.size > MAX_RECENT_MESSAGES) {
    recentMessages.delete(recentMessages.keys().next().value);
  }
}

// Sending a message makes Baileys mark this device as "available" (online),
// which suppresses push notifications on the phone. Re-assert "unavailable"
// so notifications keep flowing to the phone.
async function markUnavailable() {
  try {
    await sock?.sendPresenceUpdate("unavailable");
  } catch (err) {
    console.error("Failed to mark presence unavailable:", err.message);
  }
}

async function sendText(jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  rememberMessage(sent);
  await markUnavailable();
  return sent;
}

async function cacheGroupJid() {
  try {
    const groups = await sock.groupFetchAllParticipating();
    const group = Object.values(groups).find(
      (g) => g.subject === process.env.GROUP_NAME,
    );
    if (group) {
      groupJid = group.id;
      console.log(`Group "${process.env.GROUP_NAME}" found.`);
    } else {
      console.error(`Group "${process.env.GROUP_NAME}" not found.`);
    }
  } catch (err) {
    console.error("Error fetching groups:", err.message);
  }
}

async function send(menu) {
  if (!groupJid) await cacheGroupJid();
  if (!groupJid) throw new Error(`Group "${process.env.GROUP_NAME}" not found.`);
  await sendText(groupJid, renderWhatsApp(menu));
  return groupJid;
}

function scheduleReconnect(statusCode) {
  if (reconnectTimer) return;
  console.log(`Connection closed (code ${statusCode}), reconnecting...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err) => console.error("Reconnect failed:", err.message));
  }, 5000);
}

/**
 * Registers a handler for in-group commands. Called with (command, reply).
 * Must be set before connect() to take effect on the first connection.
 */
function onCommand(handler) {
  commandHandler = handler;
}

function connect() {
  return new Promise((resolve, reject) => {
    if (connectInProgress) return resolve();
    connectInProgress = true;
    createSocket(resolve, reject).catch(async (err) => {
      console.error("Fatal startup error:", err.message);
      await sendAlert(
        "Startup failed",
        `The lunch bot failed while starting WhatsApp.\n\nError: ${err.message}`,
      );
      scheduleReconnect("startup-error");
      reject(err);
    }).finally(() => {
      connectInProgress = false;
    });
  });
}

async function createSocket(onOpen, onFail) {
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
    markOnlineOnConnect: false,
    getMessage: async (key) => recentMessages.get(key.id),
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
      if (statusCode === DisconnectReason.loggedOut) {
        console.error("Logged out from WhatsApp.");
        await sendAlert(
          "Logged out",
          "The lunch bot was logged out of WhatsApp. Re-authenticate by restarting and scanning the QR code.",
        );
        process.exit(1);
      }
      scheduleReconnect(statusCode);
    }

    if (connection === "open") {
      console.log("WhatsApp connected!");
      await markUnavailable();
      await cacheGroupJid();
      onOpen();
    }
  });

  activeSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (activeSock !== sock || type !== "notify" || !commandHandler) return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const body =
        msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
      if (body !== "!menu" && body !== "!refresh") continue;

      const chatJid = msg.key.remoteJid;
      if (!chatJid.endsWith("@g.us")) continue;
      if (groupJid && chatJid !== groupJid) continue;
      if (!groupJid) {
        const meta = await sock.groupMetadata(chatJid);
        if (meta.subject !== process.env.GROUP_NAME) continue;
        groupJid = chatJid;
      }

      await commandHandler(body, (text) => sendText(chatJid, text));
    }
  });

  // Periodically re-assert offline status so the phone keeps getting notifications.
  setInterval(markUnavailable, 5 * 60 * 1000).unref();
}

async function close() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
}

module.exports = { name, isConfigured, connect, send, close, onCommand };
