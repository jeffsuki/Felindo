import { useEffect, useState, useMemo, useRef, Fragment } from 'react'
import { supabase, isConfigured, fetchAll } from '../supabaseClient'
import { Spinner, Empty, useToast } from '../components/ui'
import SearchSelect from '../components/SearchSelect'
import { NumInput, fmtId } from '../components/NumInput'
import { checkPassword, gateEnabled } from '../components/Gate'
import { groupTrips } from '../lib/trips'

const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const JENIS_POT = ['Susut', 'Ganti Ban', 'Ganti Spare Part', 'Lainnya']
const rp = n => (n === null || n === undefined || n === '') ? '' : Math.round(Number(n)).toLocaleString('id-ID')
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const potTotal = d => Number(d.potongan_susut || 0) + Number(d.potongan_ban || 0) + Number(d.potongan_sparepart || 0) + Number(d.potongan_lain || 0) + Number(d.potongan_pm || 0) + Number(d.potongan_kasbon || 0)
const netOf = d => Number(d.borongan || 0) - Number(d.selisih_bbm || 0) - Number(d.potongan_pihak || 0) - Number(d.bbm_rupiah || 0) - potTotal(d)
  + Number(d.tambahan_cuci || 0) + Number(d.tambahan_steam || 0) + Number(d.tambahan_tol || 0) + Number(d.tambahan_bantuan || 0)
