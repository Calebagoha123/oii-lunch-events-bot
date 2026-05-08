# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
docker compose up --build              # First run (foreground, scan QR from logs)
docker compose up -d                   # Detached after auth
docker compose logs -f                 # Tail logs
docker compose down                    # Stop

docker compose run --rm bot node index.js --send-now   # Send today's menu and exit

npm install && npm test                # Tests run on the host, not in Docker
```

Tests live in `tests/` and use Jest with mocked external dependencies (IMAP, Axios, Anthropic SDK).

## Architecture

This is a Node.js WhatsApp bot that scrapes daily lunch menus from multiple Oxford cafés and sends them to a WhatsApp group at 11:00 AM on weekdays.

**Main modules:**

- **`index.js`** — Entry point. Initializes WhatsApp client (via `@whiskeysockets/baileys`), handles QR auth, registers cron job (11 AM Mon–Fri), listens for `!menu` and `!refresh` commands in the group.
- **`scraper.js`** — Fetches the Dakota Café menu by scraping the Exeter College website with Axios + Cheerio. Also orchestrates combining all menus into one formatted message via `MENU_SOURCES`.
- **`blavatnik.js`** — Fetches the Blavatnik Café menu by connecting to Gmail via IMAP (`imapflow`), extracting PNG attachments from emails with subject "Weekly Menu Update", sending the image to Claude Vision API (`@anthropic-ai/sdk`) for text extraction, and caching results in `data/blavatnik-menu.json` weekly.
- **`schwarzman.js`** — Fetches the Schwarzman Centre "Build Your Own" menu via the same Gmail/IMAP/Claude Vision pipeline, searching for emails with subject "Schwarzman Menu". Returns a category-based format (Base, Sides, Protein, etc.). Cached weekly in `data/schwarzman-menu.json`.

**Data flow:**
1. Cron fires (or `!menu` received) → `sendMenuToGroup()` in `index.js`
2. `index.js` refreshes email-based caches (Blavatnik + Schwarzman) before sending
3. `scraper.js` fetches Dakota menu from web + calls `blavatnik.js` and `schwarzman.js`
4. Each email-based module checks cache freshness; if stale, fetches Gmail → extracts image → calls Claude Vision → saves JSON cache
5. Combined message sent to the WhatsApp group matched by `GROUP_NAME`

## Environment Variables

Required in `.env` (see `.env.example`):

```
GROUP_NAME=            # Exact WhatsApp group name to send menus to
GMAIL_USER=            # Gmail address receiving Blavatnik menu emails
GMAIL_APP_PASSWORD=    # Gmail App Password (requires 2FA enabled)
ANTHROPIC_API_KEY=     # Anthropic API key for Claude Vision
ALERT_EMAIL=           # Where logout/error alerts are sent
```

## Deployment Notes

- **Containerised**: The bot runs in Docker via `docker-compose.yml`. `auth_info_baileys/` and `data/` are bind-mounted from the host so auth and menu caches survive container rebuilds.
- **WhatsApp auth**: On first run, scan the QR code printed to container logs. The session is persisted in `./auth_info_baileys/`.
- **Hosting**: Run on a residential or office network — cloud provider IPs (e.g. AWS EC2) are blocked by WhatsApp's infrastructure.
- **Restart policy**: `restart: unless-stopped` in compose handles crashes and host reboots; no PM2 needed.
