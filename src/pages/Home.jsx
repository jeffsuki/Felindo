import { useNavigate } from 'react-router-dom'

export default function Home() {
  const nav = useNavigate()
  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-brand">Felindo</div>
        <div className="home-tagline">Fleet & workshop management</div>
        <div className="home-cards">
          <button className="home-card" onClick={() => nav('/fleet')}>
            <div className="hc-title">Fleet Management</div>
            <div className="hc-sub">Trucks, drivers, and the fleet at a glance</div>
          </button>
          <button className="home-card" onClick={() => nav('/workshop')}>
            <div className="hc-title">Truck Workshop</div>
            <div className="hc-sub">Complaints, work orders, mechanics, and repair history</div>
          </button>
          <button className="home-card" onClick={() => nav('/warehouse')}>
            <div className="hc-title">Warehouse</div>
            <div className="hc-sub">Spare parts, stock, and vendor supply</div>
          </button>
          <button className="home-card" onClick={() => nav('/master')}>
            <div className="hc-title">Master Data</div>
            <div className="hc-sub">Trucks, drivers, mechanics, and vendors</div>
          </button>
        </div>
      </div>
    </div>
  )
}
