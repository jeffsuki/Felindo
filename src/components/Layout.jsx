import { NavLink, useNavigate } from 'react-router-dom'
import { isConfigured } from '../supabaseClient'

const NAV = [
  { to: '/', label: 'Shop board', end: true },
  { to: '/queue', label: 'Mechanic queue' },
  { to: '/triage', label: 'Triage & assign' },
  { to: '/history', label: 'History' },
]

export default function Layout({ children }) {
  const navigate = useNavigate()
  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <b>Bengkel</b><span>v1</span>
        </div>
        <nav className="nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => isActive ? 'active' : undefined}>
              <span className="dot" />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="rail-cta">
          <button className="btn on-dark" onClick={() => navigate('/new')}>
            + New complaint
          </button>
        </div>
        <div className="rail-foot">
          Truck repair management.<br />Single-supervisor build.
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
