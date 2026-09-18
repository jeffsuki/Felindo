import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const isReady = d => d.muatan != null && d.bongkar != null

// Main tab: drivers with uang tembak activity. Each opens its own page.
export default function FleetTembak() {
  const { node } = useToast()
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    supabase.from('fleet_deliveries').select('driver_name,muatan,bongkar,tembak_released')
      .not('driver_name', 'is', null)
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [])

  const drivers = useMemo(() => {
    const m = new Map()
    for (const d of rows) {
      if (!d.driver_name) continue
      if (!m.has(d.driver_name)) m.set(d.driver_name, { name: d.driver_name, outstanding: 0, ready: 0, released: 0 })
      const g = m.get(d.driver_name)
      if (d.tembak_released) g.released++
      else { g.outstanding++; if (isReady(d)) g.ready++ }
    }
    let list = [...m.values()]
    const s = q.trim().toLowerCase()
    if (s) list = list.filter(g => g.name.toLowerCase().includes(s))
    return list.sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name))
  }, [rows, q])

  if (loading) return (<><div className="topbar"><div><h1>Uang Tembak</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Uang Tembak</h1><div className="sub">Per-trip bonus by driver — open a driver to release</div></div>
      </div>
      <div className="content" style={{ maxWidth: 820 }}>
        <div className="controls"><div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search driver…" /></div></div>
        {drivers.length === 0 ? <Empty title="No uang tembak yet">Trips earn uang tembak once a driver is assigned.</Empty> : (
          <div className="clist">
            {drivers.map(g => (
              <div className="crow" key={g.name}>
                <div className="crow-head" onClick={() => nav('/fleet/tembak/' + encodeURIComponent(g.name))}>
                  <div className="crow-desc">
                    <div className="d">{g.name}</div>
                    <div className="m">{g.outstanding} outstanding{g.outstanding ? ` · ${g.ready} ready${g.outstanding - g.ready ? ` · ${g.outstanding - g.ready} pending` : ''}` : ''}{g.released ? ` · ${g.released} released` : ''}</div>
                  </div>
                  <div className="crow-meta">
                    {g.ready > 0 && <span className="fc-out" style={{ color: 'var(--accent)' }}>{g.ready} ready</span>}
                  </div>
                  <span className="crow-caret">▶</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {node}
    </>
  )
}
