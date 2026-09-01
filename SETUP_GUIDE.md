# Setup Guide — Push to GitHub & Connect to Supabase

Follow these in order. Two independent things happen here: (Part A) your code
goes to GitHub, and (Part B) your database schema + data go into Supabase. They
don't depend on each other — you can do B without A — but doing both is the
intended setup.

Estimated time: ~15 minutes.

---

## Before you start

You need:

- **Git** installed — check with `git --version`. If missing, install from
  https://git-scm.com.
- A **GitHub account** — https://github.com.
- A **Supabase account** — https://supabase.com.

You do **not** need Node.js or the Supabase CLI yet — those come with the front
end. This guide uses the simplest path (GitHub website + Supabase SQL editor).

---

## Part A — Push the code to GitHub

### A1. Open a terminal in this folder
Unzip the file, then `cd` into it:
```bash
cd truck-repair-system
```

### A2. Initialise the repo and make the first commit
```bash
git init
git add .
git commit -m "Initial commit: v1 schema, seed, and docs"
```
The `.gitignore` already excludes secrets and `node_modules`, so `git add .` is
safe here.

### A3. Create an empty repo on GitHub
Go to https://github.com/new. Give it a name (e.g. `truck-repair-system`),
choose Private, and **do not** tick "Add a README / .gitignore / license" —
this folder already has them. Click **Create repository**.

### A4. Connect and push
GitHub shows you the repo URL. Use it here (swap in your username/repo):
```bash
git remote add origin https://github.com/YOUR-USERNAME/truck-repair-system.git
git branch -M main
git push -u origin main
```
If prompted to authenticate, use a **Personal Access Token** as the password
(GitHub → Settings → Developer settings → Personal access tokens → generate one
with `repo` scope). Refresh the GitHub page — your files are up.

---

## Part B — Set up the Supabase database

### B1. Create the project
At https://supabase.com/dashboard click **New project**. Pick a name, set a
strong database password (save it in your password manager — you'll need it for
the CLI later), choose a region close to you, and create. Wait ~2 minutes for it
to provision.

### B2. Apply the schema
Open **SQL Editor** → **New query**, then run the migration files **in order**,
each as its own query: `0001_init.sql`, `0002_history.sql`,
`0003_master_editable.sql`, `0004_waiting_reason.sql`, `0005_wo_description.sql`,
`0006_started_and_helper.sql`, `0007_pin_complaints.sql`, `0008_complaint_code_month.sql`, `0009_resolution.sql`, `0010_external_assignee.sql`, `0011_shopboard_external.sql`, `0012_wo_code_month.sql`, then `0013_void.sql`. Or with psql:
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_history.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0003_master_editable.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0004_waiting_reason.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0005_wo_description.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0006_started_and_helper.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0007_pin_complaints.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0008_complaint_code_month.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0009_resolution.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0010_external_assignee.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0011_shopboard_external.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0012_wo_code_month.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0013_void.sql
```
`0001` core; `0002` history; `0003` wide codes + nicknames; `0004` waiting
reason; `0005` work-order descriptions in the views; `0006` editable start time
+ a "helped by" note. **Important ordering:** run the seed (step B3) *before*
`0003`. If your database is already set up, run only the migrations you haven't
applied yet (e.g. just `0013_void.sql`).

### B3. Load the master data
New query again. Open `supabase/seed.sql`, copy all of it, paste, **Run**. You
should see the insert counts (32 drivers, 5 mechanics, 30 vendors, 84 trucks,
etc.).

### B4. Verify
New query, run:
```sql
select
  (select count(*) from trucks)      as trucks,
  (select count(*) from drivers)     as drivers,
  (select count(*) from mechanics)   as mechanics,
  (select count(*) from vendors)     as vendors,
  (select count(*) from specialties) as specialties;
