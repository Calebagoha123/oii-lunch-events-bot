# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
docker compose up -d --build           # First run (Teams needs no QR)
docker compose logs -f                 # Tail logs
docker compose down                    # Stop

node index.js --dry-run                # Render today's menu to stdout, no sends, no creds
docker compose run --rm bot node index.js --send-now   # Post today's menu and exit
docker compose run --rm bot node index.js --refresh --send-now  # Force Gmail re-read, then post

npm ci && npm test                     # Tests run on the host, not in Docker (use ci, not install)
```

Tests live in `tests/` and use Jest with mocked external dependencies (IMAP, Axios, Anthropic SDK). CI (`.github/workflows/ci.yml`) runs `npm ci && npm test` on PRs.

## Architecture

A Node.js bot that scrapes daily lunch menus from multiple Oxford cafés and posts them to a Microsoft Teams channel (default) or a WhatsApp group (deprecated) at 11:00 AM on weekdays.

**Layering (keep it this way):** `buildMenu()` returns *structured data*; `render/*` turn that into channel-specific messages; `senders/*` deliver them. Formatting must not leak back into the fetchers or `buildMenu`.

**Code lives under `src/`** (entry point `index.js` stays at the repo root). See the "Project layout" section of `README.md` for the full tree. Key modules:

- **`index.js`** (root) — Orchestration only: resolves senders from `SENDERS`, registers the cron job (11 AM Mon–Fri) and catch-up timer, dispatches to senders, handles `--dry-run` / `--send-now` / `--refresh`, sends alerts.
- **`src/buildMenu.js`** — `buildMenu()` fetches every `MENU_SOURCES` entry plus the event sources and returns `{date, day, pun, events, sections, errors, stale, onVacation}`.
- **`src/menus/`** — `dakota.js` (Exeter site scraper, staleness via `article:modified_time`), `blavatnik.js` and `schwarzman.js` (Gmail IMAP → Claude Vision → weekly JSON cache in `data/`).
- **`src/events/`** — `whatson.js` (Schwarzman What's On, with showtimes) and `nearby.js` (Blavatnik + Andrew Wiles via the oxfevents.com API).
- **`src/render/`** — pure menu-to-message renderers (`teams.js` emits an Adaptive Card for the workflow webhook).
- **`src/senders/`** — `teams.js`, `whatsapp.js`, and `index.js` (resolver). Each sender implements `isConfigured / connect / send / close`.
- **`src/dates.js`, `src/paths.js`** — shared `DAYS`/`getWeekMonday` and repo-root-anchored `data/` + `puns.txt` paths.
- **`src/alerts.js`, `src/puns.js`, `src/dailySend.js`** — email alerts, daily pun rotation, and the once-per-day send lock.

**Data flow:**
1. Cron fires at 11 AM (or `--send-now`) → `sendMenu()` in `index.js`
2. `buildMenu()` fetches event sources and every menu source. Email-based cafés check cache freshness; if stale, fetch Gmail → extract image → Claude Vision → JSON cache
3. A source can signal `stale: true`; if every source is stale with nothing to show, `onVacation` is set
4. Renderers turn the structured menu into per-channel messages; each active sender delivers it
5. Degraded sources and total failures trigger email alerts via `src/alerts.js`

## Environment Variables

See `.env.example` for the annotated list. Key points: `SENDERS` selects channels (default `teams`); Teams needs `TEAMS_WEBHOOK_URL`; the menu sources need `GMAIL_USER` / `GMAIL_APP_PASSWORD` / `ANTHROPIC_API_KEY`; `ALERT_EMAIL` should be a shared alias; `GROUP_NAME` is only for the deprecated WhatsApp sender.

## Deployment Notes

- **Containerised**: Docker via `docker-compose.yml`. `data/` (and, for WhatsApp only, `auth_info_baileys/`) are bind-mounted so caches/auth survive rebuilds.
- **Hosting**: Teams is outbound HTTPS — any host works, currently Brains. WhatsApp (deprecated) is blocked on cloud IPs and needs a residential/office network.
- **Restart policy**: `restart: unless-stopped`; no PM2 needed.
- **Reality check**: production currently runs on Brains as a `systemd --user` service, not Docker. `README.md` covers operations, the redeploy procedure, and the accounts/credentials handover.
