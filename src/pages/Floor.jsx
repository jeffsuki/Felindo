import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useToast } from '../components/ui'
import { WO_STATUS, woTitle } from '../lib/format'

// Lean "walk the floor and tick things off" screen: every active job grouped
// by mechanic, with one-tap Start / Done / Waiting. No assigning, no detail.
export default function Floor() {
  const { show, node } = useToast()
  const [queue, setQueue] = useState([])
  const [mechanics, setMechanics] = useState([])
  const [loading, setLoading] = useState(true)
  const [waitFor, setWaitFor] = useState(null)   // work_order_id awaiting a reason
  const [reason, setReason] = useState('')

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [q, m] = await Promise.all([
      supabase.from('mechanic_queue').select('*'),
      supabase.from('mechanics').select('id,code,name')
        .eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
    ])
    setQueue(q.data || [])
    setMechanics(m.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const byMech = useMemo(() => {
    const map = new Map()
    for (const r of queue) {
      if (!map.has(r.mechanic_id)) map.set(r.mechanic_id, [])
      map.get(r.mechanic_id).push(r)
    }
    return map
  }, [queue])

  async function patch(id, patchObj, msg) {
    const { error } = await supabase.from('work_orders').update(patchObj).eq('id', id)
    if (error) return show(error.message, true)
    if (msg) show(msg)
    load()
  }
  function saveWaiting() {
    const id = waitFor
    setWaitFor(null)
    patch(id, { status: 'paused', waiting_reason: reason.trim() || null }, 'Set to waiting.')
    setReason('')
  }

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Floor</h1></div></div>
      <div className="content"><Spinner label="Loading floor\u2026" /></div>
    </>
  )

  const withWork = mechanics.filter(m => (byMech.get(m.id) || []).length > 0)

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Floor</h1>
          <div className="sub">Walk the shop and tap to update \u2014 start, done, or waiting</div>
        </div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content">
        {withWork.length === 0 ? (
          <Empty title="No active jobs">Nothing assigned right now. Assign work on the Assign &amp; queue board.</Empty>
        ) : withWork.map(m => {
          const jobs = byMech.get(m.id) || []
          return (
            <div className="hist-group" key={m.id}>
              <div className="hist-head">
                <span className="title">{title(m.name)}</span>
                <div className="right"><span className="model">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span></div>
              </div>
              <div className="hist-body">
                {jobs.map(j => {
                  const st = WO_STATUS[j.wo_status] || {}
                  const waiting = waitFor === j.work_order_id
                  return (
                    <div className="floor-row" key={j.work_order_id}>
                      <div className="floor-l">
                        <Plate>{j.plate}</Plate>
                        <span className="floor-spec" style={{ fontWeight: 600, color: 'var(--text)' }}>{woTitle(j)}</span>
                        <span className="floor-spec">{j.specialty || ''}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {j.wo_status === 'paused' && j.waiting_reason &&
                          <span className="floor-reason">{j.waiting_reason}</span>}
                      </div>
                      {waiting ? (
                        <div className="floor-wait">
                          <input autoFocus value={reason} onChange={e => setReason(e.target.value)}
                            placeholder="Waiting for\u2026 (optional)"
                            onKeyDown={e => e.key === 'Enter' && saveWaiting()} />
                          <button className="btn primary sm" onClick={saveWaiting}>Set</button>
                          <button className="btn ghost sm" onClick={() => { setWaitFor(null); setReason('') }}>\u00d7</button>
                        </div>
                      ) : (
                        <div className="floor-actions">
                          {(j.wo_status === 'assigned') && (
                            <button className="btn primary sm" onClick={() => patch(j.work_order_id, { status: 'in_progress' }, 'Started.')}>Start</button>
                          )}
                          {(j.wo_status === 'paused' || j.wo_status === 'awaiting_parts') && (
                            <button className="btn primary sm" onClick={() => patch(j.work_order_id, { status: 'in_progress', waiting_reason: null }, 'Resumed.')}>Resume</button>
                          )}
                          {j.wo_status !== 'paused' && j.wo_status !== 'awaiting_parts' && (
                            <button className="btn ghost sm" onClick={() => { setWaitFor(j.work_order_id); setReason('') }}>Waiting</button>
                          )}
                          <button className="btn ghost sm floor-done" onClick={() => patch(j.work_order_id, { status: 'done', waiting_reason: null }, 'Done.')}>Done</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {node}
    </>
  )
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
