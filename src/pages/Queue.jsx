import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useNow } from '../components/ui'
import { WO_STATUS, fmtDuration } from '../lib/format'

export default function Queue() {
  const [queue, setQueue] = useState([])
  const [mechanics, setMechanics] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState(Date.now())
  const now = useNow(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [q, m] = await Promise.all([
      supabase.from('mechanic_queue').select('*'),
      supabase.from('mechanics').select('id,code,name,can_lift,status')
        .eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
    ])
    setQueue(q.data || [])
    setMechanics(m.data || [])
    setFetchedAt(Date.now())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const byMech = useMemo(() => {
    const map = new Map()
    for (const r of queue) {
      if (!map.has(r.mechanic_id)) map.set(r.mechanic_id, { active: [], parked: [] })
      map.get(r.mechanic_id)[r.queue_bucket === 'active' ? 'active' : 'parked'].push(r)
    }
    return map
  }, [queue])

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Mechanic queue</h1></div></div>
      <div className="content"><Spinner label="Loading queue…" /></div>
    </>
  )

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Mechanic queue</h1>
          <div className="sub">What each mechanic is working now, and what's stacked behind</div>
        </div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content">
        {mechanics.length === 0 ? (
          <Empty title="No active mechanics">Add mechanics in the master data to see the queue.</Empty>
        ) : mechanics.map(m => {
          const q = byMech.get(m.id) || { active: [], parked: [] }
          return (
            <div className="mech" key={m.id}>
              <div className="mech-head">
                <span className="name">{title(m.name)}</span>
                <span className="code">{m.code}</span>
                {m.can_lift && <span className="lift"><Badge tone="accent">Heavy lifting</Badge></span>}
              </div>
              <div className="mech-cols">
                <QueueCol title="Active now" items={q.active} now={now} fetchedAt={fetchedAt} empty="Free — nothing in progress" live />
                <QueueCol title="Parked / queued" items={q.parked} now={now} fetchedAt={fetchedAt} empty="Nothing queued" />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function QueueCol({ title, items, empty, now, fetchedAt, live }) {
  return (
    <div className="mech-col">
      <h4>{title} · {items.length}</h4>
      {items.length === 0
        ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: '4px 0' }}>{empty}</div>
        : items.map(w => {
          const st = WO_STATUS[w.wo_status] || WO_STATUS.assigned
          const secs = live
            ? (w.labor_seconds || 0) + Math.max(0, (now - fetchedAt) / 1000)
            : (w.labor_seconds || 0)
          return (
            <div className="mech-item" key={w.work_order_id}>
              <div>
                <Plate>{w.plate}</Plate>{' '}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{w.specialty || ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={'timer' + (live ? '' : ' static')}>{fmtDuration(secs)}</span>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
            </div>
          )
        })}
    </div>
  )
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
