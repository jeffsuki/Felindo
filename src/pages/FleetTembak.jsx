import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'

const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Number(n).toLocaleString()
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const susutOf = d => (d.muatan != null && d.bongkar != null) ? Number(d.muatan) - Number(d.bongkar) : null
const isReady = d => d.muatan != null && d.bongkar != null
const qualifies = d => {
  const s = susutOf(d); const tol = d.contract?.susut_tolerance
  if (s == null || tol == null) return null
  return s <= Number(tol) * Number(d.muatan)
}

export default function FleetTembak() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('outstanding')   // outstanding | released
  const [openDriver, setOpenDriver] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [amt, setAmt] = useState({})

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('fleet_deliveries')
      .select('id,do_no,tanggal,plate,driver_name,muatan,bongkar,tembak_amount,tembak_released,tembak_released_date,contract:fleet_contracts(control_no,origin,destination,susut_tolerance)')
      .not('driver_name', 'is', null)
      .order('tanggal', { ascending: false, nullsFirst: false })
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const groups = useMemo(() => {
    const want = view === 'released'
    const m = new Map()
    for (const d of rows) {
      if (!d.driver_name) continue
      if (!!d.tembak_released !== want) continue
      if (!m.has(d.driver_name)) m.set(d.driver_name, [])
      m.get(d.driver_name).push(d)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, view])

  function toggleSel(id) { setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function releaseSelected(trips) {
    const ids = trips.filter(d => sel.has(d.id)).map(d => d.id)
    if (ids.length === 0) return show('Select at least one ready trip.', true)
    const today = new Date().toISOString().slice(0, 10)
    for (const id of ids) {
      const a = amt[id] === undefined || amt[id] === '' ? (rows.find(r => r.id === id)?.tembak_amount ?? 0) : Number(amt[id])
      const { error } = await supabase.from('fleet_deliveries').update({ tembak_released: true, tembak_released_date: today, tembak_amount: a }).eq('id', id)
      if (error) return show(error.message, true)
    }
    show(`Released ${ids.length} uang tembak.`)
    setSel(new Set()); load()
  }

  if (loading) return (<><div className="topbar"><div><h1>Uang Tembak</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Uang Tembak</h1><div className="sub">Per-trip bonus — released when the driver returns</div></div>
        <div className="seg-lens">
          {[['outstanding', 'Outstanding'], ['released', 'Released']].map(([v, l]) => (<button key={v} className={view === v ? 'on' : ''} onClick={() => { setView(v); setOpenDriver(null) }}>{l}</button>))}
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1080 }}>
        {groups.length === 0 ? (
          <Empty title={view === 'released' ? 'Nothing released yet' : 'No outstanding tembak'}>
            {view === 'released' ? 'Released bonuses will show here.' : 'Trips earn uang tembak once a driver is assigned.'}
          </Empty>
        ) : (
          <div className="clist">
            {groups.map(([driver, trips]) => {
              const ready = trips.filter(isReady).length
              const pending = trips.length - ready
              const isOpen = openDriver === driver
              const relTotal = trips.reduce((a, d) => a + Number(d.tembak_amount || 0), 0)
              return (
                <div className={'crow' + (isOpen ? ' open' : '')} key={driver}>
                  <div className="crow-head" onClick={() => setOpenDriver(isOpen ? null : driver)}>
                    <div className="crow-desc">
                      <div className="d">{driver}</div>
                      <div className="m">{view === 'released'
                        ? `${trips.length} released · ${rp(relTotal)}`
                        : `${trips.length} outstanding · ${ready} ready${pending ? ` · ${pending} pending` : ''}`}</div>
                    </div>
                    <span className="crow-caret">▶</span>
                  </div>
                  {isOpen && (
                    <div className="crow-detail">
                      <div className="dk-wrap">
                        <table className="dk-tbl ct-tbl">
                          <thead><tr>
                            {view === 'outstanding' && <th style={{ width: 34 }}></th>}
                            <th>Date</th><th>Plate</th><th>Route</th><th className="r">Muatan</th><th className="r">Susut</th>
                            <th>Qualifies</th><th>Status</th><th className="r">Amount</th>
                            {view === 'released' && <th>Released</th>}
                          </tr></thead>
                          <tbody>
                            {trips.map(d => {
                              const s = susutOf(d); const q = qualifies(d); const ready1 = isReady(d)
                              return (
                                <tr key={d.id}>
                                  {view === 'outstanding' && <td>{ready1 && <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggleSel(d.id)} />}</td>}
                                  <td>{fmtDate(d.tanggal)}</td>
                                  <td className="mono">{d.plate || '—'}</td>
                                  <td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td>
                                  <td className="r mono">{d.muatan != null ? Number(d.muatan).toLocaleString() : '—'}</td>
                                  <td className="r mono">{s != null ? s.toLocaleString() : '—'}</td>
                                  <td>{q == null ? '—' : q ? <Badge tone="ok">Yes</Badge> : <Badge tone="urgent">No</Badge>}</td>
                                  <td>{view === 'released' ? <Badge tone="ok">Released</Badge> : ready1 ? <Badge tone="accent">Ready</Badge> : <Badge tone="muted">Pending</Badge>}</td>
                                  <td className="r">
                                    {view === 'released'
                                      ? <span className="mono">{rp(d.tembak_amount)}</span>
                                      : ready1
                                        ? <input type="number" style={{ width: 110, textAlign: 'right' }} placeholder="amount"
                                            value={amt[d.id] ?? (d.tembak_amount ?? '')} onChange={e => setAmt(a => ({ ...a, [d.id]: e.target.value }))} />
                                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                                  </td>
                                  {view === 'released' && <td>{fmtDate(d.tembak_released_date)}</td>}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      {view === 'outstanding' && (
                        <div className="btn-group" style={{ marginTop: 12 }}>
                          <button className="btn primary sm" onClick={() => releaseSelected(trips)}>Release selected ({trips.filter(d => sel.has(d.id)).length})</button>
                          <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>Only “ready” trips (muatan filled) can be released.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {node}
    </>
  )
}
