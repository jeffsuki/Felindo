import { NavLink, useNavigate } from 'react-router-dom'
import { isConfigured } from '../supabaseClient'

const NAVS = {
  workshop: [
    { to: '/workshop', label: 'Shop board', end: true },
    { to: '/workshop/complaints', label: 'Complaints' },
    { to: '/workshop/triage', label: 'Sorting Work Orders' },
    { to: '/workshop/queue', label: 'Mechanic Management' },
    { to: '/workshop/floor', label: 'Floor' },
    { to: '/workshop/history', label: 'History' },
  ],
  fleet: [
    { to: '/fleet', label: 'Fleet overview', end: true },
    { to: '/fleet/contracts', label: 'Contracts' },
    { to: '/fleet/slips', label: 'Slip Uang Jalan' },
    { to: '/fleet/tembak', label: 'Uang Tembak' },
    { to: '/fleet/registers', label: 'Clients & Places' },
  ],
  warehouse: [
    { to: '/warehouse', label: 'Items', end: true },
  ],
  master: [
    { to: '/master', label: 'Master data', end: true },
  ],
}

export default function Layout({ section = 'workshop', children }) {
  const navigate = useNavigate()
  const nav = NAVS[section] || NAVS.workshop
  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <b>Felindo</b><span>{section === 'fleet' ? 'Fleet' : section === 'warehouse' ? 'Warehouse' : section === 'master' ? 'Master' : 'Workshop'}</span>
        </div>
        <NavLink to="/" className="rail-home">{'\u2190'} Home</NavLink>
        <nav className="nav">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => isActive ? 'active' : undefined}>
              <span className="dot" />{n.label}
            </NavLink>
          ))}
        </nav>
        {section === 'workshop' && (
          <div className="rail-cta">
            <button className="btn on-dark" onClick={() => navigate('/workshop/complaints?new=1')}>
              + New complaint
            </button>
          </div>
        )}
        <div className="rail-foot">
          {section === 'fleet' ? 'Fleet management.' : section === 'warehouse' ? 'Warehouse & spare parts.' : 'Truck repair management.'}<br />Single-supervisor build.
        </div>
      </aside>
      <main className="main">
        {!isConfigured && (
          <div style={{ padding: '24px 28px 0' }}>
            <div className="banner">
              Not connected to Supabase. Create a <code>.env</code> file with{' '}
              <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>,
              then restart <code>npm run dev</code>. See <code>.env.example</code>.
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
