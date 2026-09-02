import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, useToast } from '../components/ui'
import { WO_STATUS, woTitle } from '../lib/format'

export default function Queue() {
  const { show, node } = useToast()
  const [pool, setPool] = useState([])          // unassigned work orders
  const [queue, setQueue] = useState([])        // mechanic_queue rows (current load)
  const [mechanics, setMechanics] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [groupBy, setGroupBy] = useState('truck')  // 'specialty' | 'truck'
  const [openGroups, setOpenGroups] = useState(new Set())
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [wo, q, m] = await Promise.all([
      supabase.from('work_orders')
        .select('id,code,status,description,complaint:complaints(status,truck:trucks(plate)),specialty:specialties(label)')
        .eq('status', 'unassigned').eq('is_outsourced', false).eq('voided', false),
      supabase.from('mechanic_queue').select('*'),
      supabase.from('mechanics').select('id,code,name,nickname,can_lift')
        .eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
    ])
    const openPool = (wo.data || []).filter(w => ['open', 'in_progress'].includes(w.complaint?.status))
    setPool(openPool)
    setQueue(q.data || [])
    setMechanics(m.data || [])
    setSelected(new Set())
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

  function toggle(id) {
    setSelected(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  function toggleGroup(key) {
    setOpenGroups(s => {
      const n = new Set(s)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  async function assignTo(mech) {
    if (selected.size === 0) { show('Select work on the left first.', true); return }
    const ids = [...selected]
    const { error } = await supabase.from('work_orders')
      .update({ assigned_mechanic_id: mech.id, status: 'assigned' }).in('id', ids)
    if (error) return show(error.message, true)
    show(`${ids.length} job${ids.length === 1 ? '' : 's'} \u2192 ${title(mech.name)}.`)
    load()
  }

  async function unassign(workOrderId) {
    const { error } = await supabase.from('work_orders')
      .update({ assigned_mechanic_id: null, external_assignee: null, status: 'unassigned', waiting_reason: null, helper_note: null })
      .eq('id', workOrderId)
    if (error) return show(error.message, true)
    show('Sent back to unassigned.')
    load()
  }

  // group the unassigned pool by specialty or by truck
  const groups = useMemo(() => {
    const m = new Map()
    for (const w of pool) {
      const key = groupBy === 'truck'
        ? (w.complaint?.truck?.plate || '\u2014')
        : (w.specialty?.label || 'Unspecified')
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(w)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [pool, groupBy])

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Mechanic Management</h1></div></div>
      <div className="content"><Spinner label="Loading board\u2026" /></div>
    </>
  )

  const armed = selected.size > 0

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Mechanic Management</h1>
          <div className="sub">Pick unassigned work on the left, then click a mechanic to assign it</div>
        </div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content">
        <div className="board">
          <div className="pool">
            <div className="pool-head">
              <h3>Unassigned</h3>
              <span className="crow-wocount">{pool.length}</span>
              {pool.length > 0 && (
                <div className="seg-lens" style={{ marginLeft: 'auto' }}>
                  <button className={groupBy === 'specialty' ? 'on' : ''} onClick={() => setGroupBy('specialty')}>Specialty</button>
                  <button className={groupBy === 'truck' ? 'on' : ''} onClick={() => setGroupBy('truck')}>Truck</button>
                </div>
              )}
            </div>
            <div className="pool-body">
              {pool.length === 0 ? (
                <div className="pool-hint">Nothing waiting. New work orders created in Sorting Work Orders show up here to distribute.</div>
              ) : (
                <>
                  <div className="pool-hint">
                    {armed ? `${selected.size} selected \u2014 click a mechanic \u2192` : 'Tap jobs to select, then click a mechanic.'}
                  </div>
                  {groups.map(([key, items]) => {
                    const open = openGroups.has(key)
                    const selCount = items.filter(w => selected.has(w.id)).length
                    return (
                      <div key={key} className="pool-group">
                        <div className="pool-group-head clickable" onClick={() => toggleGroup(key)}>
                          <span className="pg-caret">{open ? '\u25be' : '\u25b8'}</span>
                          <span className="pg-key">{key}</span>
                          <span className="pg-count">{items.length}</span>
                          {selCount > 0 && <span className="pg-sel">{selCount} selected</span>}
                        </div>
                        {open && items.map(w => (
                          <div key={w.id} className={'pchip' + (selected.has(w.id) ? ' sel' : '')} onClick={() => toggle(w.id)}>
                            <span className="box">{selected.has(w.id) ? '\u2713' : ''}</span>
                            <div className="pc-main">
                              <div className="pc-spec">{woTitle({ wo_description: w.description, specialty: w.specialty?.label, wo_code: w.code })}</div>
                              <div className="pc-code"><Plate>{w.complaint?.truck?.plate}</Plate> · {w.specialty?.label || '\u2014'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>

          <div>
            <div className="mechs-hint">
              {armed
                ? `${selected.size} job${selected.size === 1 ? '' : 's'} selected \u2014 click any mechanic below to assign.`
                : 'This is the live load per mechanic. Select work at left to start assigning.'}
            </div>
            <div className="mechs-grid">
              {mechanics.map(m => {
                const q = byMech.get(m.id) || { active: [], parked: [] }
                const total = q.active.length + q.parked.length
                return (
                  <div key={m.id} className={'mcard' + (armed ? ' arm' : '')} onClick={() => armed && assignTo(m)}>
                    <div className="mcard-head">
                      <span className="nm">{title(m.name)}</span>
                      <span className="cd">{m.code}</span>
                      {armed
                        ? <span className="assign-cue">Assign here</span>
                        : m.can_lift && <span style={{ marginLeft: 'auto' }}><Badge tone="accent">Lifts</Badge></span>}
                    </div>
                    <div className="mcard-body">
                      {total === 0 ? (
                        <div className="mcard-idle">Free \u2014 no jobs</div>
                      ) : (
                        <>
                          {q.active.map(j => (
                            <div className="mjob act" key={j.work_order_id}>
                              <span className="dotk" />
                              <div className="mjob-main">
                                <div className="mjob-desc">{woTitle(j)}</div>
                                <div className="mjob-sub"><Plate>{j.plate}</Plate> {j.specialty || ''}</div>
                              </div>
                              <span className="mjob-right">
                                <Badge tone="warn">Working</Badge>
                                <button className="unassign-x" title="Send back to unassigned"
                                  onClick={e => { e.stopPropagation(); unassign(j.work_order_id) }}>{'\u2715'}</button>
                              </span>
                            </div>
                          ))}
                          {q.parked.map(j => (
                            <div className="mjob park" key={j.work_order_id}>
                              <span className="dotk" />
                              <div className="mjob-main">
                                <div className="mjob-desc">{woTitle(j)}</div>
                                <div className="mjob-sub">
                                  <Plate>{j.plate}</Plate> {j.specialty || ''}
                                  {j.wo_status === 'paused' && j.waiting_reason ? <span style={{ color: '#7A5AA6' }}> · {j.waiting_reason}</span> : ''}
                                </div>
                              </div>
                              <span className="mjob-right">
                                <span className="mcard-count">{(WO_STATUS[j.wo_status] || {}).label}</span>
                                <button className="unassign-x" title="Send back to unassigned"
                                  onClick={e => { e.stopPropagation(); unassign(j.work_order_id) }}>{'\u2715'}</button>
                              </span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      {node}
    </>
  )
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
