import { useEffect, useState, useMemo, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'
import { NumInput, fmtId } from '../components/NumInput'

const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const kg = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('id-ID') + ' kg'
const rp = n => (n === null || n === undefined || n === '') ? 'Rp 0' : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID')
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—'
const netOf = d => Number(d.borongan || 0) - Number(d.bbm_rupiah || 0) - Number(d.potongan_susut || 0) - Number(d.potongan_pm || 0) - Number(d.potongan_lain || 0)

const NUMF = ['estimasi_muat', 'muatan', 'bongkar', 'borongan', 'bbm_liter', 'bbm_rupiah', 'potongan_susut', 'potongan_pm', 'potongan_lain', 'do_no', 'reject_oa_per_kg', 'muat_bruto', 'muat_tarra', 'bongkar_bruto', 'bongkar_tarra']

const qtyKnown = c => !!c && c.quantity_kg !== null && c.quantity_kg !== undefined && c.quantity_kg !== ''
// The price can change mid-contract (contract_rates): a delivery is billed at the
// rate in force on its tanggal MUAT (bongkar / slip date when muat is empty).
const rateDateOf = d => d.tanggal_muat || d.tanggal_bongkar || d.tanggal || ''
function rateFor(c, rates, date) {
  let oa = num(c?.oa_per_kg)
  for (const r of rates) if (r.effective_from <= date) oa = Number(r.oa_per_kg)   // rates sorted by effective_from
  return oa
}
const hasPricing = (c, rates) => (c?.oa_per_kg !== null && c?.oa_per_kg !== undefined && c?.oa_per_kg !== '') || rates.length > 0
// Tagihan of one row: billed kg × rate on its date; a reject is billed out and back on its muatan.
function tagihanOf(c, d, rates) {
  const oa = rateFor(c, rates, rateDateOf(d))
  if (!oa) return 0
  if (d.is_reject) return Number(d.muatan || 0) * (oa + Number(d.reject_oa_per_kg || 0))
  return Number((c.billing_basis === 'muatan' ? d.muatan : d.bongkar) || 0) * oa
}
const fmtShortD = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

export default function FleetContractDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { show, node } = useToast()
  const [c, setC] = useState(null)
  const [rows, setRows] = useState([])
  const [rates, setRates] = useState([])
  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [extras, setExtras] = useState([])     // tambahan uang jalan, per rincian
  const [xRow, setXRow] = useState(null)       // delivery id with the ⋯ panel open
  const [loading, setLoading] = useState(true)
  // Daftar kontrol order: by DO number or by date. The order is fixed when the list loads or the sort changes,
  // so a row does not jump while its date or DO number is being edited.
  const [sortBy, setSortBy] = useState('do')       // 'do' | 'date'
  const [sortDir, setSortDir] = useState('asc')
  const [order, setOrder] = useState([])
  const [tick, setTick] = useState(0)
  function sort(col) { if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortDir('asc') } }
  const arrow = col => sortBy === col ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [ct, dl, tr, dr, rr, ex] = await Promise.all([
      supabase.from('fleet_contracts').select('*').eq('id', id).single(),
      // A load can carry two contracts: the slip row (main) and a part row on the other contract
      // (parent_id = main). Embed the other side of each link for the badges.
      supabase.from('fleet_deliveries')
        .select('*, parent:parent_id(do_no,contract:fleet_contracts(control_no)), parts:fleet_deliveries!parent_id(id,do_no,contract:fleet_contracts(control_no))')
        .eq('contract_id', id).eq('is_retur', false).order('do_no', { ascending: true }),   // a retur slip is not a delivery
      supabase.from('trucks').select('id,plate,capacity_kg,status').eq('status', 'Active').order('plate'),
      supabase.from('drivers').select('name,nickname,status').eq('status', 'Active').order('name'),
      supabase.from('contract_rates').select('*').eq('contract_id', id).order('effective_from'),
      supabase.from('fleet_extras').select('*, delivery:fleet_deliveries!inner(contract_id)').eq('delivery.contract_id', id).order('tanggal'),
    ])
    setC(ct.data || null); setRows(dl.data || []); setTrucks(tr.data || []); setDrivers(dr.data || []); setTick(t => t + 1)
    setRates(rr.data || []); setExtras(ex.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [id])
  useEffect(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const n = v => (v === null || v === undefined || v === '') ? null : Number(v)
    const cmpDo = (a, b) => (n(a.do_no) === null) - (n(b.do_no) === null) || dir * ((n(a.do_no) ?? 0) - (n(b.do_no) ?? 0))
    const cmpDate = (a, b) => (!a.tanggal) - (!b.tanggal) || dir * String(a.tanggal || '').localeCompare(String(b.tanggal || ''))
    setOrder([...rows].sort((a, b) => sortBy === 'date' ? (cmpDate(a, b) || cmpDo(a, b)) : (cmpDo(a, b) || cmpDate(a, b))).map(d => d.id))
  }, [tick, sortBy, sortDir])   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const pos = new Map(order.map((rid, i) => [rid, i]))
    return [...rows].sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9))
  }, [rows, order])

  const totals = useMemo(() => {
    const t = { muatan: 0, bongkar: 0, susut: 0, committed: 0, claim: 0 }
    const tol = Number(c?.susut_tolerance ?? 0)
    t.tagihan = 0; t.rejects = 0
    for (const d of rows) {
      t.tagihan += tagihanOf(c, d, rates)
      if (d.is_reject) { t.rejects++; continue }      // a reject is billed but is no delivery for the contract
      t.muatan += Number(d.muatan || 0); t.bongkar += Number(d.bongkar || 0)
      if (d.muatan != null && d.muatan !== '' && d.bongkar != null && d.bongkar !== '') {
        const s = Number(d.muatan) - Number(d.bongkar)
        t.susut += s
        // waived (ditanggung klien) and oper'd rows are charged to no one
        if (tol > 0 && !d.susut_waived && !d.oper_truck_id) t.claim += Math.max(s - tol * Number(d.muatan), 0)
      }
      t.committed += Number(d.muatan ?? d.estimasi_muat ?? 0)
    }
    t.outstanding = Math.max(Number(c?.quantity_kg || 0) - t.committed, 0)
    t.over = qtyKnown(c) ? Math.max(t.muatan - Number(c.quantity_kg), 0) : 0
    t.rateNow = rateFor(c, rates, todayIso())
    t.noLoad = rows.filter(d => !d.is_reject && (d.muatan === null || d.muatan === undefined || d.muatan === '')).length
    return t
  }, [rows, c, rates])
  async function setReject(d, on) {
    const msg = on ? 'Tandai muatan ini sebagai REJECT (ditolak, kembali ke asal)? Tidak dihitung sebagai muatan kontrak; ditagih pergi dan pulang.'
                   : 'Batalkan reject? Muatan ini dihitung lagi sebagai muatan kontrak.'
    if (!confirm(msg)) return
    const patch = on ? { is_reject: true } : { is_reject: false, reject_oa_per_kg: null }
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', d.id)
    if (error) return show(error.message, true)
    setRows(rs => rs.map(r => r.id === d.id ? { ...r, ...patch } : r))
  }
  // price changes: collapsible history + "Ubah harga mulai tanggal"
  const [ratesOpen, setRatesOpen] = useState(false)
  const [nrDate, setNrDate] = useState(todayIso())
  const [nrRate, setNrRate] = useState('')
  async function addRate() {
    const v = num(nrRate)
    if (!v || v <= 0) return show('Isi harga baru (Rp/kg).', true)
    if (!nrDate) return show('Pilih tanggal mulai.', true)
    const { data, error } = await supabase.from('contract_rates')
      .insert({ contract_id: id, effective_from: nrDate, oa_per_kg: v }).select('*').single()
    if (error) return show(error.message.includes('duplicate') ? 'Sudah ada perubahan harga di tanggal itu — hapus dulu yang lama.' : error.message, true)
    setRates(rs => [...rs, data].sort((a, b) => a.effective_from.localeCompare(b.effective_from)))
    setNrRate(''); show(`Mulai ${fmtShortD(nrDate)}: Rp ${Math.round(v).toLocaleString('id-ID')}/kg.`)
  }
  async function delRate(r) {
    if (!confirm(`Hapus perubahan harga mulai ${fmtShortD(r.effective_from)} (Rp ${Math.round(r.oa_per_kg).toLocaleString('id-ID')}/kg)?`)) return
    const { error } = await supabase.from('contract_rates').delete().eq('id', r.id)
    if (error) return show(error.message, true)
    setRates(rs => rs.filter(x => x.id !== r.id))
  }
  // billed kg + Rp per rate period, for the breakdown (and the invoice lines)
  const periods = useMemo(() => {
    const ps = [{ from: null, oa: num(c?.oa_per_kg), kg: 0, rp: 0 }, ...rates.map(r => ({ from: r.effective_from, oa: Number(r.oa_per_kg), kg: 0, rp: 0, row: r }))]
    for (const d of rows) {
      const date = rateDateOf(d)
      let i = 0
      for (let k = 1; k < ps.length; k++) if (ps[k].from <= date) i = k
      ps[i].kg += Number((d.is_reject || c?.billing_basis === 'muatan' ? d.muatan : d.bongkar) || 0)
      ps[i].rp += tagihanOf(c, d, rates)
    }
    return ps
  }, [rows, c, rates])

  const [closing, setClosing] = useState(null)   // final quantity being entered for an open-ended contract
  async function closeContract() {
    const q = num(closing)
    if (!q || q <= 0) return show('Isi kuantitas akhir kontrak.', true)
    const { error } = await supabase.from('fleet_contracts').update({ quantity_kg: q }).eq('id', id)
    if (error) return show(error.message, true)
    setC(x => ({ ...x, quantity_kg: q })); setClosing(null); show('Kuantitas kontrak disimpan.')
  }
  const overTol = c && c.susut_tolerance != null && totals.muatan > 0 && (totals.susut / totals.muatan) > Number(c.susut_tolerance)

  function setCell(did, field, value) {
    setRows(rs => rs.map(r => r.id === did ? { ...r, [field]: value } : r))
  }
  async function saveField(did, field, raw) {
    const value = NUMF.includes(field) ? num(raw) : (raw === '' ? null : raw)
    const { error } = await supabase.from('fleet_deliveries').update({ [field]: value }).eq('id', did)
    if (error) show(error.message, true)
  }
  // Weighbridge: committing bruto or tarra recomputes netto (muatan / bongkar)
  // when both weights are present; netto stays directly editable on its own.
  async function saveWeigh(d, field, raw, bF, tF, nF) {
    const v = num(raw)
    const patch = { [field]: v }
    const bruto = field === bF ? v : num(d[bF])
    const tarra = field === tF ? v : num(d[tF])
    if (field !== nF && bruto != null && tarra != null) patch[nF] = bruto - tarra
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', did_of(d))
    if (error) return show(error.message, true)
    setRows(rs => rs.map(r => r.id === d.id ? { ...r, ...patch } : r))
  }
  const did_of = d => d.id
  async function saveTruck(did, truckId) {
    const t = trucks.find(x => x.id === truckId)
    setCell(did, 'truck_id', truckId || null); setCell(did, 'plate', t?.plate || null)
    const { error } = await supabase.from('fleet_deliveries').update({ truck_id: truckId || null, plate: t?.plate || null }).eq('id', did)
    if (error) show(error.message, true)
  }
  async function addRow() {
    const nextNo = rows.reduce((m, d) => Math.max(m, d.do_no || 0), 0) + 1
    const { data, error } = await supabase.from('fleet_deliveries')
      .insert({ contract_id: id, do_no: nextNo, tanggal: new Date().toISOString().slice(0, 10) }).select('*').single()
    if (error) return show(error.message, true)
    setRows(rs => [...rs, data])
  }
  async function delRow(did) {
    const { error } = await supabase.from('fleet_deliveries').delete().eq('id', did)
    if (error) return show(error.message, true)
    setRows(rs => rs.filter(r => r.id !== did))
  }

  async function patchRow(did, patch, msg) {
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', did)
    if (error) return show(error.message, true)
    setRows(rs => rs.map(r => r.id === did ? { ...r, ...patch } : r))
    if (msg) show(msg)
  }
  // Oper muatan: record the second truck; all potongan on the row are removed.
  const POTONGAN_FIELDS = { potongan_susut: null, potongan_pm: null, potongan_lain: null, potongan_ban: null, potongan_sparepart: null, potongan_kasbon: null, potongan_pihak: null, potongan_pihak_nama: null }
  async function saveOper(d, f) {
    if (!f.truckId) return show('Pilih truk pengganti.', true)
    const t = trucks.find(x => x.id === f.truckId)
    await patchRow(d.id, {
      oper_truck_id: f.truckId, oper_plate: t?.plate || null, oper_driver_name: f.driver || null,
      oper_date: f.date || null, oper_amount: num(f.amount), ...POTONGAN_FIELDS,
    }, `Dioper ke ${t?.plate || ''} — semua potongan dihapus.`)
  }
  async function cancelOper(d) {
    if (!confirm('Batalkan oper? Catatan truk pengganti dihapus (potongan yang sudah terhapus tidak dikembalikan).')) return
    await patchRow(d.id, { oper_truck_id: null, oper_plate: null, oper_driver_name: null, oper_date: null, oper_amount: null }, 'Oper dibatalkan.')
  }
  async function waiveSusut(d) {
    const reason = prompt('Susut ditanggung klien — alasannya? (mis. salah timbang di pabrik)')
    if (reason === null) return
    await patchRow(d.id, { susut_waived: true, susut_waived_reason: reason.trim() || null, potongan_susut: null },
      'Susut ditanggung klien: claim 0, potongan supir 0.')
  }
  async function unwaiveSusut(d) {
    if (!confirm('Batalkan? Claim susut dihitung lagi seperti biasa.')) return
    await patchRow(d.id, { susut_waived: false, susut_waived_reason: null }, 'Waive dibatalkan.')
  }
  async function addExtra(d, f) {
    if (!num(f.amount)) return show('Isi jumlah tambahan.', true)
    const { data, error } = await supabase.from('fleet_extras').insert({
      delivery_id: d.id, tanggal: f.tanggal, amount: num(f.amount), keterangan: f.ket.trim() || null,
      beban: f.beban, driver_name: f.driver || null,
    }).select('*').single()
    if (error) return show(error.message, true)
    setExtras(xs => [...xs, data].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal))))
    show(`Tambahan ${rp(num(f.amount))} dicatat (${f.beban === 'supir' ? 'potong supir' : 'biaya perusahaan'}).`)
  }
  async function delExtra(x) {
    if (!confirm(`Hapus tambahan ${rp(x.amount)} (${fmtDate(x.tanggal)})?`)) return
    const { error } = await supabase.from('fleet_extras').delete().eq('id', x.id)
    if (error) return show(error.message, true)
    setExtras(xs => xs.filter(e => e.id !== x.id))
  }

  if (loading) return (<><div className="topbar"><div><h1>Contract</h1></div></div><div className="content"><Spinner /></div></>)
  if (!c) return (<><div className="topbar"><div><h1>Contract</h1></div></div><div className="content"><Empty title="Not found">This contract doesn't exist.</Empty></div></>)

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Contract {c.control_no}</h1>
          <div className="sub">{c.client || '—'} · {c.origin || '—'} → {c.destination || '—'} · {c.commodity || '—'}</div>
        </div>
        <button className="btn ghost" onClick={() => nav('/fleet/contracts')}>← Contracts</button>
      </div>
      <div className="content">
        <div className="metrics">
          <div className="metric"><div className="k">Contracted</div><div className="v" style={{ fontSize: 18 }}>{qtyKnown(c) ? kg(c.quantity_kg) : 'Terbuka'}</div></div>
          <div className="metric"><div className="k">Loaded (real)</div><div className="v" style={{ fontSize: 18 }}>{kg(totals.muatan)}</div></div>
          {totals.over > 0
            ? <div className="metric"><div className="k">Lebih dari kontrak</div><div className="v" style={{ fontSize: 18, color: 'var(--urgent)' }}>{kg(totals.over)}</div></div>
            : <div className="metric"><div className="k">Outstanding</div><div className="v" style={{ fontSize: 18 }}>{qtyKnown(c) ? kg(totals.outstanding) : '—'}</div></div>}
          <div className="metric"><div className="k">Deliveries</div><div className="v" style={{ fontSize: 18 }}>{rows.length - totals.rejects}{totals.rejects > 0 && <span className="ct-rej-n"> + {totals.rejects} reject</span>}</div></div>
          <div className="metric"><div className="k">Tagihan OA{hasPricing(c, rates) && totals.rateNow ? ` · Rp ${Math.round(totals.rateNow).toLocaleString('id-ID')}/kg ${c.billing_basis === 'muatan' ? 'muatan' : 'bongkar'}` : ''}</div>
            <div className="v" style={{ fontSize: 18 }}>{hasPricing(c, rates) ? rp(Math.round(totals.tagihan)) : <span className="ct-open">Isi ongkos angkut (Edit)</span>}</div>
            {hasPricing(c, rates) && (
              <button className="rate-toggle" onClick={() => setRatesOpen(o => !o)}>
                {rates.length ? `Harga berubah ${rates.length}×` : 'Ubah harga'} {ratesOpen ? '▾' : '▸'}
              </button>
            )}
          </div>
          <div className="metric"><div className="k">Total Claim Susut</div><div className="v" style={{ fontSize: 18, color: totals.claim > 0 ? 'var(--urgent)' : undefined }}>{kg(totals.claim)}</div></div>
        </div>

        {ratesOpen && hasPricing(c, rates) && (
          <div className="rate-panel">
            <table className="rate-tbl">
              <tbody>
                {periods.map((p, i) => (
                  <tr key={p.row?.id || 'base'}>
                    <td>{i === 0 ? 'Harga awal' : `Mulai ${fmtShortD(p.from)}`}</td>
                    <td className="r mono">{p.oa ? `Rp ${Math.round(p.oa).toLocaleString('id-ID')}/kg` : '—'}</td>
                    <td className="r mono">{p.kg ? `${Math.round(p.kg).toLocaleString('id-ID')} kg` : ''}</td>
                    <td className="r mono">{p.kg ? rp(Math.round(p.rp)) : ''}</td>
                    <td>{p.row && <button className="btn ghost sm" title="Hapus perubahan harga ini" onClick={() => delRate(p.row)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rate-add">
              <span>Ubah harga mulai</span>
              <input type="date" value={nrDate} onChange={e => setNrDate(e.target.value)} />
              <NumInput value={nrRate} onChange={setNrRate} onCommit={setNrRate} placeholder="Rp/kg baru" />
              <button className="btn primary sm" onClick={addRate}>Simpan</button>
              <span className="rate-hint">Harga berlaku menurut tanggal muat. Tagihan per periode di atas = baris untuk invoice.</span>
            </div>
          </div>
        )}

        {!qtyKnown(c) && (
          <div className="banner ct-open-banner">
            <b>Kontrak terbuka</b> — kuantitas belum diketahui. Setelah kontrak selesai, isi kuantitas akhirnya sesuai tagihan.
            {closing === null
              ? <button className="btn primary sm" onClick={() => setClosing(String(totals.muatan || ''))}>Tutup kontrak</button>
              : (<span className="ct-close">
                  <NumInput value={closing} onChange={setClosing} onCommit={setClosing} placeholder="kuantitas akhir (kg)" />
                  <button className="btn primary sm" onClick={closeContract}>Simpan</button>
                  <button className="btn ghost sm" onClick={() => setClosing(null)}>Batal</button>
                  {totals.noLoad > 0 && <span className="ct-close-warn">{totals.noLoad} baris belum ada muatan</span>}
                </span>)}
          </div>
        )}

        <div className="dk-wrap">
          <table className="dk-tbl">
            <thead>
              <tr>
                <th style={{ width: 44 }} className="sortable" onClick={() => sort('do')} title="Urutkan menurut nomor DO">DO{arrow('do')}</th>
                <th style={{ width: 120 }} className="sortable" onClick={() => sort('date')} title="Urutkan menurut tanggal">Tanggal{arrow('date')}</th>
                <th style={{ width: 130 }}>Plat</th>
                <th style={{ width: 150 }}>Supir</th>
                <th style={{ width: 100 }}>Est. muat</th>
                <th style={{ width: 120 }}>Tgl muat</th>
                <th style={{ width: 100 }}>Muatan</th>
                <th style={{ width: 120 }}>Tgl bongkar</th>
                <th style={{ width: 100 }}>Bongkar</th>
                <th style={{ width: 90 }}>Susut</th>
                <th style={{ width: 100 }}>Claim susut</th>
                <th style={{ width: 120 }}>Tagihan</th>
                <th style={{ width: 280 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={13} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>No deliveries yet — add a row below.</td></tr>
              )}
              {shown.map(d => {
                const s = (!d.is_reject && d.muatan != null && d.muatan !== '' && d.bongkar != null && d.bongkar !== '') ? Number(d.muatan) - Number(d.bongkar) : null
                const rowOver = c.susut_tolerance != null && d.muatan > 0 && s != null && (s / Number(d.muatan)) > Number(c.susut_tolerance)
                // A part shares date / truck / driver with its slip; those are edited on the slip.
                const isPart = !!d.parent_id
                const main = isPart ? d.parent : null
                const others = d.parts || []
                const lockTip = isPart ? `Ikut slip utama${main?.contract?.control_no ? ` (kontrak ${main.contract.control_no})` : ''}` : undefined
                const myExtras = extras.filter(x => x.delivery_id === d.id)
                return (
                  <Fragment key={d.id}>
                  <tr className={[isPart ? 'slip-part' : '', d.is_reject ? 'row-reject' : ''].join(' ').trim()}>
                    <td><input value={d.do_no ?? ''} onChange={e => setCell(d.id, 'do_no', e.target.value)} onBlur={e => saveField(d.id, 'do_no', e.target.value)} /></td>
                    <td><input type="date" disabled={isPart} title={lockTip} value={d.tanggal || ''} onChange={e => setCell(d.id, 'tanggal', e.target.value)} onBlur={e => saveField(d.id, 'tanggal', e.target.value)} /></td>
                    <td>
                      <select disabled={isPart} title={lockTip} value={d.truck_id || ''} onChange={e => saveTruck(d.id, e.target.value)}>
                        <option value="">{d.plate || '—'}</option>
                        {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
                      </select>
                    </td>
                    <td>
                      <select disabled={isPart} title={lockTip} value={d.driver_name || ''} onChange={e => { setCell(d.id, 'driver_name', e.target.value); saveField(d.id, 'driver_name', e.target.value) }}>
                        <option value="">—</option>
                        {drivers.map(dr => <option key={dr.name} value={dr.name}>{dr.name}{dr.nickname ? ` (${dr.nickname})` : ''}</option>)}
                        {d.driver_name && !drivers.some(x => x.name === d.driver_name) && <option value={d.driver_name}>{d.driver_name}</option>}
                      </select>
                    </td>
                    <td><NumInput value={d.estimasi_muat} onChange={n => setCell(d.id, 'estimasi_muat', n)} onCommit={n => saveField(d.id, 'estimasi_muat', n)} /></td>
                    <td><input type="date" value={d.tanggal_muat || ''} onChange={e => setCell(d.id, 'tanggal_muat', e.target.value)} onBlur={e => saveField(d.id, 'tanggal_muat', e.target.value)} /></td>
                    <td><WeighCell d={d} bF="muat_bruto" tF="muat_tarra" nF="muatan" setCell={setCell} saveWeigh={saveWeigh} /></td>
                    <td><input type="date" value={d.tanggal_bongkar || ''} onChange={e => setCell(d.id, 'tanggal_bongkar', e.target.value)} onBlur={e => saveField(d.id, 'tanggal_bongkar', e.target.value)} /></td>
                    <td><WeighCell d={d} bF="bongkar_bruto" tF="bongkar_tarra" nF="bongkar" setCell={setCell} saveWeigh={saveWeigh} /></td>
                    <td className="dk-susut" style={rowOver ? { color: 'var(--urgent)', fontWeight: 700 } : {}}>{s != null ? fmtId(s) : '—'}</td>
                    <td className="dk-susut" style={rowOver && !d.susut_waived && !d.oper_truck_id ? { color: 'var(--urgent)', fontWeight: 700 } : {}}>{(() => {
                      const tol = Number(c.susut_tolerance ?? 0)
                      if (s == null || !(tol > 0)) return '—'
                      if (d.susut_waived) return <span title={`Ditanggung klien${d.susut_waived_reason ? ` — ${d.susut_waived_reason}` : ''}`}>0</span>
                      if (d.oper_truck_id) return <span title="Dioper — tidak diklaim ke supir">0</span>
                      const claim = Math.max(s - tol * Number(d.muatan), 0)
                      return claim > 0 ? fmtId(claim) : '0'
                    })()}</td>
                    <td className="dk-susut" title={(() => { const oa = rateFor(c, rates, rateDateOf(d)); return d.is_reject ? `Reject: ${fmtId(d.muatan || 0)} kg × (OA ${fmtId(oa)} + kembali ${fmtId(d.reject_oa_per_kg || 0)})` : `× Rp ${fmtId(oa)}/kg` })()}>{hasPricing(c, rates) ? fmtId(Math.round(tagihanOf(c, d, rates))) : '—'}</td>
                    <td className="dk-actions">
                      {!isPart && (d.is_reject
                        ? (<span className="rej-box">
                            <span className="rej-badge" title="Ditolak dan kembali ke asal: tidak dihitung sebagai muatan kontrak">Reject</span>
                            <NumInput className="rej-oa" value={d.reject_oa_per_kg} placeholder="OA kembali" onChange={n => setCell(d.id, 'reject_oa_per_kg', n)} onCommit={n => saveField(d.id, 'reject_oa_per_kg', n)} />
                            <button className="btn ghost sm" title="Batalkan reject" onClick={() => setReject(d, false)}>Batal</button>
                          </span>)
                        : <button className="btn ghost sm rej-btn" title="Muatan ditolak dan kembali ke asal" onClick={() => setReject(d, true)}>Reject</button>)}
                      <button className="btn ghost sm void-btn" onClick={() => {
                        const msg = isPart ? 'Remove this contract part from its slip?'
                          : others.length ? `Remove this delivery? It is a slip that also carries ${others.map(o => o.contract?.control_no || '—').join(', ')} — that part and its recorded muatan/bongkar are removed too.`
                          : 'Remove this delivery?'
                        if (confirm(msg)) delRow(d.id)
                      }}>✕</button>
                      {!isPart && <button className={'btn ghost sm' + (xRow === d.id ? ' on' : '')} title="Oper / tambahan uang jalan / susut klien"
                        onClick={() => setXRow(x => x === d.id ? null : d.id)}>⋯</button>}
                      {isPart && <span className="part-badge" title={lockTip}>Slip {main?.contract?.control_no || '—'}{main?.do_no != null ? ` DO ${main.do_no}` : ''}</span>}
                      {others.map(o => <span key={o.id} className="part-badge" title="Same load also carries this contract">+ {o.contract?.control_no || '—'}</span>)}
                      {d.oper_truck_id && <span className="part-badge oper-badge" title={`Dioper ${d.oper_date ? fmtDate(d.oper_date) : ''}${d.oper_amount ? ` · dioper ${rp(d.oper_amount)}` : ''}`}>Oper → {d.oper_plate || '?'}</span>}
                      {d.susut_waived && <span className="part-badge waive-badge" title={d.susut_waived_reason || 'Ditanggung klien'}>Susut klien</span>}
                      {myExtras.length > 0 && <span className="part-badge" title={myExtras.map(x => `${fmtDate(x.tanggal)} ${rp(x.amount)}${x.keterangan ? ` — ${x.keterangan}` : ''}`).join('\n')}>+{myExtras.length} tambahan</span>}
                    </td>
                  </tr>
                  {xRow === d.id && !isPart && (
                    <tr className="dkx-row"><td colSpan={13}>
                      <RowPanel d={d} s={s} trucks={trucks} drivers={drivers} myExtras={myExtras}
                        onOper={f => saveOper(d, f)} onCancelOper={() => cancelOper(d)}
                        onWaive={() => waiveSusut(d)} onUnwaive={() => unwaiveSusut(d)}
                        onAddExtra={f => addExtra(d, f)} onDelExtra={delExtra} />
                    </td></tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={addRow}>+ Add delivery row</button>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Road-money slips are filled in the <b>Slip Uang Jalan</b> tab.</div>
      </div>

      {node}
    </>
  )
}

// Per-rincian actions: oper muatan, tambahan uang jalan, susut ditanggung klien.
function RowPanel({ d, s, trucks, drivers, myExtras, onOper, onCancelOper, onWaive, onUnwaive, onAddExtra, onDelExtra }) {
  const [operForm, setOperForm] = useState(null)   // {truckId, driver, date, amount}
  const [exForm, setExForm] = useState(null)       // {tanggal, amount, ket, beban, driver}
  const rpX = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID')
  return (
    <div className="dkx">
      {/* oper muatan */}
      <div className="dkx-sec">
        <div className="dkx-h">Oper muatan</div>
        {d.oper_truck_id ? (
          <div className="dkx-line">
            Dioper ke <b>{d.oper_plate || '?'}</b>{d.oper_driver_name ? ` (${d.oper_driver_name})` : ''}
            {d.oper_date ? ` · ${fmtDate(d.oper_date)}` : ''}{d.oper_amount ? ` · sisa dioper ${rpX(d.oper_amount)}` : ''}
            <button className="btn ghost sm" onClick={onCancelOper}>Batal oper</button>
          </div>
        ) : operForm ? (
          <div className="dkx-form">
            <select value={operForm.truckId} onChange={e => setOperForm(f => ({ ...f, truckId: e.target.value }))}>
              <option value="">Truk pengganti…</option>
              {trucks.filter(t => t.id !== d.truck_id).map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
            </select>
            <select value={operForm.driver} onChange={e => setOperForm(f => ({ ...f, driver: e.target.value }))}>
              <option value="">Supirnya…</option>
              {drivers.map(dr => <option key={dr.name} value={dr.name}>{dr.name}{dr.nickname ? ` (${dr.nickname})` : ''}</option>)}
            </select>
            <input type="date" value={operForm.date} onChange={e => setOperForm(f => ({ ...f, date: e.target.value }))} />
            <NumInput value={operForm.amount} placeholder="Sisa uang jalan dioper (Rp)"
              onChange={n => setOperForm(f => ({ ...f, amount: n }))} onCommit={n => setOperForm(f => ({ ...f, amount: n }))} />
            <button className="btn primary sm" onClick={() => onOper(operForm)}>Simpan oper</button>
            <button className="btn ghost sm" onClick={() => setOperForm(null)}>Batal</button>
            <span className="dkx-hint">Tanpa SPB & uang tembak. Semua potongan di baris ini dihapus. Serah-terima sisa tidak mengubah kas; uang baru dicatat sebagai tambahan.</span>
          </div>
        ) : (
          <button className="btn ghost sm" onClick={() => setOperForm({ truckId: '', driver: '', date: todayIso(), amount: '' })}>Truk rusak — oper ke truk lain…</button>
        )}
      </div>

      {/* tambahan uang jalan */}
      <div className="dkx-sec">
        <div className="dkx-h">Tambahan uang jalan</div>
        {myExtras.map(x => (
          <div className="dkx-line" key={x.id}>
            {fmtDate(x.tanggal)} · <b>{rpX(x.amount)}</b> · {x.beban === 'supir' ? 'potong supir' : 'biaya perusahaan'}
            {x.driver_name ? ` · ${x.driver_name}` : ''}{x.keterangan ? ` — ${x.keterangan}` : ''}
            <button className="btn ghost sm void-btn" onClick={() => onDelExtra(x)}>✕</button>
          </div>
        ))}
        {exForm ? (
          <div className="dkx-form">
            <input type="date" value={exForm.tanggal} onChange={e => setExForm(f => ({ ...f, tanggal: e.target.value }))} />
            <NumInput value={exForm.amount} placeholder="Jumlah (Rp)"
              onChange={n => setExForm(f => ({ ...f, amount: n }))} onCommit={n => setExForm(f => ({ ...f, amount: n }))} />
            <input value={exForm.ket} placeholder="Keterangan (mis. tambah solar oper)" onChange={e => setExForm(f => ({ ...f, ket: e.target.value }))} />
            <select value={exForm.driver} onChange={e => setExForm(f => ({ ...f, driver: e.target.value }))}>
              <option value="">Penerima…</option>
              {drivers.map(dr => <option key={dr.name} value={dr.name}>{dr.name}{dr.nickname ? ` (${dr.nickname})` : ''}</option>)}
              {[d.driver_name, d.oper_driver_name].filter(n => n && !drivers.some(x => x.name === n)).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="seg">
              <button type="button" className={exForm.beban === 'perusahaan' ? 'on' : ''} onClick={() => setExForm(f => ({ ...f, beban: 'perusahaan' }))}>Biaya perusahaan</button>
              <button type="button" className={exForm.beban === 'supir' ? 'on' : ''} onClick={() => setExForm(f => ({ ...f, beban: 'supir' }))}>Potong supir</button>
            </div>
            <button className="btn primary sm" onClick={() => { onAddExtra(exForm); setExForm(null) }}>Simpan</button>
            <button className="btn ghost sm" onClick={() => setExForm(null)}>Batal</button>
            <span className="dkx-hint">Masuk laporan kas & laporan harian pada tanggal ini. "Potong supir" ikut kasbon supir.</span>
          </div>
        ) : (
          <button className="btn ghost sm" onClick={() => setExForm({ tanggal: todayIso(), amount: '', ket: '', beban: 'perusahaan', driver: d.oper_driver_name || d.driver_name || '' })}>+ Tambahan</button>
        )}
      </div>

      {/* susut ditanggung klien */}
      <div className="dkx-sec">
        <div className="dkx-h">Susut</div>
        {d.susut_waived ? (
          <div className="dkx-line">
            Ditanggung klien{d.susut_waived_reason ? ` — ${d.susut_waived_reason}` : ''} · claim klien 0, potongan supir 0
            <button className="btn ghost sm" onClick={onUnwaive}>Batal</button>
          </div>
        ) : (
          <div className="dkx-line">
            {s != null && s > 0 ? `Susut ${Number(s).toLocaleString('id-ID')} kg.` : 'Belum ada susut tercatat.'}
            <button className="btn ghost sm" onClick={onWaive}>Susut ditanggung klien…</button>
          </div>
        )}
      </div>
    </div>
  )
}

// Bruto / Tarra / Netto mini-stack for one weighing (muat or bongkar).
// Netto lives in the existing muatan/bongkar column; typing B and T fills it.
function WeighCell({ d, bF, tF, nF, setCell, saveWeigh }) {
  const b = d[bF], t = d[tF], n = d[nF]
  const mismatch = b != null && b !== '' && t != null && t !== '' && n != null && n !== '' && Math.abs((Number(b) - Number(t)) - Number(n)) > 0.5
  return (
    <div className="wtr-stack">
      <div className="wtr"><span>B</span><NumInput value={b} onChange={v => setCell(d.id, bF, v)} onCommit={v => saveWeigh(d, bF, v, bF, tF, nF)} /></div>
      <div className="wtr"><span>T</span><NumInput value={t} onChange={v => setCell(d.id, tF, v)} onCommit={v => saveWeigh(d, tF, v, bF, tF, nF)} /></div>
      <div className={'wtr wtr-n' + (mismatch ? ' off' : '')} title={mismatch ? 'Netto ≠ Bruto − Tarra' : 'Netto (dipakai untuk susut & tagihan)'}>
        <span>N</span><NumInput value={n} onChange={v => setCell(d.id, nF, v)} onCommit={v => saveWeigh(d, nF, v, bF, tF, nF)} /></div>
    </div>
  )
}
