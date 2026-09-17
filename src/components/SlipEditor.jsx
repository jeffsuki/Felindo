import { useState } from 'react'

const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Number(n).toLocaleString()
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Editable Slip Uang Jalan: fill the financials, save, and print.
// `d` = the delivery, `c` = its contract ({control_no, origin, destination}).
export default function SlipEditor({ d, c = {}, onSave, onClose }) {
  const [f, setF] = useState({
    borongan: d.borongan ?? '', bbm_liter: d.bbm_liter ?? '', bbm_rupiah: d.bbm_rupiah ?? '',
    potongan_susut: d.potongan_susut ?? '', potongan_pm: d.potongan_pm ?? '', potongan_lain: d.potongan_lain ?? '',
    keterangan: d.keterangan || '',
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const net = Number(f.borongan || 0) - Number(f.bbm_rupiah || 0) - Number(f.potongan_susut || 0) - Number(f.potongan_pm || 0) - Number(f.potongan_lain || 0)

  function save() {
    onSave({
      borongan: num(f.borongan), bbm_liter: num(f.bbm_liter), bbm_rupiah: num(f.bbm_rupiah),
      potongan_susut: num(f.potongan_susut), potongan_pm: num(f.potongan_pm), potongan_lain: num(f.potongan_lain),
      keterangan: f.keterangan.trim() || null,
    })
    onClose()
  }

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
          <tr><td>Borongan</td><td className="no-print"><input className="slip-in" type="number" value={f.borongan} onChange={e => set('borongan', e.target.value)} /></td></tr>
          <tr className="slip-only"><td>Borongan</td><td>{rp(f.borongan)}</td></tr>
          <tr><td>BBM liter / rupiah</td><td className="no-print"><input className="slip-in sm" type="number" value={f.bbm_liter} onChange={e => set('bbm_liter', e.target.value)} /> <input className="slip-in" type="number" value={f.bbm_rupiah} onChange={e => set('bbm_rupiah', e.target.value)} /></td></tr>
          <tr className="slip-only"><td>BBM ({f.bbm_liter || 0} L)</td><td>− {rp(f.bbm_rupiah)}</td></tr>
          <tr><td>Potongan Susut</td><td className="no-print"><input className="slip-in" type="number" value={f.potongan_susut} onChange={e => set('potongan_susut', e.target.value)} /></td></tr>
          <tr className="slip-only"><td>Potongan Susut</td><td>− {rp(f.potongan_susut)}</td></tr>
          <tr><td>Potongan PM</td><td className="no-print"><input className="slip-in" type="number" value={f.potongan_pm} onChange={e => set('potongan_pm', e.target.value)} /></td></tr>
          <tr className="slip-only"><td>Potongan PM</td><td>− {rp(f.potongan_pm)}</td></tr>
          <tr><td>Potongan Lain</td><td className="no-print"><input className="slip-in" type="number" value={f.potongan_lain} onChange={e => set('potongan_lain', e.target.value)} /></td></tr>
          <tr className="slip-only"><td>Potongan Lain-lain</td><td>− {rp(f.potongan_lain)}</td></tr>
          <tr className="slip-total"><td>Sisa Borongan</td><td>{rp(net)}</td></tr>
        </tbody></table>
        <div className="no-print" style={{ marginTop: 10 }}>
          <input className="slip-in" style={{ width: '100%' }} placeholder="Keterangan" value={f.keterangan} onChange={e => set('keterangan', e.target.value)} />
        </div>
        {f.keterangan && <div className="slip-note slip-only">Keterangan: {f.keterangan}</div>}
        <div className="slip-sign slip-only"><div>Diterima,</div><div>Hormat kami,</div></div>
      </div>
      <div className="slip-actions no-print">
        <button className="btn primary" onClick={save}>Save</button>
        <button className="btn ghost" onClick={() => window.print()}>Print</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
