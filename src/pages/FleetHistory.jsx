import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

// Route history: pick Trucks or Drivers, drill into one to see routes driven.
export default function FleetHistory() {
  const { node } = useToast()
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('driver')   // driver | truck
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    supabase.from('fleet_deliveries').select('plate,driver_name')
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [])

  const list = useMemo(() => {
    const m = new Map()
    for (const d of rows) {
      const key = mode === 'truck' ? d.plate : d.driver_name
      if (!key) continue
      m.set(key, (m.get(key) || 0) + 1)
    }
    let arr = [...m.entries()].map(([name, trips]) => ({ name, trips }))
    const s = q.trim().toLowerCase()
    if (s) arr = arr.filter(x => x.name.toLowerCase().includes(s))
    return arr.sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, mode, q])

  if (loading) return (<><div className="topbar"><div><h1>Route History</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Route History</h1><div className="sub">Routes driven, by {mode === 'truck' ? 'truck' : 'driver'}</div></div>
        <div className="seg-lens">
          {[['driver', 'Drivers'], ['truck', 'Trucks']].map(([v, l]) => (<button key={v} className={mode === v ? 'on' : ''} onClick={() => { setMode(v); setQ('') }}>{l}</button>))}
        </div>
      </div>
      <div className="content" style={{ maxWidth: 760 }}>
        <div className="controls"><div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${mode}…`} /></div></div>
        {list.length === 0 ? <Empty title="Nothing yet">Trips will appear here once deliveries are recorded.</Empty> : (
          <div className="clist">
            {list.map(x => (
              <div className="crow" key={x.name}>
                <div className="crow-head" onClick={() => nav(`/fleet/history/${mode}/${encodeURIComponent(x.name)}`)}>
                  <div className="crow-desc"><div className="d">{mode === 'truck' ? '' : ''}{x.name}</div><div className="m">{x.trips} trip{x.trips === 1 ? '' : 's'}</div></div>
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
