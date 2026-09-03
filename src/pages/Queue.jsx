import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import { WO_STATUS, woTitle } from '../lib/format'

// Single-column, work-order-focused board: jobs grouped by truck (collapsible),
// urgent trucks first. Assign via a mechanic dropdown; Start/Stop, Waiting
// (with a typed reason), Outsource, and Unassign inline on each row.
export default function Queue() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [mechanics, setMechanics] = useState([])
  const [vendors, setVendors] = useState([])
  const [openGroups, setOpenGroups] = useState(new Set())
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [wo, me, ve] = await Promise.all([
      supabase.from('work_orders')
        .select('id,code,description,status,waiting_reason,external_assignee,assigned_mechanic_id,specialty:specialties(label),complaint:complaints!inner(id,priority,status,truck:trucks(plate,code))')
        .eq('is_outsourced', false).eq('voided', false).neq('status', 'done'),
      supabase.from('mechanics').select('id,code,name,nickname').eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
      supabase.from('vendors').select('id,name').eq('status', 'Active').order('name'),
    ])
    const open = (wo.data || []).filter(w => ['open', 'in_progress'].includes(w.complaint?.status))
    setRows(open)
    setMechanics(me.data || [])
    setVendors(ve.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // group by truck plate; urgent trucks (any urgent complaint) first
  const groups = useMemo(() => {
    const m = new Map()
    for (const w of rows) {
      const key = w.complaint?.truck?.plate || '\u2014'
      if (!m.has(key)) m.set(key, { plate: key, code: w.complaint?.truck?.code, urgent: false, items: [] })
      const g = m.get(key)
      g.items.push(w)
      if (w.complaint?.priority === 'urgent') g.urgent = true
    }
    return [...m.values()].sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
      return a.plate.localeCompare(b.plate)
    })
  }, [rows])

  function toggleGroup(key) {
    setOpenGroups(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  async function patch(id, p, msg) {
    const { error } = await supabase.from('work_orders').update(p).eq('id', id)
    if (error) return show(cleanErr(error.message), true)
    if (msg) show(msg)
    load()
  }

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Mechanic Management</h1></div></div>
      <div className="content"><Spinner label="Loading board..." /></div>
    </>
  )

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Mechanic Management</h1>
          <div className="sub">Active work by truck, urgent first \u2014 assign a mechanic and drive each job</div>
        </div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content" style={{ maxWidth: 820 }}>
        {groups.length === 0 ? (
          <Empty title="No active work">Nothing to manage right now. Work orders show up here once complaints are sorted.</Empty>
        ) : (
          <div className="clist">
            {groups.map(g => {
              const open = openGroups.has(g.plate)
              const active = g.items.filter(w => w.status === 'in_progress').length
              return (
                <div className={'crow' + (open ? ' open' : '')} key={g.plate}>
                  <div className="crow-head" onClick={() => toggleGroup(g.plate)}>
                    <span className="crow-caret">{'\u25b6'}</span>
                    <Plate lg>{g.plate}</Plate>
                    <div className="crow-desc"><div className="m">{g.code || ''}</div></div>
                    <div className="crow-meta">
                      {g.urgent && <Badge tone="urgent">Urgent</Badge>}
                      {active > 0 && <Badge tone="warn">{active} working</Badge>}
                      <span className="crow-wocount">{g.items.length} job{g.items.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  {open && (
                    <div className="crow-detail">
                      {g.items.map(w => (
                        <WorkRow key={w.id} w={w} mechanics={mechanics} vendors={vendors} onPatch={patch} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {node}
    </>
  )
}

function WorkRow({ w, mechanics, vendors, onPatch }) {
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
            {w.specialty?.label || '\u2014'} · {w.code}
            {w.status === 'paused' && w.waiting_reason && <span style={{ color: '#7A5AA6' }}> · waiting: {w.waiting_reason}</span>}
          </div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
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
          : <button className="btn primary sm" disabled={!hasWorker}
              title={hasWorker ? '' : 'Assign a mechanic first'}
              onClick={() => onPatch(w.id, { status: 'in_progress' }, 'Started.')}>Start</button>}

        {!waitMode && <button className="btn ghost sm" onClick={() => { setWaitMode(true); setOutMode(false) }}>Waiting…</button>}
        {!outMode && <button className="btn ghost sm" onClick={() => { setOutMode(true); setWaitMode(false) }}>Outsource…</button>}
        {w.status !== 'unassigned' && (
          <button className="btn ghost sm" onClick={() => onPatch(w.id, { assigned_mechanic_id: null, external_assignee: null, status: 'unassigned', waiting_reason: null, helper_note: null }, 'Unassigned.')}>Unassign</button>
        )}
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
