import { useEffect, useState } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import { VoidControl } from './Complaints'
import { WO_STATUS, PRIORITY, DURATION, nextActions, fmtDate } from '../lib/format'

export default function Triage() {
  const { show, node } = useToast()
  const [complaints, setComplaints] = useState([])
  const [refs, setRefs] = useState({ specialties: [], mechanics: [], vendors: [], drivers: [] })
  const [cView, setCView] = useState('open')   // open | closed | all
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    let cq = supabase.from('complaints')
      .select('id,code,description,priority,duration_class,status,reported_at,reporter_name,truck:trucks(plate,fleet_division),driver:drivers(name),mechanic:mechanics(name),work_orders(id,code,status,description,helper_note,external_assignee,started_at,done_at,voided,is_outsourced,sent_date,expected_back_date,waiting_reason,required_specialty_id,assigned_mechanic_id,vendor_id,specialty:specialties(label,name),mechanic:mechanics(name,code),vendor:vendors(name))')
      .eq('voided', false)
      .order('reported_at', { ascending: true })
    if (cView === 'open') cq = cq.in('status', ['open', 'in_progress'])
    else if (cView === 'closed') cq = cq.eq('status', 'done')
    const [c, sp, me, ve, dr] = await Promise.all([
      cq,
      supabase.from('specialties').select('id,name,label,is_outsourced_default').order('code'),
      supabase.from('mechanics').select('id,code,name').eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
      supabase.from('vendors').select('id,name').eq('status', 'Active').order('name'),
      supabase.from('drivers').select('id,code,name,nickname').eq('status', 'Active').order('name'),
    ])
    if (c.error) show(c.error.message, true)
    setComplaints(c.data || [])
    setRefs({ specialties: sp.data || [], mechanics: me.data || [], vendors: ve.data || [], drivers: dr.data || [] })
    setLoading(false)
  }
  useEffect(() => { load() }, [cView])

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
  async function reopenComplaint(id) {
    const { error } = await supabase.from('complaints')
      .update({ status: 'in_progress', closed_at: null }).eq('id', id)
    if (error) return show(error.message, true)
    show('Complaint reopened.')
    load()
  }
  async function setComplaintInProgress(id) {
    await supabase.from('complaints').update({ status: 'in_progress' }).eq('id', id)
  }

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Sorting Work Orders</h1></div></div>
      <div className="content"><Spinner label="Loading open complaints…" /></div>
    </>
  )

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Sorting Work Orders</h1>
          <div className="sub">Break complaints into work orders, assign mechanics, or send to a vendor</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="seg-lens">
            {[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([v, l]) => (
              <button key={v} className={cView === v ? 'on' : ''} onClick={() => setCView(v)}>{l}</button>
            ))}
          </div>
          <button className="btn ghost" onClick={load}>Refresh</button>
        </div>
      </div>
      <div className="content">
        {complaints.length === 0 ? (
          <Empty title={cView === 'closed' ? 'No closed complaints' : 'No complaints'}>
            {cView === 'open' ? 'Nothing to sort. New complaints show up here.' : 'Nothing in this view.'}
          </Empty>
        ) : (
          <div className="clist">
            {complaints.map((c, i) => (
              <ComplaintCard key={c.id} c={c} refs={refs} defaultOpen={complaints.length <= 3 || i === 0}
                onPatchWO={patchWO} onAddWO={addWO} onClose={closeComplaint}
                onReopen={reopenComplaint}
                onTouch={() => setComplaintInProgress(c.id)} />
            ))}
          </div>
        )}
      </div>
      {node}
    </>
  )
}

