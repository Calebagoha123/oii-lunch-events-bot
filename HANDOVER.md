# Handover

The single most important document when a cohort changes over. It lists every
account and credential the bot depends on, who holds it, and how to rotate it.
**Keep it current** — an out-of-date handover is how a bot dies quietly.

## The one-paragraph summary

A Node.js bot posts a daily lunch menu (Dakota, Blavatnik, Schwarzman) to a
Microsoft Teams channel at 11:00 on weekdays. It scrapes Dakota from the Exeter
College website and reads the two café menus out of a Gmail inbox via IMAP,
using Claude Vision to turn the menu images into text. It runs in Docker on an
always-on machine (currently Brains).

## Accounts & credentials

| Thing | Where it lives | Held by | How to rotate |
|---|---|---|---|
| GitHub repo | `Calebagoha123/oxford_lunch_menus` | Caleb (owner) + collaborators | Owner: Settings → Collaborators to add the next maintainer. To fully hand off, Settings → Transfer ownership. |
| Teams webhook | Power Automate flow on the lunch channel | Whoever created the flow | Recreate: channel ⋯ → Workflows → "Post to a channel when a webhook request is received". Add co-owners in Power Automate so it survives one person leaving. Put the URL in `.env` as `TEAMS_WEBHOOK_URL`. |
| Gmail inbox | The Google account receiving "Weekly Menu Update" / "Schwarzman Menu" emails | ??? (fill in) | Ensure the café senders keep mailing this address. |
| Gmail App Password | `.env` → `GMAIL_APP_PASSWORD` | same as above | Google Account → Security → App Passwords → revoke old, create new, update `.env`. Requires 2FA on the account. |
| Anthropic API key | `.env` → `ANTHROPIC_API_KEY` | ??? (fill in — who pays?) | console.anthropic.com → API keys → rotate. **Note who the billing account is.** |
| Alert email | `.env` → `ALERT_EMAIL` | should be a shared alias | Point at a distribution list, not a personal inbox, so alerts survive turnover. |
| WhatsApp session *(deprecated)* | `auth_info_baileys/` on the host | Caleb's phone number | Re-auth requires scanning a QR from the paired phone. This is the dependency Teams was adopted to remove — see "Deprecation" in the README. |

> **Action for the departing maintainer:** fill in every `???` above before you
> go, and add the permanent staff member as a repo collaborator and Power
> Automate flow co-owner.

## Where it runs

- Host: **Brains** (`brains.oii.ox.ac.uk`), department-maintained, on the Oxford VPN.
  SSH in as the maintainer account (currently `kell8360`).
- **It is NOT Docker on Brains** (Docker isn't installed there). It runs as a
  **`systemd --user` service**, `lunch-bot.service`, defined at
  `~/.config/systemd/user/lunch-bot.service`. It runs `node index.js` directly
  via nvm, `Restart=always`, `TZ=Europe/London`. The 11:00 fire is the in-process
  cron, not a system cron.
- The repo on Brains at `~/oxford_lunch_menus` is a **plain copy, not a git
  clone** — so updates can't be `git pull`ed. Re-cloning it from GitHub (and
  copying `.env` + `data/` across) is a worthwhile fix for the next maintainer.
- State lives in `data/` (menu caches, send claims, pun state); WhatsApp auth in
  `auth_info_baileys/`.

Useful commands on Brains:
```bash
systemctl --user status lunch-bot.service
journalctl --user -u lunch-bot.service -n 100 --no-pager
systemctl --user restart lunch-bot.service
```

> **As of 17 Jul 2026 the running service is broken:** its WhatsApp connection
> has dropped ("Connection Closed" every 5 min in the logs) and sends have
> failed since 15 Jul. Migrating it to the Teams sender (this repo's default) and
> redeploying the current code is the fix — see RUNBOOK "Redeploying to Brains".

## If you're the new maintainer, start here

1. Read `CONTRIBUTING.md` — get `npm ci && npm test && node index.js --dry-run`
   working locally with zero credentials.
2. Read `RUNBOOK.md` — what to do when the message doesn't arrive.
3. Get yourself added as a repo collaborator and Power Automate co-owner.
4. Confirm you can reach the host and see the container.
