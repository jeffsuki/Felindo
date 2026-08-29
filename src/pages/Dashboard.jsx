import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useNow } from '../components/ui'
import { WO_STATUS, fmtDuration } from '../lib/format'

export default function Dashboard() {
  const [rows, setRows] = useState([])
  const [opStatus, setOpStatus] = useState({})   // truck_id -> operational_status
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState(Date.now())
  const now = useNow(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [down, ops] = await Promise.all([
      supabase.from('trucks_down').select('*').order('reported_at', { ascending: true }),
      supabase.from('truck_operational_status').select('*'),
    ])
    setRows(down.data || [])
    const map = {}
    ;(ops.data || []).forEach(o => { map[o.truck_id] = o.operational_status })
    setOpStatus(map)
    setFetchedAt(Date.now())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Group work-order rows by truck -> complaint
  const trucks = useMemo(() => {
    const byTruck = new Map()
    for (const r of rows) {
      if (!byTruck.has(r.truck_id)) {
        byTruck.set(r.truck_id, {
          truck_id: r.truck_id, plate: r.plate, fleet: r.fleet_division, wos: [],
        })
      }
      byTruck.get(r.truck_id).wos.push(r)
    }
    return [...byTruck.values()]
  }, [rows])

  // Split trucks into lanes by their operational status
  const lanes = useMemo(() => {
    const g = { in_repair: [], awaiting_outsource: [] }
    for (const t of trucks) {
      const st = opStatus[t.truck_id] === 'awaiting_outsource' ? 'awaiting_outsource' : 'in_repair'
      g[st].push(t)
    }
    return g
  }, [trucks, opStatus])

  if (loading) return (
    <>
      <Topbar count={0} onRefresh={load} at={fetchedAt} />
      <div className="content"><Spinner label="Loading shop board…" /></div>
    </>
  )

  const total = trucks.length

  return (
    <>
      <Topbar count={total} onRefresh={load} at={fetchedAt} />
      <div className="content">
        {total === 0 ? (
          <Empty title="No trucks in the shop">Every truck is operational. File a complaint to open a job.</Empty>
        ) : (
          <>
            <Lane title="In repair" tone="warn" trucks={lanes.in_repair} now={now} fetchedAt={fetchedAt} />
            <Lane title="At vendor" tone="out" trucks={lanes.awaiting_outsource} now={now} fetchedAt={fetchedAt} />
          </>
        )}
      </div>
    </>
  )
}

function Topbar({ count, onRefresh, at }) {
  return (
    <div className="topbar">
      <div>
        <h1>Shop board</h1>
        <div className="sub">{count} truck{count === 1 ? '' : 's'} down · updated {fmtTime(at)}</div>
      </div>
      <button className="btn ghost" onClick={onRefresh}>Refresh</button>
    </div>
  )
}

function Lane({ title, tone, trucks, now, fetchedAt }) {
  if (!trucks.length) return null
  return (
    <div className="lane">
      <div className="lane-head">
        <h2>{title}</h2>
        <span className="count">{trucks.length}</span>
        <span className="rule" />
      </div>
      <div className="grid">
        {trucks.map(t => <TruckCard key={t.truck_id} t={t} tone={tone} now={now} fetchedAt={fetchedAt} />)}
      </div>
    </div>
  )
}

function TruckCard({ t, now, fetchedAt }) {
  // highest priority among its complaints
  const urgent = t.wos.some(w => w.priority === 'urgent')
  return (
    <div className="card">
      <div className="card-top">
        <div className="meta">
          <Plate>{t.plate}</Plate>
          {urgent && <Badge tone="urgent">Urgent</Badge>}
        </div>
        <span className="model">{t.fleet || '—'}</span>
      </div>
      <div className="card-body">
        {t.wos.map(w => {
          const st = WO_STATUS[w.wo_status] || WO_STATUS.unassigned
          const live = w.wo_status === 'in_progress'
          const secs = live
            ? (w.labor_seconds || 0) + Math.max(0, (now - fetchedAt) / 1000)
            : (w.labor_seconds || 0)
          return (
            <div className="wo-row" key={w.work_order_id}>
              <div className="l">
                <div className="code">{w.wo_code}</div>
                <div className="who">
                  {w.is_outsourced
                    ? <>→ {w.vendor_name || 'vendor'} <span className="spec">· {w.specialty || ''}</span></>
                    : <>{w.mechanic_name || 'Unassigned'} <span className="spec">· {w.specialty || ''}</span></>}
                </div>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                <Badge tone={st.tone}>{st.label}</Badge>
                {w.is_outsourced
                  ? <span className="timer static">back {w.expected_back_date || '—'}</span>
                  : <span className={'timer' + (live ? '' : ' static')}>{fmtDuration(secs)}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
