# Oxford Lunch Menu Bot

A Node.js bot that, every weekday at 11:00, posts a single message to a **Microsoft Teams** channel with:

- **What's on around you today** — events at the Schwarzman Centre, the Blavatnik School of Government, and the Andrew Wiles (Maths) building.
- **The day's lunch menus** from Dakota Café (Cohen Quad), Blavatnik Café, and the Schwarzman Centre — with opening hours, prices, and a daily pun.

It can also post to WhatsApp, but that path is **deprecated** (see [Senders](#senders)).

This README is the single source of truth: setup, development, operations, and handover are all below.

---

## Contents

- [How it works](#how-it-works)
- [Senders (Teams / WhatsApp)](#senders)
- [Setting up the Teams webhook](#setting-up-the-teams-webhook)
- [Project layout](#project-layout)
- [Environment variables](#environment-variables)
- [Running it](#running-it)
- [Local development](#local-development)
- [Extending it](#extending-it) — adding a café or an events source
- [Operations / runbook](#operations--runbook)
- [Handover: accounts & credentials](#handover-accounts--credentials)

---

## How it works

1. A cron job fires at 11:00 Mon–Fri (with a catch-up timer if the host was asleep at 11:00).
2. `buildMenu()` gathers everything into **structured data** — events, café sections, and staleness flags. It never formats anything.
3. A **renderer** turns that structure into a message for each channel (`render/whatsapp.js`, `render/teams.js`).
4. Each active **sender** delivers it (`src/senders/teams.js`, `src/senders/whatsapp.js`).

Menu sources:

- **Dakota Café** — scraped live from the Exeter College catering site.
- **Blavatnik & Schwarzman cafés** — parsed from a weekly menu image emailed to a Gmail inbox: IMAP fetches the email, Claude Vision reads the image, and the result is cached per week in `data/`.

Event sources:

- **Schwarzman Centre** — scraped from its own What's On page, including today's showtimes.
- **Blavatnik & Andrew Wiles** — from the [oxfevents.com](https://www.oxfevents.com) JSON API, matched by venue.

Every source **fails soft**: a broken source is named in the message and emailed as an alert, never silently dropped, and events never block the lunch menu.

---

## Senders

The `SENDERS` env var (comma-separated) selects the channel(s):

| `SENDERS` | Behaviour |
|---|---|
| `teams` *(default)* | Post to Teams via a Power Automate workflow webhook. |
| `teams,whatsapp` | Post to both — useful during the migration. |
| `whatsapp` | WhatsApp only (**deprecated**). |

---

## Setting up the Teams webhook

1. In the target Teams channel, click **⋯ → Workflows**.
2. Choose the template **"Post to a channel when a webhook request is received."** (Ignore any "Incoming Webhook connector" guide online — Microsoft retired that in May 2026.)
3. Name it, confirm the team/channel, and finish. It gives you a **webhook URL**.
4. Put it in `.env`: `SENDERS=teams` and `TEAMS_WEBHOOK_URL=<the url>`.
5. Add a co-owner in [Power Automate](https://make.powerautomate.com) (**Edit → ⋯ → Manage owners**) so the flow survives one person leaving.

Messages post as the "Workflows" (Flow bot) identity — Microsoft doesn't allow custom bot name/icon over webhooks.

---

## Project layout

```
index.js               Entry point: scheduling, dispatch, CLI flags, alerts
puns.txt               Rotating daily puns (edit freely)
src/
  buildMenu.js         Gathers events + menus into structured data (no formatting)
  dates.js             Shared DAYS + getWeekMonday
  paths.js             Repo-root anchored data/ and puns.txt locations
  menus/
    dakota.js          Exeter College site scraper (Axios + Cheerio)
    blavatnik.js       Gmail IMAP → image → Claude Vision → weekly JSON cache
    schwarzman.js      Same pipeline for the Schwarzman café menu
  events/
    whatson.js         Schwarzman Centre What's On scraper (with showtimes)
    nearby.js          Blavatnik + Andrew Wiles via the oxfevents.com API
  render/
    whatsapp.js        Structured menu → WhatsApp text (pure)
    teams.js           Structured menu → Teams Adaptive Card (pure)
  senders/
    index.js           Resolves SENDERS into active backends
    teams.js           POSTs the card to the workflow webhook
    whatsapp.js        Baileys backend (deprecated)
  alerts.js            Email alerts for degraded/failed sends
  puns.js              Daily pun rotation
  dailySend.js         Once-per-day send claim/lock store
tests/                 Jest suites + fixtures (mock IMAP, Axios, Anthropic)
data/                  Weekly caches, send claims, pun state (bind-mounted, gitignored)
```

**Design rule:** building and rendering are separate. `buildMenu()` returns data; renderers format it. Don't push formatting back into the fetchers or `buildMenu` — that's what keeps `--dry-run` and the tests simple.

---

## Environment variables

Copy `.env.example` to `.env` and fill it in. For the default Teams setup you need `TEAMS_WEBHOOK_URL`, the Gmail/Anthropic keys for the menu sources, and `ALERT_EMAIL`.

| Variable | Needed for | Notes |
|---|---|---|
| `SENDERS` | all | Defaults to `teams`. |
| `TEAMS_WEBHOOK_URL` | Teams | The Power Automate workflow webhook. |
| `GMAIL_USER` | Blavatnik/Schwarzman menus | Gmail address receiving the menu emails. |
| `GMAIL_APP_PASSWORD` | Blavatnik/Schwarzman menus | Gmail App Password (needs 2FA on the account). |
| `ANTHROPIC_API_KEY` | Blavatnik/Schwarzman menus | Claude Vision image parsing. |
| `ALERT_EMAIL` | alerting | **Use a shared alias**, not a personal inbox. |
| `GROUP_NAME` | WhatsApp only | Exact group name; unused for Teams. |

---

## Running it

### With Docker

Teams needs no QR scan — just a valid `TEAMS_WEBHOOK_URL`.

```bash
docker compose up -d --build     # start
docker compose logs -f           # watch
docker compose run --rm bot node index.js --send-now   # post now (test)
```

`restart: unless-stopped` handles crashes and reboots. The image is multi-stage and runs as a non-root user.

**Hosting note:** Teams is outbound HTTPS, so any host works. The bot fires at 11:00 weekdays; if the host is asleep then, a catch-up timer sends as soon as it's back online the same day — so run it on an always-on machine.

### Without Docker

```bash
npm ci
node index.js                    # run the bot
node index.js --send-now         # build + post today's menu, then exit
node index.js --refresh          # force a Gmail re-read (add --send-now to also post)
```

---

## Local development

```bash
git clone git@github.com:Calebagoha123/oxford_lunch_menus.git
cd oxford_lunch_menus
npm ci        # exact locked deps, incl. the correct platform sharp binary
npm test      # should be all green
```

> If tests fail on `sharp`, you ran `npm install` instead of `npm ci`, or have a stale `node_modules`. Delete `node_modules` and `npm ci` again. (CI runs `npm ci && npm test` on every PR to catch exactly this.)

**The inner loop — `--dry-run`:**

```bash
node index.js --dry-run
```

This builds today's real message and prints both the WhatsApp text and the Teams card JSON. It **sends nothing and needs no credentials** (it just skips the Gmail cafés if keys are absent). Use it to check any formatting or parsing change.

**Testing against a real channel:** make your *own* private Teams channel and webhook, point `TEAMS_WEBHOOK_URL` at it, then `node index.js --send-now`. Never point a dev `.env` at the production channel.

**Making a change:** branch off `main`, add/adjust a test (every source and renderer has one under `tests/`), get `npm test` green and `--dry-run` looking right, then open a PR. CI runs automatically.

---

## Extending it

### Add a café

Add an entry to `MENU_SOURCES` in `src/buildMenu.js` and a fetcher under `src/menus/`:

```js
{
  name: "Café Name",
  info: "🕐 12:00–13:30 · 💷 £X.XX",
  fetch: async (today) => ({ items: ["item 1", "item 2"], stale: false }),
}
```

`fetch(today)` receives the day name (e.g. `"Wednesday"`) and returns either `string[]` or `{ items: string[], stale: boolean }`. Return empty `items` to omit the café that day; set `stale: true` when you can tell the source hasn't refreshed this week (e.g. vacation) — that feeds the "not updated" label and vacation detection. For an email-based café, follow `src/menus/blavatnik.js`.

### Add an events venue

Add a pattern to `VENUE_GROUPS` in `src/events/nearby.js` (matched against oxfevents venue names), or add a new scraper under `src/events/` and wire it into the `events` array in `buildMenu()`.

> Known cleanup: fetchers still emit WhatsApp-flavoured markup (`*bold*`, `•`) that the Teams renderer translates. Ideally fetchers would return plain structured items and let each renderer decide emphasis — a good first refactor.

---

## Operations / runbook

Diagnosis, in priority order.

**"The menu didn't arrive today."**

1. **Weekday?** The bot only posts Mon–Fri. Weekends are silent by design.
2. **Vacation?** Out of term the cafés stop updating and the bot posts *"the cafés look closed for the vacation…"* instead of a blank menu — that's correct behaviour, not a bug. Confirm with `node index.js --dry-run`.
3. **Service running?** On Brains it runs as a `systemd --user` service:
   ```bash
   systemctl --user status lunch-bot.service
   journalctl --user -u lunch-bot.service -n 100 --no-pager
   systemctl --user restart lunch-bot.service
   ```
   Repeated `Connection Closed` lines mean the WhatsApp session dropped — the deprecated backend failing, and the reason to finish the Teams migration.
4. **Alert email?** Degraded sources, total send failures, and WhatsApp logout all email `ALERT_EMAIL`. No alert + no message usually means the host was asleep at 11:00.
5. **Force a send:** `node index.js --send-now` (or via Docker, `docker compose run --rm bot node index.js --send-now`).

**"One café is missing / says 'not updated this week'."**

- This is shown on purpose — degraded and stale sources are labelled, not hidden.
- **Dakota missing:** the Exeter page structure or `EXETER_MENU_URL` may have changed (`src/menus/dakota.js`).
- **Blavatnik/Schwarzman missing:** usually the menu email didn't arrive, or its **subject line changed**. The IMAP search matches exact subjects (`"Weekly Menu Update"`, `"Schwarzman Menu"`). Force a re-read: `node index.js --refresh --send-now`. To force a fresh Vision parse, delete the relevant `data/*-menu.json` first.

**Redeploying to Brains.** The repo there is a plain copy (not a git clone) and may run older code:

```bash
ssh <maintainer>@brains.oii.ox.ac.uk
cd ~/oxford_lunch_menus && cp .env /tmp/lunch.env && cp -r data /tmp/lunch-data
cd ~ && rm -rf oxford_lunch_menus && git clone git@github.com:Calebagoha123/oxford_lunch_menus.git
cd oxford_lunch_menus && cp /tmp/lunch.env .env && cp -r /tmp/lunch-data/* data/
source ~/.nvm/nvm.sh && npm ci && node index.js --dry-run
systemctl --user restart lunch-bot.service
```

Set `SENDERS=teams` + `TEAMS_WEBHOOK_URL` in `.env` first so the redeploy also moves delivery off the WhatsApp session.

---

## Handover: accounts & credentials

Keep this current — an out-of-date list is how the bot dies quietly. Fill in every `???`.

| Thing | Where | Held by |
|---|---|---|
| Teams webhook | Power Automate flow on the channel | flow owner | 
| Gmail inbox | account receiving the menu emails | oxfordmenu7(at)gmail(dot)com |
| Gmail App Password | `.env` → `GMAIL_APP_PASSWORD` | on brains |
| Anthropic API key | `.env` → `ANTHROPIC_API_KEY` | on brains |
| Alert email | `.env` → `ALERT_EMAIL` | should be a shared alias |
| Host | Brains (`brains.oii.ox.ac.uk`), `systemd --user` service | dept-maintained |
| WhatsApp session *(deprecated)* | `auth_info_baileys/` on the host | a personal phone number (Rescan QR from the paired phone) |

---

## Tech stack

| Package | Purpose |
|---|---|
| `axios` + `cheerio` | Scraping Exeter + Schwarzman sites, and the oxfevents API |
| `imapflow` + `mailparser` | Gmail IMAP + email parsing |
| `@anthropic-ai/sdk` | Claude Vision menu-image parsing |
| `sharp` | Compressing images before Vision upload |
| `node-cron` | The 11:00 weekday schedule |
| `nodemailer` | Alert emails |
| `@whiskeysockets/baileys` + `qrcode` | WhatsApp Web API (deprecated) |