```
Expect 84 / 32 / 5 / 30 / 12. Then check the master data browser under
**Table Editor** — your trucks and mechanics are there.

You now have a live database with all your real master data and the full
assign/track logic. Done.

---

## Getting your API keys (for the front end later)

When you build the React app, go to **Project Settings → API** and copy the
**Project URL** and the **anon public** key into a `.env` file (use
`.env.example` as the template). The `.env` file is gitignored — never commit
it. Never put the `service_role` key or the database password in anything
prefixed `VITE_`, because that gets shipped to the browser.

---

## Part C — Run the front end

The React app lives in `src/`. It reads your Supabase project through the anon
key and renders four screens: the shop board, the mechanic queue, triage/assign,
and the new-complaint form.

### C1. Install Node.js
You need Node 18+ — check with `node --version`. If missing, install from
https://nodejs.org (LTS).

### C2. Point the app at your Supabase project
Copy the template and fill in real values:
```bash
cp .env.example .env
```
Open `.env` and set:
```
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```
Both come from **Project Settings → API** in Supabase (URL, and the **anon
public** key — not the service_role key). `.env` is gitignored, so it never
leaves your machine.

### C3. Install and run
```bash
npm install
npm run dev
```
Open the URL it prints (usually http://localhost:5173). You'll see your 84
trucks' worth of master data driving the app: file a complaint, triage it into
work orders, start/pause/swap a mechanic, and watch the shop board and queue
update. If you see a yellow "Not connected" banner, the `.env` values are
missing or the dev server needs a restart after you added them.

### C4. Deploy (optional, when you're ready to share it)
Push to GitHub (Part A), then at https://vercel.com import the repo. Add the two
`VITE_...` variables in Vercel's **Environment Variables**, and it builds and
gives you a public URL. Every `git push` redeploys automatically.

---

## Optional — the Supabase CLI workflow

Once you're comfortable, the CLI lets you apply future migrations with one
command instead of pasting SQL. Install it (https://supabase.com/docs/guides/cli),
then from this folder:
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF   # ref is in your project URL
supabase db push                                # applies migrations/ in order
```
`db push` applies files in `supabase/migrations/` in order. Keep adding new
numbered files (`0002_...sql`, `0003_...sql`) as the system grows — never edit
`0001_init.sql` after it's been applied in production.

---

## Shop password (optional gate)

To require a password before the app opens, set `VITE_APP_PASSWORD` in `.env`
(and in Vercel's env vars if deployed). Leaving it blank disables the gate. The
same password confirms voiding an entry. This is a curtain, not a lock — it
stops casual and accidental access, but because the app has no backend auth it
does not stop a determined technical user. For real per-user logins, that's a
separate build (Supabase Auth + row-level security).

## Clearing test data before go-live

When you're done testing and want a clean slate, run
`supabase/reset_test_data.sql` **once** in the Supabase SQL editor. It
hard-deletes all complaints, work orders, and time logs and resets the code
counters (so real data starts at `CMP-yyyymm-00001` / `WO-yyyymm-00001`), while
keeping every truck, driver, mechanic, and vendor. It's destructive and
irreversible, so only run it when you actually want everything transactional
gone.

## Voiding a mistaken entry

Day to day, don't hard-delete — **void** instead. On a complaint (Complaints →
expand) or a work order (Sorting Work Orders → Edit), the "Void" action hides
the entry from every screen and the archive but keeps the row, so nothing breaks
and it's reversible in the database if needed. If `VITE_APP_PASSWORD` is set,
voiding asks for it first.

---

## Updating master data later

When trucks/drivers/mechanics/vendors change in the Master Database spreadsheet,
regenerate the seed and re-run it (it's idempotent, so no duplicates):
```bash
python scripts/generate_seed.py path/to/1_Master_Database.xlsx > supabase/seed.sql
```
Then paste the new `seed.sql` into the SQL editor and Run (or `supabase db push`
if you've wired the CLI), and commit the change:
```bash
git add supabase/seed.sql
git commit -m "Refresh master data"
git push
```
