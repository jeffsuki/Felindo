import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const WITH_DO = ['Muat', 'Gantung/Rusak di jalan', 'Bongkar']
const NO_DO = ['Kosong', 'Rusak', 'Gantung']
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const stageRank = s => { const i = [...WITH_DO, ...NO_DO].indexOf(s); return i < 0 ? 99 : i }

export default function FleetHome() {
  const { show, node } = useToast()
  const [trucks, setTrucks] = useState([])
  const [byPlate, setByPlate] = useState({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [divFilter, setDivFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('asc')

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [tr, dl] = await Promise.all([
      supabase.from('trucks').select('id,plate,stage,fleet_division,status').eq('status', 'Active').order('plate'),
      supabase.from('fleet_deliveries').select('plate,driver_name,tanggal,contract:fleet_contracts(origin,destination)')
        .not('driver_name', 'is', null).is('tanggal_bongkar', null),
    ])
    setTrucks(tr.data || [])
    const m = {}; (dl.data || []).forEach(d => { if (d.plate && !m[d.plate]) m[d.plate] = { driver: d.driver_name, tanggal: d.tanggal, route: `${d.contract?.origin || '—'} → ${d.contract?.destination || '—'}` } })
    setByPlate(m); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setStage(id, stage) {
    setTrucks(ts => ts.map(t => t.id === id ? { ...t, stage } : t))
    const { error } = await supabase.from('trucks').update({ stage }).eq('id', id)
    if (error) show(error.message, true)
  }

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    let list = trucks.map(t => {
      const info = byPlate[t.plate]
      const hasDo = !!info
      const opts = hasDo ? WITH_DO : NO_DO
      const stage = opts.includes(t.stage) ? t.stage : opts[0]
      return { ...t, hasDo, opts, stage, driver: info?.driver || '', route: info?.route || '', tanggal: info?.tanggal || null }
    })
    if (divFilter !== 'all') list = list.filter(t => t.fleet_division === divFilter)
    if (s) list = list.filter(t => `${t.plate} ${t.driver}`.toLowerCase().includes(s))
    const dir = sortDir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (sortBy === 'plate') return a.plate.localeCompare(b.plate) * dir
      if (sortBy === 'status') return (stageRank(a.stage) - stageRank(b.stage)) * dir || a.plate.localeCompare(b.plate)
      // date: nulls last regardless of dir
      if (!a.tanggal && !b.tanggal) return a.plate.localeCompare(b.plate)
      if (!a.tanggal) return 1
      if (!b.tanggal) return -1
      return (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0) * dir
    })
    return list
  }, [trucks, byPlate, q, divFilter, sortBy, sortDir])

  function sort(col) { if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortDir('asc') } }
  const arrow = col => sortBy === col ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''

  if (loading) return (<><div className="topbar"><div><h1>Fleet Overview</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Fleet Overview</h1><div className="sub">Set each truck's status · {rows.length} shown</div></div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content" style={{ maxWidth: 1040 }}>
        <div className="controls">
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search plate / driver…" /></div>
          <select value={divFilter} onChange={e => setDivFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All types</option><option value="Tangki">Tangki</option><option value="Gerobak">Gerobak</option>
          </select>
        </div>
        {rows.length === 0 ? <Empty title="No trucks">Add trucks in Master Data.</Empty> : (
          <div className="dk-wrap">
            <table className="dk-tbl ct-tbl fo2">
              <thead><tr>
                <th className="sortable" onClick={() => sort('plate')}>Plate{arrow('plate')}</th>
                <th>Type</th><th>DO</th><th>Driver</th><th>Route</th>
                <th className="sortable" onClick={() => sort('date')}>Tgl DO{arrow('date')}</th>
                <th className="sortable" onClick={() => sort('status')}>Status{arrow('status')}</th>
              </tr></thead>
              <tbody>
                {rows.map(t => (
                  <tr key={t.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{t.plate}</td>
                    <td>{t.fleet_division || '—'}</td>
                    <td>{t.hasDo ? 'Ya' : '—'}</td>
                    <td>{t.driver || '—'}</td>
                    <td className="fo-route">{t.route || '—'}</td>
                    <td>{fmtDate(t.tanggal)}</td>
                    <td>
                      <select value={t.stage} onChange={e => setStage(t.id, e.target.value)} className={'fo-sel s-' + t.stage.split('/')[0].split(' ')[0].toLowerCase()}>
                        {t.opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {node}
    </>
  )
}
