import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'
import { NumInput } from '../components/NumInput'

const NUMF = ['unit_cost']

export default function WarehouseItems() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sys, setSys] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('warehouse_items').select('*').order('sku')
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const systems = useMemo(() => [...new Set(rows.map(r => r.system).filter(Boolean))].sort(), [rows])
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => {
      if (!showInactive && r.status !== 'Active') return false
      if (sys && r.system !== sys) return false
      if (!s) return true
      return `${r.sku} ${r.name} ${r.oem_no || ''} ${r.system || ''} ${r.part_type || ''}`.toLowerCase().includes(s)
    })
  }, [rows, q, sys, showInactive])

  function setCell(id, field, value) { setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r)) }
  async function saveField(id, field, raw) {
    const value = NUMF.includes(field) ? (raw === '' ? null : Number(raw)) : (raw === '' ? (field === 'sku' || field === 'name' ? raw : null) : raw)
    const { error } = await supabase.from('warehouse_items').update({ [field]: value }).eq('id', id)
    if (error) show(error.message, true)
  }
  async function toggleActive(r) {
    setCell(r.id, 'status', r.status === 'Active' ? 'Inactive' : 'Active')
    await supabase.from('warehouse_items').update({ status: r.status === 'Active' ? 'Inactive' : 'Active' }).eq('id', r.id)
  }
  async function addRow() {
    let n = 1; const skus = new Set(rows.map(r => r.sku))
    while (skus.has('NEW-' + String(n).padStart(4, '0'))) n++
    const sku = 'NEW-' + String(n).padStart(4, '0')
    const { data, error } = await supabase.from('warehouse_items').insert({ sku, name: '' }).select('*').single()
    if (error) return show(error.message, true)
    setRows(rs => [data, ...rs])
    setQ(sku)
  }
  async function delRow(id) {
    const { error } = await supabase.from('warehouse_items').delete().eq('id', id)
    if (error) return show(error.message, true)
    setRows(rs => rs.filter(r => r.id !== id))
  }

  if (loading) return (<><div className="topbar"><div><h1>Warehouse items</h1></div></div><div className="content"><Spinner label="Loading items…" /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Warehouse items</h1><div className="sub">Spare-parts master · {rows.length} SKUs · edit cells directly</div></div>
        <button className="btn primary" onClick={addRow}>+ Add item</button>
      </div>
      <div className="content">
        <div className="controls">
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by SKU, name, OEM, type…" /></div>
          <div className="field"><select value={sys} onChange={e => setSys(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All systems</option>{systems.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
          <button className="btn ghost" onClick={() => setShowInactive(v => !v)}>{showInactive ? 'Hide inactive' : 'Show inactive'}</button>
        </div>

        <div className="hist-count">{visible.length} item{visible.length === 1 ? '' : 's'}{!sys && !q.trim() && rows.length > 200 ? ' · tip: filter by system for faster editing' : ''}</div>
        {visible.length === 0 ? <Empty title="No items">{q || sys ? 'No matches.' : 'Add items or run the seed.'}</Empty> : (
          <div className="dk-wrap">
            <table className="dk-tbl wh-grid">
              <thead><tr>
                <th style={{ width: 110 }}>SKU</th><th style={{ width: 240 }}>Name</th><th style={{ width: 150 }}>System</th>
                <th style={{ width: 140 }}>Type</th><th style={{ width: 130 }}>OEM</th><th style={{ width: 110 }}>Unit cost</th>
                <th style={{ width: 130 }}>Behaviour</th><th style={{ width: 130 }}>Scrap cat.</th><th style={{ width: 180 }}>Note</th>
                <th style={{ width: 70 }}>Active</th><th style={{ width: 40 }}></th>
              </tr></thead>
              <tbody>
                {visible.map(r => (
                  <tr key={r.id} className={r.status !== 'Active' ? 'row-inactive' : ''}>
                    <td><input value={r.sku || ''} onChange={e => setCell(r.id, 'sku', e.target.value)} onBlur={e => saveField(r.id, 'sku', e.target.value)} /></td>
                    <td><input value={r.name || ''} onChange={e => setCell(r.id, 'name', e.target.value)} onBlur={e => saveField(r.id, 'name', e.target.value)} /></td>
                    <td><input value={r.system || ''} onChange={e => setCell(r.id, 'system', e.target.value)} onBlur={e => saveField(r.id, 'system', e.target.value)} /></td>
                    <td><input value={r.part_type || ''} onChange={e => setCell(r.id, 'part_type', e.target.value)} onBlur={e => saveField(r.id, 'part_type', e.target.value)} /></td>
                    <td><input value={r.oem_no || ''} onChange={e => setCell(r.id, 'oem_no', e.target.value)} onBlur={e => saveField(r.id, 'oem_no', e.target.value)} /></td>
                    <td><NumInput value={r.unit_cost} onChange={n => setCell(r.id, 'unit_cost', n)} onCommit={n => saveField(r.id, 'unit_cost', n)} /></td>
                    <td><input value={r.behaviour || ''} onChange={e => setCell(r.id, 'behaviour', e.target.value)} onBlur={e => saveField(r.id, 'behaviour', e.target.value)} /></td>
                    <td><input value={r.scrap_category || ''} onChange={e => setCell(r.id, 'scrap_category', e.target.value)} onBlur={e => saveField(r.id, 'scrap_category', e.target.value)} /></td>
                    <td><input value={r.note || ''} onChange={e => setCell(r.id, 'note', e.target.value)} onBlur={e => saveField(r.id, 'note', e.target.value)} /></td>
                    <td style={{ textAlign: 'center' }}><button className={'md-toggle' + (r.status === 'Active' ? ' on' : '')} onClick={() => toggleActive(r)}><span className="knob" /></button></td>
                    <td><button className="btn ghost sm void-btn" onClick={() => { if (confirm(`Delete ${r.sku}?`)) delRow(r.id) }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {node}
    </>
  )
}
