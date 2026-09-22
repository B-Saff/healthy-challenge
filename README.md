# Healthy Challenge

A tiny shared scoreboard for a two-person health/habit challenge (Ben & Chelsea).
Static frontend on GitHub Pages, Google Sheets as the database, Google Apps
Script as the thin API in between. $0/month, no backend server, no accounts.

See `PRD.md`-level detail in the original spec; this README covers **setup**.

## Architecture

```
Phone (GitHub Pages static site)
        │  fetch (GET, JSON)
        ▼
Google Apps Script Web App (apps-script/Code.gs)
        │
        ▼
Google Sheet ("Activities" tab)
```

All scoring (weekly totals, lifetime totals, dog-walk diminishing returns,
dinner/massage/weekend-trip rewards) is computed client-side from the raw
activity events in `js/scoring.js`. The Sheet only ever stores individual
events — never totals — so the scoreboard can always be rebuilt from it and
manual edits in the Sheet are safe.

## 1. Create the Google Sheet

1. Create a new Google Sheet (e.g. "Healthy Challenge Data").
2. Rename the first tab to `Activities`.
3. Add this header row exactly:

   | ID | Person | Activity | Timestamp | Date | Deleted |
   |----|--------|----------|-----------|------|---------|

   Leave the rest of the sheet empty — rows are appended automatically by the API.

## 2. Deploy the Apps Script API

1. In the Sheet, open **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content and paste in the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this repo.
3. Click **Deploy → New deployment**.
4. Select type **Web app**.
5. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
6. Click **Deploy**, authorize the script when prompted (it only touches
   this one Sheet), and copy the **Web app URL** (ends in `/exec`).

Whenever you edit `Code.gs` later, use **Deploy → Manage deployments → Edit
(pencil icon) → New version** so the same `/exec` URL picks up the change.

## 3. Point the frontend at your deployment

Edit [`js/config.js`](js/config.js) and paste your Web app URL:

```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Commit this change. (See *A note on the API URL* below for why it's fine to
commit it in a public repo for this use case.)

## 4. Host on GitHub Pages

1. Push this repo to GitHub.
2. In **Settings → Pages**, set the source branch to whichever branch has
   these files (e.g. `main`) and the folder to `/ (root)`.
3. GitHub gives you a URL like `https://<user>.github.io/<repo>/`. Open it
   on your phone and add it to your home screen for quick access.

## Using the app

- **Dashboard (`index.html`)** — this week's standings, today's +/- logging
  for both people, and lifetime progress toward dinners, massages, and the
  250-point weekend trip.
- **History (`history.html`)** — daily or weekly breakdowns, filterable by
  person. Tap a day to see individual timestamped events and delete any
  mistakes; every derived total recalculates automatically.

You can also open the Google Sheet directly at any time to inspect or
hand-correct the raw data — that's the intended escape hatch.

## Scoring rules

- Gym: **+2** per session, no daily limit.
- Dog walks (per person, per day, in order logged): 1st **+0.5**, 2nd
  **+0.5**, 3rd+ **+0.25** each.
- Reading: **+0.5**, once per day (toggle).
- Unhealthy choice: **−3** each, no daily limit.
- Week runs Monday–Sunday; higher weekly total gets the massage, a tie
  means both do.
- Lifetime points never reset: every 35 points earns a dinner, every 100
  earns a massage, and both people reaching 250 unlocks the weekend trip.

## A note on the API URL

The Apps Script URL isn't a credential — it's just an endpoint — but since
this repo is public (required for free GitHub Pages on a personal account),
it will be visible in the source. Nothing sensitive is stored (just habit
counts for two people), and it's never linked from the UI itself. If that's
ever a concern, restrict **Who has access** in the Apps Script deployment,
or move to a private repo with a paid GitHub plan (private repos support
Pages on Pro/Team/Enterprise).

## Local development

No build step. Just serve the folder statically, e.g.:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.
