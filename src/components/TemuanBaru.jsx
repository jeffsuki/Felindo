import { useState } from 'react'
import { supabase } from '../supabaseClient'
import SearchSelect from './SearchSelect'

// Five-second intake for a finding mid-job ("temuan"): mechanic spots another
// broken part while working. Creates a complaint (reporter = the mechanic) with
// one work order. Defaults to Backlog — the truck is NOT counted as down until
// someone assigns or starts the job (see 0043_backlog.sql).
export default function TemuanBaru({ onSaved, show }) {
  const [open, setOpen] = useState(false)
  const [refs, setRefs] = useState(null)       // { trucks, mechanics } lazy-loaded
  const [truckId, setTruckId] = useState('')
  const [mechId, setMechId] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState('backlog')  // 'backlog' | 'now'
  const [busy, setBusy] = useState(false)

  async function openForm() {
    setOpen(true)
    if (refs) return
    const [t, m] = await Promise.all([
      supabase.from('trucks').select('id,code,plate,fleet_division').eq('status', 'Active').order('plate'),
      supabase.from('mechanics').select('id,name,nickname').eq('status', 'Active').eq('employment_type', 'in_house').order('code'),
    ])
    setRefs({ trucks: t.data || [], mechanics: m.data || [] })
  }

  async function submit() {
    if (!truckId) return show('Pilih truknya.', true)
    if (!text.trim()) return show('Tulis apa yang rusak.', true)
    setBusy(true)
    const { data: cmp, error } = await supabase.from('complaints')
      .insert({ truck_id: truckId, description: text.trim(), reported_by_mechanic_id: mechId || null, backlog: mode === 'backlog' })
      .select('id,code').single()
    if (error) { setBusy(false); return show(error.message, true) }
    const { error: e2 } = await supabase.from('work_orders')
      .insert({ complaint_id: cmp.id, description: text.trim(), status: 'unassigned', is_outsourced: false })
    setBusy(false)
    if (e2) return show(`Temuan tercatat (${cmp.code}) tapi work order gagal: ${e2.message}`, true)
    show(mode === 'backlog' ? `Temuan ${cmp.code} masuk backlog.` : `Temuan ${cmp.code} tercatat.`)
    setText(''); setTruckId(''); setMechId(''); setMode('backlog'); setOpen(false)
    onSaved && onSaved()
  }

  if (!open) return <button className="btn ghost" onClick={openForm}>+ Temuan</button>

  return (
    <div className="temuan-pop">
      <div className="temuan-head">Temuan baru<span>ketemu kerusakan lain saat bekerja</span></div>
      <SearchSelect value={truckId} onChange={setTruckId} placeholder="Truk…"
        options={(refs?.trucks || []).map(t => ({ value: t.id, label: t.plate, sub: t.code, search: t.code }))} />
      <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="Apa yang rusak (mis. seal gerdang rembes)"
        onKeyDown={e => e.key === 'Enter' && submit()} />
      <select value={mechId} onChange={e => setMechId(e.target.value)}>
        <option value="">Dilaporkan oleh… (opsional)</option>
        {(refs?.mechanics || []).map(m => <option key={m.id} value={m.id}>{title(m.name)}{m.nickname ? ` (${m.nickname})` : ''}</option>)}
      </select>
      <div className="seg">
        <button type="button" className={mode === 'backlog' ? 'on' : ''} onClick={() => setMode('backlog')}>Backlog — tunggu part/jadwal</button>
        <button type="button" className={mode === 'now' ? 'on' : ''} onClick={() => setMode('now')}>Kerjakan sekarang</button>
      </div>
      <div className="btn-group">
        <button className="btn primary sm" disabled={busy} onClick={submit}>{busy ? 'Menyimpan…' : 'Catat temuan'}</button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>Batal</button>
      </div>
    </div>
  )
}

function title(s) { return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
