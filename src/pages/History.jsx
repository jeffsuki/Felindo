import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty } from '../components/ui'
import { WO_STATUS, EVENT_TYPES, fmtDuration, fmtDate, fmtDateShort } from '../lib/format'

const LENSES = [['truck', 'By truck'], ['mechanic', 'By mechanic'], ['day', 'By day']]

export default function History() {
  const [lens, setLens] = useState('truck')
  return (
    <>
      <div className="topbar">
        <div>
          <h1>History</h1>
          <div className="sub">Work done, by truck, by mechanic, or by day</div>
        </div>
        <div className="seg-lens">
          {LENSES.map(([v, l]) => (
            <button key={v} className={lens === v ? 'on' : ''} onClick={() => setLens(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="content">
        {lens === 'truck' && <TruckLens />}
        {lens === 'mechanic' && <MechanicLens />}
        {lens === 'day' && <DayLens />}
      </div>
    </>
  )
}

/* ---------------- Truck service record ---------------- */
function TruckLens() {
  const [trucks, setTrucks] = useState([])
  const [truckId, setTruckId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isConfigured) return
    supabase.from('trucks').select('id,plate,fleet_division,status').order('plate')
      .then(({ data }) => setTrucks(data || []))
  }, [])

  useEffect(() => {
    if (!truckId) { setRows([]); return }
    setLoading(true)
    supabase.from('truck_service_record').select('*').eq('truck_id', truckId)
      .order('reported_at', { ascending: false }).order('wo_code')
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [truckId])

  // group rows -> complaints (a complaint with no WOs still yields one row with null wo)
  const complaints = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.complaint_id)) {
        map.set(r.complaint_id, {
          id: r.complaint_id, code: r.complaint_code, desc: r.complaint_description,
          status: r.complaint_status, reported_at: r.reported_at, closed_at: r.closed_at,
          priority: r.priority, wos: [],
        })
      }
      if (r.work_order_id) map.get(r.complaint_id).wos.push(r)
    }
    return [...map.values()]
  }, [rows])

  const stats = useMemo(() => {
    const totalLabor = rows.reduce((a, r) => a + (r.labor_seconds || 0), 0)
    const lastClosed = complaints.map(c => c.closed_at).filter(Boolean).sort().pop()
    return { complaints: complaints.length, totalLabor, lastClosed }
  }, [rows, complaints])

  return (
    <>
      <div className="controls">
        <div className="field grow">
          <label>Truck</label>
          <select value={truckId} onChange={e => setTruckId(e.target.value)}>
            <option value="">Select a truck…</option>
            {trucks.map(t => (
              <option key={t.id} value={t.id}>
                {t.plate} — {t.fleet_division || 'Truck'}{t.status !== 'Active' ? ` (${t.status})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!truckId ? (
        <Empty title="Pick a truck">Its full repair history — every complaint and work order — shows here.</Empty>
      ) : loading ? <Spinner label="Loading service record…" /> : complaints.length === 0 ? (
        <Empty title="No history yet">This truck has never had a complaint filed.</Empty>
      ) : (
        <>
          <div className="metrics">
            <div className="metric"><div className="k">Complaints</div><div className="v">{stats.complaints}</div></div>
            <div className="metric"><div className="k">Total labor</div><div className="v">{fmtDuration(stats.totalLabor)}</div></div>
            <div className="metric"><div className="k">Last closed</div><div className="v" style={{ fontSize: 16 }}>{stats.lastClosed ? fmtDateShort(stats.lastClosed) : '—'}</div></div>
          </div>

          {complaints.map(c => (
            <div className="hist-group" key={c.id}>
              <div className="hist-head">
                <span className="title">{c.desc}</span>
                <div className="right">
                  <Badge tone={c.status === 'done' ? 'ok' : 'warn'}>{c.status === 'done' ? 'Closed' : 'Open'}</Badge>
                  <span className="model">{c.code} · {fmtDate(c.reported_at)}</span>
                </div>
              </div>
              <div className="hist-body">
                {c.wos.length === 0
                  ? <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>No work orders logged.</div>
                  : c.wos.map(w => {
                    const st = WO_STATUS[w.wo_status] || WO_STATUS.done
                    return (
                      <div className="wo-row" key={w.work_order_id}>
                        <div className="l">
                          <div className="code">{w.wo_code} · {w.specialty || '—'}</div>
                          <div className="who">
                            {w.is_outsourced ? `→ ${w.vendor_name || 'vendor'}` : (w.mechanic_name || 'Unassigned')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {!w.is_outsourced && <span className="timer static">{fmtDuration(w.labor_seconds)}</span>}
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  )
}

/* ---------------- Mechanic work log ---------------- */
function MechanicLens() {
  const [mechanics, setMechanics] = useState([])
  const [mechanicId, setMechanicId] = useState('')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isConfigured) return
    supabase.from('mechanics').select('id,code,name,status').order('code')
      .then(({ data }) => setMechanics(data || []))
  }, [])

  useEffect(() => {
    if (!mechanicId) { setRows([]); return }
    setLoading(true)
    supabase.from('mechanic_work_log').select('*')
      .eq('mechanic_id', mechanicId).gte('work_date', from).lte('work_date', to)
      .order('started_at', { ascending: false })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [mechanicId, from, to])

  const days = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.work_date)) map.set(r.work_date, { date: r.work_date, sessions: [], total: 0 })
      const g = map.get(r.work_date)
      g.sessions.push(r); g.total += r.session_seconds || 0
    }
    return [...map.values()]
  }, [rows])

  const stats = useMemo(() => {
    const totalLabor = rows.reduce((a, r) => a + (r.session_seconds || 0), 0)
    const jobs = new Set(rows.map(r => r.work_order_id)).size
    return { totalLabor, jobs, days: days.length }
  }, [rows, days])

  return (
    <>
      <div className="controls">
        <div className="field grow">
          <label>Mechanic</label>
          <select value={mechanicId} onChange={e => setMechanicId(e.target.value)}>
            <option value="">Select a mechanic…</option>
            {mechanics.map(m => (
              <option key={m.id} value={m.id}>{title(m.name)} ({m.code}){m.status !== 'Active' ? ` · ${m.status}` : ''}</option>
            ))}
          </select>
        </div>
        <div className="field"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>

      {!mechanicId ? (
        <Empty title="Pick a mechanic">Their work sessions, grouped by day, show here.</Empty>
      ) : loading ? <Spinner label="Loading work log…" /> : days.length === 0 ? (
        <Empty title="No sessions in this range">Try a wider date range.</Empty>
      ) : (
        <>
          <div className="metrics">
            <div className="metric"><div className="k">Labor logged</div><div className="v">{fmtDuration(stats.totalLabor)}</div></div>
            <div className="metric"><div className="k">Jobs touched</div><div className="v">{stats.jobs}</div></div>
            <div className="metric"><div className="k">Days worked</div><div className="v">{stats.days}</div></div>
          </div>

          {days.map(d => (
            <div className="hist-group" key={d.date}>
              <div className="hist-head">
                <span className="title">{fmtDayLabel(d.date)}</span>
                <div className="right">
                  <span className="timer static">{fmtDuration(d.total)}</span>
                  <span className="model">{d.sessions.length} session{d.sessions.length === 1 ? '' : 's'}</span>
                </div>
              </div>
              <div className="hist-body">
                {d.sessions.map(s => (
                  <div className="wo-row" key={s.session_id}>
                    <div className="l">
                      <div className="who"><Plate>{s.plate}</Plate> <span className="spec" style={{ marginLeft: 6, color: 'var(--muted)' }}>{s.specialty || ''}</span></div>
                      <div className="code">{s.wo_code}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className={'timer' + (s.running ? '' : ' static')}>{fmtDuration(s.session_seconds)}</span>
                      {s.running && <Badge tone="warn">Running</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  )
}

/* ---------------- Daily shop log ---------------- */
function DayLens() {
  const [date, setDate] = useState(today())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isConfigured) return
    setLoading(true)
    supabase.from('daily_shop_log').select('*').eq('event_date', date)
      .order('event_at', { ascending: true })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [date])

  return (
    <>
      <div className="controls">
        <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      </div>

      {loading ? <Spinner label="Loading day…" /> : rows.length === 0 ? (
        <Empty title="Nothing logged on this day">Pick another date, or check the shop board for today's live work.</Empty>
      ) : (
        <div className="hist-group">
          <div className="hist-head"><span className="title">{fmtDayLabel(date)}</span>
            <div className="right"><span className="model">{rows.length} event{rows.length === 1 ? '' : 's'}</span></div>
          </div>
          <div className="hist-body">
            {rows.map((e, i) => {
              const et = EVENT_TYPES[e.event_type] || { label: e.event_type, tone: 'muted' }
              return (
                <div className="event-row" key={i}>
                  <span className="time">{fmtClock(e.event_at)}</span>
                  <Badge tone={et.tone}>{et.label}</Badge>
                  <span className="txt">
                    <Plate>{e.plate}</Plate> <span style={{ color: 'var(--text-2)', marginLeft: 6 }}>{e.ref_code}</span>
                    {e.actor && <span className="actor"> · {title(e.actor)}</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

/* ---------------- helpers ---------------- */
function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
function fmtDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtClock(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
