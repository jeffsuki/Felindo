import { Routes, Route } from 'react-router-dom'
import SectionGate from './components/Gate'
import Layout from './components/Layout'
import Home from './pages/Home'
import FleetHome from './pages/FleetHome'
import WarehouseHome from './pages/WarehouseHome'
import Dashboard from './pages/Dashboard'
import Queue from './pages/Queue'
import Triage from './pages/Triage'
import Floor from './pages/Floor'
import History from './pages/History'
import MasterData from './pages/MasterData'
import Complaints from './pages/Complaints'

function Workshop() {
  return (
    <Layout section="workshop">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="triage" element={<Triage />} />
        <Route path="queue" element={<Queue />} />
        <Route path="floor" element={<Floor />} />
        <Route path="history" element={<History />} />
      </Routes>
    </Layout>
  )
}

function Fleet() {
  return (
    <Layout section="fleet">
      <Routes><Route path="/" element={<FleetHome />} /></Routes>
    </Layout>
  )
}

function Warehouse() {
  return (
    <Layout section="warehouse">
      <Routes><Route path="/" element={<WarehouseHome />} /></Routes>
    </Layout>
  )
}

function Master() {
  return (
    <Layout section="master">
      <Routes><Route path="/" element={<MasterData />} /></Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/workshop/*" element={<SectionGate section="workshop" label="Truck Workshop"><Workshop /></SectionGate>} />
      <Route path="/fleet/*" element={<SectionGate section="fleet" label="Fleet Management"><Fleet /></SectionGate>} />
      <Route path="/warehouse/*" element={<SectionGate section="warehouse" label="Warehouse"><Warehouse /></SectionGate>} />
      <Route path="/master/*" element={<SectionGate section="master" label="Master Data"><Master /></SectionGate>} />
    </Routes>
  )
}
