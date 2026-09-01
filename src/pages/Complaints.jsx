import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Plate, Badge, Spinner, Empty, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import EditableDateTime from '../components/EditableDateTime'
import { checkPassword, gateEnabled } from '../components/Gate'
import { WO_STATUS, DURATION, fmtDate } from '../lib/format'

const FILTERS = [['all', 'All'], ['open', 'Open'], ['done', 'Done']]
const OPEN_SUB = [['all', 'All open'], ['pending', 'Pending'], ['on_process', 'On process']]
const SORTS = [['newest', 'Newest'], ['oldest', 'Oldest'], ['urgent', 'Urgent first']]

export default function Complaints() {
  const { show, node } = useToast()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [refs, setRefs] = useState({ trucks: [], drivers: [], mechanics: [], specialties: [] })
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(params.get('new') === '1')
  const [filter, setFilter] = useState('all')
  const [openSub, setOpenSub] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [byType, setByType] = useState('none')   // none | truck | mechanic | driver
  const [byId, setById] = useState('')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [editing, setEditing] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [c, t, d, m, s] = await Promise.all([
      supabase.from('complaints')
        .select('id,code,description,resolution,status,priority,duration_class,pinned,reported_at,closed_at,reporter_name,reported_by_driver_id,reported_by_mechanic_id,truck:trucks(id,plate,code),driver:drivers(name,nickname),mechanic:mechanics(name,nickname),work_orders(id,status,description,helper_note,voided,assigned_mechanic_id,specialty:specialties(label))')
        .eq('voided', false)
        .order('reported_at', { ascending: false }),
      supabase.from('trucks').select('id,code,plate,fleet_division').eq('status', 'Active').order('plate'),
      supabase.from('drivers').select('id,code,name,nickname').eq('status', 'Active').order('name'),
      supabase.from('mechanics').select('id,code,name,nickname').eq('status', 'Active').order('code'),
      supabase.from('specialties').select('id,label,name,is_outsourced_default').order('code'),
    ])
    setRows(c.data || [])
    setRefs({ trucks: t.data || [], drivers: d.data || [], mechanics: m.data || [], specialties: s.data || [] })
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    const filtered = rows.filter(c => {
      const wos = (c.work_orders || []).filter(w => !w.voided)
      const anyInProcess = wos.some(w => w.status === 'in_progress')
      const isDone = c.status === 'done'
      if (filter === 'done' && !isDone) return false
      if (filter === 'open') {
        if (isDone) return false
        if (openSub === 'pending' && anyInProcess) return false
        if (openSub === 'on_process' && !anyInProcess) return false
      }
      if (byType === 'truck' && byId && c.truck?.id !== byId) return false
      if (byType === 'driver' && byId && c.reported_by_driver_id !== byId) return false
      if (byType === 'mechanic' && byId && !wos.some(w => w.assigned_mechanic_id === byId)) return false
      if (!t) return true
      const who = c.driver?.name || c.mechanic?.name || c.reporter_name || ''
      return `${c.code} ${c.truck?.plate} ${c.truck?.code} ${c.description} ${who}`.toLowerCase().includes(t)
    })
    return filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sortBy === 'urgent') {
        const ap = a.priority === 'urgent' ? 0 : 1, bp = b.priority === 'urgent' ? 0 : 1
        if (ap !== bp) return ap - bp
        return new Date(b.reported_at) - new Date(a.reported_at)
      }
      if (sortBy === 'oldest') return new Date(a.reported_at) - new Date(b.reported_at)
      return new Date(b.reported_at) - new Date(a.reported_at)
    })
  }, [rows, filter, openSub, sortBy, q, byType, byId])

  async function patchComplaint(id, patch, msg) {
    const { error } = await supabase.from('complaints').update(patch).eq('id', id)
    if (error) return show(error.message, true)
    if (msg) show(msg)
    load()
  }
  async function patchWO(id, patch) {
    const { error } = await supabase.from('work_orders').update(patch).eq('id', id)
    if (error) return show(error.message, true)
    load()
  }
  async function togglePin(c) {
    await patchComplaint(c.id, { pinned: !c.pinned })
  }
  async function voidComplaint(id) {
    const { error } = await supabase.from('complaints').update({ voided: true }).eq('id', id)
    if (error) return show(error.message, true)
    show('Complaint voided.')
    setExpanded(null); load()
  }

  async function createComplaint(payload, issues) {
    const { data, error } = await supabase.from('complaints').insert(payload).select('id,code').single()
    if (error) return show(error.message, true)
    const wos = issues.map(i => ({
      complaint_id: data.id, description: i.text.trim(),
      required_specialty_id: i.specialtyId || null, status: 'unassigned', is_outsourced: false,
    }))
    const { error: e2 } = await supabase.from('work_orders').insert(wos)
    if (e2) return show(`Complaint saved, but work orders failed: ${e2.message}`, true)
    show(`${data.code} filed with ${wos.length} work order${wos.length === 1 ? '' : 's'}.`)
    setAdding(false)
    if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }) }
    load()
  }

  if (loading) return (
    <>
      <div className="topbar"><div><h1>Complaints</h1></div></div>
      <div className="content"><Spinner label="Loading complaints..." /></div>
    </>
  )

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Complaints</h1>
          <div className="sub">Every complaint lodged - file new ones, edit, and see what came of them</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(a => !a)}>
          {adding ? 'Cancel' : '+ Add complaint'}
        </button>
      </div>
      <div className="content">
        {adding && <AddComplaint refs={refs} onCreate={createComplaint} onCancel={() => setAdding(false)} />}

        <div className="controls" style={{ marginTop: adding ? 20 : 0 }}>
          <div className="field grow">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by plate, code, problem, or who lodged it..." />
          </div>
          <div className="seg-lens">
            {FILTERS.map(([v, l]) => (
              <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 'auto' }}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </select>
        </div>
        {filter === 'open' && (
          <div className="seg-lens" style={{ marginTop: -8, marginBottom: 16 }}>
            {OPEN_SUB.map(([v, l]) => (
              <button key={v} className={openSub === v ? 'on' : ''} onClick={() => setOpenSub(v)}>{l}</button>
            ))}
          </div>
        )}

        <div className="controls" style={{ marginBottom: 16 }}>
          <div className="seg-lens">
            {[['none', 'All'], ['truck', 'By truck'], ['mechanic', 'By mechanic'], ['driver', 'By driver']].map(([v, l]) => (
              <button key={v} className={byType === v ? 'on' : ''}
                onClick={() => { setByType(v); setById('') }}>{l}</button>
            ))}
          </div>
          {byType !== 'none' && (
            <div className="field grow" style={{ maxWidth: 320 }}>
              {byType === 'truck' && (
                <SS value={byId} onChange={setById} placeholder="Pick a truck..."
                  options={refs.trucks.map(t => ({ value: t.id, label: t.plate, sub: t.code, search: t.code }))} />
              )}
              {byType === 'mechanic' && (
                <SS value={byId} onChange={setById} placeholder="Pick a mechanic..."
                  options={refs.mechanics.map(m => ({ value: m.id, label: m.nickname ? `${title(m.name)} (${m.nickname})` : title(m.name), sub: m.code, search: m.nickname || '' }))} />
              )}
              {byType === 'driver' && (
                <SS value={byId} onChange={setById} placeholder="Pick a driver..."
                  options={refs.drivers.map(d => ({ value: d.id, label: d.nickname ? `${title(d.name)} (${d.nickname})` : title(d.name), sub: d.code, search: d.nickname || '' }))} />
              )}
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <Empty title="No complaints">{q ? 'No matches.' : 'Nothing lodged yet. Add the first complaint above.'}</Empty>
        ) : (
          <div className="clist">
            {visible.map(c => {
              const wos = (c.work_orders || []).filter(w => !w.voided)
              const openCount = wos.filter(w => w.status !== 'done').length
              const who = title(c.driver?.name || c.mechanic?.name || c.reporter_name || 'No reporter')
              const nick = c.driver?.nickname || c.mechanic?.nickname
              const isOpen = expanded === c.id
              return (
                <div className={'crow' + (isOpen ? ' open' : '')} key={c.id}>
                  <div className="crow-head" onClick={() => setExpanded(isOpen ? null : c.id)}>
                    <button className={'pin' + (c.pinned ? ' on' : '')} title={c.pinned ? 'Unpin' : 'Pin to top'}
                      onClick={e => { e.stopPropagation(); togglePin(c) }}>{c.pinned ? '\u2605' : '\u2606'}</button>
                    <Plate lg>{c.truck?.plate}</Plate>
                    <div className="crow-desc">
                      <div className="d">{c.description}</div>
                      {c.resolution && <div className="resolved">→ Resolved: {c.resolution}</div>}
                      <div className="m">{c.code} - {who}{nick ? ` (${nick})` : ''} - {fmtDate(c.reported_at)}</div>
                    </div>
                    <div className="crow-meta">
                      {c.priority === 'urgent' && <Badge tone="urgent">Urgent</Badge>}
                      <Badge tone={c.status === 'done' ? 'ok' : 'warn'}>{c.status === 'done' ? 'Done' : 'Open'}</Badge>
                      <span className="crow-wocount">{wos.length} WO{openCount > 0 ? ` - ${openCount} open` : ''}</span>
                    </div>
                    <span className="crow-caret">{'\u25b6'}</span>
                  </div>
                  {isOpen && (
                    <div className="crow-detail">
                      <div className="dates-panel" style={{ alignItems: 'center' }}>
                        <EditableDateTime label="Recorded" value={c.reported_at}
                          onSave={v => patchComplaint(c.id, { reported_at: v }, 'Saved.')} />
                        <EditableDateTime label="Complaint closed" value={c.closed_at} disabled={c.status !== 'done'}
                          onSave={v => patchComplaint(c.id, { closed_at: v }, 'Saved.')} />
                        <button className="btn ghost sm" style={{ marginLeft: 'auto' }}
                          onClick={() => setEditing(editing === c.id ? null : c.id)}>
                          {editing === c.id ? 'Close edit' : 'Edit complaint'}
                        </button>
                        <VoidControl label="Void complaint" onVoid={() => voidComplaint(c.id)} />
                      </div>

                      {editing === c.id && (
                        <EditComplaint c={c} refs={refs}
                          onSave={async patch => { await patchComplaint(c.id, patch, 'Complaint updated.'); setEditing(null) }}
                          onCancel={() => setEditing(null)} />
                      )}

                      {wos.length === 0
                        ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>No work orders under this complaint.</div>
                        : wos.map(w => {
                          const st = WO_STATUS[w.status] || {}
                          return (
                            <div key={w.id} style={{ padding: '10px 0', borderTop: '1px dashed var(--line-2)' }}>
                              <div className="wo-row" style={{ padding: 0, border: 'none' }}>
                                <div className="l">
                                  <div className="who" style={{ fontWeight: 600 }}>{w.description || w.specialty?.label || 'Work order'}</div>
                                  <div className="code">{w.specialty?.label || '-'}{w.helper_note ? ` - helped by ${w.helper_note}` : ''}</div>
                                </div>
                                <Badge tone={st.tone}>{st.label}</Badge>
                              </div>
                            </div>
                          )
                        })}
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

function EditComplaint({ c, refs, onSave, onCancel }) {
  const initType = c.reported_by_driver_id ? 'driver' : c.reported_by_mechanic_id ? 'mechanic' : c.reporter_name ? 'other' : 'none'
  const [truckId, setTruckId] = useState(c.truck?.id || '')
  const [reporterType, setReporterType] = useState(initType)
  const [driverId, setDriverId] = useState(c.reported_by_driver_id || '')
  const [mechanicId, setMechanicId] = useState(c.reported_by_mechanic_id || '')
  const [reporterName, setReporterName] = useState(c.reporter_name || '')
  const [description, setDescription] = useState(c.description || '')
  const [resolution, setResolution] = useState(c.resolution || '')
  const [priority, setPriority] = useState(c.priority || 'normal')
  const [duration, setDuration] = useState(c.duration_class || '')

  function submit() {
    onSave({
      truck_id: truckId,
      description: description.trim(),
      resolution: resolution.trim() || null,
      priority,
      duration_class: duration || null,
      reported_by_driver_id: reporterType === 'driver' ? (driverId || null) : null,
      reported_by_mechanic_id: reporterType === 'mechanic' ? (mechanicId || null) : null,
      reporter_name: reporterType === 'other' ? (reporterName.trim() || null) : null,
    })
  }

  return (
    <div className="md-edit" style={{ borderRadius: 8, marginBottom: 12 }}>
      <div className="row2">
        <div className="field">
          <label>Truck</label>
          <SS value={truckId} onChange={setTruckId} placeholder="Search truck..."
            options={refs.trucks.map(t => ({ value: t.id, label: t.plate, sub: t.code, search: t.code }))} />
        </div>
        <div className="field">
          <label>Reported by</label>
          <div className="seg" style={{ marginBottom: 8 }}>
            {[['driver', 'Driver'], ['mechanic', 'Mechanic'], ['other', 'Other'], ['none', 'No one']].map(([v, l]) => (
              <button type="button" key={v} className={reporterType === v ? 'on' : ''} onClick={() => setReporterType(v)}>{l}</button>
            ))}
          </div>
          {reporterType === 'driver' &&
            <SS value={driverId} onChange={setDriverId} placeholder="Search driver..."
              options={refs.drivers.map(d => ({ value: d.id, label: d.nickname ? `${title(d.name)} (${d.nickname})` : title(d.name), sub: d.code, search: d.nickname || '' }))} />}
          {reporterType === 'mechanic' &&
            <SS value={mechanicId} onChange={setMechanicId} placeholder="Search mechanic..."
              options={refs.mechanics.map(m => ({ value: m.id, label: m.nickname ? `${title(m.name)} (${m.nickname})` : title(m.name), sub: m.code, search: m.nickname || '' }))} />}
          {reporterType === 'other' &&
            <input value={reporterName} onChange={e => setReporterName(e.target.value)} placeholder="Who reported it" />}
        </div>
      </div>
      <div className="field">
        <label>What's wrong<span className="hint">the reported problem(s)</span></label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label>Resolution<span className="hint">what was actually wrong / done, e.g. ternyata gerdang</span></label>
        <textarea value={resolution} onChange={e => setResolution(e.target.value)} style={{ minHeight: 52 }} />
      </div>
      <div className="row2">
        <div className="field">
          <label>Priority</label>
          <div className="seg">
            {[['urgent', 'Urgent'], ['normal', 'Normal']].map(([v, l]) => (
              <button type="button" key={v} className={priority === v ? 'on' : ''} onClick={() => setPriority(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Expected duration</label>
          <select value={duration} onChange={e => setDuration(e.target.value)}>
            <option value="">- not set -</option>
            {Object.entries(DURATION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="btn-group">
        <button className="btn primary" onClick={submit}>Save changes</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function AddComplaint({ refs, onCreate, onCancel }) {
  const [truckId, setTruckId] = useState('')
  const [reporterType, setReporterType] = useState('driver')
  const [driverId, setDriverId] = useState('')
  const [mechanicId, setMechanicId] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [issues, setIssues] = useState([{ text: '', specialtyId: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const setIssue = (i, key, val) => setIssues(list => list.map((it, idx) => idx === i ? { ...it, [key]: val } : it))
  const addIssue = () => setIssues(list => [...list, { text: '', specialtyId: '' }])
  const removeIssue = (i) => setIssues(list => list.length === 1 ? list : list.filter((_, idx) => idx !== i))

  async function submit() {
    setErr('')
    if (!truckId) return setErr('Pick a truck.')
    const filled = issues.filter(i => i.text.trim())
    if (filled.length === 0) return setErr('Add at least one issue.')
    setBusy(true)
    const payload = {
      truck_id: truckId,
      description: filled.map(i => i.text.trim()).join('; '),
      reported_by_driver_id: reporterType === 'driver' ? (driverId || null) : null,
      reported_by_mechanic_id: reporterType === 'mechanic' ? (mechanicId || null) : null,
      reporter_name: reporterType === 'other' ? (reporterName.trim() || null) : null,
    }
    await onCreate(payload, filled)
    setBusy(false)
  }

  return (
    <div className="form" style={{ maxWidth: 720 }}>
      <div className="row2">
        <div className="field">
          <label>Truck</label>
          <SS options={refs.trucks.map(t => ({ value: t.id, label: t.plate, sub: t.code, search: `${t.code} ${t.fleet_division || ''}` }))}
            value={truckId} onChange={setTruckId} placeholder="Search truck..." />
        </div>
        <div className="field">
          <label>Reported by</label>
          <div className="seg" style={{ marginBottom: 8 }}>
            {[['driver', 'Driver'], ['mechanic', 'Mechanic'], ['other', 'Other'], ['none', 'No one']].map(([v, l]) => (
              <button type="button" key={v} className={reporterType === v ? 'on' : ''} onClick={() => setReporterType(v)}>{l}</button>
            ))}
          </div>
          {reporterType === 'driver' &&
            <SS options={refs.drivers.map(d => ({ value: d.id, label: d.nickname ? `${title(d.name)} (${d.nickname})` : title(d.name), sub: d.code, search: d.nickname || '' }))}
              value={driverId} onChange={setDriverId} placeholder="Search driver..." />}
          {reporterType === 'mechanic' &&
            <SS options={refs.mechanics.map(m => ({ value: m.id, label: m.nickname ? `${title(m.name)} (${m.nickname})` : title(m.name), sub: m.code, search: m.nickname || '' }))}
              value={mechanicId} onChange={setMechanicId} placeholder="Search mechanic..." />}
          {reporterType === 'other' &&
            <input value={reporterName} onChange={e => setReporterName(e.target.value)} placeholder="Who reported it" />}
        </div>
      </div>

      <div className="field">
        <label>What's wrong<span className="hint">one line per problem - each becomes a work order</span></label>
        {issues.map((it, i) => (
          <div className="issue-row" key={i}>
            <input value={it.text} onChange={e => setIssue(i, 'text', e.target.value)}
              placeholder={`Issue ${i + 1} (e.g. kopling geger)`} />
            <select value={it.specialtyId} onChange={e => setIssue(i, 'specialtyId', e.target.value)}>
              <option value="">Specialty (optional)</option>
              {refs.specialties.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button type="button" className="btn ghost sm" onClick={() => removeIssue(i)} disabled={issues.length === 1}>{'\u00d7'}</button>
          </div>
        ))}
        <button type="button" className="btn ghost sm" onClick={addIssue} style={{ marginTop: 6 }}>+ Add issue</button>
      </div>

      {err && <div style={{ color: 'var(--urgent)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div className="btn-group">
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Filing...' : 'File complaint'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function SS(props) { return <SearchSelect {...props} /> }
function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }

// Password-gated void control (curtain, not a lock — see Gate). Reusable.
export function VoidControl({ label, onVoid }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  function confirm() {
    if (!gateEnabled || checkPassword(pw)) { onVoid(); setOpen(false); setPw('') }
    else { setErr(true); setPw('') }
  }
  if (!open) return <button className="btn ghost sm void-btn" onClick={() => { setOpen(true); setErr(false) }}>{label}</button>
  return (
    <div className="void-panel">
      <div className="msg">This hides the entry everywhere but keeps the record. {gateEnabled ? 'Enter the password to confirm.' : 'Confirm to void.'}</div>
      {gateEnabled && (
        <input type="password" autoFocus value={pw} placeholder="Password"
          onChange={e => { setPw(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && confirm()} style={{ width: 160, fontSize: 13, padding: '6px 9px' }} />
      )}
      {err && <span style={{ color: 'var(--urgent)', fontSize: 12 }}>Wrong password</span>}
      <button className="btn sm void-btn" onClick={confirm}>Confirm void</button>
      <button className="btn ghost sm" onClick={() => { setOpen(false); setPw('') }}>Cancel</button>
    </div>
  )
}