function ComplaintCard({ c, refs, onPatchWO, onAddWO, onClose, onReopen, onTouch, defaultOpen }) {
  const [showAdd, setShowAdd] = useState(false)
  const [open, setOpen] = useState(!!defaultOpen)
  const [woView, setWoView] = useState('all')   // all | queue | done
  const reporter = c.driver?.name || c.mechanic?.name || c.reporter_name || 'No reporter'
  const allWos = (c.work_orders || []).filter(w => !w.voided)
  const allDone = allWos.length > 0 && allWos.every(w => w.status === 'done')
  const activeCount = allWos.filter(w => w.status !== 'done').length
  const isClosed = c.status === 'done'
  const wos = allWos.filter(w =>
    woView === 'all' ? true : woView === 'done' ? w.status === 'done' : w.status !== 'done')

  // Rediagnosis: close the task the mechanic reported back on, then open the
  // add-work-order drawer on this same complaint so the real fix can be logged.
  function handleFollowUp(w) {
    if (w.status !== 'done') onPatchWO(w.id, { status: 'done' }, 'Task closed — now add the follow-up.')
    setShowAdd(true)
  }

  return (
    <div className={'crow' + (open ? ' open' : '')}>
      <div className="crow-head" onClick={() => setOpen(o => !o)}>
        <Plate lg>{c.truck?.plate}</Plate>
        <div className="crow-desc">
          <div className="d">{c.description}</div>
          <div className="m">{c.code} · {title(reporter)} · {fmtDate(c.reported_at)}</div>
        </div>
        <div className="crow-meta">
          {isClosed && <Badge tone="ok">Closed</Badge>}
          <Badge tone={PRIORITY[c.priority]?.tone}>{PRIORITY[c.priority]?.label}</Badge>
          <span className="crow-wocount">
            {allWos.length === 0 ? 'no WOs' : `${allWos.length} WO · ${activeCount} open`}
          </span>
        </div>
        <span className="crow-caret">▶</span>
      </div>

      {open && (
        <div className="crow-detail">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{DURATION[c.duration_class] || '—'} · {c.truck?.fleet_division}</span>
            <div className="seg-lens" style={{ marginLeft: 'auto' }}>
              {[['all', 'All'], ['queue', 'In queue'], ['done', 'Done']].map(([v, l]) => (
                <button key={v} className={woView === v ? 'on' : ''} onClick={() => setWoView(v)}>{l}</button>
              ))}
            </div>
          </div>

          {allWos.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
              No work orders yet. Add the first task below.
            </div>
          )}
          {allWos.length > 0 && wos.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
              No {woView === 'done' ? 'done' : 'in-queue'} work orders.
            </div>
          )}

          {wos.map(w => (
            <WorkOrderRow key={w.id} w={w} refs={refs} onPatch={onPatchWO} onTouch={onTouch}
              onFollowUp={handleFollowUp} />
          ))}

          <div className="btn-group" style={{ marginTop: 12 }}>
            <button className="btn ghost sm" onClick={() => setShowAdd(s => !s)}>
              {showAdd ? 'Cancel' : '+ Add work order'}
            </button>
            {isClosed
              ? <button className="btn ghost sm" onClick={() => onReopen(c.id)}>Reopen complaint</button>
              : allDone && <button className="btn primary sm" onClick={() => onClose(c.id)}>Close complaint</button>}
          </div>

          {showAdd && (
            <AddWorkOrder refs={refs} onAdd={async (wo) => { await onAddWO(c.id, wo); setShowAdd(false) }} />
          )}
        </div>
      )}
    </div>
  )
}

