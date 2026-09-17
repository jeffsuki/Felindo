import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'
import SlipEditor from '../components/SlipEditor'

const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Number(n).toLocaleString()
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const netOf = d => Number(d.borongan || 0) - Number(d.bbm_rupiah || 0) - Number(d.potongan_susut || 0) - Number(d.potongan_pm || 0) - Number(d.potongan_lain || 0)
const isFilled = d => d.borongan != null

// Master list of Slip Uang Jalan — fill each slip here (click a row).
export default function FleetSlips() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')   // all | filled | blank
  const [slipId, setSlipId] = useState(null)

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('fleet_deliveries')
      .select('*, contract:fleet_contracts(control_no,client,origin,destination)')
      .order('tanggal', { ascending: false, nullsFirst: false })
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(d => {
      if (filter === 'filled' && !isFilled(d)) return false
      if (filter === 'blank' && isFilled(d)) return false
      if (!s) return true
      return `${d.plate} ${d.driver_name} ${d.contract?.control_no} ${d.contract?.client}`.toLowerCase().includes(s)
    })
  }, [rows, q, filter])
  const total = useMemo(() => visible.reduce((a, d) => a + netOf(d), 0), [visible])

  async function saveSlip(did, patch) {
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', did)
    if (error) return show(error.message, true)
    setRows(rs => rs.map(r => r.id === did ? { ...r, ...patch } : r))
    show('Slip saved.')
  }

  if (loading) return (<><div className="topbar"><div><h1>Slip Uang Jalan</h1></div></div><div className="content"><Spinner /></div></>)

  const active = rows.find(r => r.id === slipId)

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Slip Uang Jalan</h1>
          <div className="sub">Fill and print road-money slips — click a row</div>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1080 }}>
        <div className="controls">
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by plate, driver, control no, client…" /></div>
          <div className="seg-lens">
            {[['all', 'All'], ['blank', 'Not filled'], ['filled', 'Filled']].map(([v, l]) => (
              <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <Empty title="No slips">{q ? 'No matches.' : 'Deliveries appear here — click one to fill its slip.'}</Empty>
        ) : (
          <>
            <div className="hist-count">{visible.length} slip{visible.length === 1 ? '' : 's'} · total net {rp(total)}</div>
            <div className="slip-list">
              <div className="slip-lrow slip-lhead">
                <span>Date</span><span>Plate</span><span>Driver</span><span>Contract</span><span className="r">Borongan</span><span className="r">Net</span><span></span>
              </div>
              {visible.map(d => (
                <div className="slip-lrow slip-lclick" key={d.id} onClick={() => setSlipId(d.id)}>
                  <span>{fmtDate(d.tanggal)}</span>
                  <span className="mono">{d.plate || '—'}</span>
                  <span>{d.driver_name || '—'}</span>
                  <span className="mono">{d.contract?.control_no || '—'}</span>
                  <span className="r mono">{isFilled(d) ? rp(d.borongan) : '—'}</span>
                  <span className="r mono" style={{ fontWeight: 700 }}>{isFilled(d) ? rp(netOf(d)) : '—'}</span>
                  <span className="r">{isFilled(d) ? <span className="fc-out">edit</span> : <span className="fc-out" style={{ color: 'var(--accent)' }}>fill</span>}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {active && <SlipEditor d={active} c={active.contract || {}} onSave={p => saveSlip(active.id, p)} onClose={() => setSlipId(null)} />}
      {node}
    </>
  )
}
