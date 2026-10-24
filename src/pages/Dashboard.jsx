import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useToast } from '../components/ui'
import { WO_STATUS, fmtDateShort, fmtAgo, woTitle, waitInfo } from '../lib/format'

export default function Dashboard() {
  const { show, node } = useToast()
  const [lens, setLens] = useState('truck')   // 'truck' | 'mechanic'
  const [rows, setRows] = useState([])
  const [opStatus, setOpStatus] = useState({})   // truck_id -> operational_status
  const [progress, setProgress] = useState({})   // truck_id -> {done,total}
  const [breakdown, setBreakdown] = useState({}) // truck_id -> {in_process,waiting,at_vendor,queued}
  const [ready, setReady] = useState([])         // open complaints whose every WO is done
  const [backlog, setBacklog] = useState([])     // deferred findings (temuan), not counted as down
  const [backlogOpen, setBacklogOpen] = useState(false)
  const [queue, setQueue] = useState([])         // mechanic_queue rows (for mechanic lens)
  const [mechanics, setMechanics] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState(Date.now())

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [down, ops, prog, q, m, bl] = await Promise.all([
      supabase.from('trucks_down').select('*').order('reported_at', { ascending: true }),
      supabase.from('truck_operational_status').select('*'),
      supabase.from('truck_service_record')
        .select('truck_id,plate,complaint_id,complaint_code,complaint_description,work_order_id,wo_status,complaint_status')
        .in('complaint_status', ['open', 'in_progress']),
      supabase.from('mechanic_queue').select('*'),
      supabase.from('mechanics').select('id,code,name').eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
      supabase.from('complaints').select('id,code,description,reported_at,truck:trucks(plate)')
        .eq('voided', false).eq('backlog', true).in('status', ['open', 'in_progress']).order('reported_at', { ascending: true }),
    ])
    setRows(down.data || [])
    const map = {}
    ;(ops.data || []).forEach(o => { map[o.truck_id] = o.operational_status })
    setOpStatus(map)
    const pm = {}
    const bd = {}
    const byComplaint = new Map()
    ;(prog.data || []).forEach(r => {
      // "ready to close": every (non-voided) WO of an open complaint is done
      if (!byComplaint.has(r.complaint_id)) {
        byComplaint.set(r.complaint_id, { id: r.complaint_id, code: r.complaint_code, plate: r.plate, desc: r.complaint_description, total: 0, done: 0 })
      }
      const g = byComplaint.get(r.complaint_id)
      if (!r.work_order_id) return
      g.total++
      if (r.wo_status === 'done') g.done++
      if (!pm[r.truck_id]) pm[r.truck_id] = { done: 0, total: 0 }
      pm[r.truck_id].total++
      if (r.wo_status === 'done') pm[r.truck_id].done++
      if (!bd[r.truck_id]) bd[r.truck_id] = { in_process: 0, waiting: 0, at_vendor: 0, queued: 0 }
      const s = r.wo_status
      if (s === 'in_progress') bd[r.truck_id].in_process++
      else if (s === 'paused') bd[r.truck_id].waiting++
      else if (s === 'awaiting_outsource') bd[r.truck_id].at_vendor++
      else if (s !== 'done') bd[r.truck_id].queued++
    })
    setProgress(pm)
    setBreakdown(bd)
    setReady([...byComplaint.values()].filter(g => g.total > 0 && g.done === g.total))
    setQueue(q.data || [])
    setMechanics(m.data || [])
    setBacklog(bl.data || [])
    setFetchedAt(Date.now())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function workBacklog(id, code) {
    const { error } = await supabase.from('complaints').update({ backlog: false }).eq('id', id)
    if (error) return show(error.message, true)
    show(`${code} kembali ke papan — tinggal assign montirnya.`)
    load()
  }

  async function closeComplaint(id, code) {
    const { error } = await supabase.from('complaints')
      .update({ status: 'done', closed_at: new Date().toISOString() }).eq('id', id)
    if (error) return show(error.message, true)
    show(`${code} closed.`)
    load()
  }

  // Group work-order rows by truck
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

  const total = trucks.length
  const topRight = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div className="seg-lens">
        <button className={lens === 'truck' ? 'on' : ''} onClick={() => setLens('truck')}>By truck</button>
        <button className={lens === 'mechanic' ? 'on' : ''} onClick={() => setLens('mechanic')}>By mechanic</button>
      </div>
      <button className="btn ghost" onClick={load}>Refresh</button>
    </div>
  )

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Shop board</h1>
          <div className="sub">{total} truck{total === 1 ? '' : 's'} down · updated {fmtTime(fetchedAt)}</div>
        </div>
        {!loading && topRight}
      </div>
      <div className="content">
        {loading ? <Spinner label="Loading shop board…" /> : lens === 'truck' ? (
          <>
            {ready.length > 0 && (
              <div className="lane">
                <div className="lane-head">
                  <h2>Ready to close</h2>
                  <span className="count">{ready.length}</span>
                  <span className="rule" />
                </div>
                <div className="ready-list">
                  {ready.map(g => (
                    <div className="ready-row" key={g.id}>
                      <Plate>{g.plate}</Plate>
                      <span className="ready-desc">{g.desc}</span>
                      <span className="ready-meta">{g.code} · {g.total} WO done</span>
                      <button className="btn primary sm" onClick={() => closeComplaint(g.id, g.code)}>Close complaint</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {total === 0 && ready.length === 0 ? (
              <Empty title="No trucks in the shop">Every truck is operational. File a complaint to open a job.</Empty>
            ) : (
              <>
                <Lane title="In repair" tone="warn" trucks={lanes.in_repair} progress={progress} breakdown={breakdown} />
                <Lane title="At vendor" tone="out" trucks={lanes.awaiting_outsource} progress={progress} breakdown={breakdown} />
              </>
            )}
            {backlog.length > 0 && (
              <div className="lane">
                <div className="lane-head backlog-head" onClick={() => setBacklogOpen(o => !o)}>
                  <h2>Backlog — temuan belum dikerjakan</h2>
                  <span className="count">{backlog.length}</span>
                  <span className="bl-caret">{backlogOpen ? '▾' : '▸'}</span>
                  <span className="rule" />
                </div>
                {backlogOpen && (
                  <div className="ready-list">
                    {backlog.map(g => (
                      <div className="ready-row" key={g.id}>
                        <Plate>{g.truck?.plate}</Plate>
                        <span className="ready-desc">{g.description}</span>
                        <span className="ready-meta">{g.code} · {fmtAgo(g.reported_at)}</span>
                        <button className="btn ghost sm" onClick={() => workBacklog(g.id, g.code)}>Kerjakan</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <MechanicLens queue={queue} mechanics={mechanics} />
        )}
      </div>
      {node}
    </>
  )
}

function MechanicLens({ queue, mechanics }) {
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
                : jobs.map(j => (
                  <div className="wo-row" key={j.work_order_id}>
                    <div className="l">
                      <div className="who" style={{ fontWeight: 600 }}>{woTitle(j)}</div>
                      <div className="code">
                        <Plate>{j.plate}</Plate>{j.specialty ? ` · ${j.specialty}` : ''}
                        {j.wo_status === 'paused' && (() => { const wi = waitInfo(j.waiting_reason, j.waiting_expected); return wi && <span className={wi.overdue ? 'wait-note overdue' : 'wait-note'}> · {wi.text}{wi.overdue ? ' — telat' : ''}</span> })()}
                      </div>
                    </div>
                    <WoRight w={{ ...j, wo_status: j.wo_status }} />
                  </div>
                ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Right side of a WO row: status badge + a date-level note (no fake timers —
// jobs here are rarely started/stopped on time, so seconds would lie).
function WoRight({ w }) {
  const st = WO_STATUS[w.wo_status] || WO_STATUS.unassigned
  return (
    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <Badge tone={st.tone}>{st.label}</Badge>
      {w.is_outsourced
        ? <span className="timer static">back {w.expected_back_date || '—'}</span>
        : w.wo_status === 'in_progress' && w.started_at
          ? <span className="timer static">since {fmtDateShort(w.started_at)}</span>
          : null}
    </div>
  )
}

function Lane({ title, trucks, progress, breakdown }) {
  if (!trucks.length) return null
  return (
    <div className="lane">
      <div className="lane-head">
        <h2>{title}</h2>
        <span className="count">{trucks.length}</span>
        <span className="rule" />
      </div>
      <div className="grid">
        {trucks.map(t => <TruckCard key={t.truck_id} t={t} prog={progress[t.truck_id]} bd={breakdown[t.truck_id]} />)}
      </div>
    </div>
  )
}

function TruckCard({ t, prog, bd }) {
  const urgent = t.wos.some(w => w.priority === 'urgent')
  const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0
  const since = t.wos.reduce((a, w) => (!a || (w.reported_at && w.reported_at < a)) ? w.reported_at : a, null)
  return (
    <div className="card">
      <div className="card-top">
        <div className="meta">
          <Plate>{t.plate}</Plate>
          {urgent && <Badge tone="urgent">Urgent</Badge>}
          {since && <span className="down-since">in shop {fmtAgo(since)} · {fmtDateShort(since)}</span>}
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
        {t.wos.map(w => (
          <div className="wo-row" key={w.work_order_id}>
            <div className="l">
              <div className="who" style={{ fontWeight: 600 }}>{woTitle(w)}</div>
              <div className="code">
                {w.is_outsourced ? `→ ${w.vendor_name || 'vendor'}` : (w.mechanic_name || (w.external_assignee ? `${w.external_assignee} (external)` : 'Unassigned'))}
                {w.specialty ? ` · ${w.specialty}` : ''} · {w.wo_code}
                {w.wo_status === 'paused' && (() => { const wi = waitInfo(w.waiting_reason, w.waiting_expected); return wi && <span className={wi.overdue ? 'wait-note overdue' : 'wait-note'}> · {wi.text}{wi.overdue ? ' — telat' : ''}</span> })()}
              </div>
            </div>
            <WoRight w={w} />
          </div>
        ))}
      </div>
    </div>
  )
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
