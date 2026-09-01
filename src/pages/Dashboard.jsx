import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useNow } from '../components/ui'
import { WO_STATUS, fmtDuration, woTitle } from '../lib/format'

export default function Dashboard() {
  const [lens, setLens] = useState('truck')   // 'truck' | 'mechanic'
  const [rows, setRows] = useState([])
  const [opStatus, setOpStatus] = useState({})   // truck_id -> operational_status
  const [progress, setProgress] = useState({})   // truck_id -> {done,total}
  const [breakdown, setBreakdown] = useState({}) // truck_id -> {in_process,waiting,at_vendor,queued}
  const [queue, setQueue] = useState([])         // mechanic_queue rows (for mechanic lens)
  const [mechanics, setMechanics] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState(Date.now())
  const now = useNow(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [down, ops, prog, q, m] = await Promise.all([
      supabase.from('trucks_down').select('*').order('reported_at', { ascending: true }),
      supabase.from('truck_operational_status').select('*'),
      supabase.from('truck_service_record')
        .select('truck_id,work_order_id,wo_status,complaint_status')
        .in('complaint_status', ['open', 'in_progress']),
      supabase.from('mechanic_queue').select('*'),
      supabase.from('mechanics').select('id,code,name').eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
    ])
    setRows(down.data || [])
    const map = {}
    ;(ops.data || []).forEach(o => { map[o.truck_id] = o.operational_status })
    setOpStatus(map)
    const pm = {}
    const bd = {}
    ;(prog.data || []).forEach(r => {
      if (!r.work_order_id) return
      if (!pm[r.truck_id]) pm[r.truck_id] = { done: 0, total: 0 }
      pm[r.truck_id].total++
      if (r.wo_status === 'done') pm[r.truck_id].done++
      if (!bd[r.truck_id]) bd[r.truck_id] = { in_process: 0, waiting: 0, at_vendor: 0, queued: 0 }
      const s = r.wo_status
      if (s === 'in_progress') bd[r.truck_id].in_process++
      else if (s === 'paused' || s === 'awaiting_parts') bd[r.truck_id].waiting++
      else if (s === 'awaiting_outsource') bd[r.truck_id].at_vendor++
      else if (s !== 'done') bd[r.truck_id].queued++
    })
    setProgress(pm)
    setBreakdown(bd)
    setQueue(q.data || [])
    setMechanics(m.data || [])
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
      <div className="topbar">
        <div>
          <h1>Shop board</h1>
          <div className="sub">{total} truck{total === 1 ? '' : 's'} down · updated {fmtTime(fetchedAt)}</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="seg-lens">
            <button className={lens === 'truck' ? 'on' : ''} onClick={() => setLens('truck')}>By truck</button>
            <button className={lens === 'mechanic' ? 'on' : ''} onClick={() => setLens('mechanic')}>By mechanic</button>
          </div>
          <button className="btn ghost" onClick={load}>Refresh</button>
        </div>
      </div>
      <div className="content">
        {lens === 'truck' ? (
          total === 0 ? (
            <Empty title="No trucks in the shop">Every truck is operational. File a complaint to open a job.</Empty>
          ) : (
            <>
              <Lane title="In repair" tone="warn" trucks={lanes.in_repair} now={now} fetchedAt={fetchedAt} progress={progress} breakdown={breakdown} />
              <Lane title="At vendor" tone="out" trucks={lanes.awaiting_outsource} now={now} fetchedAt={fetchedAt} progress={progress} breakdown={breakdown} />
            </>
          )
        ) : (
          <MechanicLens queue={queue} mechanics={mechanics} now={now} fetchedAt={fetchedAt} />
        )}
      </div>
    </>
  )
}

