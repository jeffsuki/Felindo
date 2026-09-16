import { useEffect, useState } from 'react'
import { supabase, isConfigured } from '../supabaseClient'
import { Spinner } from '../components/ui'

// Placeholder for the Warehouse area (spare parts / inventory). Spare parts
// were deliberately deferred from v1 (large data set); this is where stock,
// part requests, and vendor supply get built out.
export default function WarehouseHome() {
  const [vendors, setVendors] = useState(null)

  useEffect(() => {
    if (!isConfigured) return
    supabase.from('vendors').select('id', { count: 'exact', head: true }).eq('status', 'Active')
      .then(({ count }) => setVendors(count))
  }, [])

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Warehouse</h1>
          <div className="sub">Spare parts and inventory</div>
        </div>
      </div>
      <div className="content">
        {vendors === null ? <Spinner label="Loading…" /> : (
          <div className="metrics">
            <div className="metric"><div className="k">Active vendors</div><div className="v">{vendors ?? '—'}</div></div>
          </div>
        )}
        <div className="empty" style={{ marginTop: 20 }}>
          <b>Warehouse features coming next</b>
          Spare-parts stock, part requests tied to work orders, and vendor supply will live here.
          Tell me what to build first.
        </div>
      </div>
    </>
  )
}
