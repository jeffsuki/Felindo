# Truck Repair Management System

Repair-shop dashboard for a truck fleet: complaints → work orders → mechanic
assignment → time tracking, backed by Supabase (Postgres) with a Vite + React
front end. See [`spec.md`](./spec.md) for the full design and
[`SETUP_GUIDE.md`](./SETUP_GUIDE.md) for step-by-step setup.

```
truck-repair-system/
├── spec.md                       # finalized specification
├── SETUP_GUIDE.md                # push to GitHub + connect Supabase + run
├── index.html · package.json · vite.config.js
├── .env.example                  # template for Supabase keys (copy to .env)
├── src/
│   ├── main.jsx · App.jsx · index.css   # entry, router, design system
│   ├── supabaseClient.js
│   ├── lib/format.js             # status maps + formatting
│   ├── components/               # Layout, shared UI
│   └── pages/                    # Dashboard, Queue, Triage, NewComplaint
├── supabase/
│   ├── migrations/
│   │   ├── 0001_init.sql     # schema: tables, triggers, live views, RLS
│   │   ├── 0002_history.sql  # read-only history views
│   │   └── 0003_master_editable.sql  # wide codes, truck codes, nicknames
│   └── seed.sql                  # master data, generated from the xlsx
└── scripts/
    └── generate_seed.py          # regenerates seed.sql from the spreadsheet
```

## The six screens

- **Shop board** (`/`) — trucks currently down, grouped into "in repair" and
  "at vendor" lanes, each job card showing the mechanic/vendor, status, and a
  live-ticking labor timer.
- **Mechanic queue** (`/queue`) — per mechanic, what's *active now* vs *parked*.
- **Triage & assign** (`/triage`) — break complaints into work orders, assign a
  mechanic or send to a vendor, and drive each task start → pause → swap → done.
- **History** (`/history`) — three lenses: a truck's full service record, a
  mechanic's assignment trail by day, and a daily shop activity feed.
- **Master data** (`/master`) — searchable, editable lists for trucks, drivers,
  mechanics, and vendors: add, edit, and retire (status change) while history is
  preserved. Codes are permanent and 5-digit (`T-00001`, `D-00001`); plates are
  editable; drivers and mechanics have searchable nicknames.
- **New complaint** (`/new`) — intake form with searchable pickers; reporter can
  be a driver, a mechanic, a free-text name, or no one.

The schema and seed have been validated against Postgres 16: both apply with
`ON_ERROR_STOP=1`, and a full complaint → assign → start → swap → pause →
outsource → complete lifecycle passes (codes auto-generate, time logs open and
close correctly, derived truck status and the queue board react as expected).

## Setup

### 1. Create the Supabase project
Create a project at supabase.com. Grab the connection string from
**Project Settings → Database** (or use the SQL editor for steps 2–3).

### 2. Apply the schema
Using the Supabase CLI:
```bash
supabase db push          # if you wire this repo to `supabase link`
```
Or directly with psql / the SQL editor:
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
```

### 3. Load the master data
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```
The seed is idempotent (`insert ... on conflict do update`), so re-running it
refreshes master data without creating duplicates.

## Regenerating the seed after the spreadsheet changes

The seed is generated, not hand-written. When trucks/drivers/mechanics/vendors
change in the Master Database, regenerate and re-apply:
```bash
python scripts/generate_seed.py path/to/1_Master_Database.xlsx > supabase/seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```
Specialties and the mechanic→specialty mapping live in `generate_seed.py` (they
are not in the spreadsheet yet) — edit them there.

## How the pieces work

- **Codes** (`CMP-2026-0001`, `WO-2026-0001`) auto-generate on insert via
  `next_code()` and a per-year counter; you never set them by hand.
- **Time tracking** is driven by triggers on `work_orders`: the clock runs only
  while a work order is `in_progress`. Moving to `paused` /
  `awaiting_parts` / `awaiting_outsource` / `done` stops it; reassigning a
  mechanic mid-job closes one session and opens the next.
- **Truck operational status** is never stored — read it from
  `truck_operational_status`. Keep the `trucks.status` column for lifecycle
  only (Active / Sold / Scrapped / Off-road).
- **Dashboards** read from the `trucks_down`, `mechanic_queue`,
  `truck_operational_status` and `work_order_labor` views.

## Running the front end

```bash
cp .env.example .env      # fill in your Supabase URL + anon key
npm install
npm run dev               # http://localhost:5173
```
Because v1 has no auth, the anon key with the permissive RLS policies is enough
to start; replace those policies when you add login. Full instructions,
including GitHub and Vercel deploy, are in [`SETUP_GUIDE.md`](./SETUP_GUIDE.md).
