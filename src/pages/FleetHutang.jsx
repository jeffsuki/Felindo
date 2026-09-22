import { useEffect, useState, useMemo } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner, Empty, Badge, useToast } from '../components/ui'
import { NumInput } from '../components/NumInput'

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const susutKg = d => (d.muatan != null && d.bongkar != null) ? Number(d.muatan) - Number(d.bongkar) : 0
const claimKg = d => { const tol = d.contract?.susut_tolerance; if (tol == null) return 0; return Math.max(susutKg(d) - Number(tol) * Number(d.muatan || 0), 0) }
const claimRp = d => claimKg(d) * num(d.contract?.price_per_kg)

const TABS = [['ringkasan', 'Hutang Supir'], ['susut', 'Susut'], ['sparepart', 'Spare Part'], ['ban', 'Ban']]
const JENIS_OF = { susut: 'Susut', sparepart: 'Ganti Spare Part', ban: 'Ganti Ban' }

export default function FleetHutang() {
  const { show, node } = useToast()
  const [dels, setDels] = useState([])
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ringkasan')
  const [openDriver, setOpenDriver] = useState(null)
  const [adding, setAdding] = useState(null)   // {driver} for manual claim

  async function load() {
    if (!isConfigured) { setLoading(false); return }
    setLoading(true)
    const [dl, cl] = await Promise.all([
      supabase.from('fleet_deliveries')
        .select('id,tanggal,plate,driver_name,muatan,bongkar,potongan_susut,jenis_potongan,contract:fleet_contracts(control_no,origin,destination,susut_tolerance,price_per_kg)')
        .not('driver_name', 'is', null),
      supabase.from('fleet_driver_claims').select('*').order('tanggal', { ascending: false }),
    ])
    setDels(dl.data || []); setClaims(cl.data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // per-driver account totals
  const accounts = useMemo(() => {
    const m = {}
    const ensure = n => (m[n] = m[n] || { driver: n, susutC: 0, susutP: 0, banC: 0, banP: 0, spC: 0, spP: 0 })
    for (const d of dels) {
      if (!d.driver_name) continue
      const a = ensure(d.driver_name)
      a.susutC += claimRp(d)
      const pot = num(d.potongan_susut)
      if (pot > 0) {
        if (d.jenis_potongan === 'Susut') a.susutP += pot
        else if (d.jenis_potongan === 'Ganti Ban') a.banP += pot
        else if (d.jenis_potongan === 'Ganti Spare Part') a.spP += pot
      }
    }
    for (const c of claims) {
      const a = ensure(c.driver_name)
      if (c.jenis === 'Ganti Ban') a.banC += num(c.amount)
      else if (c.jenis === 'Ganti Spare Part') a.spC += num(c.amount)
    }
    return Object.values(m).map(a => ({
      ...a,
      susut: a.susutC - a.susutP, ban: a.banC - a.banP, sp: a.spC - a.spP,
      total: (a.susutC - a.susutP) + (a.banC - a.banP) + (a.spC - a.spP),
    })).sort((x, y) => y.total - x.total || x.driver.localeCompare(y.driver))
  }, [dels, claims])

  async function addClaim(driver, jenis, amount, tanggal, note) {
    const { error } = await supabase.from('fleet_driver_claims').insert({ driver_name: driver, jenis, amount: num(amount), tanggal: tanggal || null, note: note || null })
    if (error) return show(error.message, true)
    show('Claim added.'); setAdding(null); load()
  }
  async function delClaim(id) {
    const { error } = await supabase.from('fleet_driver_claims').delete().eq('id', id)
    if (error) return show(error.message, true)
    load()
  }

  if (loading) return (<><div className="topbar"><div><h1>Hutang Supir</h1></div></div><div className="content"><Spinner /></div></>)

  return (
    <>
      <div className="topbar">
        <div><h1>Hutang Supir</h1><div className="sub">Driver accounts — claims minus payments</div></div>
        <div className="seg-lens">{TABS.map(([v, l]) => <button key={v} className={tab === v ? 'on' : ''} onClick={() => { setTab(v); setOpenDriver(null) }}>{l}</button>)}</div>
      </div>
      <div className="content" style={{ maxWidth: 980 }}>
        {tab === 'ringkasan' ? (
          accounts.length === 0 ? <Empty title="Nothing yet">Driver debts appear here.</Empty> : (
            <div className="dk-wrap"><table className="dk-tbl ct-tbl">
              <thead><tr><th>Supir</th><th className="r">Susut</th><th className="r">Spare Part</th><th className="r">Ban</th><th className="r">Total Hutang</th></tr></thead>
              <tbody>
                {accounts.map(a => (
                  <tr key={a.driver}>
                    <td>{a.driver}</td>
                    <td className="r mono">{rp(a.susut)}</td><td className="r mono">{rp(a.sp)}</td><td className="r mono">{rp(a.ban)}</td>
                    <td className="r mono" style={{ fontWeight: 700, color: a.total > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{rp(a.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )
        ) : (
          <AccountView tab={tab} accounts={accounts} dels={dels} claims={claims} openDriver={openDriver} setOpenDriver={setOpenDriver}
            onAdd={(driver) => setAdding({ driver, jenis: JENIS_OF[tab] })} onDelClaim={delClaim} />
        )}
      </div>
      {adding && <ClaimModal adding={adding} onSave={(amt, tgl, note) => addClaim(adding.driver, adding.jenis, amt, tgl, note)} onClose={() => setAdding(null)} />}
      {node}
    </>
  )
}

function AccountView({ tab, accounts, dels, claims, openDriver, setOpenDriver, onAdd, onDelClaim }) {
  const bal = a => tab === 'susut' ? a.susut : tab === 'ban' ? a.ban : a.sp
  const list = accounts.filter(a => (tab === 'susut' ? (a.susutC || a.susutP) : tab === 'ban' ? (a.banC || a.banP) : (a.spC || a.spP)))
  if (list.length === 0) return <Empty title="Nothing here">No {tab} activity yet.</Empty>
  return (
    <div className="clist">
      {list.map(a => {
        const open = openDriver === a.driver
        const jenis = JENIS_OF[tab]
        const payments = dels.filter(d => d.driver_name === a.driver && num(d.potongan_susut) > 0 && d.jenis_potongan === jenis)
        const susutClaims = tab === 'susut' ? dels.filter(d => d.driver_name === a.driver && claimRp(d) > 0) : []
        const manualClaims = tab !== 'susut' ? claims.filter(c => c.driver_name === a.driver && c.jenis === jenis) : []
        return (
          <div className={'crow' + (open ? ' open' : '')} key={a.driver}>
            <div className="crow-head" onClick={() => setOpenDriver(open ? null : a.driver)}>
              <div className="crow-desc"><div className="d">{a.driver}</div><div className="m">balance</div></div>
              <div className="crow-meta"><span className="fc-out" style={{ fontWeight: 700, color: bal(a) > 0 ? 'var(--urgent)' : 'var(--ok)' }}>{rp(bal(a))}</span></div>
              <span className="crow-caret">▶</span>
            </div>
            {open && (
              <div className="crow-detail">
                <div className="fd-sec">Claims</div>
                {tab === 'susut' ? (
                  susutClaims.length === 0 ? <div className="pool-hint">No susut claims.</div> : (
                    <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Route</th><th className="r">Susut kg</th><th className="r">Rp/kg</th><th className="r">Claim</th></tr></thead>
                      <tbody>{susutClaims.map(d => <tr key={d.id}><td>{fmtDate(d.tanggal)}</td><td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td><td className="r mono">{claimKg(d).toLocaleString('id-ID')}</td><td className="r mono">{rp(d.contract?.price_per_kg)}</td><td className="r mono">{rp(claimRp(d))}</td></tr>)}</tbody></table>
                  )
                ) : (
                  <>
                    {manualClaims.length === 0 ? <div className="pool-hint">No claims yet.</div> : (
                      <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Note</th><th className="r">Amount</th><th></th></tr></thead>
                        <tbody>{manualClaims.map(c => <tr key={c.id}><td>{fmtDate(c.tanggal)}</td><td>{c.note || '—'}</td><td className="r mono">{rp(c.amount)}</td><td><button className="btn ghost sm void-btn" onClick={() => { if (confirm('Delete claim?')) onDelClaim(c.id) }}>✕</button></td></tr>)}</tbody></table>
                    )}
                    <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => onAdd(a.driver)}>+ Add claim</button>
                  </>
                )}
                <div className="fd-sec" style={{ marginTop: 14 }}>Payments (potongan)</div>
                {payments.length === 0 ? <div className="pool-hint">No payments.</div> : (
                  <table className="dk-tbl ct-tbl"><thead><tr><th>Date</th><th>Plate</th><th>Route</th><th className="r">Paid</th></tr></thead>
                    <tbody>{payments.map(d => <tr key={d.id}><td>{fmtDate(d.tanggal)}</td><td className="mono">{d.plate || '—'}</td><td>{d.contract?.origin || '—'} → {d.contract?.destination || '—'}</td><td className="r mono">{rp(d.potongan_susut)}</td></tr>)}</tbody></table>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ClaimModal({ adding, onSave, onClose }) {
  const [amt, setAmt] = useState(''); const [tgl, setTgl] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState('')
  return (
    <div className="slip-scrim">
      <div className="rel-modal" style={{ width: 420 }}>
        <div className="slip-h" style={{ fontSize: 18 }}>Add {adding.jenis} claim · {adding.driver}</div>
        <div className="adj-grid" style={{ marginTop: 12 }}>
          <label><span>Amount</span><NumInput value={amt} onChange={setAmt} onCommit={setAmt} /></label>
          <label><span>Date</span><input type="date" value={tgl} onChange={e => setTgl(e.target.value)} /></label>
        </div>
        <label className="nsf-ket" style={{ marginTop: 8 }}><span>Note</span><input value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => onSave(amt, tgl, note)}>Add</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
