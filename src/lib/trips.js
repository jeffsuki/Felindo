// One truck load (trip / slip) = a main delivery row (parent_id null) plus any
// contract parts (rows whose parent_id is the main row). Parts carry only their
// contract's kg; slip money, uang tembak and stage stay on the main row.
// See supabase/migrations/0037_delivery_parts.sql.

// rows → main rows, each with `parts: [...]`. A part whose main row is not in
// `rows` (e.g. filtered out by the query) is kept as its own trip so nothing
// silently disappears.
export function groupTrips(rows) {
  const ids = new Set(rows.map(r => r.id))
  const parts = new Map()
  for (const r of rows) {
    if (r.parent_id && ids.has(r.parent_id)) {
      if (!parts.has(r.parent_id)) parts.set(r.parent_id, [])
      parts.get(r.parent_id).push(r)
    }
  }
  // contract 2, 3… in the order they were added (when created_at was selected)
  for (const list of parts.values()) list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  const out = []
  for (const r of rows) {
    if (r.parent_id && ids.has(r.parent_id)) continue
    out.push({ ...r, parts: parts.get(r.id) || [] })
  }
  return out
}

export const legsOf = t => [t, ...(t.parts || [])]

const has = v => v !== null && v !== undefined && v !== ''

// Sum a kg field over the main row and its parts (null when none has it).
export function tripSum(t, field) {
  const vals = legsOf(t).map(r => r[field]).filter(has)
  return vals.length ? vals.reduce((a, v) => a + Number(v), 0) : null
}

// Loaded and unloaded on every contract of the load.
export const tripReady = t => legsOf(t).every(r => has(r.muatan) && has(r.bongkar))

// Total susut over the load, only when every contract has both weights.
export const tripSusut = t => tripReady(t) ? tripSum(t, 'muatan') - tripSum(t, 'bongkar') : null

// "Origin → Destination", with each extra route of the load appended.
export function tripRoute(t, sep = ' → ') {
  const seen = []
  for (const r of legsOf(t)) {
    // a slip still without its contract shows the route written on the uang jalan (0039)
    const s = r.contract ? `${r.contract.origin || '—'}${sep}${r.contract.destination || '—'}` : (r.rute || `—${sep}—`)
    if (!seen.includes(s)) seen.push(s)
  }
  return seen.join(' + ')
}

// Control numbers of the load: "7811 + 7802".
export const tripControls = t => legsOf(t).map(r => r.contract?.control_no || '—').join(' + ')
