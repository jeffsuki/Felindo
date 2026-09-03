import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import { WO_STATUS, EVENT_TYPES, fmtDate } from '../lib/format'

const TABS = [['archive', 'Archive'], ['logs', 'Logs']]

export default function History() {
  const [tab, setTab] = useState('archive')
  return (
    <>
      <div className="topbar">
        <div>
          <h1>History</h1>
          <div className="sub">Look back at complaints and their work \u2014 or the day-by-day log</div>
        </div>
        <div className="seg-lens">
          {TABS.map(([v, l]) => (
            <button key={v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="content">
        {tab === 'archive' ? <Archive /> : <Logs />}
      </div>
    </>
  )
}

/* ---------------- Archive: complaints + work orders, filtered ---------------- */
const CATS = [['all', 'All'], ['truck', 'By truck'], ['mechanic', 'By mechanic'], ['driver', 'By driver']]

function Archive() {
  const [cat, setCat] = useState('all')
  const [entityId, setEntityId] = useState('')
  const [from, setFrom] = useState(daysAgo(90))
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState([])
  const [refs, setRefs] = useState({ trucks: [], mechanics: [], drivers: [] })
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    if (!isConfigured) return
    Promise.all([
      supabase.from('trucks').select('id,code,plate').order('plate'),
      supabase.from('mechanics').select('id,code,name,nickname').order('code'),
      supabase.from('drivers').select('id,code,name,nickname').order('name'),
    ]).then(([t, m, d]) => setRefs({ trucks: t.data || [], mechanics: m.data || [], drivers: d.data || [] }))
  }, [])

  useEffect(() => {
    if (!isConfigured) return
    if (cat !== 'all' && !entityId) { setRows([]); return }
    setLoading(true)
    let query = supabase.from('complaints')
      .select('id,code,description,resolution,status,priority,reported_at,closed_at,reporter_name,reported_by_driver_id,truck:trucks(plate,code),driver:drivers(name),mechanic:mechanics(name),work_orders(id,code,status,description,external_assignee,assigned_mechanic_id,specialty:specialties(label),mechanic:mechanics(name),vendor:vendors(name))')
      .eq('voided', false)
      .gte('reported_at', from + 'T00:00:00')
      .lte('reported_at', to + 'T23:59:59')
      .order('reported_at', { ascending: false })
    if (cat === 'truck') query = query.eq('truck_id', entityId)
    if (cat === 'driver') query = query.eq('reported_by_driver_id', entityId)
    query.then(({ data }) => {
      let list = data || []
      if (cat === 'mechanic') {
        list = list.filter(c => (c.work_orders || []).some(w => w.assigned_mechanic_id === entityId))
      }
      setRows(list)
      setLoading(false)
    })
  }, [cat, entityId, from, to])

  const opts = cat === 'truck'
    ? refs.trucks.map(t => ({ value: t.id, label: t.plate, sub: t.code, search: t.code }))
    : cat === 'mechanic'
      ? refs.mechanics.map(m => ({ value: m.id, label: m.nickname ? `${title(m.name)} (${m.nickname})` : title(m.name), sub: m.code, search: m.nickname || '' }))
      : cat === 'driver'
        ? refs.drivers.map(d => ({ value: d.id, label: d.nickname ? `${title(d.name)} (${d.nickname})` : title(d.name), sub: d.code, search: d.nickname || '' }))
        : []

  return (
    <>
      <div className="controls">
        <div className="seg-lens">
          {CATS.map(([v, l]) => (
            <button key={v} className={cat === v ? 'on' : ''} onClick={() => { setCat(v); setEntityId('') }}>{l}</button>
          ))}
        </div>
        {cat !== 'all' && (
          <div className="field grow" style={{ maxWidth: 300 }}>
            <SearchSelect value={entityId} onChange={setEntityId} placeholder={`Pick a ${cat}...`} options={opts} />
          </div>
        )}
        <div className="field"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>

      {cat !== 'all' && !entityId ? (
        <Empty title={`Pick a ${cat}`}>Choose one to see its complaints and work orders in the date range.</Empty>
      ) : loading ? <Spinner label="Loading..." /> : rows.length === 0 ? (
        <Empty title="Nothing in this range">Try a wider date range or a different filter.</Empty>
      ) : (
        <>
          <div className="hist-count">{rows.length} complaint{rows.length === 1 ? '' : 's'}</div>
          <div className="clist">
            {rows.map(c => {
              const wos = c.work_orders || []
              const who = title(c.driver?.name || c.mechanic?.name || c.reporter_name || 'No reporter')
              const isOpen = expanded === c.id
              return (
                <div className={'crow' + (isOpen ? ' open' : '')} key={c.id}>
                  <div className="crow-head" onClick={() => setExpanded(isOpen ? null : c.id)}>
                    <Plate lg>{c.truck?.plate}</Plate>
                    <div className="crow-desc">
                      <div className="d">{c.description}</div>
                      {c.resolution && <div className="resolved">\u2192 Resolved: {c.resolution}</div>}
                      <div className="m">{c.code} \u00b7 {who} \u00b7 {fmtDate(c.reported_at)}</div>
                    </div>
                    <div className="crow-meta">
                      {c.priority === 'urgent' && <Badge tone="urgent">Urgent</Badge>}
                      <Badge tone={c.status === 'done' ? 'ok' : 'warn'}>{c.status === 'done' ? 'Done' : 'Open'}</Badge>
                      <span className="crow-wocount">{wos.length} WO</span>
                    </div>
                    <span className="crow-caret">{'\u25b6'}</span>
                  </div>
                  {isOpen && (
                    <div className="crow-detail">
                      {wos.length === 0
                        ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>No work orders.</div>
                        : wos.map(w => {
                          const st = WO_STATUS[w.status] || {}
                          const who2 = w.mechanic?.name ? title(w.mechanic.name) : (w.external_assignee ? `${w.external_assignee} (external)` : (w.vendor?.name ? `\u2192 ${w.vendor.name}` : 'Unassigned'))
                          return (
                            <div className="wo-row" key={w.id}>
                              <div className="l">
                                <div className="who" style={{ fontWeight: 600 }}>{w.description || w.specialty?.label || 'Work order'}</div>
                                <div className="code">{who2} \u00b7 {w.specialty?.label || '\u2014'} \u00b7 {w.code}</div>
                              </div>
                              <Badge tone={st.tone}>{st.label}</Badge>
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

/* ---------------- Logs: daily event feed ---------------- */
function Logs() {
  const [from, setFrom] = useState(daysAgo(7))
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isConfigured) return
    setLoading(true)
    supabase.from('daily_shop_log').select('*')
      .gte('event_date', from).lte('event_date', to)
      .order('event_at', { ascending: false })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [from, to])

  const byDay = useMemo(() => {
    const m = new Map()
    for (const e of rows) {
      if (!m.has(e.event_date)) m.set(e.event_date, [])
      m.get(e.event_date).push(e)
    }
    return [...m.entries()]
  }, [rows])

  return (
    <>
      <div className="controls">
        <div className="field"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>
      {loading ? <Spinner label="Loading log..." /> : byDay.length === 0 ? (
        <Empty title="Nothing logged">No events in this range \u2014 opens, completions, vendor sends, and closes show here.</Empty>
      ) : byDay.map(([date, events]) => (
        <div className="hist-group" key={date}>
          <div className="hist-head"><span className="title">{fmtDayLabel(date)}</span>
            <div className="right"><span className="model">{events.length} event{events.length === 1 ? '' : 's'}</span></div>
          </div>
          <div className="hist-body">
            {events.map((e, i) => {
              const et = EVENT_TYPES[e.event_type] || { label: e.event_type, tone: 'muted' }
              return (
                <div className="event-row" key={i}>
                  <span className="time">{fmtClock(e.event_at)}</span>
                  <Badge tone={et.tone}>{et.label}</Badge>
                  <span className="txt">
                    <Plate>{e.plate}</Plate> <span style={{ color: 'var(--text-2)', marginLeft: 6 }}>{e.ref_code}</span>
                    {e.actor && <span className="actor"> \u00b7 {title(e.actor)}</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

/* helpers */
function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
function fmtDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtClock(iso) {
  if (!iso) return '\u2014'
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
