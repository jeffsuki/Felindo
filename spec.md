# Truck Repair Management System — v1 Specification

A single-supervisor web dashboard for managing truck-fleet repairs. A driver or
mechanic files a complaint about a truck; the supervisor breaks it into tasks,
assigns them to mechanics by specialty and availability, and everything is
time-tracked so you can see live which trucks are down, who is working on what,
and how long each job has taken.

**Stack:** Vite + React (plain SPA) · Supabase (Postgres) · GitHub. No auth in
v1; the schema is structured so auth + row-level security drop in later without
a rewrite.

## Scope

In scope for v1: master data (trucks, drivers, mechanics, vendors, specialties),
the complaint → assign → work → swap → complete flow, time tracking, and the
dashboards. **Spare parts are deliberately excluded** (831 SKUs — too much to
carry now); the schema leaves a clean hook to add a `parts` table and a
`work_order_parts` join later. Vendors *are* loaded in v1, because outsourced
work orders point at them.

## Data governance (inherited from the Master Database)

The source spreadsheet already defines a governance model, and this system
adopts it wholesale:

- Every master entity carries a **stable business code** (`D-01`, `M-01`, plate,
  `V-01`, `SP-01`) plus an internal UUID used for foreign keys.
- **Rows are never deleted and codes are never reused.** You retire a record by
  setting its status column, which removes it from dropdowns while keeping every
  historical reference intact.
- Status vocabularies come straight from the spreadsheet's `_Status` sheet:
  drivers/mechanics are Active / Resigned / Dismissed / On leave; trucks are
  Active / Sold / Scrapped / Off-road; vendors are Active / Inactive /
  Blacklisted.

Crucially, this **lifecycle status** (is this truck scrapped?) is separate from
a truck's **operational status** (is this truck in the shop right now?). The
latter is *derived* from open work orders — never typed by hand — via the
`truck_operational_status` view.

## Entities

**Trucks** — 84, keyed by plate, tagged by fleet division (Tangki / Gerobak /
Kantor). **Drivers** — 32. **Mechanics** — 5 in-house, each mapped to one or
more specialties with a `primary`/`backup` proficiency; Ronald also carries a
`can_lift` capability flag (heavy lifting is a capability, not a specialty).
**Vendors** — 29 + CASH, used as the destination for outsourced work.

**Specialties** — 12, each with an *adjustable* in-house/outsourced default:

| In-house (default) | Outsourced (default) |
|---|---|
| las, ban, mesin, gerang, kolong | posneleng, cabin, pom, dinamo, electrical, bubut, pres_karet_tingtong |

The default is only a default: every individual work order has its own
`is_outsourced` flag you can flip without touching the taxonomy.

**Mechanic → specialty mapping (seeded):**

| Mechanic | Specialties |
|---|---|
| M-01 Darmanto | mesin (primary), kolong (backup) |
| M-02 Indra | mesin (primary), kolong (backup) |
| M-03 Geleng | kolong (primary), gerang (primary) |
| M-04 Ronald | las (primary) · can_lift |
| M-05 Rahmat | kolong (primary) |

## Workflow

1. **Complaint (intake).** Filed against a truck. The reporter is flexible and
   never required — an optional driver link, an optional mechanic link (the
   driverless inspection case), or a free-text name. The supervisor sets a
   manual **priority** (urgent / normal) and an expected **duration class**
   (same_day / multi_day / outsourced_wait).
2. **Triage & assign.** The supervisor splits the complaint into **work orders**,
   each tagged with a required specialty and either assigned to a mechanic or
   marked outsourced. An outsourced order records vendor + sent date + expected
   back date (all optional — fill them if the turnaround matters, skip them if
   not; it degrades gracefully to just "outsourced").
3. **Work.** A mechanic can hold **multiple tasks at once** — one actively
   worked, others parked waiting on parts or an outsourced return. Work-order
   status is one of: unassigned, assigned, in_progress, paused, awaiting_parts,
   awaiting_outsource, done.
4. **Swap.** Reassigning a task closes the current mechanic's time session and
   opens a new one. Two mechanics never co-work a single task simultaneously.
5. **Reopen loop (Option A).** One complaint stays open through the whole
   fix → test-drive → refix cycle. If a test drive fails, add another work order
   under the same complaint. The complaint closes only when the truck passes.
   The stacked work-order history shows that a truck bounced. (Explicit
   pass/fail test-drive logging is a future add-on, not needed now.)

## Time tracking

The clock (a row in `time_logs`) runs **only while a work order is
in_progress**. Parked states stop the clock; elapsed calendar time is still
visible but is not counted as labor. The same table doubles as the swap/audit
trail — each reassignment closes one session and opens the next, so you never
lose who touched what. At most one session per work order runs at a time
(enforced by a partial unique index). Starting a work order with no assigned
mechanic is rejected.

## Dashboards (read from views)

- **`trucks_down`** — trucks currently in the shop, their open work orders,
  assignee or vendor, and labor time.
- **`mechanic_queue`** — each mechanic's plate: what they are *actively* working
  vs *parked*, for planning.
- **`truck_operational_status`** — derived operational state per truck.
- **`work_order_labor`** — total labor seconds per work order.

## Decisions log

- One mechanic per work order at a time; swaps are sequential. Mechanics hold
  multiple work orders across the shop (the queue).
- Truck operational status is derived, not manual.
- Outsourcing tracks vendor + turnaround dates, all optional.
- Priority is manual; both a priority and a duration class are recorded.
- Reopen loop: Option A (implicit via stacked work orders).
- No auth in v1; RLS enabled with permissive policies to be tightened later.

## Deliberately deferred

Spare-parts inventory and the parts-request form; explicit test-drive pass/fail
logging; multi-user auth and role-based access; anything about cost/billing.