function MechanicLens({ queue, mechanics, now, fetchedAt }) {
  const byMech = useMemo(() => {
    const map = new Map()
    for (const r of queue) {
      if (!map.has(r.mechanic_id)) map.set(r.mechanic_id, { active: [], parked: [] })
      map.get(r.mechanic_id)[r.queue_bucket === 'active' ? 'active' : 'parked'].push(r)
    }
    return map
  }, [queue])

  return (
    <div className="grid">
      {mechanics.map(m => {
        const q = byMech.get(m.id) || { active: [], parked: [] }
        const jobs = [...q.active, ...q.parked]
        return (
          <div className="card" key={m.id}>
            <div className="card-top">
              <div className="meta"><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{title(m.name)}</span></div>
              <span className="model">{jobs.length ? `${jobs.length} job${jobs.length === 1 ? '' : 's'}` : 'free'}</span>
            </div>
            <div className="card-body">
              {jobs.length === 0
                ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: '4px 0' }}>Nothing assigned</div>
                : jobs.map(j => {
                  const st = WO_STATUS[j.wo_status] || {}
                  const live = j.wo_status === 'in_progress'
                  const secs = live ? (j.labor_seconds || 0) + Math.max(0, (now - fetchedAt) / 1000) : (j.labor_seconds || 0)
                  return (
                    <div className="wo-row" key={j.work_order_id}>
                      <div className="l">
                        <div className="who" style={{ fontWeight: 600 }}>{woTitle(j)}</div>
                        <div className="code">
                          <Plate>{j.plate}</Plate>{j.specialty ? ` · ${j.specialty}` : ''}
                          {j.wo_status === 'paused' && j.waiting_reason && <span style={{ color: '#7A5AA6' }}> · {j.waiting_reason}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <span className={'timer' + (live ? '' : ' static')}>{fmtDuration(secs)}</span>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )
      })}
    </div>
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

function Lane({ title, tone, trucks, now, fetchedAt, progress, breakdown }) {
  if (!trucks.length) return null
  return (
    <div className="lane">
      <div className="lane-head">
        <h2>{title}</h2>
        <span className="count">{trucks.length}</span>
        <span className="rule" />
      </div>
      <div className="grid">
        {trucks.map(t => <TruckCard key={t.truck_id} t={t} tone={tone} now={now} fetchedAt={fetchedAt} prog={progress[t.truck_id]} bd={breakdown[t.truck_id]} />)}
      </div>
    </div>
  )
}

function TruckCard({ t, now, fetchedAt, prog, bd }) {
  // highest priority among its complaints
  const urgent = t.wos.some(w => w.priority === 'urgent')
  const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0
  return (
    <div className="card">
      <div className="card-top">
        <div className="meta">
          <Plate>{t.plate}</Plate>
          {urgent && <Badge tone="urgent">Urgent</Badge>}
        </div>
        <span className="model">{t.fleet || '—'}</span>
      </div>
      {prog && prog.total > 0 && (
        <div className="progress">
          <div className="progress-bar"><span style={{ width: pct + '%' }} /></div>
          <span className="progress-txt">{prog.done} of {prog.total} done</span>
        </div>
      )}
      {bd && (bd.in_process + bd.waiting + bd.at_vendor + bd.queued) > 0 && (
        <div className="bd-line">
          {bd.in_process > 0 && <span className="bd warn">{bd.in_process} in process</span>}
          {bd.waiting > 0 && <span className="bd wait">{bd.waiting} waiting</span>}
          {bd.at_vendor > 0 && <span className="bd out">{bd.at_vendor} at vendor</span>}
          {bd.queued > 0 && <span className="bd muted">{bd.queued} queued</span>}
        </div>
      )}
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
                <div className="who" style={{ fontWeight: 600 }}>{woTitle(w)}</div>
                <div className="code">
                  {w.is_outsourced ? `→ ${w.vendor_name || 'vendor'}` : (w.mechanic_name || (w.external_assignee ? `${w.external_assignee} (external)` : 'Unassigned'))}
                  {w.specialty ? ` · ${w.specialty}` : ''} · {w.wo_code}
                  {w.wo_status === 'paused' && w.waiting_reason &&
                    <span style={{ color: '#7A5AA6' }}> · {w.waiting_reason}</span>}
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

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
