# Oxford Lunch Menu Bot

A Node.js bot that scrapes and compiles daily lunch menus from cafés around Oxford's Schwarzman Centre and posts them to a **Microsoft Teams** channel at 11:00 AM on weekdays. It can also post to WhatsApp (deprecated — see below).

> **New here?** Read `CONTRIBUTING.md` to get running locally in two minutes,
> `RUNBOOK.md` when something breaks, and `HANDOVER.md` for the accounts and
> credentials behind it.

## Senders

The `SENDERS` env var (comma-separated) picks the channel(s):

- `SENDERS=teams` *(default)* — post to Teams via a Power Automate workflow webhook.
- `SENDERS=teams,whatsapp` — both, for a migration period.
- `SENDERS=whatsapp` — WhatsApp only (**deprecated**).

### Deprecation: WhatsApp

The WhatsApp backend is kept only to bridge the move to Teams. It carries costs
Teams doesn't: the session is bound to one **personal phone number**, needs a
**physical QR rescan** from that handset to re-authenticate, and can't run on
cloud IPs (WhatsApp blocks them). **Once the Teams channel has traction, delete
`senders/whatsapp.js`, the `@whiskeysockets/baileys` + `qrcode` dependencies,
and the `auth_info_baileys/` mount.** Nothing else depends on it. Note also that
`!menu` / `!refresh` commands work on WhatsApp only — on Teams the equivalents
are `node index.js --send-now` and `node index.js --refresh` (a Teams workflow
webhook is one-way, so in-channel commands aren't possible without a full bot
registration).

## What it does

Every weekday at 11 AM the bot posts a single message with the day's lunch options from:

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

### Commands & manual triggers

On WhatsApp (deprecated), users in the group can type `!menu` and `!refresh`.

Everywhere, maintainers have CLI equivalents:
- `node index.js --dry-run` — render today's menu to stdout, no sends, no credentials
- `node index.js --send-now` — build and post today's menu, then exit
- `node index.js --refresh` — force a re-read from Gmail (combine with `--send-now` to also post)

## Setup

### Prerequisites

- Docker (Desktop on Mac/Windows, or Engine on Linux)
- A Gmail account that receives the Blavatnik and Schwarzman menu emails
- A Gmail App Password (requires 2FA enabled on the account)
- An Anthropic API key (for Claude Vision image parsing)
- A WhatsApp account to run the bot from

### Environment variables

Copy `.env.example` to `.env` and fill in the values documented there. For the
default Teams setup you need `TEAMS_WEBHOOK_URL`, the three Gmail/Anthropic keys
for the menu sources, and `ALERT_EMAIL`. `GROUP_NAME` is only needed if you
enable the deprecated WhatsApp sender.

### First run (Teams, the default)

Teams needs no QR scan — just a valid `TEAMS_WEBHOOK_URL` in `.env`.

```bash
docker compose up -d --build
docker compose logs -f          # to watch
```

Verify it posts:

```bash
docker compose run --rm bot node index.js --send-now
```

### First run (WhatsApp, deprecated)

Only if `SENDERS` includes `whatsapp`: run in the foreground once so the QR code
prints to the logs, scan it from the paired phone, then Ctrl-C and start
detached. The session persists in `./auth_info_baileys/`.

### Running tests

```bash
npm ci        # exact locked deps (incl. the correct sharp binary)
npm test
```

## Deployment

Runs in Docker with `restart: unless-stopped`, which handles crashes and host
reboots as long as Docker is running. Currently hosted on **Brains** (see
`HANDOVER.md`).

- **Teams** has no hosting restriction — it's an outbound HTTPS POST, so cloud
  hosts are fine.
- **WhatsApp** (deprecated) does not work on cloud IP ranges (AWS/GCP/etc. are
  blocked by WhatsApp) and must run on a residential/office network.

The bot fires at 11:00 AM weekdays. If the host is asleep or offline at that
time the menu won't go out; a catch-up timer sends it as soon as the host is
back online the same weekday. Run it on an always-on machine.

## Adding a new café

Each menu source is an entry in the `MENU_SOURCES` array in `scraper.js`:

```js
{
  name: "Café Name",
  info: "🕐 12:00–13:30 · 💷 £X.XX",
  fetch: async (today) => ["item 1", "item 2"],  // return array of strings
}
```

The `fetch` function receives the current day name (e.g. `"Wednesday"`) and returns either an array of formatted strings, or `{ items: string[], stale: boolean }`. Return an empty `items` to omit the café that day; set `stale: true` when you can tell the source hasn't been refreshed this week (e.g. during vacation) so it feeds the "not updated" label and vacation detection. See `CONTRIBUTING.md` for the fuller contract.

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