function WorkOrderRow({ w, refs, onPatch, onTouch, onFollowUp }) {
  const st = WO_STATUS[w.status] || WO_STATUS.unassigned
  const actions = nextActions(w.status)
  const [reassignTo, setReassignTo] = useState('')
  const [waitMode, setWaitMode] = useState(false)
  const [waitReason, setWaitReason] = useState('')
  const [extMode, setExtMode] = useState(false)
  const [extName, setExtName] = useState('')
  const [extDriverId, setExtDriverId] = useState('')
  const [outMode, setOutMode] = useState(false)
  const [outVendorId, setOutVendorId] = useState('')
  const [outSent, setOutSent] = useState(new Date().toISOString().slice(0, 10))
  const [outBack, setOutBack] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [edDesc, setEdDesc] = useState('')
  const [edSpec, setEdSpec] = useState('')
  const [edStart, setEdStart] = useState('')
  const [edDone, setEdDone] = useState('')

  // Follow-up applies once a mechanic has engaged with the task and reported back
  const canFollowUp = ['in_progress', 'paused', 'awaiting_parts', 'done'].includes(w.status) && !w.is_outsourced
  const canAssign = actions.includes('assign') || actions.includes('reassign')

  const assignee = w.is_outsourced
    ? `→ ${w.vendor?.name || 'vendor'}`
    : (w.mechanic?.name ? title(w.mechanic.name)
      : (w.external_assignee ? `${w.external_assignee} (external)` : 'Unassigned'))

  function saveWait() {
    onPatch(w.id, { status: 'paused', waiting_reason: waitReason.trim() || null }, 'Set to waiting.')
    setWaitMode(false); setWaitReason('')
  }
  function saveExternal() {
    const driver = refs.drivers?.find(d => d.id === extDriverId)
    const name = driver ? title(driver.name) : extName.trim()
    if (!name) { setExtMode(false); return }
    onPatch(w.id, {
      external_assignee: name, assigned_mechanic_id: null,
      status: w.status === 'unassigned' ? 'assigned' : w.status,
    }, `Assigned to ${name}.`)
    setExtMode(false); setExtName(''); setExtDriverId('')
  }
  function saveOutsource() {
    onPatch(w.id, {
      is_outsourced: true,
      vendor_id: outVendorId || null,
      sent_date: outSent || null,
      expected_back_date: outBack || null,
      status: 'awaiting_outsource',
      assigned_mechanic_id: null,
      external_assignee: null,
      waiting_reason: null,
    }, 'Sent to vendor.')
    setOutMode(false)
  }
  function openEdit() {
    setEdDesc(w.description || ''); setEdSpec(w.required_specialty_id || '')
    setEdStart(toLocalInput(w.started_at)); setEdDone(toLocalInput(w.done_at))
    setEditMode(true)
  }
  function saveEdit() {
    const patch = {
      description: edDesc.trim() || null,
      required_specialty_id: edSpec || null,
      started_at: fromLocalInput(edStart),
    }
    if (w.status === 'done') patch.done_at = fromLocalInput(edDone)
    onPatch(w.id, patch, 'Work order updated.')
    setEditMode(false)
  }

  return (
    <div className="wo-row">
      <div className="l">
        <div className="who" style={{ fontWeight: 600 }}>{w.description || w.specialty?.label || 'Work order'}</div>
        <div className="code">{assignee} · {w.specialty?.label || '—'} · {w.code}
          {w.is_outsourced && w.expected_back_date && <span> · back {w.expected_back_date}</span>}
          {w.status === 'paused' && w.waiting_reason &&
            <span style={{ color: '#7A5AA6' }}> · waiting: {w.waiting_reason}</span>}
          {w.helper_note && <span className="helper-inline"> · helped by {w.helper_note}</span>}
        </div>
        {waitMode && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input autoFocus value={waitReason} onChange={e => setWaitReason(e.target.value)}
              placeholder="Why is it waiting? (e.g. nunggu part dari Medan)"
              style={{ fontSize: 13, padding: '6px 9px' }}
              onKeyDown={e => e.key === 'Enter' && saveWait()} />
            <button className="btn primary sm" onClick={saveWait}>Set waiting</button>
            <button className="btn ghost sm" onClick={() => { setWaitMode(false); setWaitReason('') }}>Cancel</button>
          </div>
        )}
        {extMode && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Pick a driver, or type another name:</div>
            <SearchSelect value={extDriverId} onChange={id => { setExtDriverId(id); setExtName('') }}
              placeholder="Search driver..."
              options={(refs.drivers || []).map(d => ({ value: d.id, label: d.nickname ? `${title(d.name)} (${d.nickname})` : title(d.name), sub: d.code, search: d.nickname || '' }))} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={extName} onChange={e => { setExtName(e.target.value); setExtDriverId('') }}
                placeholder="or type any other name" style={{ fontSize: 13, padding: '6px 9px' }}
                onKeyDown={e => e.key === 'Enter' && saveExternal()} />
              <button className="btn primary sm" onClick={saveExternal}>Assign</button>
              <button className="btn ghost sm" onClick={() => { setExtMode(false); setExtName(''); setExtDriverId('') }}>Cancel</button>
            </div>
          </div>
        )}
        {outMode && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Send this job to a vendor:</div>
            <SearchSelect value={outVendorId} onChange={setOutVendorId} placeholder="Search vendor..."
              options={(refs.vendors || []).map(v => ({ value: v.id, label: v.name }))} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: 'var(--muted)' }}>Sent
                <input type="date" value={outSent} onChange={e => setOutSent(e.target.value)} style={{ fontSize: 13, padding: '5px 7px' }} /></label>
              <label style={{ fontSize: 11, color: 'var(--muted)' }}>Back
                <input type="date" value={outBack} onChange={e => setOutBack(e.target.value)} style={{ fontSize: 13, padding: '5px 7px' }} /></label>
              <button className="btn primary sm" onClick={saveOutsource}>Send</button>
              <button className="btn ghost sm" onClick={() => setOutMode(false)}>Cancel</button>
            </div>
          </div>
        )}
        {editMode && (
          <div className="wo-editpanel">
            <div className="field" style={{ margin: 0 }}>
              <label>What needs doing</label>
              <input value={edDesc} onChange={e => setEdDesc(e.target.value)} placeholder="e.g. ganti kampas kopling" />
            </div>
            <div className="row2">
              <div className="field" style={{ margin: 0 }}>
                <label>Specialty</label>
                <select value={edSpec} onChange={e => setEdSpec(e.target.value)}>
                  <option value="">Unspecified</option>
                  {refs.specialties.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Started</label>
                <input type="datetime-local" value={edStart} onChange={e => setEdStart(e.target.value)} />
              </div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Ended{w.status !== 'done' && <span className="hint">only saved once the job is done</span>}</label>
              <input type="datetime-local" value={edDone} onChange={e => setEdDone(e.target.value)} disabled={w.status !== 'done'} />
            </div>
            <div className="btn-group">
              <button className="btn primary sm" onClick={saveEdit}>Save</button>
              <button className="btn ghost sm" onClick={() => setEditMode(false)}>Cancel</button>
              <VoidControl label="Void work order" onVoid={() => onPatch(w.id, { voided: true }, 'Work order voided.')} />
            </div>
          </div>
        )}
        {!w.is_outsourced && (
          <div className="wo-helper">
            <span>Helped by:</span>
            <input defaultValue={w.helper_note || ''} placeholder="others who helped (optional)"
              onBlur={e => { const v = e.target.value.trim(); if (v !== (w.helper_note || '')) onPatch(w.id, { helper_note: v || null }, 'Saved.') }} />
          </div>
        )}
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
          {actions.includes('wait') && !waitMode && (
            <button className="btn ghost sm" onClick={() => setWaitMode(true)}>Wait…</button>
          )}
          {actions.includes('resume') && (
            <button className="btn primary sm" onClick={() => onPatch(w.id, { status: 'in_progress', waiting_reason: null }, 'Resumed.')}>Resume</button>
          )}
          {actions.includes('complete') && (
            <button className="btn ghost sm" onClick={() => onPatch(w.id, { status: 'done', waiting_reason: null }, 'Completed.')}>Complete</button>
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
          {actions.includes('unassign') && (
            <button className="btn ghost sm" title="Send back to the unassigned pool"
              onClick={() => onPatch(w.id, { assigned_mechanic_id: null, external_assignee: null, status: 'unassigned', waiting_reason: null, helper_note: null }, 'Unassigned.')}>
              Unassign
            </button>
          )}
          {canAssign && !extMode && (
            <button className="btn ghost sm" title="Assign to a driver or other person not in the mechanics list"
              onClick={() => { setExtMode(true); setOutMode(false) }}>Other…</button>
          )}
          {actions.includes('outsource') && !outMode && (
            <button className="btn ghost sm" title="Send this job out to a vendor"
              onClick={() => { setOutMode(true); setExtMode(false) }}>Outsource…</button>
          )}
          {!editMode && (
            <button className="btn ghost sm" title="Edit this work order" onClick={openEdit}>Edit</button>
          )}
          {canFollowUp && (
            <button className="btn ghost sm" title="Close this task and add the real fix on the same complaint"
              onClick={() => onFollowUp(w)}>
              {w.status === 'done' ? '+ Follow-up' : 'Done + follow-up'}
            </button>
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
  const [helper, setHelper] = useState('')
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
      helper_note: helper.trim() || null,
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
      <div className="field">
        <label>What needs doing<span className="hint">shown as the job's title everywhere</span></label>
        <input autoFocus value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="e.g. ganti kampas kopling" />
      </div>
      <div className="field">
        <label>Helped by<span className="hint">optional — e.g. driver opened the tires</span></label>
        <input value={helper} onChange={e => setHelper(e.target.value)} placeholder="Who helped, if anyone" />
      </div>
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

      <button className="btn primary" disabled={busy || !specialtyId} onClick={submit}>
        {busy ? 'Adding…' : 'Add work order'}
      </button>
    </div>
  )
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso); const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null }

// Turn the raise-exception guard into something readable
function cleanErr(msg) {
  if (/no mechanic assigned/i.test(msg)) return 'Assign a mechanic before starting this work order.'
  return msg
}
