# Contributing

This bot is maintained by a rotating group. The goal is that anyone can pick it
up, make a change safely, and open a PR — without touching production
credentials and without posting test messages to the real channel.

## Local setup (no credentials needed)

```bash
git clone git@github.com:Calebagoha123/oxford_lunch_menus.git
cd oxford_lunch_menus
npm ci          # installs the exact locked deps, incl. the right sharp binary
npm test        # should be all green
```

If `npm test` fails on `sharp`, you ran `npm install` instead of `npm ci`, or
have a stale `node_modules`. Delete `node_modules` and `npm ci` again.

## The inner loop: `--dry-run`

```bash
node index.js --dry-run
```

This builds today's real menu and prints both the WhatsApp text and the Teams
Adaptive Card JSON to your terminal. **It sends nothing and needs no
credentials** (it just skips the Gmail-based cafés if the keys aren't set). This
is how you check a formatting or parsing change. Use it constantly.

## Testing against a real channel (optional)

Create your **own** private Teams channel and its own webhook (⋯ → Workflows →
"Post to a channel when a webhook request is received"), then:

```bash
echo "SENDERS=teams" >> .env
echo "TEAMS_WEBHOOK_URL=<your-own-webhook>" >> .env
node index.js --send-now
```

Never point your `.env` at the production channel while developing.

## Architecture in one breath

- `scraper.js` `buildMenu()` — fetches every source, returns **structured data**
  (`{date, pun, sections, errors, stale, onVacation}`). No formatting here.
- `render/whatsapp.js`, `render/teams.js` — pure functions: structured menu → a
  message. This is where presentation lives.
- `senders/*` — one file per channel (`teams`, `whatsapp`), each with
  `isConfigured / connect / send / close`. Selected by the `SENDERS` env var.
- `index.js` — orchestration only: schedule, dispatch to senders, CLI flags, alerts.

Because building and rendering are separate, everything is unit-testable and
`--dry-run` is trivial. Keep it that way: **don't put formatting back into the
fetchers or `buildMenu`.**

## Making a change

1. Branch off `main`.
2. Add/adjust a test. Every source and renderer has tests in `tests/`.
3. `npm test` green, and `node index.js --dry-run` looks right.
4. Open a PR. CI runs `npm ci && npm test` automatically.

## Adding a new café

Add an entry to `MENU_SOURCES` in `scraper.js`. The `fetch(today)` function
returns either `string[]` or `{ items: string[], stale: boolean }`. Return
`stale: true` when you can tell the source hasn't been updated this week (e.g.
during vacation) — that feeds the vacation detection and the "not updated"
label. For an image-in-email source, follow `blavatnik.js` / `schwarzman.js`.

> Known cleanup, not yet done: the fetchers still emit WhatsApp-flavoured markup
> (`*bold*`, `•`) in their strings, and the Teams renderer translates it. Ideally
> fetchers would return plain structured items and let each renderer decide on
> emphasis. Good first refactor.
