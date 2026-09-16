import { useEffect, useState } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner } from '../components/ui'

// Placeholder overview for the Fleet Management area. Reuses the shared trucks
// and drivers already in the system; fleet-specific features (registration /
// KIR / insurance dates, service schedules, documents) get built out here next.
export default function FleetHome() {
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    if (!isConfigured) return
    Promise.all([
      supabase.from('trucks').select('id', { count: 'exact', head: true }).eq('status', 'Active'),
      supabase.from('drivers').select('id', { count: 'exact', head: true }).eq('status', 'Active'),
      supabase.from('mechanics').select('id', { count: 'exact', head: true }).eq('status', 'Active'),
    ]).then(([t, d, m]) => setCounts({ trucks: t.count, drivers: d.count, mechanics: m.count }))
  }, [])

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Fleet overview</h1>
          <div className="sub">The fleet at a glance — shared with the workshop</div>
        </div>
      </div>
      <div className="content">
        {!counts ? <Spinner label="Loading fleet…" /> : (
          <div className="metrics">
            <div className="metric"><div className="k">Active trucks</div><div className="v">{counts.trucks ?? '—'}</div></div>
            <div className="metric"><div className="k">Active drivers</div><div className="v">{counts.drivers ?? '—'}</div></div>
            <div className="metric"><div className="k">Active mechanics</div><div className="v">{counts.mechanics ?? '—'}</div></div>
          </div>
        )}
        <div className="empty" style={{ marginTop: 20 }}>
          <b>Fleet features coming next</b>
          Registration / KIR / insurance dates, service schedules, and documents will live here —
          built on the same trucks and drivers the workshop already uses.
        </div>
      </div>
    </>
  )
}
