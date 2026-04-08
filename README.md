# WhatsApp Lunch Menu Bot

A Node.js bot that scrapes and compiles daily lunch menus from cafés around Oxford's Schwarzman Centre and sends them to a WhatsApp group at 11:00 AM on weekdays.

## What it does

Every weekday at 11 AM the bot sends a single WhatsApp message to a configured group with the day's lunch options from:

- **Dakota Café (Cohen Quad)** — scraped from the Exeter College website
- **Blavatnik Café** — parsed from a weekly menu image sent by email
- **Schwarzman Centre** — parsed from a weekly "Build Your Own" menu image sent by email

The message includes each café's opening hours, price, and the day's items. For email-based menus, results are cached weekly to avoid redundant API calls.

## Architecture

```
index.js          Entry point. WhatsApp connection, cron job, !menu command handler
scraper.js        Orchestrates all menu sources into one formatted message
blavatnik.js      Gmail IMAP → PNG attachment → Claude Vision → structured JSON cache
schwarzman.js     Gmail IMAP → image attachment → Claude Vision → structured JSON cache
data/             Weekly JSON caches for Blavatnik and Schwarzman menus
```

### Data flow

1. Cron fires at 11 AM (or `!menu` is typed in the group)
2. Each email-based module checks if its cache is from the current week
3. If stale, it connects to Gmail via IMAP, downloads the latest menu image, and sends it to the Claude Vision API for structured extraction
4. Results are saved to `data/blavatnik-menu.json` and `data/schwarzman-menu.json`
5. All sources are combined into one message and sent to the WhatsApp group

### Commands

Users in the group can type:
- `!menu` — fetch and send today's menu on demand
- `!refresh` — force re-fetch from Gmail (useful if a new menu email arrived mid-week)

## Setup

### Prerequisites

- Node.js 18+
- A Gmail account that receives the Blavatnik and Schwarzman menu emails
- A Gmail App Password (requires 2FA enabled on the account)
- An Anthropic API key (for Claude Vision image parsing)
- A WhatsApp account to run the bot from

### Installation

```bash
git clone <repo>
cd whatsapp-menu-bot
npm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in:

```
GROUP_NAME=          # Exact name of the WhatsApp group to send menus to
GMAIL_USER=          # Gmail address that receives the menu emails
GMAIL_APP_PASSWORD=  # Gmail App Password (not your regular password)
ANTHROPIC_API_KEY=   # Anthropic API key for Claude Vision
```

### First run

```bash
npm start
```

On first run a QR code will be saved to `qr-code.png` and opened automatically. Scan it with WhatsApp on your phone. The session is persisted in `auth_info_baileys/` and reused on subsequent starts.

### Sending the menu immediately (for testing)

```bash
node index.js --send-now
```

This connects, sends today's menu to the group, and exits.

## Deployment

The bot needs to run persistently on a machine that stays online. The recommended approach is to run it locally (or on a home server/VPS) with PM2:

```bash
npm install -g pm2
pm2 start index.js --name lunch-bot
pm2 save
pm2 startup   # follow the printed instructions to auto-start on reboot
```

### A note on hosting

The bot originally ran on an AWS EC2 instance, but WhatsApp's infrastructure started blocking connections from cloud provider IP ranges, causing repeated disconnections. Running it on a regular residential/office network (or a VPS not flagged as a data centre) resolves this. The Baileys library handles reconnection automatically for normal network blips.

### Keeping the session alive

WhatsApp occasionally requires re-authentication. The bot sends an email alert to a configured address if it gets logged out. To re-authenticate, restart the process and scan the QR code again.

## Adding a new café

Each menu source is an entry in the `MENU_SOURCES` array in `scraper.js`:

```js
{
  name: "Café Name",
  info: "🕐 12:00–13:30 · 💷 £X.XX",
  fetch: async (today) => ["item 1", "item 2"],  // return array of strings
}
```

The `fetch` function receives the current day name (e.g. `"Wednesday"`) and should return an array of formatted strings. Return an empty array to omit the café from that day's message.

For email-based menus, follow the pattern in `blavatnik.js` or `schwarzman.js`: connect via IMAP, find the relevant email by subject, extract the image attachment, send to Claude Vision with a structured prompt, and cache the result by week.

## Tech stack

| Package | Purpose |
|---|---|
| `@whiskeysockets/baileys` | WhatsApp Web API (no browser required) |
| `node-cron` | Scheduling the 11 AM weekday send |
| `axios` + `cheerio` | Scraping the Exeter College website |
| `imapflow` + `mailparser` | Connecting to Gmail and parsing emails |
| `@anthropic-ai/sdk` | Claude Vision API for menu image parsing |
| `sharp` | Compressing large images before Vision API upload |
| `nodemailer` | Sending alert emails on errors or logout |
| `qrcode` | Generating the WhatsApp QR code as a PNG |

## Tests

```bash
npm test
```

Tests live in `tests/` and use Jest with mocked external dependencies (IMAP, Axios, Anthropic SDK).