const hasAdj = d => [d.selisih_bbm, d.potongan_pihak, d.tambahan_cuci, d.tambahan_steam, d.tambahan_tol, d.tambahan_bantuan].some(v => v)
const tambahanOf = d => Number(d.tambahan_cuci || 0) + Number(d.tambahan_steam || 0) + Number(d.tambahan_tol || 0) + Number(d.tambahan_bantuan || 0)
const potLainOf = d => Number(d.selisih_bbm || 0) + Number(d.potongan_pihak || 0)
const penyOf = d => tambahanOf(d) - Number(d.selisih_bbm || 0) - Number(d.potongan_pihak || 0)
const totalBbm = d => (Number(d.bbm_liter || 0) * Number(d.price_per_liter || 0))
const isFilled = d => d.borongan != null
const todayStr = () => new Date().toISOString().slice(0, 10)
const localToday = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
// Retur: the trip did not happen and the driver brings the uang jalan back. Only a slip without a load (and no second contract).
const canRetur = d => !d.is_retur && d.borongan != null && d.muatan == null && d.bongkar == null && !(d.parts || []).length
const PAGE = 200   // rows rendered at a time — a month can still have a few hundred slips
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const monthLabel = m => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }   // local time, not UTC
// 'YYYY-MM' + n months
const addMonths = (m, n) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}` }
const SEL = '*, contract:fleet_contracts(control_no,client,origin,destination)'
const SEARCH_LIMIT = 150   // a search shows the latest matches across all months
const NUMF = ['do_no', 'borongan', 'bbm_liter', 'price_per_liter', 'bbm_rupiah', 'potongan_susut', 'potongan_ban', 'potongan_sparepart', 'potongan_lain', 'potongan_pm', 'potongan_kasbon']

export default function FleetSlips() {
  const { show, node } = useToast()
  const [rows, setRows] = useState([])
  const [contracts, setContracts] = useState([])
  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)   // first load of the page
  const [busy, setBusy] = useState(false)        // loading another month / a search
  const [q, setQ] = useState('')
  const [sq, setSq] = useState('')               // the search text, a moment after typing stops
  const [filter, setFilter] = useState('all')
  const [month, setMonth] = useState(thisMonth)  // 'YYYY-MM' — only this month's slips are loaded
  const [bounds, setBounds] = useState(null)     // first and last month that have slips
  const [shown, setShown] = useState(PAGE)
  const [adding, setAdding] = useState(false)
  const [printId, setPrintId] = useState(null)
  const [adjFor, setAdjFor] = useState(null)
  const [tbhFor, setTbhFor] = useState(null)   // slip whose Tambahan modal is open
  const [extras, setExtras] = useState([])     // tambahan uang jalan for the loaded slips
  const [unlocked, setUnlocked] = useState(new Set())
  const [unlockFor, setUnlockFor] = useState(null)
  const [partFor, setPartFor] = useState(null)
  const [flagCount, setFlagCount] = useState(0)    // slips marked "perlu dicek" (all months)
  const [flagged, setFlagged] = useState(false)    // showing only those, across all months

  // Contracts, trucks, drivers and the range of months: loaded once.
  async function loadRefs() {
    const [ct, tr, dr, lo, hi, fl] = await Promise.all([
      supabase.from('fleet_contracts').select('id,control_no,client,origin,destination').order('control_no'),
      supabase.from('trucks').select('id,plate,capacity_kg,status').eq('status', 'Active').order('plate'),
      supabase.from('drivers').select('name,nickname,status').eq('status', 'Active').order('name'),
      supabase.from('fleet_deliveries').select('tanggal').not('tanggal', 'is', null).order('tanggal', { ascending: true }).limit(1),
      supabase.from('fleet_deliveries').select('tanggal').not('tanggal', 'is', null).order('tanggal', { ascending: false }).limit(1),
      supabase.from('fleet_deliveries').select('id', { count: 'exact', head: true }).not('cek_note', 'is', null),
    ])
    setFlagCount(fl.count || 0)
    setContracts(ct.data || []); setTrucks(tr.data || []); setDrivers(dr.data || [])
    const now = thisMonth(), first = lo.data?.[0]?.tanggal?.slice(0, 7) || now, last = hi.data?.[0]?.tanggal?.slice(0, 7) || now
    setBounds({ first: first < now ? first : now, last: last > now ? last : now })
  }
  // Only the slips of one month — or, while searching, the latest matches across all months.
  // Historical trips imported from RINCI have no slip date and stay out of this page.
  // Contract parts (parent_id set) share their slip's date, so they come along and show under it.
  const reqNo = useRef(0)
  async function loadRows() {
    const n = ++reqNo.current
    setBusy(true)
    const { data, error } = sq ? await searchRows(sq) : flagged ? await flaggedRows() : await fetchAll(() => supabase.from('fleet_deliveries').select(SEL)
      .gte('tanggal', `${month}-01`).lt('tanggal', `${addMonths(month, 1)}-01`).order('tanggal', { ascending: false }))
    if (n !== reqNo.current) return   // a newer month / search was asked for meanwhile
    if (error) show(error.message, true)
    setRows(data || []); setBusy(false); setLoading(false)
  }
  // Search by plate / driver / route of a slip without contract, or by contract no. / client (of the slip or a second contract on it).
  async function searchRows(s) {
    const pat = s.replace(/[,()*%\\:"']/g, ' ').trim().replace(/\s+/g, '*')
    if (!pat) return { data: [] }
    const [a, b] = await Promise.all([
      supabase.from('fleet_deliveries').select('id,parent_id,tanggal').not('tanggal', 'is', null)
        .or(`plate.ilike.*${pat}*,driver_name.ilike.*${pat}*,rute.ilike.*${pat}*`).order('tanggal', { ascending: false }).limit(SEARCH_LIMIT),
      supabase.from('fleet_deliveries').select('id,parent_id,tanggal,contract:fleet_contracts!inner(control_no,client)').not('tanggal', 'is', null)
        .or(`control_no.ilike.*${pat}*,client.ilike.*${pat}*`, { referencedTable: 'contract' }).order('tanggal', { ascending: false }).limit(SEARCH_LIMIT),
    ])
    if (a.error || b.error) return { data: [], error: a.error || b.error }
    const hits = [...a.data, ...b.data].sort((x, y) => String(y.tanggal).localeCompare(String(x.tanggal)))
    return withParts([...new Set(hits.map(h => h.parent_id || h.id))].slice(0, SEARCH_LIMIT))
  }
  // Slips marked "perlu dicek", whatever their month.
  async function flaggedRows() {
    const { data, error } = await supabase.from('fleet_deliveries').select('id').not('cek_note', 'is', null).limit(500)
    if (error) return { data: [], error }
    return withParts(data.map(h => h.id))
  }
  // the slips with these ids and every contract part under them
  async function withParts(ids) {
    const out = []
    for (let i = 0; i < ids.length; i += 50) {   // the slips and every contract part under them
      const chunk = ids.slice(i, i + 50).join(',')
      const { data, error } = await supabase.from('fleet_deliveries').select(SEL).or(`id.in.(${chunk}),parent_id.in.(${chunk})`)
      if (error) return { data: out, error }
      out.push(...data)
    }
    return { data: out.sort((x, y) => String(y.tanggal).localeCompare(String(x.tanggal))) }
  }
  const load = () => loadRows()
  // After creating a slip: show the month it belongs to (and reload).
  function showMonthOf(tanggal) {
    const m = (tanggal || '').slice(0, 7)
    if (!m || sq || m === month) return load()
    setBounds(b => b && { first: m < b.first ? m : b.first, last: m > b.last ? m : b.last })
    setMonth(m)
  }
  useEffect(() => { if (isConfigured) loadRefs() }, [])
  useEffect(() => { if (isConfigured) loadRows(); else setLoading(false) }, [month, sq, flagged])
  useEffect(() => {
    if (!isConfigured) return
    const ids = rows.filter(r => !r.parent_id).map(r => r.id)
    if (!ids.length) { setExtras([]); return }
    let live = true
    ;(async () => {
      const out = []
      for (let i = 0; i < ids.length; i += 80) {
        const { data } = await supabase.from('fleet_extras').select('*').in('delivery_id', ids.slice(i, i + 80)).order('tanggal')
        out.push(...(data || []))
      }
      if (live) setExtras(out)
    })()
    return () => { live = false }
  }, [rows])
  useEffect(() => { const t = setTimeout(() => setSq(q.trim().length >= 2 ? q.trim() : ''), 350); return () => clearTimeout(t) }, [q])

  // One entry per slip; a second (third…) contract on the same load sits in d.parts.
  const slips = useMemo(() => groupTrips(rows), [rows])
  // years that have slips (and this year), newest first
  const years = useMemo(() => {
    const y = Number(month.slice(0, 4)), lo = Math.min(Number((bounds?.first || month).slice(0, 4)), y), hi = Math.max(Number((bounds?.last || month).slice(0, 4)), y)
    const out = []; for (let k = hi; k >= lo; k--) out.push(k)
    return out
  }, [bounds, month])
  const visible = useMemo(() => slips.filter(d => filter === 'all' || (filter === 'nocontract' ? !d.contract_id : (filter === 'filled') === isFilled(d))), [slips, filter])
  const noContract = useMemo(() => slips.filter(d => !d.contract_id).length, [slips])
  useEffect(() => { setShown(PAGE) }, [sq, filter, month, flagged])
  const total = useMemo(() => visible.reduce((a, d) => a + netOf(d), 0), [visible])

  // locked = there is a password, the slip's date is before today, and not unlocked this session
  const isLocked = d => gateEnabled && d.tanggal && d.tanggal < todayStr() && !unlocked.has(d.id)

  function setCell(did, field, value) { setRows(rs => rs.map(r => r.id === did ? { ...r, [field]: value } : r)) }
  async function saveField(did, field, raw) {
    const value = NUMF.includes(field) ? num(raw) : (raw === '' ? null : raw)
    const { error } = await supabase.from('fleet_deliveries').update({ [field]: value }).eq('id', did)
    if (error) show(error.message, true)
  }
  // BBM total (bbm_rupiah) = liter × price/L; recompute and persist on either edit
  async function saveBbm(did, field, raw) {
    const row = rows.find(r => r.id === did) || {}
    const L = field === 'bbm_liter' ? num(raw) : (row.bbm_liter == null ? null : Number(row.bbm_liter))
    const P = field === 'price_per_liter' ? num(raw) : (row.price_per_liter == null ? null : Number(row.price_per_liter))
    const total = Number(L || 0) * Number(P || 0)
    setCell(did, 'bbm_rupiah', total)
    const { error } = await supabase.from('fleet_deliveries').update({ [field]: num(raw), bbm_rupiah: total }).eq('id', did)
    if (error) show(error.message, true)
  }
  async function saveTruck(did, truckId) {
    const t = trucks.find(x => x.id === truckId)
    const patch = { truck_id: truckId || null, plate: t?.plate || null }
    // estimate = truck capacity, less whatever the slip's other contracts are estimated to carry
    const partsEst = rows.filter(r => r.parent_id === did).reduce((a, r) => a + Number(r.estimasi_muat || 0), 0)
    if (t && t.capacity_kg != null) patch.estimasi_muat = Math.max(Number(t.capacity_kg) - partsEst, 0)
    setRows(rs => rs.map(r => r.id === did ? { ...r, ...patch } : r))
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', did)
    if (error) show(error.message, true)
  }
  // Moving a slip (or a part) to another contract gives it the next DO number there.
  // Taking the contract off a slip (no contract yet) drops its DO number and keeps the route as text.
  async function saveContractLink(did, cid) {
    const c = contracts.find(x => x.id === cid)
    const row = rows.find(r => r.id === did)
    try {
      if (!cid) {
        const patch = { contract_id: null, do_no: null, rute: row?.rute || (row?.contract ? `${row.contract.origin || '—'} - ${row.contract.destination || '—'}` : null) }
        const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', did)
        if (error) throw error
        return setRows(rs => rs.map(r => r.id === did ? { ...r, ...patch, contract: null } : r))
      }
      const doNo = row?.is_retur ? null : await nextDo(cid)   // a retur slip has no DO number
      const { error } = await supabase.from('fleet_deliveries').update({ contract_id: cid, do_no: doNo }).eq('id', did)
      if (error) throw error
      setRows(rs => rs.map(r => r.id === did ? { ...r, contract_id: cid, do_no: doNo, contract: c ? { control_no: c.control_no, origin: c.origin, destination: c.destination, client: c.client } : r.contract } : r))
    } catch (e) { show(e.message, true) }
  }
  // Retur: the whole sisa comes back today; the slip leaves the daftar kontrol (no DO number) but stays on the
  // laporan borongan harian, and the Laporan Kas shows the money coming back on the retur date.
  async function saveRetur(d) {
    const amt = netOf(d), today = localToday()
    const msg = d.is_retur
      ? `Uang retur Rp ${rp(amt)} sudah kembali hari ini (${fmtDate(today)})?`
      : `Retur: uang jalan Rp ${rp(amt)} dikembalikan hari ini (${fmtDate(today)})?\n\nSlip tetap di laporan borongan, tapi keluar dari daftar kontrol ${d.contract?.control_no || ''}${d.do_no != null ? ` (DO ${d.do_no} dihapus)` : ''}.`
    if (!confirm(msg)) return
    const patch = { is_retur: true, retur_date: today, retur_amount: amt, do_no: null }
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', d.id)
    if (error) return show(error.message, true)
    setRows(rs => rs.map(r => r.id === d.id ? { ...r, ...patch } : r)); show('Retur dicatat.')
  }
  // "Perlu dicek": staff looked at the slip (and fixed it if needed).
  async function clearCek(d) {
    const { error } = await supabase.from('fleet_deliveries').update({ cek_note: null }).eq('id', d.id)
    if (error) return show(error.message, true)
    setRows(rs => rs.map(r => r.id === d.id ? { ...r, cek_note: null } : r)); setFlagCount(n => Math.max(n - 1, 0)); show('Ditandai sudah dicek.')
  }
  async function cancelRetur(d) {
    if (!confirm('Batalkan retur? Slip kembali ke daftar kontrol dengan DO baru, dan uang retur hilang dari Laporan Kas.')) return
    try {
      const patch = { is_retur: false, retur_date: null, retur_amount: null, do_no: await nextDo(d.contract_id) }
      const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', d.id)
      if (error) throw error
      setRows(rs => rs.map(r => r.id === d.id ? { ...r, ...patch } : r)); show('Retur dibatalkan.')
    } catch (e) { show(e.message, true) }
  }
  // Removing a slip also removes its contract parts (on delete cascade).
  async function delRow(did) {
    const { error } = await supabase.from('fleet_deliveries').delete().eq('id', did)
    if (error) return show(error.message, true)
    setRows(rs => rs.filter(r => r.id !== did && r.parent_id !== did))
  }
  // Removing a contract part hands its estimated kg back to the slip's own contract.
  async function delPart(main, part) {
    const { error } = await supabase.from('fleet_deliveries').delete().eq('id', part.id)
    if (error) return show(error.message, true)
    setRows(rs => rs.filter(r => r.id !== part.id))
    if (part.estimasi_muat != null && main.estimasi_muat != null) {
      const est = Number(main.estimasi_muat) + Number(part.estimasi_muat)
      const { error: e2 } = await supabase.from('fleet_deliveries').update({ estimasi_muat: est }).eq('id', main.id)
      if (e2) return show('Contract removed, but the slip estimate was not restored: ' + e2.message, true)
      setRows(rs => rs.map(r => r.id === main.id ? { ...r, estimasi_muat: est } : r))
    }
  }
  // Next DO number within a contract, read from the database so rows not on this
  // page (historical trips without a slip date, other slips' parts) are counted.
  async function nextDo(contractId) {
    if (!contractId) return null   // no contract yet: no DO number
    const { data, error } = await supabase.from('fleet_deliveries').select('do_no')
      .eq('contract_id', contractId).not('do_no', 'is', null).order('do_no', { ascending: false }).limit(1)
    if (error) throw error
    return Number(data?.[0]?.do_no || 0) + 1
  }
  const partRow = (main, contractId, est) => ({
    parent_id: main.id, contract_id: contractId, estimasi_muat: est ?? null,
    tanggal: main.tanggal ?? null, truck_id: main.truck_id ?? null, plate: main.plate ?? null, driver_name: main.driver_name ?? null,
  })
  async function createSlip(fields, second) {
    let main
    try {
      const { data, error } = await supabase.from('fleet_deliveries').insert({ do_no: await nextDo(fields.contract_id), ...fields }).select('*').single()   // no contract: no DO yet
      if (error) throw error
      main = data
    } catch (e) { return show(e.message, true) }
    if (second) {
      try {
        const { error } = await supabase.from('fleet_deliveries').insert({ do_no: await nextDo(second.contract_id), ...partRow(main, second.contract_id, second.estimasi_muat) })
        if (error) throw error
      } catch (e) { show('Slip created, but the second contract was not added: ' + e.message, true); setAdding(false); load(); return }
    }
    show(second ? 'Slip created with two contracts.' : 'Slip created.'); setAdding(false); showMonthOf(main.tanggal)
  }
  // Add another contract to an existing slip (same truck load).
  async function addPart(main, { contract_id, est_main, est_part }) {
    try {
      const { error } = await supabase.from('fleet_deliveries').insert({ do_no: await nextDo(contract_id), ...partRow(main, contract_id, est_part) })
      if (error) throw error
    } catch (e) { return show(e.message, true) }
    // the part exists now: close and reload whatever happens to the estimate update
    let msg = 'Contract added to the slip.', bad = false
    if (est_main !== (main.estimasi_muat == null ? null : Number(main.estimasi_muat))) {
      const { error } = await supabase.from('fleet_deliveries').update({ estimasi_muat: est_main }).eq('id', main.id)
      if (error) { msg = 'Contract added, but the slip estimate was not updated: ' + error.message; bad = true }
    }
    show(msg, bad); setPartFor(null); load()
  }
  function tryUnlock(pw) {
    if (checkPassword(pw)) { setUnlocked(s => new Set(s).add(unlockFor)); setUnlockFor(null) }
    else show('Wrong password.', true)
  }
  async function saveAdj(id, patch) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    const { error } = await supabase.from('fleet_deliveries').update(patch).eq('id', id)
    if (error) return show(error.message, true)
    show('Adjustments saved.'); setAdjFor(null)
  }
  async function addExtra(d, f) {
    if (!num(f.amount)) return show('Isi jumlah tambahan.', true)
    const { data, error } = await supabase.from('fleet_extras').insert({
      delivery_id: d.id, tanggal: f.tanggal, amount: num(f.amount), keterangan: f.ket.trim() || null,
      beban: f.beban, driver_name: f.driver || null,
    }).select('*').single()
    if (error) return show(error.message, true)
    setExtras(xs => [...xs, data].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal))))
    show(`Tambahan Rp ${rp(num(f.amount))} tercatat tanggal ${fmtDate(f.tanggal)} (${f.beban === 'supir' ? 'potong supir' : 'biaya perusahaan'}).`)
  }
  async function delExtra(x) {
    if (!confirm(`Hapus tambahan Rp ${rp(x.amount)} (${fmtDate(x.tanggal)})?`)) return
    const { error } = await supabase.from('fleet_extras').delete().eq('id', x.id)
    if (error) return show(error.message, true)
    setExtras(xs => xs.filter(e => e.id !== x.id))
  }

  if (loading) return (<><div className="topbar"><div><h1>Slip Uang Jalan</h1></div></div><div className="content"><Spinner /></div></>)
  const active = slips.find(r => r.id === printId)
  const partMain = slips.find(r => r.id === partFor)

  return (
    <>
      <div className="topbar">
        <div><h1>Slip Uang Jalan</h1><div className="sub">Fill inline, print each slip{gateEnabled ? ' · past-dated slips need the password to edit' : ''}</div></div>
        <button className="btn primary" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ New slip'}</button>
      </div>
      <div className="content">
        {adding && <NewSlip contracts={contracts} trucks={trucks} drivers={drivers} onCreate={createSlip} onCancel={() => setAdding(false)} />}

        <div className="controls" style={{ marginTop: adding ? 20 : 0 }}>
          <div className="field grow"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by plate, driver, control no, client… (all months)" /></div>
          <div className="btn-group" title={sq ? 'Search looks through all months' : 'Only this month is loaded'}>
            <button className="btn ghost sm" disabled={!!sq || flagged} title="Bulan sebelumnya" onClick={() => setMonth(m => addMonths(m, -1))}>‹</button>
            <select value={month.slice(5, 7)} onChange={e => setMonth(`${month.slice(0, 4)}-${e.target.value}`)} style={{ width: 'auto' }} disabled={!!sq || flagged} aria-label="Bulan">
              {MONTHS.map((l, i) => <option key={l} value={String(i + 1).padStart(2, '0')}>{l}</option>)}
            </select>
            <select value={month.slice(0, 4)} onChange={e => setMonth(`${e.target.value}-${month.slice(5, 7)}`)} style={{ width: 'auto' }} disabled={!!sq || flagged} aria-label="Tahun">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn ghost sm" disabled={!!sq || flagged} title="Bulan berikutnya" onClick={() => setMonth(m => addMonths(m, 1))}>›</button>
            {month !== thisMonth() && !sq && !flagged && <button className="btn ghost sm" onClick={() => setMonth(thisMonth())}>Bulan ini</button>}
          </div>
          <div className="seg-lens">
            {[['all', 'All'], ['blank', 'Not filled'], ['filled', 'Filled'], ['nocontract', `Tanpa kontrak${noContract ? ` (${noContract})` : ''}`]].map(([v, l]) => (<button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>))}
          </div>
        </div>

        {(flagCount > 0 || flagged) && !sq && (
          <div className="cek-banner">
            {flagged
              ? <><b>Perlu dicek</b> — semua bulan, {flagCount} slip tersisa. Perbaiki slipnya bila perlu, lalu klik “Sudah dicek”.
                  <button className="btn ghost sm" onClick={() => setFlagged(false)}>Kembali ke {monthLabel(month)}</button></>
              : <>⚠ <b>{flagCount} slip perlu dicek</b> — berbeda dengan laporan borongan harian.
                  <button className="btn ghost sm" onClick={() => { setFilter('all'); setFlagged(true) }}>Tampilkan</button></>}
          </div>
        )}
        {busy ? <Spinner /> : visible.length === 0 ? (
          <Empty title="No slips">{sq ? `No slips match “${sq}”.` : `No slips in ${monthLabel(month)} — pick another month above, or create one with “+ New slip”.`}</Empty>
        ) : (
          <>
            <div className="hist-count">{sq ? `Search “${sq}”, all months: ` : flagged ? 'Perlu dicek, semua bulan: ' : `${monthLabel(month)}: `}{visible.length} slip{visible.length === 1 ? '' : 's'}{sq && slips.length >= SEARCH_LIMIT ? ` (latest ${SEARCH_LIMIT} — type more to narrow it down)` : ''} · total net Rp {rp(total) || '0'}</div>
            <div className="dk-wrap">
              <table className="dk-tbl slip-grid">
                <thead>
                  <tr>
                    <th></th><th>Tanggal</th><th>Plat</th><th>Supir</th><th>No. Kontrol</th><th>Asal</th><th>Tujuan</th>
                    <th className="r">Borongan</th><th className="r">BBM L</th><th className="r">Price/L</th><th className="r">Total BBM</th>
                    <th className="r">Susut</th><th className="r">Ban</th><th className="r">S.Part</th><th className="r">Lain</th><th className="r">PM</th><th className="r">Kasbon</th><th className="r">Penyesuaian</th>
                    <th className="r">Sisa</th><th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, shown).map(d => {
                    const locked = isLocked(d)
                    const partCtl = d.parts.map(p => p.contract?.control_no || '—').join(', ')
                    return (
                      <Fragment key={d.id}>
                      <tr className={(locked ? 'row-locked' : '') + (d.is_retur ? ' row-retur' : '') + (d.cek_note ? ' row-cek' : '')}>
                        <td className="dk-actions">
                          <button className="btn ghost sm" onClick={() => setPrintId(d.id)}>Print</button>
                          <button className={'btn ghost sm' + (hasAdj(d) ? ' driver-on' : '')} disabled={locked} onClick={() => setAdjFor(d.id)}>Adj{hasAdj(d) ? ' ✓' : ''}</button>
                          {(() => { const n = extras.filter(x => x.delivery_id === d.id).length
                            return <button className={'btn ghost sm' + (n ? ' driver-on' : '')} title="Tambahan uang jalan — uang keluar di hari lain, dicatat pada tanggalnya sendiri" onClick={() => setTbhFor(d.id)}>Tambahan{n ? ` ✓${n > 1 ? n : ''}` : ''}</button> })()}
                          {d.is_retur ? <>
                            <span className="retur-chip" title={d.retur_amount != null ? `Rp ${rp(d.retur_amount)} dikembalikan` : 'Trip batal — uang belum kembali'}>Retur{d.retur_date ? ' ' + fmtDate(d.retur_date) : ' · belum kembali'}</span>
                            {!d.retur_date && <button className="btn ghost sm" disabled={locked} title="Uang jalan sudah dikembalikan hari ini" onClick={() => saveRetur(d)}>Uang kembali</button>}
                            <button className="btn ghost sm" disabled={locked} onClick={() => cancelRetur(d)}>Batal retur</button>
                          </> : <>
                            <button className="btn ghost sm" disabled={locked || !d.contract_id} title={d.contract_id ? 'Satu muatan, kontrak lain — tambah kontrak ke slip ini' : 'Pilih kontrak slip ini dulu (kolom No. Kontrol)'} onClick={() => setPartFor(d.id)}>+ Kontrak</button>
                            <button className="btn ghost sm" disabled={locked || !canRetur(d)} title={canRetur(d) ? 'Trip batal — uang jalan dikembalikan hari ini' : 'Retur hanya untuk slip tanpa muatan/bongkar dan tanpa kontrak kedua'} onClick={() => saveRetur(d)}>Retur</button>
                          </>}
                          {locked
                            ? <button className="btn ghost sm" title="Past-dated — unlock to edit" onClick={() => setUnlockFor(d.id)}>🔒</button>
                            : <button className="btn ghost sm void-btn" onClick={() => { if (confirm(d.parts.length ? `Remove this slip? The other contract on this load (${partCtl}) is removed too, with its recorded muatan/bongkar.` : 'Remove this slip/delivery?')) delRow(d.id) }}>✕</button>}
                        </td>
                        <td><input type="date" disabled={locked} value={d.tanggal || ''} onChange={e => setCell(d.id, 'tanggal', e.target.value)} onBlur={e => saveField(d.id, 'tanggal', e.target.value)} /></td>
                        <td><LazySelect disabled={locked} value={d.truck_id || ''} onChange={e => saveTruck(d.id, e.target.value)} label={d.plate || '—'}
                          options={() => <><option value="">{d.plate || '—'}</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}</>} /></td>
                        <td><LazySelect disabled={locked} value={d.driver_name || ''} onChange={e => { setCell(d.id, 'driver_name', e.target.value); saveField(d.id, 'driver_name', e.target.value) }} label={d.driver_name || '—'}
                          options={() => <><option value="">—</option>{drivers.map(dr => <option key={dr.name} value={dr.name}>{dr.name}</option>)}{d.driver_name && !drivers.some(x => x.name === d.driver_name) && <option value={d.driver_name}>{d.driver_name}</option>}</>} /></td>
                        <td><LazySelect disabled={locked} value={d.contract_id || ''} onChange={e => saveContractLink(d.id, e.target.value)} label={d.contract?.control_no || '— belum ada —'}
                          className={d.contract_id ? '' : 'no-contract'} title={d.contract_id ? '' : 'Belum ada kontrak — pilih kontraknya, slip dapat nomor DO berikutnya'}
                          options={() => <>{!d.parts.length && <option value="">— belum ada —</option>}{contracts.filter(c => !d.parts.some(p => p.contract_id === c.id)).map(c => <option key={c.id} value={c.id}>{c.control_no}</option>)}</>} /></td>
                        {d.contract_id ? <>
                          <td className="ro">{d.contract?.origin || '—'}</td>
                          <td className="ro">{d.contract?.destination || '—'}</td>
                        </> : <td colSpan={2}><input disabled={locked} className="rute-in" value={d.rute || ''} placeholder="Rute (belum ada kontrak)" title="Rute di slip uang jalan — dipakai sampai kontraknya dipilih"
                          onChange={e => setCell(d.id, 'rute', e.target.value)} onBlur={e => saveField(d.id, 'rute', e.target.value.trim())} /></td>}
                        <td><NumInput disabled={locked} value={d.borongan} onChange={n => setCell(d.id, 'borongan', n)} onCommit={n => saveField(d.id, 'borongan', n)} /></td>
                        <td><NumInput disabled={locked} value={d.bbm_liter} onChange={n => setCell(d.id, 'bbm_liter', n)} onCommit={n => saveBbm(d.id, 'bbm_liter', n)} /></td>
                        <td><NumInput disabled={locked} value={d.price_per_liter} onChange={n => setCell(d.id, 'price_per_liter', n)} onCommit={n => saveBbm(d.id, 'price_per_liter', n)} /></td>
                        <td className="mono ro r">{totalBbm(d) ? rp(totalBbm(d)) : '—'}</td>
                        <td><NumInput disabled={locked} value={d.potongan_susut} onChange={n => setCell(d.id, 'potongan_susut', n)} onCommit={n => saveField(d.id, 'potongan_susut', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_ban} onChange={n => setCell(d.id, 'potongan_ban', n)} onCommit={n => saveField(d.id, 'potongan_ban', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_sparepart} onChange={n => setCell(d.id, 'potongan_sparepart', n)} onCommit={n => saveField(d.id, 'potongan_sparepart', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_lain} onChange={n => setCell(d.id, 'potongan_lain', n)} onCommit={n => saveField(d.id, 'potongan_lain', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_pm} onChange={n => setCell(d.id, 'potongan_pm', n)} onCommit={n => saveField(d.id, 'potongan_pm', n)} /></td>
                        <td><NumInput disabled={locked} value={d.potongan_kasbon} onChange={n => setCell(d.id, 'potongan_kasbon', n)} onCommit={n => saveField(d.id, 'potongan_kasbon', n)} /></td>
                        <td className="mono ro r" title="Tambahan (cuci, steam, jembatan/tol, bantuan) − Selisih BBM − ANS/MNA (set in Adj)">{penyOf(d) ? rp(penyOf(d)) : '—'}</td>
                        <td className="mono ro r" style={{ fontWeight: 700 }}>{isFilled(d) ? rp(netOf(d)) : '—'}</td>
                        <td><input disabled={locked} value={d.keterangan || ''} onChange={e => setCell(d.id, 'keterangan', e.target.value)} onBlur={e => saveField(d.id, 'keterangan', e.target.value)} /></td>
                      </tr>
                      {d.parts.map((p, i) => (
                        <tr key={p.id} className={'slip-part' + (locked ? ' row-locked' : '')}>
                          <td className="dk-actions">
                            {!locked && <button className="btn ghost sm void-btn" title="Remove this contract from the slip" onClick={() => { if (confirm(`Remove contract ${p.contract?.control_no || ''} from this slip? Its recorded muatan/bongkar on that contract are deleted too.`)) delPart(d, p) }}>✕</button>}
                          </td>
                          <td colSpan={3} className="ro slip-part-lbl">↳ Kontrak ke-{i + 2} · DO {p.do_no ?? '—'}</td>
                          <td><LazySelect disabled={locked} value={p.contract_id || ''} onChange={e => saveContractLink(p.id, e.target.value)} label={p.contract?.control_no || '—'}
                            options={() => contracts.filter(c => c.id === p.contract_id || (c.id !== d.contract_id && !d.parts.some(o => o.contract_id === c.id))).map(c => <option key={c.id} value={c.id}>{c.control_no}</option>)} /></td>
                          <td className="ro">{p.contract?.origin || '—'}</td>
                          <td className="ro">{p.contract?.destination || '—'}</td>
                          <td colSpan={13} className="ro slip-part-note">Muatan masuk kontrak ini · uang jalan ikut slip di atas{p.estimasi_muat != null ? ` · est. muat ${fmtId(p.estimasi_muat)} kg` : ''}</td>
                        </tr>
                      ))}
                      {d.cek_note && (
                        <tr className="slip-cek">
                          <td colSpan={20}><div className="cek-note">
                            <button className="btn ghost sm" disabled={locked} title="Slip sudah diperiksa (dan diperbaiki bila perlu)" onClick={() => clearCek(d)}>Sudah dicek</button>
                            <span>⚠ <b>Perlu dicek:</b> {d.cek_note}</span></div></td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {visible.length > shown && (
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setShown(n => n + PAGE)}>
                Show {Math.min(PAGE, visible.length - shown)} more ({visible.length - shown} not shown)
              </button>
            )}
          </>
        )}
      </div>
      {active && <SlipPrintH d={active} c={active.contract || {}} onClose={() => setPrintId(null)} />}
      {partMain && <AddPartModal main={partMain} contracts={contracts} onSave={f => addPart(partMain, f)} onClose={() => setPartFor(null)} />}
      {adjFor && <AdjustModal d={rows.find(r => r.id === adjFor)} onSave={p => saveAdj(adjFor, p)} onClose={() => setAdjFor(null)} />}
      {tbhFor && <TambahanModal d={rows.find(r => r.id === tbhFor)} drivers={drivers}
        extras={extras.filter(x => x.delivery_id === tbhFor)}
        onAdd={f => addExtra(rows.find(r => r.id === tbhFor), f)} onDel={delExtra} onClose={() => setTbhFor(null)} />}
      {unlockFor && <UnlockModal onOk={tryUnlock} onCancel={() => setUnlockFor(null)} />}
      {node}
    </>
  )
}

// A month can hold a few hundred slips, each with truck / driver / contract dropdowns (185 contracts):
// building every option up front is what made the page slow. Until the pointer or keyboard reaches it,
// the dropdown holds only its current choice; the full list is built the moment it is needed.
function LazySelect({ value, label, options, ...rest }) {
  const [full, setFull] = useState(false)
  const wake = () => { if (!full) setFull(true) }
  return (
    <select value={value} {...rest} onMouseEnter={wake} onFocus={wake} onMouseDown={wake} onTouchStart={wake}>
      {full ? options() : <option value={value}>{label}</option>}
    </select>
  )
}

function UnlockModal({ onOk, onCancel }) {
  const [pw, setPw] = useState('')
  return (
    <div className="slip-scrim">
      <form className="gate-card" onSubmit={e => { e.preventDefault(); onOk(pw) }}>
        <div className="gate-brand" style={{ fontSize: 18 }}>Unlock past-dated slip</div>
        <div className="gate-sub">Editing a slip after its date has passed needs the password.</div>
        <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" />
        <button className="btn primary wide" type="submit">Unlock</button>
        <button type="button" className="gate-home" onClick={onCancel}>Cancel</button>
      </form>
    </div>
  )
}

function AdjustModal({ d, onSave, onClose }) {
  const [f, setF] = useState({
    selisih_liter: d.selisih_bbm_liter ?? '', selisih_price: d.selisih_bbm_price ?? '',
    potongan_pihak: d.potongan_pihak ?? '', potongan_pihak_nama: d.potongan_pihak_nama || '',
    tambahan_cuci: d.tambahan_cuci ?? '', tambahan_steam: d.tambahan_steam ?? '', tambahan_tol: d.tambahan_tol ?? '',
    tambahan_bantuan: d.tambahan_bantuan ?? '', tambahan_bantuan_ket: d.tambahan_bantuan_ket || '',
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const nz = v => (v === '' || v === null || v === undefined) ? 0 : Number(v)
  const orNull = v => (v === '' || v === null || v === undefined) ? null : Number(v)
  const selisih = nz(f.selisih_liter) * nz(f.selisih_price)
  const preview = Number(d.borongan || 0) - selisih - nz(f.potongan_pihak) - Number(d.bbm_rupiah || 0) - potTotal(d)
    + nz(f.tambahan_cuci) + nz(f.tambahan_steam) + nz(f.tambahan_tol) + nz(f.tambahan_bantuan)
  function save() {
    onSave({
      selisih_bbm_liter: orNull(f.selisih_liter), selisih_bbm_price: orNull(f.selisih_price), selisih_bbm: selisih || null,
      potongan_pihak: orNull(f.potongan_pihak), potongan_pihak_nama: f.potongan_pihak_nama.trim() || null,
      tambahan_cuci: orNull(f.tambahan_cuci), tambahan_steam: orNull(f.tambahan_steam), tambahan_tol: orNull(f.tambahan_tol),
      tambahan_bantuan: orNull(f.tambahan_bantuan), tambahan_bantuan_ket: f.tambahan_bantuan_ket.trim() || null,
    })
  }
  return (
    <div className="slip-scrim">
      <div className="rel-modal nsf" style={{ width: 480 }}>
        <div className="slip-h" style={{ fontSize: 18 }}>Penyesuaian slip · {d.plate || '—'}</div>
        <div className="fd-sec">Potongan (kurangi sisa)</div>
        <div className="nsf-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <label><span>Selisih BBM Liter</span><NumInput value={f.selisih_liter} onChange={v => set('selisih_liter', v)} onCommit={v => set('selisih_liter', v)} /></label>
          <label><span>Selisih BBM Price/L</span><NumInput value={f.selisih_price} onChange={v => set('selisih_price', v)} onCommit={v => set('selisih_price', v)} /></label>
          <div className="nsf-f" style={{ justifyContent: 'flex-end' }}><span>= Selisih</span><div className="fd-calc">{rp(selisih)}</div></div>
          <label><span>Potongan ANS/MNA</span><NumInput value={f.potongan_pihak} onChange={v => set('potongan_pihak', v)} onCommit={v => set('potongan_pihak', v)} /></label>
          <label><span>Dari pihak</span><select value={f.potongan_pihak_nama} onChange={e => set('potongan_pihak_nama', e.target.value)}><option value="">—</option><option value="ANS">ANS</option><option value="MNA">MNA</option><option value="Lainnya">Lainnya</option></select></label>
          <div></div>
        </div>
        <div className="fd-sec">Tambahan (tambah sisa)</div>
        <div className="nsf-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <label><span>Cuci tangki</span><NumInput value={f.tambahan_cuci} onChange={v => set('tambahan_cuci', v)} onCommit={v => set('tambahan_cuci', v)} /></label>
          <label><span>Double steam</span><NumInput value={f.tambahan_steam} onChange={v => set('tambahan_steam', v)} onCommit={v => set('tambahan_steam', v)} /></label>
          <label><span>Uang jembatan / tol</span><NumInput value={f.tambahan_tol} onChange={v => set('tambahan_tol', v)} onCommit={v => set('tambahan_tol', v)} /></label>
          <label><span>Bantuan</span><NumInput value={f.tambahan_bantuan} onChange={v => set('tambahan_bantuan', v)} onCommit={v => set('tambahan_bantuan', v)} /></label>
          <label style={{ gridColumn: 'span 2' }}><span>Keterangan bantuan</span><input value={f.tambahan_bantuan_ket} onChange={e => set('tambahan_bantuan_ket', e.target.value)} placeholder="mis. Bantuan tol" /></label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 14 }}>
          <span style={{ fontWeight: 700 }}>Sisa: {rp(preview)}</span>
          <div className="btn-group" style={{ marginLeft: 'auto' }}>
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Same truck load, another contract: the part only records that contract's kg.
function AddPartModal({ main, contracts, onSave, onClose }) {
  const taken = new Set([main.contract_id, ...main.parts.map(p => p.contract_id)])
  const [cid, setCid] = useState('')
  // The load is split: the slip's own estimate goes down by what this contract takes,
  // unless the main estimate is typed in by hand.
  const base = main.estimasi_muat == null ? null : Number(main.estimasi_muat)
  const [estMain, setEstMain] = useState(base ?? '')
  const [mainTyped, setMainTyped] = useState(false)
  const [estPart, setEstPart] = useState('')
  function onPart(v) {
    setEstPart(v)
    if (!mainTyped && base != null) setEstMain(Math.max(base - (v === '' ? 0 : Number(v)), 0))
  }
  const [err, setErr] = useState('')
  const orNull = v => (v === '' || v === null || v === undefined) ? null : Number(v)
  function save() {
    if (!cid) return setErr('Pick the other contract.')
    onSave({ contract_id: cid, est_main: orNull(estMain), est_part: orNull(estPart) })
  }
  return (
    <div className="slip-scrim">
      <div className="rel-modal nsf" style={{ width: 480 }}>
        <div className="slip-h" style={{ fontSize: 18 }}>Tambah kontrak · {main.plate || '—'} · {fmtDate(main.tanggal)}</div>
        <div className="nsf-note" style={{ marginTop: 0 }}>Satu muatan, dua kontrak. Uang jalan tetap di slip ini; kontrak tambahan hanya mencatat muatan dan bongkar-nya sendiri (diisi di halaman kontrak).</div>
        <div className="nsf-grid" style={{ marginTop: 10 }}>
          <div className="nsf-f" style={{ gridColumn: '1 / -1' }}><span>Kontrak lain *</span><SearchSelect value={cid} onChange={setCid} placeholder="Pick…" options={contracts.filter(c => !taken.has(c.id)).map(c => ({ value: c.id, label: c.control_no, sub: `${c.origin || '—'} → ${c.destination || '—'}`, search: c.client || '' }))} /></div>
          <label><span>Est. muat {main.contract?.control_no || 'kontrak utama'} (kg)</span><NumInput value={estMain} onChange={v => { setMainTyped(true); setEstMain(v) }} onCommit={v => setEstMain(v)} /></label>
          <label><span>Est. muat kontrak ini (kg)</span><NumInput value={estPart} onChange={onPart} onCommit={onPart} /></label>
        </div>
        {err && <div style={{ color: 'var(--urgent)', fontSize: 12, marginTop: 6 }}>{err}</div>}
        <div className="btn-group" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={save}>Add contract</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function NewSlip({ contracts, trucks, drivers, onCreate, onCancel }) {
  const [f, setF] = useState({
    contract_id: '', rute: '', truck_id: '', driver_name: '', tanggal: new Date().toISOString().slice(0, 10),
    borongan: '', bbm_liter: '', price_per_liter: '', potongan_susut: '', potongan_ban: '', potongan_sparepart: '', potongan_lain: '', potongan_pm: '40000', potongan_kasbon: '',
    selisih_liter: '', selisih_price: '', potongan_pihak: '', potongan_pihak_nama: '',
    tambahan_cuci: '', tambahan_steam: '', tambahan_tol: '', tambahan_bantuan: '', tambahan_bantuan_ket: '', keterangan: '',
    contract2_id: '', est2: '',
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const [err, setErr] = useState('')
  const [showAdj, setShowAdj] = useState(false)
  const [showK2, setShowK2] = useState(false)
  const [outstanding, setOutstanding] = useState({ kasbon: 0, bbm: 0 })
  const nz = v => (v === '' || v === null || v === undefined) ? 0 : Number(v)
  const orNull = v => (v === '' || v === null || v === undefined) ? null : Number(v)
  const truck = trucks.find(t => t.id === f.truck_id)

  useEffect(() => {
    if (!f.driver_name) { setOutstanding({ kasbon: 0, bbm: 0 }); return }
    let alive = true
    ;(async () => {
      const [ln, rpm, dl] = await Promise.all([
        supabase.from('fleet_driver_loans').select('jenis,amount,liter,tanggal').eq('driver_name', f.driver_name),
        supabase.from('fleet_driver_loan_repayments').select('amount').eq('driver_name', f.driver_name),
        supabase.from('fleet_deliveries').select('potongan_kasbon,bbm_liter,tanggal').eq('driver_name', f.driver_name),
      ])
      if (!alive) return
      let kC = 0; (ln.data || []).forEach(l => { if (l.jenis === 'Cash') kC += nz(l.amount) })
      let kP = 0; (dl.data || []).forEach(d => { kP += nz(d.potongan_kasbon) }); (rpm.data || []).forEach(r => { kP += nz(r.amount) })
      // date-aware BBM: chronological running balance of loans(+) and usage(-), floored at 0
      const ev = []
      ;(ln.data || []).forEach(l => { if (l.jenis === 'BBM') ev.push([l.tanggal || '', nz(l.liter)]) })
      ;(dl.data || []).forEach(d => { if (nz(d.bbm_liter) > 0) ev.push([d.tanggal || '', -nz(d.bbm_liter)]) })
      ev.sort((a, b) => a[0].localeCompare(b[0]))
      let bal = 0; for (const [, amt] of ev) { bal += amt; if (bal < 0) bal = 0 }
      setOutstanding({ kasbon: kC - kP, bbm: bal })
    })()
    return () => { alive = false }
  }, [f.driver_name])

  const totalBbm = nz(f.bbm_liter) * nz(f.price_per_liter)
  const selisih = nz(f.selisih_liter) * nz(f.selisih_price)
  const potTot = nz(f.potongan_susut) + nz(f.potongan_ban) + nz(f.potongan_sparepart) + nz(f.potongan_lain) + nz(f.potongan_pm) + nz(f.potongan_kasbon)
  const sisa = nz(f.borongan) - selisih - nz(f.potongan_pihak) - totalBbm - potTot
    + nz(f.tambahan_cuci) + nz(f.tambahan_steam) + nz(f.tambahan_tol) + nz(f.tambahan_bantuan)

  // Two contracts on one load: the second takes its estimate out of the truck's capacity.
  const k2 = showK2 && f.contract2_id ? f.contract2_id : ''
  const cap = truck?.capacity_kg != null ? Number(truck.capacity_kg) : null
  const estMain = cap == null ? null : (k2 && orNull(f.est2) != null ? Math.max(cap - Number(f.est2), 0) : cap)
  function submit() {
    if (!f.contract_id && !f.rute.trim()) return setErr('Pick a contract, or type the route if the contract is not known yet.')
    if (k2 && !f.contract_id) return setErr('Pick the first contract before a second one.')
    if (k2 && k2 === f.contract_id) return setErr('The second contract must be different from the first.')
    if (nz(f.borongan) <= 0) return setErr('Borongan is required.')
    if (f.potongan_pm === '' || f.potongan_pm === null) return setErr('PM is required.')
    onCreate({
      contract_id: f.contract_id || null, rute: f.contract_id ? null : f.rute.trim(), truck_id: f.truck_id || null, plate: truck?.plate || null,
      driver_name: f.driver_name || null, tanggal: f.tanggal || null,
      estimasi_muat: estMain,
      borongan: orNull(f.borongan), bbm_liter: orNull(f.bbm_liter), price_per_liter: orNull(f.price_per_liter), bbm_rupiah: totalBbm || null,
      potongan_susut: orNull(f.potongan_susut), potongan_ban: orNull(f.potongan_ban), potongan_sparepart: orNull(f.potongan_sparepart), potongan_lain: orNull(f.potongan_lain), potongan_pm: orNull(f.potongan_pm),
      potongan_kasbon: orNull(f.potongan_kasbon),
      selisih_bbm_liter: orNull(f.selisih_liter), selisih_bbm_price: orNull(f.selisih_price), selisih_bbm: selisih || null,
      potongan_pihak: orNull(f.potongan_pihak), potongan_pihak_nama: f.potongan_pihak_nama || null,
      tambahan_cuci: orNull(f.tambahan_cuci), tambahan_steam: orNull(f.tambahan_steam), tambahan_tol: orNull(f.tambahan_tol),
      tambahan_bantuan: orNull(f.tambahan_bantuan), tambahan_bantuan_ket: f.tambahan_bantuan_ket.trim() || null,
      keterangan: f.keterangan.trim() || null,
    }, k2 ? { contract_id: k2, estimasi_muat: orNull(f.est2) } : null)
  }

  return (
    <div className="form nsf" style={{ maxWidth: 680 }}>
      <div className="nsf-grid">
        <div className="nsf-f"><span>Contract</span><SearchSelect value={f.contract_id} onChange={v => set('contract_id', v)} placeholder="Pick… or leave empty" options={contracts.map(c => ({ value: c.id, label: c.control_no, sub: c.client || '', search: c.client || '' }))} /></div>
        {!f.contract_id && <label><span>Rute (belum ada kontrak) *</span><input value={f.rute} onChange={e => set('rute', e.target.value)} placeholder="mis. ANS - SDS" /></label>}
        <label><span>Date</span><input type="date" value={f.tanggal} onChange={e => set('tanggal', e.target.value)} /></label>
        <div className="nsf-f"><span>Truck</span><SearchSelect value={f.truck_id} onChange={v => set('truck_id', v)} placeholder="Pick…" options={trucks.map(t => ({ value: t.id, label: t.plate }))} /></div>
        <div className="nsf-f"><span>Driver</span><SearchSelect value={f.driver_name} onChange={v => set('driver_name', v)} placeholder="Pick…" options={drivers.map(d => ({ value: d.name, label: d.nickname ? `${d.name} (${d.nickname})` : d.name }))} /></div>
        <label><span>Borongan *</span><NumInput value={f.borongan} onChange={v => set('borongan', v)} onCommit={v => set('borongan', v)} /></label>
        <label><span>BBM Liter</span><NumInput value={f.bbm_liter} onChange={v => set('bbm_liter', v)} onCommit={v => set('bbm_liter', v)} />
          {f.driver_name && outstanding.bbm > 0 ? <span className="nsf-out">Sisa pinjaman BBM: {outstanding.bbm.toLocaleString('id-ID')} L<button type="button" className="nsf-deduct" onClick={() => set('bbm_liter', String(outstanding.bbm))}>Pakai semua</button></span> : null}</label>
        <label><span>BBM Price/L</span><NumInput value={f.price_per_liter} onChange={v => set('price_per_liter', v)} onCommit={v => set('price_per_liter', v)} /></label>
        <label><span>Pot Susut</span><NumInput value={f.potongan_susut} onChange={v => set('potongan_susut', v)} onCommit={v => set('potongan_susut', v)} /></label>
        <label><span>Pot Ban</span><NumInput value={f.potongan_ban} onChange={v => set('potongan_ban', v)} onCommit={v => set('potongan_ban', v)} /></label>
        <label><span>Pot Spare Part</span><NumInput value={f.potongan_sparepart} onChange={v => set('potongan_sparepart', v)} onCommit={v => set('potongan_sparepart', v)} /></label>
        <label><span>Pot Lain</span><NumInput value={f.potongan_lain} onChange={v => set('potongan_lain', v)} onCommit={v => set('potongan_lain', v)} /></label>
        <label><span>PM *</span><NumInput value={f.potongan_pm} onChange={v => set('potongan_pm', v)} onCommit={v => set('potongan_pm', v)} /></label>
        <label><span>Pot Kasbon</span><NumInput value={f.potongan_kasbon} onChange={v => set('potongan_kasbon', v)} onCommit={v => set('potongan_kasbon', v)} />
          {f.driver_name ? <span className="nsf-out">Sisa: {rp(outstanding.kasbon)}{outstanding.kasbon > 0 ? <button type="button" className="nsf-deduct" onClick={() => set('potongan_kasbon', String(outstanding.kasbon))}>Deduct</button> : null}</span> : null}</label>
      </div>
      <div className="nsf-note">Total BBM: {rp(totalBbm)}</div>

      <button type="button" className="btn ghost nsf-toggle" onClick={() => setShowK2(v => !v)}>{showK2 ? '\u25be' : '\u25b8'} Kontrak kedua — satu muatan, dua kontrak (opsional)</button>
      {showK2 && (
        <div className="nsf-adj"><div className="nsf-grid">
          <div className="nsf-f"><span>Kontrak kedua</span><SearchSelect value={f.contract2_id} onChange={v => set('contract2_id', v)} placeholder="Pick…" options={contracts.filter(c => c.id !== f.contract_id).map(c => ({ value: c.id, label: c.control_no, sub: `${c.origin || '—'} → ${c.destination || '—'}`, search: c.client || '' }))} /></div>
          <label><span>Est. muat kontrak kedua (kg)</span><NumInput value={f.est2} onChange={v => set('est2', v)} onCommit={v => set('est2', v)} /></label>
          <div className="nsf-note" style={{ gridColumn: '1 / -1', marginTop: 0 }}>Uang jalan tetap satu slip (kontrak pertama). Kontrak kedua mendapat nomor DO sendiri; muatan/bongkar-nya diisi di halaman kontrak.{k2 && cap != null ? ` Est. muat kontrak pertama: ${fmtId(estMain)} kg.` : ''}</div>
        </div></div>
      )}

      <button type="button" className="btn ghost nsf-toggle" onClick={() => setShowAdj(v => !v)}>{showAdj ? '\u25be Sembunyikan' : '\u25b8 Tampilkan'} Penyesuaian — Selisih BBM, Potongan ANS/MNA, Cuci, Steam, Jembatan/Tol, Bantuan, Retur</button>
      {showAdj && (
        <div className="nsf-adj"><div className="nsf-grid">
          <label><span>Selisih BBM Liter</span><NumInput value={f.selisih_liter} onChange={v => set('selisih_liter', v)} onCommit={v => set('selisih_liter', v)} /></label>
          <label><span>Selisih BBM Price/L</span><NumInput value={f.selisih_price} onChange={v => set('selisih_price', v)} onCommit={v => set('selisih_price', v)} /></label>
          <label><span>Potongan ANS/MNA</span><NumInput value={f.potongan_pihak} onChange={v => set('potongan_pihak', v)} onCommit={v => set('potongan_pihak', v)} /></label>
          <label><span>Dari pihak</span><select value={f.potongan_pihak_nama} onChange={e => set('potongan_pihak_nama', e.target.value)}><option value="">—</option><option value="ANS">ANS</option><option value="MNA">MNA</option><option value="Lainnya">Lainnya</option></select></label>
          <label><span>Cuci tangki</span><NumInput value={f.tambahan_cuci} onChange={v => set('tambahan_cuci', v)} onCommit={v => set('tambahan_cuci', v)} /></label>
          <label><span>Double steam</span><NumInput value={f.tambahan_steam} onChange={v => set('tambahan_steam', v)} onCommit={v => set('tambahan_steam', v)} /></label>
          <label><span>Uang jembatan / tol</span><NumInput value={f.tambahan_tol} onChange={v => set('tambahan_tol', v)} onCommit={v => set('tambahan_tol', v)} /></label>
          <label><span>Bantuan</span><NumInput value={f.tambahan_bantuan} onChange={v => set('tambahan_bantuan', v)} onCommit={v => set('tambahan_bantuan', v)} /></label>
          <label><span>Keterangan bantuan</span><input value={f.tambahan_bantuan_ket} onChange={e => set('tambahan_bantuan_ket', e.target.value)} placeholder="mis. Bantuan tol" /></label>
        </div></div>
      )}

      <label className="nsf-ket"><span>Keterangan</span><input value={f.keterangan} onChange={e => set('keterangan', e.target.value)} /></label>
      {err && <div style={{ color: 'var(--urgent)', fontSize: 12, marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 10 }}>
        <span style={{ fontWeight: 700 }}>Sisa: {rp(sisa)}</span>
        <div className="btn-group" style={{ marginLeft: 'auto' }}>
          <button className="btn primary" onClick={submit}>Create slip</button>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function SlipPrintH({ d, c, onClose }) {
  const parts = d.parts || []
  const span = 1 + parts.length
  return (
    <div className="slip-scrim">
      <div className="slip-hp">
        <div className="slip-h">SLIP UANG JALAN{d.is_retur ? ' (RETUR)' : ''}</div>
        <div className="slip-hp-meta">
          <div><b>Plat BK:</b> {d.plate || '—'}</div>
          <div><b>Tanggal DO:</b> {fmtDate(d.tanggal)}</div>
          <div><b>Nama Supir:</b> {d.driver_name || '—'}</div>
          <div><b>Nomor DO:</b> {[d.do_no, ...parts.map(p => p.do_no)].map(n => n ?? '—').join(' / ')}</div>
        </div>
        <table className="slip-hp-tbl">
          <thead><tr>
            <th>NO</th><th>NOMOR KONTROL</th><th>ASAL</th><th>TUJUAN</th><th>JUMLAH BORONGAN</th>
            <th>BBM LITER</th><th>PRICE/L</th><th>TOTAL BBM</th><th>SUSUT</th><th>BAN</th><th>S.PART</th><th>LAIN</th><th>PM</th><th>KASBON</th><th>SISA BORONGAN</th><th>KETERANGAN</th>
          </tr></thead>
          <tbody><tr>
            <td>{d.do_no ?? '—'}</td><td>{c.control_no || '—'}</td>{d.contract_id ? <><td>{c.origin || '—'}</td><td>{c.destination || '—'}</td></> : <td colSpan={2}>{d.rute || '—'}</td>}
            <td className="r" rowSpan={span}>{rp(d.borongan)}</td><td className="r" rowSpan={span}>{d.bbm_liter || ''}</td><td className="r" rowSpan={span}>{rp(d.price_per_liter)}</td><td className="r" rowSpan={span}>{rp(totalBbm(d))}</td>
            <td className="r" rowSpan={span}>{rp(d.potongan_susut)}</td><td className="r" rowSpan={span}>{rp(d.potongan_ban)}</td><td className="r" rowSpan={span}>{rp(d.potongan_sparepart)}</td><td className="r" rowSpan={span}>{rp(d.potongan_lain)}</td><td className="r" rowSpan={span}>{rp(d.potongan_pm)}</td><td className="r" rowSpan={span}>{rp(d.potongan_kasbon)}</td>
            <td className="r" rowSpan={span} style={{ fontWeight: 800 }}>{rp(netOf(d))}</td><td rowSpan={span}>{d.keterangan || ''}</td>
          </tr>
          {parts.map(p => (
            <tr key={p.id}><td>{p.do_no ?? '—'}</td><td>{p.contract?.control_no || '—'}</td><td>{p.contract?.origin || '—'}</td><td>{p.contract?.destination || '—'}</td></tr>
          ))}</tbody>
        </table>
        {hasAdj(d) && (
          <table className="slip-hp-tbl" style={{ marginTop: 8 }}>
            <thead><tr><th colSpan={2}>PENYESUAIAN</th></tr></thead>
            <tbody>
              {d.selisih_bbm ? <tr><td>Potongan Selisih BBM{d.selisih_bbm_liter ? ` (${fmtId(d.selisih_bbm_liter)} L × ${rp(d.selisih_bbm_price)})` : ''}</td><td className="r">− {rp(d.selisih_bbm)}</td></tr> : null}
              {d.potongan_pihak ? <tr><td>Potongan {d.potongan_pihak_nama || 'pihak'}</td><td className="r">− {rp(d.potongan_pihak)}</td></tr> : null}
              {d.tambahan_cuci ? <tr><td>Tambahan Cuci Tangki</td><td className="r">+ {rp(d.tambahan_cuci)}</td></tr> : null}
              {d.tambahan_steam ? <tr><td>Tambahan Double Steam</td><td className="r">+ {rp(d.tambahan_steam)}</td></tr> : null}
              {d.tambahan_tol ? <tr><td>Tambahan Uang Jembatan / Tol</td><td className="r">+ {rp(d.tambahan_tol)}</td></tr> : null}
              {d.tambahan_bantuan ? <tr><td>Tambahan Bantuan{d.tambahan_bantuan_ket ? ` — ${d.tambahan_bantuan_ket}` : ''}</td><td className="r">+ {rp(d.tambahan_bantuan)}</td></tr> : null}
            </tbody>
          </table>
        )}
        <div className="slip-sign" style={{ marginTop: 40 }}><div>Diterima,</div><div>Hormat kami,</div></div>
      </div>
      <div className="slip-actions no-print">
        <button className="btn primary" onClick={() => window.print()}>Print</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

// Tambahan uang jalan: extra cash on a later day, attached to this slip's trip.
// Booked in Laporan Kas and the Daily Report on ITS OWN date — the slip's day
// and its Sisa do not move. "Potong supir" counts into the driver's kasbon.
function TambahanModal({ d, drivers, extras, onAdd, onDel, onClose }) {
  const [f, setF] = useState({ tanggal: localToday(), amount: '', ket: '', beban: 'perusahaan', driver: d.oper_driver_name || d.driver_name || '' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  return (
    <div className="slip-scrim">
      <div className="rel-modal" style={{ width: 660, maxWidth: '94vw' }}>
        <div className="slip-h" style={{ fontSize: 18 }}>Tambahan uang jalan · {d.plate || '—'} {d.driver_name ? `· ${d.driver_name}` : ''}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          Slip {fmtDate(d.tanggal)}{d.contract?.control_no ? ` · kontrak ${d.contract.control_no}` : ''} — tambahan dicatat pada tanggalnya sendiri, slip tidak berubah.
        </div>
        {extras.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="dk-tbl ct-tbl" style={{ width: '100%' }}>
            <thead><tr><th>Tanggal</th><th className="r">Jumlah</th><th>Beban</th><th>Penerima</th><th>Keterangan</th><th></th></tr></thead>
            <tbody>
              {extras.map(x => (
                <tr key={x.id}>
                  <td>{fmtDate(x.tanggal)}</td><td className="r mono">{rp(x.amount)}</td>
                  <td>{x.beban === 'supir' ? 'Potong supir' : 'Perusahaan'}</td>
                  <td>{x.driver_name || '—'}</td><td>{x.keterangan || ''}</td>
                  <td><button className="btn ghost sm void-btn" onClick={() => onDel(x)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <div className="adj-grid" style={{ marginTop: 14 }}>
          <label><span>Tanggal uang keluar</span><input type="date" value={f.tanggal} onChange={e => set('tanggal', e.target.value)} /></label>
          <label><span>Jumlah (Rp)</span><NumInput value={f.amount} onChange={v => set('amount', v)} onCommit={v => set('amount', v)} /></label>
          <label><span>Penerima</span>
            <select value={f.driver} onChange={e => set('driver', e.target.value)}>
              <option value="">—</option>
              {drivers.map(dr => <option key={dr.name} value={dr.name}>{dr.name}{dr.nickname ? ` (${dr.nickname})` : ''}</option>)}
              {[d.driver_name, d.oper_driver_name].filter(n => n && !drivers.some(x => x.name === n)).map(n => <option key={n} value={n}>{n}</option>)}
            </select></label>
          <label><span>Keterangan</span><input value={f.ket} placeholder="mis. cuci tangki dibayar belakangan" onChange={e => set('ket', e.target.value)} /></label>
        </div>
        <div className="seg" style={{ marginTop: 10 }}>
          <button type="button" className={f.beban === 'perusahaan' ? 'on' : ''} onClick={() => set('beban', 'perusahaan')}>Biaya perusahaan</button>
          <button type="button" className={f.beban === 'supir' ? 'on' : ''} onClick={() => set('beban', 'supir')}>Potong supir</button>
        </div>
        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => { onAdd(f); set('amount', ''); set('ket', '') }}>Simpan tambahan</button>
          <button className="btn ghost" onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  )
}
