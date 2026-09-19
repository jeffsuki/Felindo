import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

// Fixed kanban columns. Flow chosen by whether the truck has an active DO.
const WITH_DO = ['Muat', 'Gantung/Rusak di jalan', 'Bongkar']
const NO_DO = ['Kosong', 'Rusak', 'Gantung']

export default function FleetHome() {
  const { show, node } = useToast()
  const [trucks, setTrucks] = useState([])
  const [byPlate, setByPlate] = useState({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const dragId = useRef(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [tr, dl] = await Promise.all([
      supabase.from('trucks').select('id,plate,stage,fleet_division,status').eq('status', 'Active').order('plate'),
      supabase.from('fleet_deliveries').select('plate,driver_name,contract:fleet_contracts(origin,destination)')
        .not('driver_name', 'is', null).is('tanggal_bongkar', null),
    ])
    setTrucks(tr.data || [])
    const m = {}; (dl.data || []).forEach(d => { if (d.plate && !m[d.plate]) m[d.plate] = { driver: d.driver_name, route: `${d.contract?.origin || '—'} → ${d.contract?.destination || '—'}` } })
    setByPlate(m); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setStage(id, stage) {
    setTrucks(ts => ts.map(t => t.id === id ? { ...t, stage } : t))
    const { error } = await supabase.from('trucks').update({ stage }).eq('id', id)
    if (error) show(error.message, true)
  }

  const placed = useMemo(() => {
    const s = q.trim().toLowerCase()
    const withDo = {}; const noDo = {}
    WITH_DO.forEach(c => withDo[c] = []); NO_DO.forEach(c => noDo[c] = [])
    for (const t of trucks) {
      if (s && !(`${t.plate} ${byPlate[t.plate]?.driver || ''}`.toLowerCase().includes(s))) continue
      const hasDo = !!byPlate[t.plate]
      if (hasDo) { const col = WITH_DO.includes(t.stage) ? t.stage : 'Muat'; withDo[col].push(t) }
      else { const col = NO_DO.includes(t.stage) ? t.stage : 'Kosong'; noDo[col].push(t) }
    }
    return { withDo, noDo }
  }, [trucks, byPlate, q])

  if (loading) return (<><div className="topbar"><div><h1>Fleet Overview</h1></div></div><div className="content"><Spinner /></div></>)

  const Card = ({ t }) => {
    const info = byPlate[t.plate]
    return (
      <div className="kb-card" draggable onDragStart={() => { dragId.current = t.id }}>
        <div className="kb-plate">{t.plate}</div>
        {info && <div className="kb-sub">{info.driver}<br />{info.route}</div>}
      </div>
    )
  }
  const Col = ({ name, list }) => {
    const [over, setOver] = useState(false)
    return (
      <div className={'kb-col' + (over ? ' over' : '')}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={() => { setOver(false); if (dragId.current) setStage(dragId.current, name); dragId.current = null }}>
        <div className="kb-col-h">{name}<span>{list.length}</span></div>
        <div className="kb-col-body">{list.map(t => <Card key={t.id} t={t} />)}</div>
      </div>
    )
  }

  return (
    <>
      <div className="topbar">
        <div><h1>Fleet Overview</h1><div className="sub">Drag a truck to set where it is</div></div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content" style={{ maxWidth: 1240 }}>
        <div className="controls"><div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search plate / driver…" /></div></div>
        {trucks.length === 0 ? <Empty title="No trucks">Add trucks in Master Data.</Empty> : (
          <>
            <div className="kb-flow-h">Dengan DO</div>
            <div className="kb-board">{WITH_DO.map(c => <Col key={c} name={c} list={placed.withDo[c]} />)}</div>
            <div className="kb-flow-h" style={{ marginTop: 20 }}>Tanpa DO</div>
            <div className="kb-board">{NO_DO.map(c => <Col key={c} name={c} list={placed.noDo[c]} />)}</div>
          </>
        )}
      </div>
      {node}
    </>
  )
}
