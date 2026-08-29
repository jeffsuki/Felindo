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
Open **SQL Editor** → **New query**, then run the migration files **in order**.
Paste the full contents of `supabase/migrations/0001_init.sql`, click **Run**,
then do the same with `supabase/migrations/0002_history.sql`. Or with psql:
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_history.sql
```
`0001` builds the tables, triggers, and live views; `0002` adds the read-only
history views. You should see "Success. No rows returned."

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
