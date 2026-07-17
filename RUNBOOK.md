# Runbook

Diagnosis in priority order. Work top to bottom — the checks are ordered by how
common the cause is.

## "The menu didn't arrive today"

1. **Is today a weekday?** The bot only posts Mon–Fri. Weekends are silent by design.

2. **Is it a vacation?** Out of term the cafés stop updating. The bot now detects
   this and posts *"The cafés look closed for the vacation…"* instead of a blank
   menu. If you saw that message, the bot is working correctly — there's just no menu.
   Confirm locally: `node index.js --dry-run`.

3. **Is the service running?** On Brains it runs as a `systemd --user` service
   (not Docker — Docker isn't installed there):
   ```bash
   systemctl --user status lunch-bot.service
   journalctl --user -u lunch-bot.service -n 100 --no-pager
   ```
   Restart with `systemctl --user restart lunch-bot.service`. Repeated
   `Connection Closed` lines mean the WhatsApp session has dropped — that's the
   deprecated backend failing, and the reason to finish the Teams migration.

4. **Did an alert email arrive?** Check `ALERT_EMAIL`. The bot emails on:
   degraded sources, a total send failure, and (WhatsApp only) being logged out.
   No alert + no message usually means the host was asleep/offline at 11:00 —
   see step 7.

5. **Did the send just fail once?** Force it now:
   ```bash
   docker compose run --rm bot node index.js --send-now
   ```

6. **Preview without spamming the channel** — no credentials needed:
   ```bash
   node index.js --dry-run
   ```
   This prints the exact message and the Teams card payload. Use it to tell a
   real bug from an empty-menu day.

7. **Was the host awake at 11:00?** If it runs on a laptop, a shut lid means no
   send. The bot has a catch-up timer that fires as soon as it's back online on a
   weekday — but only if it comes back the same day. This is why it should live
   on an always-on machine (Brains).

## "One café is missing / says 'not updated this week'"

- The message now names degraded sources (⚠️) rather than hiding them, and a
  stale source is labelled *"not updated this week"*. So this is visible on purpose.
- **Dakota missing:** the Exeter page structure or URL may have changed. Check
  `EXETER_MENU_URL` in `scraper.js` and run `--dry-run` to see the parse.
- **Blavatnik / Schwarzman missing or stale:** almost always the menu email
  didn't arrive, or its **subject line changed**. The IMAP search matches exact
  subjects (`"Weekly Menu Update"`, `"Schwarzman Menu"` in `blavatnik.js` /
  `schwarzman.js`). If the café renamed the email, update the subject there.
  Force a re-read from Gmail:
  ```bash
  docker compose run --rm bot node index.js --refresh --send-now
  ```

## "It posted an empty or garbled menu"

- Run `--dry-run` and read the parsed output.
- For the image-based cafés, the cache is in `data/blavatnik-menu.json` /
  `data/schwarzman-menu.json`. Delete the relevant file and `--refresh` to force
  a fresh Vision parse.

## "I need to re-authenticate WhatsApp" (deprecated path only)

Relevant only if `SENDERS` still includes `whatsapp`. Run the container in the
foreground, scan the QR from the paired phone, then detach:
```bash
docker compose up        # scan QR
# Ctrl-C once connected
docker compose up -d
```
If you can't scan (no access to the phone), you can't recover the WhatsApp
session — this is exactly why the bot moved to Teams.

## Redeploying to Brains

The repo on Brains is a plain copy, not a git clone, and the running service is
the pre-Teams code. To deploy the current version:

```bash
ssh <maintainer>@brains.oii.ox.ac.uk
cd ~/oxford_lunch_menus
# back up your env + data, then replace the code with a fresh clone:
cp .env /tmp/lunch.env && cp -r data /tmp/lunch-data
cd ~ && rm -rf oxford_lunch_menus && git clone git@github.com:Calebagoha123/oxford_lunch_menus.git
cd oxford_lunch_menus && cp /tmp/lunch.env .env && cp -r /tmp/lunch-data/* data/ 2>/dev/null || true
source ~/.nvm/nvm.sh && npm ci
node index.js --dry-run                 # sanity-check the output
systemctl --user restart lunch-bot.service
```

Set `SENDERS=teams` and `TEAMS_WEBHOOK_URL=…` in `.env` first (see HANDOVER.md) so
the redeploy also moves delivery off the broken WhatsApp session.

## Escalation

If a source keeps breaking, open a GitHub issue with the `--dry-run` output
attached so the next person has the parse in hand.
