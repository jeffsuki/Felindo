import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'

const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Number(n).toLocaleString()
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const netOf = d => Number(d.borongan || 0) - Number(d.bbm_rupiah || 0) - Number(d.potongan_susut || 0) - Number(d.potongan_pm || 0) - Number(d.potongan_lain || 0)

// Master list of all Slip Uang Jalan (the financial side of every delivery).
export default function FleetSlips() {
  const { node } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [slip, setSlip] = useState(null)

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    supabase.from('fleet_deliveries')
      .select('*, contract:fleet_contracts(control_no,client,origin,destination)')
      .order('tanggal', { ascending: false, nullsFirst: false })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [])

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(d => `${d.plate} ${d.driver_name} ${d.contract?.control_no} ${d.contract?.client}`.toLowerCase().includes(s))
  }, [rows, q])

  const total = useMemo(() => visible.reduce((a, d) => a + netOf(d), 0), [visible])

  if (loading) return (<><div className="topbar"><div><h1>Slip Uang Jalan</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Slip Uang Jalan</h1>
          <div className="sub">All road-money slips across contracts</div>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 1080 }}>
        <div className="controls">
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by plate, driver, control no, client…" /></div>
        </div>
        {visible.length === 0 ? (
          <Empty title="No slips">{q ? 'No matches.' : 'Slips appear here once you enter borongan on a delivery.'}</Empty>
        ) : (
          <>
            <div className="hist-count">{visible.length} slip{visible.length === 1 ? '' : 's'} · total net {rp(total)}</div>
            <div className="slip-list">
              <div className="slip-lrow slip-lhead">
                <span>Date</span><span>Plate</span><span>Driver</span><span>Contract</span><span className="r">Borongan</span><span className="r">Net</span><span></span>
              </div>
              {visible.map(d => (
                <div className="slip-lrow" key={d.id}>
                  <span>{fmtDate(d.tanggal)}</span>
                  <span className="mono">{d.plate || '—'}</span>
                  <span>{d.driver_name || '—'}</span>
                  <span className="mono">{d.contract?.control_no || '—'}</span>
                  <span className="r mono">{rp(d.borongan)}</span>
                  <span className="r mono" style={{ fontWeight: 700 }}>{rp(netOf(d))}</span>
                  <span className="r"><button className="btn ghost sm" onClick={() => setSlip(d)}>Slip</button></span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {slip && <SlipOverlay d={slip} onClose={() => setSlip(null)} />}
      {node}
    </>
  )
}

function SlipOverlay({ d, onClose }) {
  const c = d.contract || {}
  const net = netOf(d)
  return (
    <div className="slip-scrim">
      <div className="slip-print">
        <div className="slip-h">SLIP UANG JALAN</div>
        <div className="slip-meta">
          <div><b>Plat BK:</b> {d.plate || '—'}</div>
          <div><b>Tanggal DO:</b> {fmtDate(d.tanggal)}</div>
          <div><b>Nama Supir:</b> {d.driver_name || '—'}</div>
          <div><b>Nomor DO:</b> {d.do_no}</div>
        </div>
        <table className="slip-tbl"><tbody>
          <tr><td>Nomor Kontrol</td><td>{c.control_no || '—'}</td></tr>
          <tr><td>Asal</td><td>{c.origin || '—'}</td></tr>
          <tr><td>Tujuan</td><td>{c.destination || '—'}</td></tr>
          <tr><td>Borongan</td><td>{rp(d.borongan)}</td></tr>
          <tr><td>BBM ({d.bbm_liter || 0} L)</td><td>− {rp(d.bbm_rupiah)}</td></tr>
          <tr><td>Potongan Susut</td><td>− {rp(d.potongan_susut)}</td></tr>
          <tr><td>Potongan PM</td><td>− {rp(d.potongan_pm)}</td></tr>
          <tr><td>Potongan Lain-lain</td><td>− {rp(d.potongan_lain)}</td></tr>
          <tr className="slip-total"><td>Sisa Borongan</td><td>{rp(net)}</td></tr>
        </tbody></table>
        {d.keterangan && <div className="slip-note">Keterangan: {d.keterangan}</div>}
        <div className="slip-sign"><div>Diterima,</div><div>Hormat kami,</div></div>
      </div>
      <div className="slip-actions no-print">
        <button className="btn primary" onClick={() => window.print()}>Print</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
