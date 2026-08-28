# Truck Repair Management System

Repair-shop dashboard for a truck fleet: complaints → work orders → mechanic
assignment → time tracking, backed by Supabase (Postgres). See
[`spec.md`](./spec.md) for the full design. This repo currently contains the
**data layer** (schema + seed + docs); the React front end is the next step.

```
truck-repair-system/
├── spec.md                       # finalized specification
├── supabase/
│   ├── migrations/0001_init.sql  # schema: tables, triggers, views, RLS
│   └── seed.sql                  # master data, generated from the xlsx
└── scripts/
    └── generate_seed.py          # regenerates seed.sql from the spreadsheet
```

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

## Next step: the front end

Scaffold a Vite + React app (`npm create vite@latest`), add
`@supabase/supabase-js`, and build four screens against the views and tables
above: complaint intake, triage/assign, the mechanic queue board, and the
trucks-down dashboard. Because v1 has no auth, the anon key with the permissive
RLS policies is enough to start; replace those policies when you add login.
