import { useEffect, useState } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useToast } from '../components/ui'
import { WO_STATUS, PRIORITY, DURATION, nextActions, fmtDate } from '../lib/format'

export default function Triage() {
  const { show, node } = useToast()
  const [complaints, setComplaints] = useState([])
  const [refs, setRefs] = useState({ specialties: [], mechanics: [], vendors: [] })
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [c, sp, me, ve] = await Promise.all([
      supabase.from('complaints')
        .select('id,code,description,priority,duration_class,status,reported_at,reporter_name,truck:trucks(plate,fleet_division),driver:drivers(name),mechanic:mechanics(name),work_orders(id,code,status,is_outsourced,sent_date,expected_back_date,required_specialty_id,assigned_mechanic_id,vendor_id,specialty:specialties(label,name),mechanic:mechanics(name,code),vendor:vendors(name))')
        .in('status', ['open', 'in_progress'])
        .order('reported_at', { ascending: true }),
      supabase.from('specialties').select('id,name,label,is_outsourced_default').order('code'),
      supabase.from('mechanics').select('id,code,name').eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
      supabase.from('vendors').select('id,name').eq('status', 'Active').order('name'),
    ])
    if (c.error) show(c.error.message, true)
    setComplaints(c.data || [])
    setRefs({ specialties: sp.data || [], mechanics: me.data || [], vendors: ve.data || [] })
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // ---- work-order mutations -------------------------------------------
  async function patchWO(id, patch, okMsg) {
    const { error } = await supabase.from('work_orders').update(patch).eq('id', id)
    if (error) return show(cleanErr(error.message), true)
    if (okMsg) show(okMsg)
    load()
  }
  async function addWO(complaintId, wo) {
    const { error } = await supabase.from('work_orders').insert({ complaint_id: complaintId, ...wo })
    if (error) return show(cleanErr(error.message), true)
    show('Work order added.')
    load()
  }
  async function closeComplaint(id) {
    const { error } = await supabase.from('complaints')
      .update({ status: 'done', closed_at: new Date().toISOString() }).eq('id', id)
    if (error) return show(error.message, true)
    show('Complaint closed.')
    load()
  }
  async function setComplaintInProgress(id) {
    await supabase.from('complaints').update({ status: 'in_progress' }).eq('id', id)
  }

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Triage & assign</h1></div></div>
      <div className="content"><Spinner label="Loading open complaints…" /></div>
    </>
  )

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Triage & assign</h1>
          <div className="sub">Break complaints into work orders, assign mechanics, or send to a vendor</div>
        </div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <div className="content">
        {complaints.length === 0 ? (
          <Empty title="No open complaints">Nothing to triage. New complaints show up here.</Empty>
        ) : complaints.map(c => (
          <ComplaintCard key={c.id} c={c} refs={refs}
            onPatchWO={patchWO} onAddWO={addWO} onClose={closeComplaint}
            onTouch={() => setComplaintInProgress(c.id)} />
        ))}
      </div>
      {node}
    </>
  )
}

function ComplaintCard({ c, refs, onPatchWO, onAddWO, onClose, onTouch }) {
  const [showAdd, setShowAdd] = useState(false)
  const reporter = c.driver?.name || c.mechanic?.name || c.reporter_name || 'No reporter'
  const wos = c.work_orders || []
  const allDone = wos.length > 0 && wos.every(w => w.status === 'done')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-top">
        <div className="meta">
          <Plate lg>{c.truck?.plate}</Plate>
          <Badge tone={PRIORITY[c.priority]?.tone}>{PRIORITY[c.priority]?.label}</Badge>
          <span className="badge muted"><span className="tick" />{DURATION[c.duration_class] || '—'}</span>
        </div>
        <span className="model">{c.code} · {fmtDate(c.reported_at)}</span>
      </div>
      <div className="card-body">
        <div style={{ fontSize: 14, marginBottom: 4 }}>{c.description}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Reported by {title(reporter)} · {c.truck?.fleet_division}
        </div>

        {wos.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
            No work orders yet. Add the first task below.
          </div>
        )}

        {wos.map(w => (
          <WorkOrderRow key={w.id} w={w} refs={refs} onPatch={onPatchWO} onTouch={onTouch} />
        ))}

        <div className="btn-group" style={{ marginTop: 12 }}>
          <button className="btn ghost sm" onClick={() => setShowAdd(s => !s)}>
            {showAdd ? 'Cancel' : '+ Add work order'}
          </button>
          {allDone && (
            <button className="btn primary sm" onClick={() => onClose(c.id)}>Close complaint</button>
          )}
        </div>

        {showAdd && (
          <AddWorkOrder refs={refs} onAdd={async (wo) => { await onAddWO(c.id, wo); setShowAdd(false) }} />
        )}
      </div>
    </div>
  )
}

