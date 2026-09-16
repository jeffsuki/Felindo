import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import { WO_STATUS, woTitle } from '../lib/format'

// Single column: an Unassigned pool (grouped by truck, collapsible) at the top,
// then one section per mechanic showing that mechanic's queue stacked in one
// column. Assign via the per-job mechanic dropdown; Start/Stop, Waiting,
// Outsource, Unassign inline on each job.
export default function Queue() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [mechanics, setMechanics] = useState([])
  const [vendors, setVendors] = useState([])
  const [openGroups, setOpenGroups] = useState(new Set())
  const [vendorFilter, setVendorFilter] = useState('')
  const [pinned, setPinned] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('trs_pinned_trucks') || '[]')) } catch { return new Set() }
  })
  const [loading, setLoading] = useState(true)

  function togglePin(plate) {
    setPinned(s => {
      const n = new Set(s)
      n.has(plate) ? n.delete(plate) : n.add(plate)
      try { localStorage.setItem('trs_pinned_trucks', JSON.stringify([...n])) } catch { /* ignore */ }
      return n
    })
  }

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [wo, me, ve] = await Promise.all([
      supabase.from('work_orders')
        .select('id,code,description,status,waiting_reason,external_assignee,by_driver,assigned_mechanic_id,is_outsourced,sent_date,expected_back_date,vendor:vendors(id,name),specialty:specialties(label),complaint:complaints!inner(id,priority,status,truck:trucks(plate,code))')
        .eq('voided', false).neq('status', 'done'),
      supabase.from('mechanics').select('id,code,name,nickname,can_lift').eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
      supabase.from('vendors').select('id,name').eq('status', 'Active').eq('for_outsource', true).order('name'),
    ])
    const open = (wo.data || []).filter(w => ['open', 'in_progress'].includes(w.complaint?.status))
    setRows(open)
    setMechanics(me.data || [])
    setVendors(ve.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const unassigned = useMemo(() => rows.filter(w => !w.is_outsourced && !w.assigned_mechanic_id && !w.external_assignee && !w.by_driver), [rows])
  const others = useMemo(() => rows.filter(w => !w.is_outsourced && !w.assigned_mechanic_id && (w.external_assignee || w.by_driver)), [rows])
  const atVendor = useMemo(() => rows.filter(w => w.is_outsourced), [rows])
  const byMech = useMemo(() => {
    const m = new Map()
    for (const w of rows) {
      if (w.is_outsourced || !w.assigned_mechanic_id) continue
      if (!m.has(w.assigned_mechanic_id)) m.set(w.assigned_mechanic_id, [])
      m.get(w.assigned_mechanic_id).push(w)
    }
    return m
  }, [rows])

  // unassigned grouped by truck (collapsible)
  const unassignedGroups = useMemo(() => {
    const m = new Map()
    for (const w of unassigned) {
      const key = w.complaint?.truck?.plate || '\u2014'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(w)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [unassigned])

  // which trucks already have work underway (any non-unassigned work order)
  const underRepairPlates = useMemo(() => {
    const s = new Set()
    for (const w of rows) {
      if (w.status !== 'unassigned') {
        const p = w.complaint?.truck?.plate
        if (p) s.add(p)
      }
    }
    return s
  }, [rows])
  const pinnedGroups = useMemo(() => unassignedGroups.filter(([p]) => pinned.has(p)), [unassignedGroups, pinned])
  const uaUnderRepair = useMemo(() => unassignedGroups.filter(([p]) => !pinned.has(p) && underRepairPlates.has(p)), [unassignedGroups, underRepairPlates, pinned])
  const uaNotStarted = useMemo(() => unassignedGroups.filter(([p]) => !pinned.has(p) && !underRepairPlates.has(p)), [unassignedGroups, underRepairPlates, pinned])

  function toggleGroup(k) { setOpenGroups(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n }) }
  async function patch(id, p, msg) {
    const { error } = await supabase.from('work_orders').update(p).eq('id', id)
    if (error) return show(cleanErr(error.message), true)
    if (msg) show(msg)
    load()
  }

  // group at-vendor jobs by vendor (respecting the vendor filter)
  const vendorGroups = useMemo(() => {
    const list = vendorFilter ? atVendor.filter(w => w.vendor?.id === vendorFilter) : atVendor
    const m = new Map()
    for (const w of list) {
      const key = w.vendor?.name || 'No vendor'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(w)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [atVendor, vendorFilter])
  const vendorsInUse = useMemo(() => {
    const seen = new Map()
    for (const w of atVendor) if (w.vendor?.id) seen.set(w.vendor.id, w.vendor.name)
    return [...seen.entries()]
  }, [atVendor])

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Mechanic Management</h1></div></div>
      <div className="content"><Spinner label="Loading board..." /></div>
    </>
  )

  const renderGroups = (groups) => groups.map(([plate, items]) => {
    const open = openGroups.has(plate)
    const isPinned = pinned.has(plate)
    return (
      <div className="pool-group" key={plate}>
        <div className="pool-group-head clickable" onClick={() => toggleGroup(plate)}>
          <span className="pg-caret">{open ? '\u25be' : '\u25b8'}</span>
          <span className="pg-key">{plate}</span>
          <span className="pg-count">{items.length}</span>
          <button className={'pin' + (isPinned ? ' on' : '')} style={{ marginLeft: 'auto', fontSize: 15 }}
            title={isPinned ? 'Unpin' : 'Pin to top'}
            onClick={e => { e.stopPropagation(); togglePin(plate) }}>{isPinned ? '\u2605' : '\u2606'}</button>
        </div>
        {open && items.map(w => (
          <WorkRow key={w.id} w={w} mechanics={mechanics} vendors={vendors} onPatch={patch} showTruck />
        ))}
      </div>
    )
  })

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Mechanic Management</h1>
          <div className="sub">Each mechanic's queue \u2014 assign from the unassigned pool and drive each job</div>
        </div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content" style={{ maxWidth: 1180 }}>
        <div className="board2">

          {/* LEFT: unassigned work, grouped by truck */}
          <div className="mm-col">
            <div className="mm-col-title">Trucks — unassigned work</div>
            <div className="mm-section">
              <div className="mm-section-head">
                <h3>Unassigned</h3><span className="crow-wocount">{unassigned.length}</span>
              </div>
              {unassigned.length === 0 ? (
                <div className="pool-hint" style={{ padding: '8px 2px' }}>Nothing waiting to assign.</div>
              ) : (
                <>
                  {pinnedGroups.length > 0 && (
                    <>
                      <div className="mm-substatus">\u2605 Pinned · {pinnedGroups.length} truck{pinnedGroups.length === 1 ? '' : 's'}</div>
                      {renderGroups(pinnedGroups)}
                    </>
                  )}
                  {uaUnderRepair.length > 0 && (
                    <>
                      <div className="mm-substatus">Undergoing repair · {uaUnderRepair.length} truck{uaUnderRepair.length === 1 ? '' : 's'}</div>
                      {renderGroups(uaUnderRepair)}
                    </>
                  )}
                  {uaNotStarted.length > 0 && (
                    <>
                      <div className="mm-substatus">Not started · {uaNotStarted.length} truck{uaNotStarted.length === 1 ? '' : 's'}</div>
                      {renderGroups(uaNotStarted)}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT: one section per mechanic */}
          <div className="mm-col">
            <div className="mm-col-title">Mechanics — current queue</div>
            {mechanics.map(m => {
              const jobs = byMech.get(m.id) || []
              const active = jobs.filter(j => j.status === 'in_progress').length
              return (
                <div className="mm-section" key={m.id}>
                  <div className="mm-section-head">
                    <h3 className="mech">{title(m.name)}{m.nickname ? ` (${m.nickname})` : ''}</h3>
                    <span className="cd">{m.code}</span>
                    {m.can_lift && <Badge tone="accent">Lifts</Badge>}
                    <span className="crow-wocount" style={{ marginLeft: 'auto' }}>
                      {jobs.length === 0 ? 'free' : `${jobs.length} job${jobs.length === 1 ? '' : 's'}${active ? ` \u00b7 ${active} working` : ''}`}
                    </span>
                  </div>
                  {jobs.length === 0
                    ? <div className="mcard-idle" style={{ padding: '6px 2px' }}>Nothing assigned</div>
                    : (() => {
                      const groups = [
                        ['In process', jobs.filter(j => j.status === 'in_progress')],
                        ['In queue', jobs.filter(j => j.status === 'assigned')],
                        ['Waiting', jobs.filter(j => ['paused', 'awaiting_parts'].includes(j.status))],
                      ].filter(([, arr]) => arr.length > 0)
                      return groups.map(([label, arr]) => (
                        <div key={label}>
                          <div className="mm-substatus">{label} · {arr.length}</div>
                          {arr.map(w => <WorkRow key={w.id} w={w} mechanics={mechanics} vendors={vendors} onPatch={patch} showTruck />)}
                        </div>
                      ))
                    })()}
                </div>
              )
            })}

            {others.length > 0 && (
              <div className="mm-section">
                <div className="mm-section-head"><h3>Others (drivers / external)</h3><span className="crow-wocount">{others.length}</span></div>
                {others.map(w => <WorkRow key={w.id} w={w} mechanics={mechanics} vendors={vendors} onPatch={patch} showTruck />)}
              </div>
            )}
          </div>

        </div>

        {/* At vendor — outsourced jobs, grouped by vendor */}
        <div className="mm-section" style={{ marginTop: 8 }}>
          <div className="mm-section-head">
            <h3>At vendor</h3><span className="crow-wocount">{atVendor.length}</span>
            {vendorsInUse.length > 1 && (
              <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}
                style={{ marginLeft: 'auto', width: 'auto', padding: '5px 8px', fontSize: 12 }}>
                <option value="">All vendors</option>
                {vendorsInUse.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
          </div>
          {atVendor.length === 0 ? (
            <div className="mcard-idle" style={{ padding: '6px 2px' }}>Nothing out at vendors.</div>
          ) : vendorGroups.map(([vname, items]) => (
            <div key={vname} style={{ marginBottom: 6 }}>
              <div className="mm-substatus">{vname} · {items.length}</div>
              {items.map(w => (
                <div className="mm-row" key={w.id}>
                  <div className="mm-top">
                    <div className="mm-l">
                      <div className="who" style={{ fontWeight: 600 }}>{woTitle(w)}</div>
                      <div className="code">
                        <Plate>{w.complaint?.truck?.plate}</Plate> · {w.specialty?.label || '\u2014'} · {w.code}
                        {w.sent_date && <span> · sent {w.sent_date}</span>}
                        {w.expected_back_date && <span> · back {w.expected_back_date}</span>}
                      </div>
                    </div>
                    <Badge tone="out">At vendor</Badge>
                  </div>
                  <div className="mm-actions">
                    <button className="btn primary sm"
                      onClick={() => patch(w.id, { status: 'done', returned_date: new Date().toISOString().slice(0, 10) }, 'Returned & done.')}>
                      Returned — done
                    </button>
                    <button className="btn ghost sm"
                      onClick={() => patch(w.id, { status: 'unassigned', is_outsourced: false, returned_date: new Date().toISOString().slice(0, 10) }, 'Returned — back to shop.')}>
                      Returned — back to shop
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {node}
    </>
  )
}

function WorkRow({ w, mechanics, vendors, onPatch, showTruck }) {
  const st = WO_STATUS[w.status] || {}
  const [waitMode, setWaitMode] = useState(false)
  const [waitReason, setWaitReason] = useState('')
  const [outMode, setOutMode] = useState(false)
  const [outVendorId, setOutVendorId] = useState('')
  const [outSent, setOutSent] = useState(new Date().toISOString().slice(0, 10))
  const [outBack, setOutBack] = useState('')

  const inProgress = w.status === 'in_progress'
  const hasWorker = w.assigned_mechanic_id || w.external_assignee
  const assignedLabel = w.external_assignee ? `${w.external_assignee} (external)` : ''

  function saveWait() {
    onPatch(w.id, { status: 'paused', waiting_reason: waitReason.trim() || null }, 'Set to waiting.')
    setWaitMode(false); setWaitReason('')
  }
  function saveOut() {
    onPatch(w.id, {
      is_outsourced: true, vendor_id: outVendorId || null, sent_date: outSent || null,
      expected_back_date: outBack || null, status: 'awaiting_outsource',
      assigned_mechanic_id: null, external_assignee: null, waiting_reason: null,
    }, 'Sent to vendor.')
    setOutMode(false)
  }

  return (
    <div className="mm-row">
      <div className="mm-top">
        <div className="mm-l">
          <div className="who" style={{ fontWeight: 600 }}>{woTitle(w)}</div>
          <div className="code">
            {showTruck && <><Plate>{w.complaint?.truck?.plate}</Plate> · </>}
            {w.specialty?.label || '\u2014'} · {w.code}
            {w.status === 'paused' && w.waiting_reason && <span style={{ color: '#7A5AA6' }}> · waiting: {w.waiting_reason}</span>}
          </div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      {w.by_driver && <div style={{ marginTop: 4 }}><Badge tone="accent">Done by driver</Badge></div>}
      <div className="mm-actions">
        <select className="mm-mech" value={w.assigned_mechanic_id || ''}
          onChange={e => {
            const v = e.target.value
            if (!v) onPatch(w.id, { assigned_mechanic_id: null, external_assignee: null, status: 'unassigned', waiting_reason: null, helper_note: null }, 'Unassigned.')
            else onPatch(w.id, { assigned_mechanic_id: v, external_assignee: null, status: w.status === 'unassigned' ? 'assigned' : w.status }, 'Assigned.')
          }}>
          <option value="">{assignedLabel || 'Unassigned'}</option>
          {mechanics.map(m => <option key={m.id} value={m.id}>{title(m.name)}{m.nickname ? ` (${m.nickname})` : ''}</option>)}
        </select>

        {inProgress
          ? <button className="btn ghost sm" onClick={() => onPatch(w.id, { status: 'paused', waiting_reason: null }, 'Stopped.')}>Stop</button>
          : <button className="btn primary sm" disabled={!hasWorker} title={hasWorker ? '' : 'Assign a mechanic first'}
              onClick={() => onPatch(w.id, { status: 'in_progress' }, 'Started.')}>Start</button>}

        {!waitMode && <button className="btn ghost sm" onClick={() => { setWaitMode(true); setOutMode(false) }}>Waiting…</button>}
        {!outMode && <button className="btn ghost sm" onClick={() => { setOutMode(true); setWaitMode(false) }}>Outsource…</button>}
      </div>

      {waitMode && (
        <div className="mm-panel">
          <input autoFocus value={waitReason} onChange={e => setWaitReason(e.target.value)}
            placeholder="Waiting for... (e.g. nunggu part, bubutan di luar)"
            onKeyDown={e => e.key === 'Enter' && saveWait()} style={{ fontSize: 13, padding: '6px 9px' }} />
          <button className="btn primary sm" onClick={saveWait}>Set waiting</button>
          <button className="btn ghost sm" onClick={() => setWaitMode(false)}>Cancel</button>
        </div>
      )}
      {outMode && (
        <div className="mm-panel">
          <SearchSelect value={outVendorId} onChange={setOutVendorId} placeholder="Vendor..."
            options={vendors.map(v => ({ value: v.id, label: v.name }))} />
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>Sent<input type="date" value={outSent} onChange={e => setOutSent(e.target.value)} style={{ fontSize: 13, padding: '5px 7px' }} /></label>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>Back<input type="date" value={outBack} onChange={e => setOutBack(e.target.value)} style={{ fontSize: 13, padding: '5px 7px' }} /></label>
          <button className="btn primary sm" onClick={saveOut}>Send</button>
          <button className="btn ghost sm" onClick={() => setOutMode(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
function cleanErr(msg) {
  if (/no mechanic assigned/i.test(msg)) return 'Assign a mechanic before starting this job.'
  return msg
}