function WorkOrderRow({ w, refs, onPatch, onTouch }) {
  const st = WO_STATUS[w.status] || WO_STATUS.unassigned
  const actions = nextActions(w.status)
  const [reassignTo, setReassignTo] = useState('')

  const assignee = w.is_outsourced
    ? `→ ${w.vendor?.name || 'vendor'}`
    : (w.mechanic?.name ? title(w.mechanic.name) : 'Unassigned')

  return (
    <div className="wo-row">
      <div className="l">
        <div className="code">{w.code} · {w.specialty?.label || '—'}</div>
        <div className="who">{assignee}
          {w.is_outsourced && w.expected_back_date && <span className="spec"> · back {w.expected_back_date}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Badge tone={st.tone}>{st.label}</Badge>
        <div className="btn-group">
          {actions.includes('assign') && (
            <AssignPicker mechanics={refs.mechanics}
              onPick={(mid) => onPatch(w.id, { assigned_mechanic_id: mid, status: 'assigned' }, 'Assigned.')} />
          )}
          {actions.includes('start') && (
            <button className="btn primary sm" onClick={async () => { await onTouch(); onPatch(w.id, { status: 'in_progress' }, 'Started.') }}>Start</button>
          )}
          {actions.includes('pause') && (
            <button className="btn ghost sm" onClick={() => onPatch(w.id, { status: 'paused' }, 'Paused.')}>Pause</button>
          )}
          {actions.includes('resume') && (
            <button className="btn primary sm" onClick={() => onPatch(w.id, { status: 'in_progress' }, 'Resumed.')}>Resume</button>
          )}
          {actions.includes('complete') && (
            <button className="btn ghost sm" onClick={() => onPatch(w.id, { status: 'done' }, 'Completed.')}>Complete</button>
          )}
          {actions.includes('return_from_vendor') && (
            <button className="btn primary sm"
              onClick={() => onPatch(w.id, { status: 'done', returned_date: new Date().toISOString().slice(0, 10) }, 'Returned & done.')}>
              Mark returned
            </button>
          )}
          {actions.includes('reassign') && (
            <select className="reassign" value={reassignTo} style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }}
              onChange={e => { const v = e.target.value; setReassignTo(''); if (v) onPatch(w.id, { assigned_mechanic_id: v }, 'Swapped.') }}>
              <option value="">Swap…</option>
              {refs.mechanics.map(m => <option key={m.id} value={m.id}>{title(m.name)}</option>)}
            </select>
          )}
        </div>
      </div>
    </div>
  )
}

function AssignPicker({ mechanics, onPick }) {
  return (
    <select style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }} defaultValue=""
      onChange={e => { if (e.target.value) onPick(e.target.value) }}>
      <option value="">Assign to…</option>
      {mechanics.map(m => <option key={m.id} value={m.id}>{title(m.name)}</option>)}
    </select>
  )
}

function AddWorkOrder({ refs, onAdd }) {
  const [specialtyId, setSpecialtyId] = useState('')
  const [mode, setMode] = useState('in_house') // in_house | outsource
  const [mechanicId, setMechanicId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [sentDate, setSentDate] = useState(new Date().toISOString().slice(0, 10))
  const [backDate, setBackDate] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)

  // when specialty changes, default the mode to its outsource default
  function pickSpecialty(id) {
    setSpecialtyId(id)
    const sp = refs.specialties.find(s => s.id === id)
    if (sp) setMode(sp.is_outsourced_default ? 'outsource' : 'in_house')
  }

  async function submit() {
    setBusy(true)
    const base = {
      required_specialty_id: specialtyId || null,
      description: desc.trim() || null,
    }
    const wo = mode === 'outsource'
      ? { ...base, is_outsourced: true, vendor_id: vendorId || null,
          sent_date: sentDate || null, expected_back_date: backDate || null,
          status: 'awaiting_outsource' }
      : { ...base, is_outsourced: false,
          assigned_mechanic_id: mechanicId || null,
          status: mechanicId ? 'assigned' : 'unassigned' }
    await onAdd(wo)
    setBusy(false)
  }

  return (
    <div className="drawer">
      <h4>New work order</h4>
      <div className="row2">
        <div className="field">
          <label>Specialty</label>
          <select value={specialtyId} onChange={e => pickSpecialty(e.target.value)}>
            <option value="">Select…</option>
            {refs.specialties.map(s => (
              <option key={s.id} value={s.id}>{s.label}{s.is_outsourced_default ? ' (usually outsourced)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Handle</label>
          <div className="seg">
            <button type="button" className={mode === 'in_house' ? 'on' : ''} onClick={() => setMode('in_house')}>In-house</button>
            <button type="button" className={mode === 'outsource' ? 'on' : ''} onClick={() => setMode('outsource')}>Outsource</button>
          </div>
        </div>
      </div>

      {mode === 'in_house' ? (
        <div className="field">
          <label>Mechanic<span className="hint">leave empty to queue as unassigned</span></label>
          <select value={mechanicId} onChange={e => setMechanicId(e.target.value)}>
            <option value="">Unassigned for now</option>
            {refs.mechanics.map(m => <option key={m.id} value={m.id}>{title(m.name)} ({m.code})</option>)}
          </select>
        </div>
      ) : (
        <>
          <div className="field">
            <label>Vendor</label>
            <select value={vendorId} onChange={e => setVendorId(e.target.value)}>
              <option value="">Select vendor…</option>
              {refs.vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="row2">
            <div className="field">
              <label>Sent<span className="hint">optional</span></label>
              <input type="date" value={sentDate} onChange={e => setSentDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Expected back<span className="hint">optional</span></label>
              <input type="date" value={backDate} onChange={e => setBackDate(e.target.value)} />
            </div>
          </div>
        </>
      )}

      <div className="field">
        <label>Note<span className="hint">optional</span></label>
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Detail of this task" />
      </div>

      <button className="btn primary" disabled={busy || !specialtyId} onClick={submit}>
        {busy ? 'Adding…' : 'Add work order'}
      </button>
    </div>
  )
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }

// Turn the raise-exception guard into something readable
function cleanErr(msg) {
  if (/no mechanic assigned/i.test(msg)) return 'Assign a mechanic before starting this work order.'
  return msg
}
